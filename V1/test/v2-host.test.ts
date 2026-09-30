import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { OpenCodeHost, PluginOpenCodeHost } from "../src/v2/opencode-host.js";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const session = {
    create: vi.fn().mockResolvedValue({ data: { id: "child" } }),
    prompt: vi.fn().mockResolvedValue({ data: { info: { structured: { outcome: "completed" } } } }),
    abort: vi.fn().mockResolvedValue({ data: true }),
    get: vi.fn().mockResolvedValue({ data: { id: "child" } }),
    status: vi.fn().mockResolvedValue({ data: {} }),
    messages: vi.fn().mockResolvedValue({ data: [] }),
  };
  const activity = vi.fn();
  const host = new OpenCodeHost({ session } as unknown as ConstructorParameters<typeof OpenCodeHost>[0], activity);
  return { session, host, activity };
}
const prompt = { sessionId: "child", directory: "/isolated", agent: "sol-executor", prompt: "trusted assignment", schema: { type: "object", required: ["outcome"] } };

describe("OpenCodeHost native SDK boundary", () => {
  it.each([false, true])("explicitly denies executable tools for root inspectors (metadata=%s)", async metadata => {
    const { host, session } = fixture();
    await host.createSession({ parentSessionId: "parent", directory: "/original project", agent: "sol-executor", title: "Inspect",
      ...(metadata ? {} : { readOnly: true }), metadata: metadata ? { sol: { readOnly: true } } : {} });
    const request = session.create.mock.calls[0]![0];
    expect(request.directory).toBe("/original project");
    const policy = request.permission as { permission: string; action: string }[];
    for (const permission of ["edit", "bash", "sol_check", "unknown_tool"]) {
      expect(policy.findLast(rule => rule.permission === permission || rule.permission === "*")?.action).toBe("deny");
    }
    for (const permission of ["read", "glob", "grep", "sol_observe", "StructuredOutput"]) {
      expect(policy.findLast(rule => rule.permission === permission || rule.permission === "*")?.action).toBe("allow");
    }
  });
  it.each([400, 429, 500])("classifies explicit creation HTTP %s without guessing transport outcomes", async status => {
    const { host, session } = fixture();
    session.create.mockResolvedValueOnce({ error: { message: "private" }, response: { status } });
    await expect(host.createSession({ parentSessionId: "parent", directory: "/isolated", agent: "sol-executor", title: "Work", metadata: {} }))
      .rejects.toMatchObject({ name: "HostCreationError", created: status === 500 ? "unknown" : "no", retryable: status === 429 });
    session.create.mockRejectedValueOnce(new Error("transport timed out"));
    await expect(host.createSession({ parentSessionId: "parent", directory: "/isolated", agent: "sol-executor", title: "Work", metadata: {} }))
      .rejects.not.toMatchObject({ created: "no" });
  });
  it("creates a directory-bound child with parent, role, metadata and restrictive permissions", async () => {
    const { host, session } = fixture();
    const metadata = { sol: { attemptId: "attempt" } };
    expect(await host.createSession({ parentSessionId: "parent", directory: "/isolated", agent: "sol-executor", title: "Work", metadata })).toBe("child");
    expect(session.create).toHaveBeenCalledWith({ parentID: "parent", directory: "/isolated", agent: "sol-executor", title: "Work", metadata,
      permission: [...["task", "question", "sol_plan", "sol_run", "sol_cancel", "sol_ask", "external_directory"].map(permission => ({ permission, pattern: "*", action: "deny" })),
        { permission: "StructuredOutput", pattern: "*", action: "allow" }],
    }, { throwOnError: false });
    session.create.mockResolvedValueOnce({ data: {} });
    await expect(host.createSession({ parentSessionId: "parent", directory: "/isolated", agent: "sol-executor", title: "Work", metadata })).rejects.toThrow("identity");
  });

  it("sends JSON schema and returns the actual structured field, forwarding cancellation", async () => {
    const { host, session } = fixture(), signal = new AbortController().signal;
    session.prompt.mockResolvedValueOnce({ data: { info: { structured: { correct: true }, structured_output: { obsolete: true } } } });
    expect(await host.prompt({ ...prompt, signal })).toEqual({ correct: true });
    expect(session.prompt).toHaveBeenCalledWith({ sessionID: "child", directory: "/isolated", agent: "sol-executor",
      parts: [{ type: "text", text: "trusted assignment" }], format: { type: "json_schema", schema: prompt.schema, retryCount: 1 },
    }, { throwOnError: true, signal });
  });

  it.each([
    { info: {} },
    { info: { structured_output: { obsolete: true } } },
    { info: { structured: { valid: true }, error: { name: "APIError", data: { message: "provider failed" } } } },
  ])("rejects missing structure or assistant errors: %j", async data => {
    const { host, session } = fixture(); session.prompt.mockResolvedValueOnce({ data });
    await expect(host.prompt(prompt)).rejects.toThrow(/structured specialist result|Specialist APIError/);
  });

  it.each(["idle", "missing"])("confirms abort only after %s", async state => {
    const { host, session } = fixture();
    if (state === "missing") session.get.mockResolvedValueOnce({ error: {}, response: { status: 404 } });
    await expect(host.abort("child", "/isolated")).resolves.toBeUndefined();
    expect(session.abort).toHaveBeenCalledWith({ sessionID: "child", directory: "/isolated" }, { throwOnError: true });
    expect(session.get).toHaveBeenCalledWith({ sessionID: "child", directory: "/isolated" });
    expect(session.abort.mock.invocationCallOrder[0]).toBeLessThan(session.get.mock.invocationCallOrder[0]!);
  });

  it.each([true, false])("preserves typed provider retryability (%s) without leaking raw error bodies", async retryable => {
    const { host, session } = fixture();
    session.prompt.mockResolvedValueOnce({ data: { info: { error: { name: "APIError", data: { isRetryable: retryable, message: "private provider body" } } } } });
    await expect(host.prompt(prompt)).rejects.toMatchObject({ name: "HostExecutionError", message: "Specialist APIError", retryable });
  });

  it.each(["running", "unknown"])("rejects unconfirmed %s abort", async state => {
    const { host, session } = fixture();
    session.status.mockResolvedValue({ ...(state === "running" ? { data: { child: { type: "busy" } } } : { error: {} }) });
    await expect(host.abort("child", "/isolated")).rejects.toThrow("not yet confirmed");
  });

  it("distinguishes absent idle entries from API failures and missing sessions", async () => {
    const { host, session } = fixture();
    expect(await host.status("child", "/isolated")).toBe("idle");
    session.status.mockResolvedValueOnce({ data: { child: { type: "retry" } } });
    expect(await host.status("child", "/isolated")).toBe("running");
    session.get.mockResolvedValueOnce({ error: {}, response: { status: 500 } });
    expect(await host.status("child", "/isolated")).toBe("unknown");
    session.get.mockRejectedValueOnce(new Error("offline"));
    expect(await host.status("child", "/isolated")).toBe("unknown");
    session.status.mockResolvedValueOnce({ error: {} });
    expect(await host.status("child", "/isolated")).toBe("unknown");
    session.status.mockResolvedValueOnce({});
    expect(await host.status("child", "/isolated")).toBe("unknown");
    session.get.mockResolvedValueOnce({ error: {}, response: { status: 404 } });
    expect(await host.status("child", "/isolated")).toBe("missing");
  });

  it("recovers the latest structured assistant result without returning transcript text", async () => {
    const { host, session } = fixture();
    session.messages.mockResolvedValueOnce({ data: [
      { info: { role: "assistant", structured: { old: true } } },
      { info: { role: "assistant", structured: { final: true } } },
      { info: { role: "user", structured: { forged: true } } },
      { info: { role: "assistant" }, parts: [{ text: "raw tokens" }] },
    ] });
    expect(await host.lastResult("child", "/isolated")).toEqual({ final: true });
    expect(session.messages).toHaveBeenCalledWith({ sessionID: "child", directory: "/isolated", limit: 1 }, { throwOnError: true });
    expect(await host.lastResult("child", "/isolated")).toBeUndefined();
  });
});

