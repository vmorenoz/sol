import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RuntimeSummary } from "./core.js";
import type { SessionSummary } from "./session-store.js";
import type { WorkspaceInventory } from "./workspace.js";
import type { EvidenceInventory } from "./evidence.js";

const statusLimit = 64 * 1024;
const documentLimit = 8 * 1024;
// Explicit allowlist: no recursive discovery, manifests, credentials or raw contents.
const documentPaths = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "ARCHITECTURE.md",
  "SOL.md", "docs/README.md", "docs/AGENTS.md", "docs/architecture.md", ".sol/project/index.md",
  ".sol/knowledge/index.md", ".sol/knowledge/index.json"] as const;

export interface ProjectGit {
  available: boolean;
  directory: string;
  branch: string | null;
  head: string | null;
  unborn: boolean;
  detached: boolean;
  status: "known" | "unknown";
  scope: "worktree-excluding-submodule-changes";
  truncated: boolean;
  reason?: "git-unavailable" | "not-a-repository-or-unreadable" | "status-truncated" | "status-unavailable" | "identity-unavailable";
  changes: { total: number | null; staged: number | null; unstaged: number | null; untracked: number | null };
}

export interface ProjectQueryResult {
  queryId: "project-status";
  observationId: string;
  observedAt: string;
  provenance: { directory: string; kind: "original-project" };
  git: ProjectGit;
  documents: { path: string; sha256: string; bytes: number; modifiedAt: string }[];
  documentSkips: { path: string; reason: "symlink" | "budget" | "not-regular" | "unreadable-or-changed" }[];
  documentsNote: string;
  checks: { executed: []; note: "No tests or analysis were executed" };
  evidenceRefs: string[];
}
export interface SolStatusResult {
  queryId: "sol-status";
  observationId: string;
  observedAt: string;
  projectRoot: string;
  storage: {
    database: { path: string; classification: "runtime-external" | "project-local" };
    workspace: { path: string; classification: "runtime-external" | "project-local" };
    evidence: { path: string; classification: "runtime-external" };
    markers: { path: string; classification: "project-local" };
  };
  runtime: RuntimeSummary["v2"];
  sessions: SessionSummary;
  workspace: Omit<WorkspaceInventory, "storage">;
  externalArtifacts: { workspace: WorkspaceInventory["artifacts"]; evidenceByCategory: Record<string, number> };
  recentWork: RuntimeSummary["recentWork"];
  recentAudit: RuntimeSummary["recentAudit"];
  legacyV1: RuntimeSummary["legacyV1"];
  projectLocalMarkers: Record<".sol" | ".planning" | ".gsd" | ".pulso", { present: boolean; kind: "directory" | "file" | "symlink" | "other" | "absent" }>;
  bounds: { recentWork: 8; recentAudit: 24 };
}

export interface SolStatusSources {
  runtimeSummary: () => RuntimeSummary;
  sessionSummary: () => SessionSummary;
  workspaceInventory: () => WorkspaceInventory;
  evidenceInventory: () => EvidenceInventory;
}

function canonical(root: string): string {
  const directory = realpathSync(resolve(root));
  if (!lstatSync(directory).isDirectory()) throw new Error("Project root must be a directory");
  return directory;
}

function git(root: string, args: string[], maxBuffer = 8192): Buffer {
  // Inherited GIT_DIR/WORK_TREE/INDEX_FILE/config overrides must not redirect provenance.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  return execFileSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", root, ...args], {
    cwd: root, env: { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    timeout: 1500, maxBuffer, stdio: ["ignore", "pipe", "pipe"],
  });
}

function counts(output: Buffer): ProjectGit["changes"] {
  const changes = { total: 0, staged: 0, unstaged: 0, untracked: 0 };
  const records = output.toString("utf8").split("\0");
  if (records.pop() !== "") throw new Error("Incomplete porcelain output");
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.length < 4 || record[2] !== " ") throw new Error("Invalid porcelain output");
    const x = record[0]!, y = record[1]!;
    if (!/^[ MADRCU?!]{2}$/.test(x + y)) throw new Error("Invalid porcelain status");
    if (x === "!" && y === "!") continue;
    changes.total++;
    if (x === "?" && y === "?") changes.untracked++;
    else {
      if (x !== " ") changes.staged++;
      if (y !== " ") changes.unstaged++;
      // -z puts destination first and source in the next NUL record (not another change).
      if (/[RC]/.test(x + y) && !records[++i]) throw new Error("Missing rename source");
    }
  }
  return changes;
}

