import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import type { HostAdapter } from "./host.js";
import { HostCreationError, HostExecutionError } from "./host.js";
import type { PluginInput } from "@opencode-ai/plugin";

type Client = ReturnType<typeof createOpencodeClient>;

function inspectionPermissions(input: Parameters<HostAdapter["createSession"]>[0]) {
  const sol = input.metadata.sol as { readOnly?: boolean } | undefined;
  if (!input.readOnly && sol?.readOnly !== true) return [];
  // Cooperative native tool policy, not an OS sandbox. Deny unknown tools as well
  // as explicit edit/bash overrides of permissive executor-role defaults.
  return [
    ...["*", "edit", "bash", "sol_check"].map(permission => ({ permission, pattern: "*", action: "deny" as const })),
    ...["read", "glob", "grep", "sol_observe", "StructuredOutput"].map(permission => ({ permission, pattern: "*", action: "allow" as const })),
  ];
}

function creationRejected(response: { error?: unknown; response?: Response }): void {
  if (!response.error) return;
  const status = response.response?.status;
  // Only explicit request rejection proves there was no child. 408/5xx may follow a write.
  const rejected = status !== undefined && [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(status);
  throw new HostCreationError(`Host session creation HTTP ${status ?? "unknown"}`, rejected ? "no" : "unknown", status === 429);
}

/** Pinned OpenCode SDK adapter. No assumption that a child inherits its parent's transcript. */
export class OpenCodeHost implements HostAdapter {
  constructor(private readonly client: Client, private readonly onActivity?: HostAdapter["activity"]) {}

  async createSession(input: Parameters<HostAdapter["createSession"]>[0]): Promise<string> {
    const response = await this.client.session.create({
      parentID: input.parentSessionId, agent: input.agent, directory: input.directory,
      title: input.title, metadata: input.metadata,
      permission: [
        { permission: "task", pattern: "*", action: "deny" },
        { permission: "question", pattern: "*", action: "deny" },
        { permission: "sol_plan", pattern: "*", action: "deny" },
        { permission: "sol_run", pattern: "*", action: "deny" },
        { permission: "sol_cancel", pattern: "*", action: "deny" },
        { permission: "sol_ask", pattern: "*", action: "deny" },
        { permission: "external_directory", pattern: "*", action: "deny" },
        { permission: "StructuredOutput", pattern: "*", action: "allow" },
        ...inspectionPermissions(input),
      ],
    }, { throwOnError: false });
    creationRejected(response);
    if (!response.data?.id) throw new HostCreationError("Host did not return a child session identity", "unknown", false);
    return response.data.id;
  }

  async prompt(input: Parameters<HostAdapter["prompt"]>[0]): Promise<unknown> {
    const response = await this.client.session.prompt({
      sessionID: input.sessionId, directory: input.directory, agent: input.agent,
      parts: [{ type: "text", text: input.prompt }],
      format: { type: "json_schema", schema: input.schema, retryCount: 1 },
    }, { throwOnError: true, ...(input.signal ? { signal: input.signal } : {}) });
    if (response.data?.info.error) {
      const error = response.data.info.error;
      throw new HostExecutionError(`Specialist ${error.name}`, "isRetryable" in error.data && error.data.isRetryable === true);
    }
    // `structured` is the actual field in the pinned 1.18.30 SDK, not documentation's older alias.
    if (response.data?.info.structured === undefined) throw new Error("Host returned no structured specialist result");
    return response.data.info.structured;
  }

  async abort(sessionId: string, directory: string): Promise<void> {
    await this.client.session.abort({ sessionID: sessionId, directory }, { throwOnError: true });
    const state = await this.status(sessionId, directory);
    if (state !== "idle" && state !== "missing") throw new Error("Host abort not yet confirmed");
  }

  async status(sessionId: string, directory: string): ReturnType<HostAdapter["status"]> {
    try {
      const info = await this.client.session.get({ sessionID: sessionId, directory });
      if (info.error) return info.response.status === 404 ? "missing" : "unknown";
      const response = await this.client.session.status({ directory });
      if (response.error || !response.data) return "unknown";
      const state = response.data[sessionId];
      return !state || state.type === "idle" ? "idle" : "running";
    } catch { return "unknown"; }
  }

  async lastResult(sessionId: string, directory: string): Promise<unknown | undefined> {
    // Each assignment owns a child session. Recover its latest response, not an older result
    // from an earlier turn or the entire user-format history of the host.
    const response = await this.client.session.messages({ sessionID: sessionId, directory, limit: 1 }, { throwOnError: true });
    const message = response.data?.findLast(entry => entry.info.role === "assistant" && entry.info.structured !== undefined);
    return message?.info.role === "assistant" ? message.info.structured : undefined;
  }

  async activity(input: Parameters<HostAdapter["activity"]>[0]): Promise<void> {
    await this.onActivity?.(input);
  }
}

export function hostClient(serverUrl: URL): Client {
  return createOpencodeClient({ baseUrl: serverUrl.toString() });
}

/** Uses the host's public SDK methods, preserving its in-process fetch, authentication and interceptors.
 * PluginInput currently types these methods with v1 request shapes; the server supports the pinned
 * v2 body fields. Passing a typed body variable retains those fields without accessing private SDK internals.
 */
export class PluginOpenCodeHost implements HostAdapter {
  constructor(private readonly client: PluginInput["client"]) {}
  async createSession(input: Parameters<HostAdapter["createSession"]>[0]): Promise<string> {
    const body = { parentID: input.parentSessionId, agent: input.agent, title: input.title, metadata: input.metadata,
      permission: [...["task", "question", "sol_plan", "sol_run", "sol_cancel", "sol_ask", "external_directory"]
        .map(permission => ({ permission, pattern: "*", action: "deny" as const })),
        { permission: "StructuredOutput", pattern: "*", action: "allow" as const }, ...inspectionPermissions(input)] };
    const response = await this.client.session.create({ body, query: { directory: input.directory }, throwOnError: false });
    creationRejected(response);
    if (!response.data?.id) throw new HostCreationError("Host did not return a child session identity", "unknown", false);
    return response.data.id;
  }
  async prompt(input: Parameters<HostAdapter["prompt"]>[0]): Promise<unknown> {
    const body = { agent: input.agent, parts: [{ type: "text" as const, text: input.prompt }],
      format: { type: "json_schema", schema: input.schema, retryCount: 1 } };
    const response = await this.client.session.prompt({ path: { id: input.sessionId }, query: { directory: input.directory }, body,
      throwOnError: true, ...(input.signal ? { signal: input.signal } : {}) });
    const info = response.data.info as typeof response.data.info & { structured?: unknown };
    if (info.error) throw new HostExecutionError(`Specialist ${info.error.name}`, "isRetryable" in info.error.data && info.error.data.isRetryable === true);
    if (info.structured === undefined) throw new Error("Host returned no structured specialist result");
    return info.structured;
  }
  async abort(sessionId: string, directory: string): Promise<void> {
    await this.client.session.abort({ path: { id: sessionId }, query: { directory }, throwOnError: true });
    const state = await this.status(sessionId, directory);
    if (state !== "idle" && state !== "missing") throw new Error("Host abort not yet confirmed");
  }
  async status(sessionId: string, directory: string): ReturnType<HostAdapter["status"]> {
    try {
      const info = await this.client.session.get({ path: { id: sessionId }, query: { directory } });
      if (info.error) return info.response.status === 404 ? "missing" : "unknown";
      const response = await this.client.session.status({ query: { directory } });
      if (response.error || !response.data) return "unknown";
      const state = response.data[sessionId];
      return !state || state.type === "idle" ? "idle" : "running";
    } catch { return "unknown"; }
  }
  async lastResult(sessionId: string, directory: string): Promise<unknown | undefined> {
    const query = { directory, limit: 1 };
    const response = await this.client.session.messages({ path: { id: sessionId }, query, throwOnError: true });
    for (const message of [...response.data].reverse()) {
      const info = message.info as typeof message.info & { structured?: unknown };
      if (info.role === "assistant" && info.structured !== undefined) return info.structured;
    }
    return undefined;
  }
  async activity(_input: Parameters<HostAdapter["activity"]>[0]): Promise<void> { /* Projection is owned by the bridge. */ }
}
