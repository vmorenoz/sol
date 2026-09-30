import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "../src/v2/session-store.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "session-store-"))), databasePath = join(base, "state.sqlite");
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const open = () => {
    const store = new SessionStore(databasePath); let closed = false;
    const close = () => { if (!closed) { closed = true; store.close(); } };
    cleanups.push(close); return { store, close };
  };
  return { root: join(base, "project"), otherRoot: join(base, "other"), databasePath, open, ...open() };
}

describe("SessionStore usage persistence", () => {
  it("upserts message counters idempotently and isolates aggregates by canonical root and role after restart", () => {
    const s = setup();
    s.store.bind({ sessionId: "parent", root: s.root, role: "sol" });
    s.store.bind({ sessionId: "worker", root: s.root, role: "sol-executor", parentSessionId: "parent", attemptId: "attempt" });
    s.store.bind({ sessionId: "other", root: s.otherRoot, role: "sol" });
    const record = { id: "message", sessionID: "worker", tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3 } }, cost: 0.25 };
    s.store.recordUsage(record); s.store.recordUsage(record);
    s.store.recordUsage({ ...record, tokens: { input: 20, output: 8, reasoning: 4, cache: { read: 6 } }, cost: 0.5 });
    s.store.recordUsage({ id: "parent-message", sessionID: "parent", tokens: { input: 7, output: 2 }, cost: 0.125 });
    s.store.recordUsage({ id: "other-message", sessionID: "other", tokens: { input: 999 } });
    s.store.recordUsage({ id: "unbound-message", sessionID: "stranger", tokens: { input: 999 } });
    s.store.recordUsage({ id: "no-tokens", sessionID: "parent" });
    s.close(); const { store } = s.open();
    expect(store.usage(join(s.root, "nested", ".."))).toEqual({ roles: [
      { role: "sol", messages: 1, inputTokens: 7, outputTokens: 2, reasoningTokens: 0, cachedTokens: 0, cost: 0.125 },
      { role: "sol-executor", messages: 1, inputTokens: 20, outputTokens: 8, reasoningTokens: 4, cachedTokens: 6, cost: 0.5 },
    ], tools: [] });
    expect(store.usage(s.otherRoot)).toEqual({ roles: [{ role: "sol", messages: 1, inputTokens: 999, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, cost: 0 }], tools: [] });
    expect(store.get("worker")).toMatchObject({ root: s.root, role: "sol-executor", attemptId: "attempt" });
  });

  it("stores only byte aggregates and numeric usage, never message or tool content", () => {
    const s = setup();
    s.store.bind({ sessionId: "worker", root: s.root, role: "sol-executor" });
    s.store.bind({ sessionId: "other", root: s.otherRoot, role: "sol-executor" });
    const secret = "PRIVATE_OUTPUT_雪_12345";
    const record = { id: "message", sessionID: "worker", tokens: { input: 3 }, content: secret, parts: [{ text: secret }] };
    s.store.recordUsage(record);
    s.store.recordTool("worker", "call", "read", Buffer.byteLength(secret));
    s.store.recordTool("worker", "call", "read", Buffer.byteLength(secret));
    s.store.recordTool("worker", "call2", "read", 12);
    s.store.recordTool("worker", "call2", "read", 18);
    s.store.recordTool("other", "call", "read", 999);
    s.store.recordTool("stranger", "call", "read", 999);
    expect(s.store.usage(s.root)).toMatchObject({ tools: [{ role: "sol-executor", tool: "read", calls: 2, outputBytes: Buffer.byteLength(secret) + 18 }] });
    const db = new DatabaseSync(s.databasePath);
    try {
      const usage = db.prepare("SELECT * FROM v2_host_usage").all();
      const tools = db.prepare("SELECT * FROM v2_host_tools").all();
      expect(Object.keys(usage[0]!).sort()).toEqual(["message_id", "session_id", "root", "role", "input_tokens", "output_tokens", "reasoning_tokens", "cached_tokens", "cost"].sort());
      expect(Object.keys(tools[0]!).sort()).toEqual(["session_id", "call_id", "root", "role", "tool", "output_bytes"].sort());
      expect(JSON.stringify({ usage, tools })).not.toContain(secret);
    } finally { db.close(); }
  });

  it("normalizes invalid usage counters rather than contaminating metrics", () => {
    const s = setup(); s.store.bind({ sessionId: "parent", root: s.root, role: "sol" });
    s.store.recordUsage({ id: "invalid", sessionID: "parent", tokens: { input: -1, output: NaN, reasoning: Infinity, cache: { read: -2 } }, cost: Infinity });
    expect(s.store.usage(s.root)).toEqual({ roles: [{ role: "sol", messages: 1, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, cost: 0 }], tools: [] });
  });
});
