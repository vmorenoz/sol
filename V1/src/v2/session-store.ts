import { SolDatabase } from "../store/database.js";
import { resolve } from "node:path";

export interface SessionBinding {
  sessionId: string;
  root: string;
  role: string;
  parentSessionId?: string;
  attemptId?: string;
}
export interface SessionSummary {
  sessions: { total: number; byRole: Record<string, number> };
  messages: { total: number; inputTokens: number; outputTokens: number; reasoningTokens: number; cachedTokens: number; cost: number };
  tools: { total: number; outputBytes: number; byTool: Record<string, number>; omittedToolKinds: number };
}

/** Host-owned routing, shared across plugins in parent/isolated child directories. */
export class SessionStore {
  private readonly store: SolDatabase;
  constructor(databasePath?: string) {
    this.store = new SolDatabase(databasePath);
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS v2_host_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS v2_host_questions (session_id TEXT NOT NULL, call_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session_id,call_id));
      CREATE TABLE IF NOT EXISTS v2_host_activity (session_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS v2_host_usage (message_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, root TEXT NOT NULL, role TEXT NOT NULL,
        input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, reasoning_tokens INTEGER NOT NULL, cached_tokens INTEGER NOT NULL, cost REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS v2_host_tools (session_id TEXT NOT NULL, call_id TEXT NOT NULL, root TEXT NOT NULL, role TEXT NOT NULL,
        tool TEXT NOT NULL, output_bytes INTEGER NOT NULL, PRIMARY KEY(session_id,call_id));
    `);
  }
  bind(binding: SessionBinding): void {
    const old = this.get(binding.sessionId);
    if (old && (old.root !== binding.root || old.role !== binding.role || old.attemptId !== binding.attemptId)) {
      throw new Error("Session binding is immutable");
    }
    this.store.db.prepare("INSERT INTO v2_host_sessions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data")
      .run(binding.sessionId, JSON.stringify(binding));
  }
  get(sessionId: string): SessionBinding | undefined {
    const row = this.store.db.prepare("SELECT data FROM v2_host_sessions WHERE id=?").get(sessionId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as SessionBinding : undefined;
  }
  routeQuestions(sessionId: string, callId: string, ids: string[]): void {
    this.store.db.prepare("INSERT INTO v2_host_questions VALUES (?,?,?) ON CONFLICT(session_id,call_id) DO UPDATE SET data=excluded.data")
      .run(sessionId, callId, JSON.stringify(ids));
  }
  questionIds(sessionId: string, callId: string): string[] {
    const row = this.store.db.prepare("SELECT data FROM v2_host_questions WHERE session_id=? AND call_id=?")
      .get(sessionId, callId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as string[] : [];
  }
  activity(sessionId: string, value?: object): object | undefined {
    if (value) this.store.db.prepare("INSERT INTO v2_host_activity VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET data=excluded.data")
      .run(sessionId, JSON.stringify({ ...value, updatedAt: new Date().toISOString() }));
    const row = this.store.db.prepare("SELECT data FROM v2_host_activity WHERE session_id=?").get(sessionId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as object : undefined;
  }
  recordUsage(message: { id: string; sessionID: string; tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number } }; cost?: number }): void {
    const binding = this.get(message.sessionID);
    if (!binding || !message.tokens) return;
    const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
    this.store.db.prepare(`INSERT INTO v2_host_usage VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(message_id) DO UPDATE SET
      input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,reasoning_tokens=excluded.reasoning_tokens,cached_tokens=excluded.cached_tokens,cost=excluded.cost`)
      .run(message.id, message.sessionID, binding.root, binding.role, number(message.tokens.input), number(message.tokens.output),
        number(message.tokens.reasoning), number(message.tokens.cache?.read), number(message.cost));
  }
  recordTool(sessionId: string, callId: string, tool: string, outputBytes: number): void {
    const binding = this.get(sessionId);
    if (!binding) return;
    this.store.db.prepare(`INSERT INTO v2_host_tools VALUES (?,?,?,?,?,?) ON CONFLICT(session_id,call_id) DO UPDATE SET output_bytes=excluded.output_bytes`)
      .run(sessionId, callId, binding.root, binding.role, tool, outputBytes);
  }
  usage(root: string): object {
    root = resolve(root);
    return {
      roles: this.store.db.prepare(`SELECT role,COUNT(*) AS messages,SUM(input_tokens) AS inputTokens,SUM(output_tokens) AS outputTokens,
        SUM(reasoning_tokens) AS reasoningTokens,SUM(cached_tokens) AS cachedTokens,SUM(cost) AS cost FROM v2_host_usage WHERE root=? GROUP BY role`).all(root),
      tools: this.store.db.prepare(`SELECT role,tool,COUNT(*) AS calls,SUM(output_bytes) AS outputBytes FROM v2_host_tools WHERE root=? GROUP BY role,tool`).all(root),
    };
  }
  summary(root: string): SessionSummary {
    root = resolve(root);
    const roles: Record<string, number> = {};
    const sessionRows = this.store.db.prepare(`SELECT json_extract(data,'$.role') AS role,COUNT(*) AS count FROM v2_host_sessions
      WHERE json_extract(data,'$.root')=? GROUP BY role`).all(root) as { role: string; count: number }[];
    for (const row of sessionRows) roles[row.role] = Number(row.count);
    const messages = this.store.db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(input_tokens),0) AS inputTokens,
      COALESCE(SUM(output_tokens),0) AS outputTokens,COALESCE(SUM(reasoning_tokens),0) AS reasoningTokens,
      COALESCE(SUM(cached_tokens),0) AS cachedTokens,COALESCE(SUM(cost),0) AS cost FROM v2_host_usage WHERE root=?`).get(root) as SessionSummary["messages"];
    const toolAggregate = this.store.db.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(output_bytes),0) AS outputBytes,COUNT(DISTINCT tool) AS kinds FROM v2_host_tools WHERE root=?").get(root) as { total: number; outputBytes: number; kinds: number };
    const toolRows = this.store.db.prepare("SELECT tool,COUNT(*) AS count FROM v2_host_tools WHERE root=? GROUP BY tool ORDER BY count DESC,tool LIMIT 24").all(root) as { tool: string; count: number }[];
    const byTool: Record<string, number> = {};
    for (const row of toolRows) byTool[row.tool] = Number(row.count);
    return { sessions: { total: sessionRows.reduce((sum, row) => sum + Number(row.count), 0), byRole: roles },
      messages: { total: Number(messages.total), inputTokens: Number(messages.inputTokens), outputTokens: Number(messages.outputTokens),
        reasoningTokens: Number(messages.reasoningTokens), cachedTokens: Number(messages.cachedTokens), cost: Number(messages.cost) },
      tools: { total: Number(toolAggregate.total), outputBytes: Number(toolAggregate.outputBytes), byTool,
        omittedToolKinds: Math.max(0, Number(toolAggregate.kinds) - toolRows.length) } };
  }
  close(): void { this.store.close(); }
}
