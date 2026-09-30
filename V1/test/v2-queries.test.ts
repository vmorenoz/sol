import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { captureProjectGit, ProjectQueries } from "../src/v2/queries.js";
import { SolCore } from "../src/v2/core.js";
import { SessionStore } from "../src/v2/session-store.js";
import { WorkspaceManager } from "../src/v2/workspace.js";
import { EvidenceRunner } from "../src/v2/evidence.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "queries-")));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "project"); mkdirSync(root);
  const database = join(base, "queries.sqlite");
  const open = (directory = root) => {
    const queries = new ProjectQueries(directory);
    let closed = false;
    const close = () => { if (!closed) { queries.close(); closed = true; } };
    cleanups.push(close);
    return { queries, close };
  };
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "Query Test", GIT_AUTHOR_EMAIL: "query@example.invalid",
      GIT_COMMITTER_NAME: "Query Test", GIT_COMMITTER_EMAIL: "query@example.invalid" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const init = () => { git("init", "-b", "original-branch"); };
  const commit = () => { git("add", "."); git("-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture"); };
  return { base, root, database, open, git, init, commit };
}

describe("standalone project queries", () => {
  it("persists real source observations without plans, checks, raw documents or remotes", () => {
    const f = fixture(); f.init();
    const text = "Private document text 雪\n";
    writeFileSync(join(f.root, "README.md"), text); f.commit();
    writeFileSync(join(f.root, "README.md"), text + "dirty\n");
    writeFileSync(join(f.root, ".env"), "SECRET=private");
    f.git("remote", "add", "origin", "https://private:token@example.invalid/personal/repo");
    const before = readFileSync(join(f.root, ".git/index"));
    const db = new DatabaseSync(f.database);
    db.exec("CREATE TABLE v2_queries (id TEXT PRIMARY KEY, root TEXT NOT NULL, observed_at TEXT NOT NULL, result_json TEXT NOT NULL)");
    db.prepare("INSERT INTO v2_queries VALUES (?,?,?,?)").run("legacy", f.root, "before", "{}");
    db.close();
    const { queries, close } = f.open(); const result = queries.project();
    expect(result.provenance).toEqual({ directory: f.root, kind: "original-project" });
    expect(result.git).toMatchObject({ available: true, branch: "original-branch", detached: false,
      changes: { total: 2, staged: 0, unstaged: 1, untracked: 1 } });
    expect(result.checks).toEqual({ executed: [], note: "No tests or analysis were executed" });
    expect(result.queryId).toBe("project-status");
    expect(result.evidenceRefs).toEqual([`observation:${result.observationId}`]);
    expect(result.documents[0]).toMatchObject({ path: "README.md", bytes: Buffer.byteLength(text + "dirty\n"),
      sha256: createHash("sha256").update(text + "dirty\n").digest("hex") });
    expect(JSON.stringify(result)).not.toMatch(/Private document text|SECRET|private:token|personal\/repo|\.env/);
    expect(readFileSync(join(f.root, ".git/index"))).toEqual(before);
    writeFileSync(join(f.root, "later"), "fresh state");
    const fresh = queries.project();
    expect(fresh.queryId).toBe("project-status");
    expect(fresh.observationId).not.toBe(result.observationId);
    expect(fresh.git.changes.total).toBe(3);
    close();
    const legacy = new DatabaseSync(f.database);
    try {
      expect(legacy.prepare("SELECT id, observed_at FROM v2_queries").all()).toEqual([{ id: "legacy", observed_at: "before" }]);
    } finally { legacy.close(); }
  });

  it("uses the requested subdirectory or actual detached worktree, without remapping", () => {
    const f = fixture(); f.init(); writeFileSync(join(f.root, "file"), "original"); f.commit();
    const worktree = join(f.base, "detached"); f.git("worktree", "add", "--detach", worktree, "HEAD");
    writeFileSync(join(f.root, "file"), "dirty original");
    const sub = join(f.root, "sub"); mkdirSync(sub);
    const alias = join(f.base, "alias"); symlinkSync(sub, alias);
    const original = f.open(alias).queries.project();
    const detached = f.open(worktree).queries.project();
    expect(original.provenance.directory).toBe(sub);
    expect(original.git).toMatchObject({ directory: f.root, branch: "original-branch", detached: false, changes: { total: 1 } });
    expect(detached.provenance.directory).toBe(worktree);
    expect(detached.git).toMatchObject({ directory: worktree, branch: null, detached: true, unborn: false, changes: { total: 0 } });
  });

  it("distinguishes unborn repositories from non-Git unknown state", () => {
    const f = fixture(); const { queries } = f.open();
    expect(queries.project().git).toMatchObject({ available: false, status: "unknown", branch: null, head: null,
      changes: { total: null, staged: null, unstaged: null, untracked: null } });
    f.init(); writeFileSync(join(f.root, "new"), "new");
    expect(queries.project().git).toMatchObject({ available: true, branch: "original-branch", head: null,
      unborn: true, detached: false, status: "known", changes: { total: 1, untracked: 1 } });
  });

  it("counts NUL-delimited renames with newline, spaces and Unicode filenames once", () => {
    const f = fixture(); f.init();
    const old = "old\n雪 name.txt", next = "new\n雪 name.txt";
    writeFileSync(join(f.root, old), "unchanged rename content\n"); f.commit();
    renameSync(join(f.root, old), join(f.root, next)); f.git("add", "-A");
    writeFileSync(join(f.root, "untracked\n雪"), "new");
    expect(captureProjectGit(f.root).changes).toEqual({ total: 2, staged: 1, unstaged: 0, untracked: 1 });
  });

  it("skips source symlinks explicitly, including symlinked parent directories", () => {
    const f = fixture(); const outside = join(f.base, "outside"); mkdirSync(outside);
    writeFileSync(join(outside, "README.md"), "outside secret");
    symlinkSync(join(outside, "README.md"), join(f.root, "README.md"));
    symlinkSync(outside, join(f.root, "docs"));
    const result = f.open().queries.project();
    expect(result.documents).toEqual([]);
    expect(result.documentSkips).toContainEqual({ path: "README.md", reason: "symlink" });
    expect(result.documentSkips).toContainEqual({ path: "docs/README.md", reason: "symlink" });
    expect(JSON.stringify(result)).not.toContain("outside secret");
  });

  it("enforces the document byte budget and only observes selected knowledge indexes", () => {
    const f = fixture();
    writeFileSync(join(f.root, "README.md"), "a".repeat(8192));
    writeFileSync(join(f.root, "AGENTS.md"), "exceeds remaining budget");
    mkdirSync(join(f.root, ".sol/knowledge"), { recursive: true });
    writeFileSync(join(f.root, ".sol/knowledge/index.md"), "index");
    writeFileSync(join(f.root, ".sol/knowledge/private.md"), "secret");
    const result = f.open().queries.project();
    expect(result.documents.reduce((sum, doc) => sum + doc.bytes, 0)).toBe(8192);
    expect(result.documents.length).toBeLessThanOrEqual(20);
    expect(result.documentSkips).toContainEqual({ path: "AGENTS.md", reason: "budget" });
    expect(JSON.stringify(result)).not.toContain("private.md");
    expect(result.checks.executed).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(8192);
  });

  it("reports capped status as unknown rather than a clean or partially counted tree", () => {
    const f = fixture(); f.init();
    for (let i = 0; i < 400; i++) writeFileSync(join(f.root, `${i}-${"x".repeat(180)}`), "");
    const result = captureProjectGit(f.root);
    expect(result).toMatchObject({ available: true, status: "unknown", truncated: true, reason: "status-truncated",
      changes: { total: null, staged: null, unstaged: null, untracked: null } });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(2048);
  });

  it("hashes the selected knowledge index without following its entries", () => {
    const f = fixture(); mkdirSync(join(f.root, ".sol/knowledge"), { recursive: true });
    const content = JSON.stringify({ paths: ["../../.env", "private.md"] });
    writeFileSync(join(f.root, ".sol/knowledge/index.json"), content);
    writeFileSync(join(f.root, ".sol/knowledge/private.md"), "private");
    const result = f.open().queries.project();
    expect(result.documents).toEqual([{ path: ".sol/knowledge/index.json",
      bytes: Buffer.byteLength(content), sha256: createHash("sha256").update(content).digest("hex"), modifiedAt: expect.any(String) }]);
    expect(JSON.stringify(result)).not.toContain("private.md");
  });

  it("ignores inherited Git repository redirection", () => {
    const f = fixture(); f.init();
    const previous = process.env.GIT_DIR;
    try {
      process.env.GIT_DIR = join(f.base, "nonexistent.git");
      expect(captureProjectGit(f.root)).toMatchObject({ available: true, directory: f.root, branch: "original-branch", unborn: true });
    } finally { if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous; }
  });

  it("handles a genuinely unavailable git executable without inventing evidence", () => {
    const f = fixture(); const old = process.env.PATH;
    try {
      process.env.PATH = f.base;
      expect(captureProjectGit(f.root)).toMatchObject({ available: false, status: "unknown", reason: "git-unavailable",
        changes: { total: null, staged: null, unstaged: null, untracked: null } });
    } finally { if (old === undefined) delete process.env.PATH; else process.env.PATH = old; }
  });

  it("returns a bounded project-scoped Sol inventory without sensitive record payloads", () => {
    const f = fixture(), other = join(f.base, "other"); mkdirSync(other);
    for (const marker of [".sol", ".pulso"]) mkdirSync(join(f.root, marker));
    const core = new SolCore(f.root, f.database), sessions = new SessionStore(f.database);
    const workspace = new WorkspaceManager(f.root, join(f.base, "runtime", "isolation"));
    const evidence = new EvidenceRunner(core, join(f.base, "runtime", "evidence"));
    cleanups.push(() => sessions.close(), () => core.close());
    sessions.bind({ sessionId: "session", root: f.root, role: "sol" });
    sessions.recordUsage({ id: "message", sessionID: "session", tokens: { input: 3, output: 2 } });
    sessions.recordTool("session", "call", "read", 17);
    mkdirSync(join(f.base, "runtime", "isolation", "artifacts"), { recursive: true });
    writeFileSync(join(f.base, "runtime", "isolation", "artifacts", "count-only.json"), "PRIVATE_ARTIFACT_CONTENT");
    mkdirSync(join(f.base, "runtime", "evidence", "checks"), { recursive: true });
    writeFileSync(join(f.base, "runtime", "evidence", "checks", "count-only.log"), "PRIVATE_LOG_CONTENT");
    const db = new DatabaseSync(f.database);
    try {
      const secret = "PRIVATE_OBJECTIVE_PROMPT_ANSWER_PAYLOAD";
      for (let index = 0; index < 12; index++) {
        const id = `plan-${index}`, data = JSON.stringify({ id, status: "active", revision: 1, createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`, updatedAt: "2026-01-01T00:00:00.000Z", objective: secret });
        db.prepare("INSERT INTO v2_plans VALUES (?,?,?,?,?,?,?)").run(f.root, id, "active", 1, data, null, JSON.stringify({ objective: secret }));
      }
      db.prepare("INSERT INTO v2_plans VALUES (?,?,?,?,?,?,?)").run(other, "other-plan", "failed", 1, JSON.stringify({ objective: secret }), null, "{}");
      for (let index = 0; index < 30; index++) db.prepare("INSERT INTO v2_events(root,plan_id,type,entity_id,created_at) VALUES (?,?,?,?,?)")
        .run(f.root, `plan-${index % 12}`, "plan.created", `${secret}-${index}`, "2026-01-01T00:00:00.000Z");
      db.prepare("INSERT INTO v2_events(root,plan_id,type,entity_id,created_at) VALUES (?,?,?,?,?)").run(other, "other-plan", "private.other", secret, "2026-01-01T00:00:00.000Z");
      db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root TEXT NOT NULL);
        CREATE TABLE work_items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL);
        CREATE TABLE tasks (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL);
        CREATE TABLE evidence (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, payload TEXT);
        CREATE TABLE events (id INTEGER PRIMARY KEY, project_id TEXT, payload_json TEXT);
        CREATE TABLE message_usage (message_id TEXT PRIMARY KEY, project_id TEXT);
        CREATE TABLE decisions (id TEXT PRIMARY KEY, project_id TEXT);
        CREATE TABLE debts (id TEXT PRIMARY KEY, project_id TEXT);
        CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT);
        CREATE TABLE worktrees (id TEXT PRIMARY KEY, project_id TEXT);`);
      db.prepare("INSERT INTO projects VALUES (?,?)").run("current", f.root);
      db.prepare("INSERT INTO projects VALUES (?,?)").run("other", other);
      db.prepare("INSERT INTO work_items VALUES (?,?)").run("work", "current");
      db.prepare("INSERT INTO work_items VALUES (?,?)").run("other-work", "other");
      db.prepare("INSERT INTO tasks VALUES (?,?)").run("task", "work");
      db.prepare("INSERT INTO evidence VALUES (?,?,?)").run("legacy-evidence", "task", secret);
      db.prepare("INSERT INTO events VALUES (?,?,?)").run(1, "current", secret);
      db.prepare("INSERT INTO message_usage VALUES (?,?)").run("legacy-message", "current");
    } finally { db.close(); }
    const queries = new ProjectQueries(f.root, { runtimeSummary: () => core.readOnly().runtimeSummary(), sessionSummary: () => sessions.summary(f.root),
      workspaceInventory: () => workspace.inventory(), evidenceInventory: () => evidence.inventory() });
    const result = queries.solStatus(), serialized = JSON.stringify(result);
    expect(result).toMatchObject({ queryId: "sol-status", projectRoot: f.root,
      runtime: { plans: { total: 12, byStatus: { active: 12 } } },
      sessions: { sessions: { total: 1 }, messages: { total: 1 }, tools: { total: 1 } },
      legacyV1: { scope: "project", classification: "legacy-sol-not-pulso", counts: {
        work_items: 1, tasks: 1, evidence: 1, events: 1, message_usage: 1, decisions: 0, debts: 0, sessions: 0, worktrees: 0,
      } },
      projectLocalMarkers: { ".sol": { present: true }, ".planning": { present: false }, ".gsd": { present: false }, ".pulso": { present: true } },
      externalArtifacts: { workspace: { workspaceArtifacts: 1 }, evidenceByCategory: { checks: 1 } } });
    expect(result.recentWork).toHaveLength(8);
    expect(result.recentAudit).toHaveLength(24);
    expect(serialized).not.toMatch(/PRIVATE_|objective|prompt|answer|payload|entityId|count-only/);
  });
});