describe("PluginOpenCodeHost with the real public v1 SDK", () => {
  function inprocess() {
    const requests: Request[] = [];
    let reply: (request: Request) => Response = request => {
      const path = new URL(request.url).pathname;
      if (path === "/session" && request.method === "POST") return Response.json({ id: "child" });
      if (path === "/session/child/message" && request.method === "POST") return Response.json({ info: { structured: { completed: true } }, parts: [] });
      if (path === "/session/child/abort") return Response.json(true);
      if (path === "/session/child") return Response.json({ id: "child" });
      if (path === "/session/status") return Response.json({});
      throw new Error(`Unexpected SDK request: ${request.method} ${request.url}`);
    };
    const fake = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init); requests.push(request.clone()); return reply(request);
    });
    const globalFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network access"));
    const client = createOpencodeClient({ baseUrl: "http://inprocess.invalid", fetch: fake,
      headers: { Authorization: "Bearer test" }, directory: "/parent project" });
    return { host: new PluginOpenCodeHost(client), requests, globalFetch, respond: (handler: typeof reply) => { reply = handler; } };
  }

  it("preserves authenticated in-process fetch and serializes native fields and isolated directory overrides", async () => {
    const s = inprocess();
    const metadata = { sol: { attemptId: "attempt" } };
    expect(await s.host.createSession({ parentSessionId: "parent", directory: "/isolated", agent: "sol-executor", title: "Work", metadata })).toBe("child");
    expect(await s.requests[0]!.json()).toEqual({ parentID: "parent", agent: "sol-executor", title: "Work", metadata,
      permission: [...["task", "question", "sol_plan", "sol_run", "sol_cancel", "sol_ask", "external_directory"].map(permission => ({ permission, pattern: "*", action: "deny" })),
        { permission: "StructuredOutput", pattern: "*", action: "allow" }],
    });
    expect(await s.host.prompt(prompt)).toEqual({ completed: true });
    expect(await s.requests[1]!.json()).toEqual({ agent: "sol-executor", parts: [{ type: "text", text: prompt.prompt }],
      format: { type: "json_schema", schema: prompt.schema, retryCount: 1 } });
    await s.host.abort("child", "/isolated");
    expect(s.requests.map(request => [request.method, new URL(request.url).pathname])).toEqual([
      ["POST", "/session"], ["POST", "/session/child/message"], ["POST", "/session/child/abort"], ["GET", "/session/child"], ["GET", "/session/status"],
    ]);
    for (const request of s.requests) {
      expect(new URL(request.url).origin).toBe("http://inprocess.invalid");
      expect(request.headers.get("authorization")).toBe("Bearer test");
      expect(new URL(request.url).searchParams.get("directory")).toBe("/isolated");
      // Pinned v1.18.30 workspace-routing.ts defaultDirectory prefers query over header.
      // The SDK retains the default header on POST and strips it on GET; the explicit
      // isolated query above is therefore essential when creating the child session.
      expect(request.headers.get("x-opencode-directory")).toBe(request.method === "GET" ? null : encodeURIComponent("/parent project"));
    }
    expect(s.globalFetch).not.toHaveBeenCalled();
  });

  it("serializes root inspector permissions through the real SDK with no executable shell", async () => {
    const s = inprocess();
    await s.host.createSession({ parentSessionId: "parent", directory: "/original project", agent: "sol-executor", title: "Inspect", readOnly: true, metadata: {} });
    expect(new URL(s.requests[0]!.url).searchParams.get("directory")).toBe("/original project");
    const policy = (await s.requests[0]!.json()).permission as { permission: string; action: string }[];
    for (const permission of ["bash", "edit", "sol_check", "unknown_tool"]) expect(policy.findLast(rule => rule.permission === permission || rule.permission === "*")?.action).toBe("deny");
    for (const permission of ["read", "glob", "grep", "sol_observe", "StructuredOutput"]) expect(policy.findLast(rule => rule.permission === permission || rule.permission === "*")?.action).toBe("allow");
  });

  it.each([400, 429])("preserves definitive HTTP %s creation rejection through the actual SDK", async status => {
    const s = inprocess(); s.respond(() => Response.json({ name: "BadRequestError", data: { message: "rejected" } }, { status }));
    await expect(s.host.createSession({ parentSessionId: "parent", directory: "/isolated", agent: "sol-executor", title: "Work", metadata: {} }))
      .rejects.toMatchObject({ name: "HostCreationError", created: "no", retryable: status === 429 });
  });

  it.each([
    { info: { structured_output: { obsolete: true } } },
    { info: { structured: { completed: true }, error: { name: "APIError", data: { message: "failed" } } } },
  ])("rejects invalid specialist responses over the actual SDK: %j", async response => {
    const s = inprocess(); s.respond(() => Response.json(response));
    await expect(s.host.prompt(prompt)).rejects.toThrow(/structured specialist result|APIError/);
    expect(s.globalFetch).not.toHaveBeenCalled();
  });

  it("keeps status errors unknown and confirms missing-session aborts over the actual SDK", async () => {
    const s = inprocess(); s.respond(() => Response.json({ message: "unavailable" }, { status: 503 }));
    expect(await s.host.status("child", "/isolated")).toBe("unknown");
    s.respond(request => new URL(request.url).pathname.endsWith("/abort") ? Response.json(true) : Response.json({ message: "missing" }, { status: 404 }));
    await expect(s.host.abort("child", "/isolated")).resolves.toBeUndefined();
    expect(s.globalFetch).not.toHaveBeenCalled();
  });

  it("recovers only the latest response when the host rejects serialization of full format history", async () => {
    const s = inprocess();
    s.respond(request => new URL(request.url).searchParams.get("limit") === "1"
      ? Response.json([{ info: { role: "assistant", structured: { outcome: "completed" } }, parts: [] }])
      : Response.json({ name: "BadRequest", data: { message: "OutputFormatJsonSchema history serialization" } }, { status: 400 }));
    expect(await s.host.lastResult("child", "/isolated")).toEqual({ outcome: "completed" });
    expect(s.requests).toHaveLength(1);
  });
});
