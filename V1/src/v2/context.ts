import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, matchesGlob, relative, resolve } from "node:path";
import type { AssignmentPacket, SolCore } from "./core.js";

export interface SourceSnippet {
  id: string; path: string; reason: string;
  origin: "workspace" | "project-knowledge";
  status: "available" | "unknown"; snippet?: string; truncated?: boolean;
}

const knowledgePath = (path: string): boolean =>
  !path.includes("\\") && !path.split("/").some(part => !part || part === "." || part === "..") &&
  (/^\.sol\/(?:knowledge|decisions)\/.+/.test(path) ||
    /^\.sol\/project\/(?:index|architecture|conventions|patterns|business|design)\.md$/.test(path) ||
    /^\.sol\/project\/decisions\/[^/]+\.md$/.test(path) ||
    [".sol/PROJECT.md", ".sol/STRATEGY.md", ".sol/POLICIES.yml"].includes(path));
const contained = (root: string, path: string): string => {
  const rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\")) throw new Error("Source escapes root");
  return rel.split("\\").join("/");
};
export interface AssignmentContext extends AssignmentPacket {
  sourceSnippets: SourceSnippet[];
  sourceFingerprint: string;
  sourceFacts: "available" | "unknown";
  skills: string[];
}

/** Only declared, task-relevant sources are opened. Acceptance and dependency refs remain intact. */
export function compileAssignmentContext(core: SolCore, attemptId: string): AssignmentContext {
  const assignment = core.assignment(attemptId);
  const task: AssignmentPacket["task"] & { sourceIds?: string[]; skills?: string[] } = assignment.task;
  const root = realpathSync(assignment.workspacePath);
  const sources = assignment.sources.filter((source) => task.sourceIds?.includes(source.id) ||
    (!source.path.startsWith(".sol/") && [...task.reads, ...task.writes].some((scope) => source.path === scope || source.path.startsWith(`${scope}/`) || matchesGlob(source.path, scope))));
  let remaining = 12 * 1024;
  const hash = createHash("sha256");
  const sourceSnippets = sources.map((source): SourceSnippet => {
    let fd: number | undefined;
    let origin: SourceSnippet["origin"] = "workspace";
    try {
      const knowledge = Boolean(task.sourceIds?.includes(source.id) && knowledgePath(source.path));
      if (source.path.startsWith(".sol/") && !knowledge) throw new Error("Not an approved knowledge source");
      let sourceRoot = root;
      let path: string;
      try { path = realpathSync(resolve(root, source.path)); }
      catch (error) {
        if (!knowledge || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        origin = "project-knowledge";
        sourceRoot = realpathSync(core.projectRoot);
        path = realpathSync(resolve(sourceRoot, source.path));
      }
      const rel = contained(sourceRoot, path);
      // Approved aliases must not resolve to internal state or another arbitrary project file.
      if ((knowledge && !knowledgePath(rel)) || (rel.startsWith(".sol/") && !knowledge)) throw new Error("Unsafe knowledge source target");
      const before = lstatSync(path);
      if (!before.isFile()) throw new Error("Not a source file");
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      const openedPath = realpathSync(resolve(sourceRoot, source.path));
      if (openedPath !== path || stat.dev !== before.dev || stat.ino !== before.ino) throw new Error("Source changed while being opened");
      const maxBytes = knowledge ? 1024 * 1024 : Infinity;
      if (!stat.isFile() || stat.size > maxBytes) throw new Error("Invalid or oversized source file");
      const contentHash = createHash("sha256");
      const buffer = Buffer.alloc(8192);
      const snippets: Buffer[] = [];
      let bytes = 0;
      for (;;) {
        const count = readSync(fd, buffer);
        if (!count) break;
        bytes += count;
        if (bytes > maxBytes) throw new Error("Knowledge source exceeds file budget");
        contentHash.update(buffer.subarray(0, count));
        const take = Math.min(count, remaining);
        if (take) snippets.push(Buffer.from(buffer.subarray(0, take)));
        remaining -= take;
      }
      if (realpathSync(resolve(sourceRoot, source.path)) !== path) throw new Error("Source path changed while being read");
      // Decode only complete UTF-8 sequences so replacement characters cannot exceed the byte budget.
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const snippet = decoder.decode(Buffer.concat(snippets), { stream: true });
      hash.update(JSON.stringify([source.id, source.path, origin, contentHash.digest("hex")]));
      return { ...source, origin, status: "available", snippet, truncated: Buffer.byteLength(snippet) < bytes };
    } catch {
      hash.update(JSON.stringify([source.id, source.path, origin, "unknown"]));
      return { ...source, origin, status: "unknown" };
    } finally { if (fd !== undefined) closeSync(fd); }
  });
  return { ...assignment, sources, sourceSnippets, sourceFingerprint: hash.digest("hex"),
    sourceFacts: sourceSnippets.some((source) => source.status === "available") ? "available" : "unknown", skills: task.skills ?? [] };
}
