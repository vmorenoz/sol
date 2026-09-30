import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

export interface SolMcpClientOptions {
  projectRoot: string;
  databasePath?: string;
  entrypoint?: string;
  executable?: string;
  /** Test/embedding seam. The client takes ownership of each returned transport. */
  transportFactory?: () => Transport;
}

const envelopeSchema = z.object({ schemaVersion: z.literal(2), data: z.record(z.string(), z.unknown()) }).strict();
export function nodeExecutable(): string {
  // In a Bun-compiled OpenCode host, process.execPath is OpenCode itself, not a JS interpreter.
  return process.env.SOL_NODE_PATH ?? (process.versions["bun"] ? "node" : process.execPath);
}
function compact(error: unknown): Error {
  return new Error(`Sol MCP: ${error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 512) : "request failed"}`);
}

/** Private trusted-plugin bridge; never expose this writable pipe to worker sessions. */
export class SolMcpClient {
  private client: Client | undefined;
  private connecting: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private closed = false;
  private stderrTail = "";
  private readonly options: SolMcpClientOptions;

  constructor(options: SolMcpClientOptions) {
    this.options = { ...options, projectRoot: resolve(options.projectRoot) };
  }
  connect(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Sol MCP: client is closed"));
    if (this.connecting) return this.connecting;
    if (this.client) return Promise.resolve();
    this.connecting = this.open().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private async open(): Promise<void> {
    const client = new Client({ name: "sol-native-bridge", version: "2.2.0" });
    let transport: Transport | undefined;
    try {
      const args = [this.options.entrypoint ?? fileURLToPath(new URL("./mcp.js", import.meta.url)), "--project", this.options.projectRoot, "--bridge"];
      if (this.options.databasePath !== undefined) args.push("--database", this.options.databasePath);
      transport = this.options.transportFactory?.() ?? new StdioClientTransport({
        command: this.options.executable ?? nodeExecutable(), args, cwd: this.options.projectRoot,
        env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
        stderr: "pipe",
      });
      if (transport instanceof StdioClientTransport) transport.stderr?.on("data", (chunk: Buffer) => {
        this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-8192);
      });
      client.onclose = () => { if (this.client === client) this.client = undefined; };
      await client.connect(transport);
      if (this.closed) { await client.close(); throw new Error("client is closed"); }
      this.client = client;
    } catch (error) {
      await client.close().catch(() => {});
      await transport?.close().catch(() => {});
      throw compact(error);
    }
  }
  async call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    try {
      await this.connect();
      if (!this.client) throw new Error("connection closed");
      const result = await this.client.callTool({ name, arguments: args });
      if (result.isError) {
        const content = result.content;
        const text = Array.isArray(content) ? content.find((item) => item.type === "text")?.text : undefined;
        throw new Error(typeof text === "string" ? text : "tool failed");
      }
      const parsed = envelopeSchema.safeParse(result.structuredContent);
      if (!parsed.success) throw new Error("invalid v2 response envelope");
      if (Buffer.byteLength(JSON.stringify(parsed.data)) > 65_536) throw new Error("response exceeds 64KB; use plan references");
      return parsed.data.data;
    } catch (error) { throw compact(error); }
  }
  close(): Promise<void> {
    this.closed = true;
    return this.closing ??= (async () => {
      await this.connecting?.catch(() => {});
      const client = this.client;
      this.client = undefined;
      try { await client?.close(); } catch (error) { throw compact(error); }
    })();
  }
  /** Debug-only transport diagnostics. Never included in normal tool results. */
  diagnostics(): string { return this.stderrTail; }
}