/** Read-only, bounded source Git observation. Deliberately omits filenames and remote URLs. */
export function captureProjectGit(root: string): ProjectGit {
  const directory = canonical(root);
  const result: ProjectGit = {
    available: false, directory, branch: null, head: null, unborn: false, detached: false,
    status: "unknown", scope: "worktree-excluding-submodule-changes", truncated: false,
    changes: { total: null, staged: null, unstaged: null, untracked: null },
  };
  let top: string;
  try {
    // Strip only Git's terminating newline: directory names may themselves contain whitespace.
    top = canonical(git(directory, ["rev-parse", "--show-toplevel"]).toString("utf8").replace(/\n$/, ""));
    result.directory = top;
    result.available = true;
  } catch (error) {
    result.reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "git-unavailable" : "not-a-repository-or-unreadable";
    return result;
  }
  let symbolicDetached = false;
  try { result.branch = git(top, ["symbolic-ref", "--quiet", "--short", "HEAD"]).toString("utf8").replace(/\n$/, ""); }
  catch (error) { symbolicDetached = (error as { status?: number }).status === 1; }
  try { result.head = git(top, ["rev-parse", "--verify", "--quiet", "HEAD"]).toString("utf8").trim(); }
  catch (error) { result.unborn = result.branch !== null && (error as { status?: number }).status === 1; }
  result.detached = symbolicDetached && result.head !== null;
  if ((!result.branch && !result.detached) || (!result.head && !result.unborn)) result.reason = "identity-unavailable";
  try {
    // No refresh, diff, remote, hooks, submodule traversal or unbounded status retry.
    result.changes = counts(git(top, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all"], statusLimit));
    result.status = "known";
  } catch (error) {
    result.truncated = (error as NodeJS.ErrnoException).code === "ENOBUFS";
    result.reason = result.truncated ? "status-truncated" : "status-unavailable";
  }
  return result;
}

function documents(root: string): Pick<ProjectQueryResult, "documents" | "documentSkips"> {
  const result: Pick<ProjectQueryResult, "documents" | "documentSkips"> = { documents: [], documentSkips: [] };
  let remaining = documentLimit;
  let discovered: string[] = [];
  try {
    const dir = join(root, "docs");
    if (!lstatSync(dir).isSymbolicLink() && realpathSync(dir) === dir) {
      discovered = readdirSync(dir, { withFileTypes: true }).filter(entry => /\.md$/i.test(entry.name))
        .map(entry => `docs/${entry.name}`).sort().slice(0, 20);
    }
  } catch { /* The optional docs directory may not exist. */ }
  for (const path of [...new Set([...documentPaths, ...discovered])].slice(0, 20)) {
    let fd: number | undefined;
    try {
      let current = root;
      let symlink = false;
      for (const part of path.split("/")) {
        current = join(current, part);
        if (lstatSync(current).isSymbolicLink()) { symlink = true; break; }
      }
      if (symlink) { result.documentSkips.push({ path, reason: "symlink" }); continue; }
      const before = lstatSync(current);
      if (!before.isFile()) { result.documentSkips.push({ path, reason: "not-regular" }); continue; }
      if (before.size > remaining) { result.documentSkips.push({ path, reason: "budget" }); continue; }
      fd = openSync(current, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size || realpathSync(current) !== current)
        throw new Error("Document changed during observation");
      const buffer = Buffer.alloc(stat.size);
      let bytes = 0;
      while (bytes < buffer.length) {
        const read = readSync(fd, buffer, bytes, buffer.length - bytes, bytes);
        if (!read) throw new Error("Document changed during observation");
        bytes += read;
      }
      remaining -= bytes;
      const after = fstatSync(fd);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error("Document changed during observation");
      result.documents.push({ path, sha256: createHash("sha256").update(buffer).digest("hex"), bytes, modifiedAt: stat.mtime.toISOString() });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.documentSkips.push({ path, reason: "unreadable-or-changed" });
    } finally { if (fd !== undefined) closeSync(fd); }
  }
  return result;
}

/** Standalone sol_query building block; creates no plans, agents, worktrees or task evidence. */
export class ProjectQueries {
  private readonly root: string;

  constructor(projectRoot: string, private readonly solSources?: SolStatusSources) {
    this.root = canonical(projectRoot);
  }

  solStatus(): SolStatusResult {
    if (!this.solSources) throw new Error("Sol status sources are unavailable");
    const runtime = this.solSources.runtimeSummary(), sessions = this.solSources.sessionSummary();
    const workspace = this.solSources.workspaceInventory(), evidence = this.solSources.evidenceInventory();
    const markerNames = [".sol", ".planning", ".gsd", ".pulso"] as const;
    const projectLocalMarkers = Object.fromEntries(markerNames.map(name => {
      try {
        const stat = lstatSync(join(this.root, name));
        const kind = stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
        return [name, { present: true, kind }];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return [name, { present: false, kind: "absent" }];
      }
    })) as SolStatusResult["projectLocalMarkers"];
    return {
      queryId: "sol-status", observationId: randomUUID(), observedAt: new Date().toISOString(), projectRoot: this.root,
      storage: { database: { path: runtime.storage.database, classification: runtime.storage.classification }, workspace: workspace.storage,
        evidence: evidence.storage, markers: { path: this.root, classification: "project-local" } },
      runtime: runtime.v2, sessions, workspace: { records: workspace.records, artifacts: workspace.artifacts },
      externalArtifacts: { workspace: workspace.artifacts, evidenceByCategory: evidence.artifactsByCategory },
      recentWork: runtime.recentWork.slice(0, 8), recentAudit: runtime.recentAudit.slice(0, 24), legacyV1: runtime.legacyV1,
      projectLocalMarkers, bounds: { recentWork: 8, recentAudit: 24 },
    };
  }

  project(): ProjectQueryResult {
    const observationId = randomUUID();
    const observedAt = new Date().toISOString();
    const sourceGit = captureProjectGit(this.root);
    const result: ProjectQueryResult = {
      queryId: "project-status", observationId, observedAt, provenance: { directory: this.root, kind: "original-project" }, git: sourceGit,
      ...documents(this.root),
      documentsNote: "Bounded allowlisted document observations only; presence and hashes do not establish truth, currency or project health. Git and documents are not an atomic snapshot.",
      checks: { executed: [], note: "No tests or analysis were executed" }, evidenceRefs: [`observation:${observationId}`],
    };
    return result;
  }

  close(): void { /* No retained query lookup state. */ }
}
