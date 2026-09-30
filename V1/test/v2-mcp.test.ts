import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { SolCore, planTemplates, type PlanRecord } from "../src/v2/core.js";
import { createSolMcpServer } from "../src/v2/mcp.js";
import { SolMcpClient, nodeExecutable } from "../src/v2/transport.js";

const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function core() {
  const core = new SolCore("/project", ":memory:");
  cleanups.push(() => core.close());
  return core;
}
async function pair(core: SolCore, writable = false) {
  const server = createSolMcpServer(core, { writable });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  cleanups.push(() => server.close(), () => client.close());
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}
function data(result: Awaited<ReturnType<Client["callTool"]>>) {
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ schemaVersion: 2 });
  return result.structuredContent!.data as Record<string, unknown>;
}
const entrypoint = fileURLToPath(new URL("../dist/v2/mcp.js", import.meta.url));

describe("Sol v2 MCP", () => {
  it("does not launch the compiled OpenCode binary as the MCP JavaScript interpreter", () => {
    const env = process.env.SOL_NODE_PATH;
    const descriptor = Object.getOwnPropertyDescriptor(process.versions, "bun");
    try {
      delete process.env.SOL_NODE_PATH;
      Object.defineProperty(process.versions, "bun", { configurable: true, value: "test-bun" });
      expect(nodeExecutable()).toBe("node");
      process.env.SOL_NODE_PATH = "/trusted/node";
      expect(nodeExecutable()).toBe("/trusted/node");
    } finally {
      if (env === undefined) delete process.env.SOL_NODE_PATH; else process.env.SOL_NODE_PATH = env;
      if (descriptor) Object.defineProperty(process.versions, "bun", descriptor); else delete process.versions["bun"];
    }
  });
  it("advertises strict input and object output schemas and defaults to read-only", async () => {
    const c = core(), client = await pair(c);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["sol_plan_get", "sol_plan_list", "sol_progress", "sol_templates"]);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema).toMatchObject({ type: "object", properties: { schemaVersion: { const: 2 }, data: { type: "object" } }, required: ["schemaVersion", "data"] });
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
    const templates = data(await client.callTool({ name: "sol_templates", arguments: {} })).templates;
    expect(templates).toEqual(Object.fromEntries(Object.entries(planTemplates).map(([key, make]) => [key, make()])));
    for (const name of ["sol_plan_create", "sol_plan_revise", "sol_plan_cancel", "sol_plan_pause", "sol_plan_resume", "exec"]) {
      expect((await client.callTool({ name, arguments: { draft: planTemplates.fast() } })).isError).toBe(true);
    }
    expect(c.listPlans()).toEqual([]);
  });

  it("rejects invalid shapes, excess arguments and invalid draft semantics via the SDK", async () => {
    const c = core(), client = await pair(c, true);
    for (const [name, args] of [
      ["sol_plan_get", {}], ["sol_plan_get", { planId: 12 }],
      ["sol_plan_list", { limit: 101 }], ["sol_plan_list", { limit: 1.5 }],
      ["sol_progress", { afterEventId: -1 }], ["sol_templates", { command: "whoami" }],
      ["sol_plan_create", { draft: { ...planTemplates.fast(), unexpected: true } }],
      ["sol_plan_create", { draft: { ...planTemplates.fast(), tasks: [{ ...planTemplates.fast().tasks[0], dependsOn: ["missing"] }] } }],
    ] as const) {
      expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
    }
    expect(c.listPlans()).toEqual([]);
  });

  it("shares canonical create/get/revise/progress state and returns compact mutation receipts", async () => {
    const c = core(), writer = await pair(c, true), reader = await pair(c);
    expect((await writer.listTools()).tools.map((tool) => tool.name)).toContain("sol_plan_cancel");
    const prompt = "private-long-instructions ".repeat(250);
    const draft = planTemplates.fast(); draft.tasks[0]!.instructions = prompt;
    const args = { draft, idempotencyKey: "create-once" };
    const created = await writer.callTool({ name: "sol_plan_create", arguments: args });
    const receipt = data(created), planId = receipt.id as string;
    expect(receipt).toEqual({ id: planId, revision: 1, status: "active", title: draft.title, tasks: { queued: 1 } });
    expect(JSON.stringify(created)).not.toContain(prompt);
    expect(Buffer.byteLength(JSON.stringify(created))).toBeLessThan(1024);
    expect(data(await writer.callTool({ name: "sol_plan_create", arguments: args }))).toEqual(receipt);
    expect(c.listPlans()).toHaveLength(1);
    expect(data(await reader.callTool({ name: "sol_plan_get", arguments: { planId } }))).toEqual(c.getPlan(planId));
    const before = data(await reader.callTool({ name: "sol_progress", arguments: { planId } }));
    expect(before).toEqual(c.digest(planId));
    const revise = { planId, expectedRevision: 1, draft: { ...draft, title: "Revised" }, reason: "Updated scope" };
    expect(data(await writer.callTool({ name: "sol_plan_revise", arguments: revise }))).toMatchObject({ revision: 2, title: "Revised" });
    expect((await writer.callTool({ name: "sol_plan_revise", arguments: revise })).isError).toBe(true);
    const progress = data(await reader.callTool({ name: "sol_progress", arguments: { planId, afterEventId: before.cursor } }));
    expect(progress).toEqual(c.digest(planId, before.cursor as number));
    expect(progress.events).toHaveLength(1);
    expect(JSON.stringify(progress)).not.toContain(prompt);
    const listed = await reader.callTool({ name: "sol_plan_list", arguments: { limit: 1 } });
    expect(data(listed).plans).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(prompt);
    const resources = await reader.listResourceTemplates();
    expect(resources.resourceTemplates[0]?.uriTemplate).toBe("sol://plans/{id}");
    const resource = await reader.readResource({ uri: `sol://plans/${planId}` });
    expect(JSON.parse(resource.contents[0]!.text as string)).toEqual({ schemaVersion: 2, data: c.getPlan(planId) });
    expect(data(await writer.callTool({ name: "sol_plan_pause", arguments: { planId } })).status).toBe("paused");
    expect(data(await reader.callTool({ name: "sol_progress", arguments: { planId } }))).toEqual(c.digest(planId));
    expect(data(await writer.callTool({ name: "sol_plan_resume", arguments: { planId } })).status).toBe("active");
    expect(data(await writer.callTool({ name: "sol_plan_cancel", arguments: { planId } })).status).toBe("cancelled");
    expect(c.getPlan(planId).status).toBe("cancelled");
  });

  it("fails full retrieval over the UTF-8 byte budget without truncating or mirroring large prompts", async () => {
    const c = core(), client = await pair(c, true);
    const draft = planTemplates.standard();
    draft.tasks = Array.from({ length: 8 }, (_, i) => ({ ...draft.tasks[0]!, id: `t${i}`, instructions: "界".repeat(7000) }));
    const created = await client.callTool({ name: "sol_plan_create", arguments: { draft } });
    const planId = data(created).id as string;
    expect(Buffer.byteLength(JSON.stringify(created))).toBeLessThan(1024);
    const full = await client.callTool({ name: "sol_plan_get", arguments: { planId } });
    expect(full.isError).toBe(true);
    expect(JSON.stringify(full)).toMatch(/64KB.*references/);
    expect(JSON.stringify(full)).not.toContain("界");
    await expect(client.readResource({ uri: `sol://plans/${planId}` })).rejects.toThrow(/64KB/);
    expect(c.getPlan(planId).draft).toEqual(draft);
    expect(data(await client.callTool({ name: "sol_progress", arguments: { planId } })).plans).toHaveLength(1);
  });

  it("lazily shares one client connection, unwraps data, throws tool errors and closes idempotently", async () => {
    const c = core(), server = createSolMcpServer(c, { writable: true });
    const [left, right] = InMemoryTransport.createLinkedPair();
    await server.connect(right); cleanups.push(() => server.close());
    let connections = 0;
    const client = new SolMcpClient({ projectRoot: "/project", transportFactory: () => { connections++; return left; } });
    cleanups.push(() => client.close());
    expect(connections).toBe(0);
    const results = await Promise.all(Array.from({ length: 5 }, () => client.call("sol_plan_list")));
    expect(results).toEqual(Array.from({ length: 5 }, () => ({ plans: [] })));
    expect(connections).toBe(1);
    const receipt = await client.call("sol_plan_create", { draft: planTemplates.fast() }) as { id: string };
    expect(await client.call("sol_plan_get", { planId: receipt.id })).toEqual(c.getPlan(receipt.id));
    await expect(client.call("sol_plan_get", { planId: "missing" })).rejects.toThrow(/Unknown/);
    await expect(client.call("sol_plan_list", { limit: -1 })).rejects.toThrow(/Sol MCP/);
    await Promise.all([client.close(), client.close()]);
    await expect(client.connect()).rejects.toThrow(/closed/);
  });

  it("cleans up a close racing connection and rejects malformed envelopes", async () => {
    const server = new McpServer({ name: "bad-response", version: "1" });
    server.registerTool("bad", {}, () => ({ content: [{ type: "text", text: "not structured" }] }));
    const [left, right] = InMemoryTransport.createLinkedPair();
    await server.connect(right); cleanups.push(() => server.close());
    const client = new SolMcpClient({ projectRoot: "/project", transportFactory: () => left });
    cleanups.push(() => client.close());
    await expect(client.call("bad")).rejects.toThrow(/invalid v2 response envelope/);
    const c = core(), otherServer = createSolMcpServer(c);
    const [otherLeft, otherRight] = InMemoryTransport.createLinkedPair();
    await otherServer.connect(otherRight); cleanups.push(() => otherServer.close());
    const other = new SolMcpClient({ projectRoot: "/project", transportFactory: () => otherLeft });
    const pending = other.connect();
    const rejected = expect(pending).rejects.toThrow(/closed/);
    await other.close(); await rejected;
  });

  it("runs the built stdio entrypoint as read-only and the private bridge against the same database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sol-v2-mcp-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const databasePath = join(dir, "state.sqlite");
    const bridge = new SolMcpClient({ projectRoot: dir, databasePath, entrypoint });
    cleanups.push(() => bridge.close());
    const created = await bridge.call("sol_plan_create", { draft: planTemplates.fast() }) as { id: string };
    const client = new Client({ name: "stdio-test", version: "1" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [entrypoint, "--project", dir, "--database", databasePath], stderr: "pipe" });
    transport.stderr?.resume();
    cleanups.push(() => client.close());
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(4);
    const plan = data(await client.callTool({ name: "sol_plan_get", arguments: { planId: created.id } })) as unknown as PlanRecord;
    expect(plan.id).toBe(created.id);
    expect((await client.callTool({ name: "sol_plan_cancel", arguments: { planId: created.id } })).isError).toBe(true);
    await bridge.close();
    expect(data(await client.callTool({ name: "sol_progress", arguments: { planId: created.id } })).plans).toHaveLength(1);
  });
});
