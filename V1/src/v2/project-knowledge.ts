import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

export const PROJECT_KNOWLEDGE_NAMESPACE = ".sol/project" as const;
export const PROJECT_KNOWLEDGE_SCHEMA_VERSION = 1 as const;
export const PROJECT_KNOWLEDGE_DOCUMENTS = [
  "index.md", "project.md", "stack.md", "integrations.md", "architecture.md", "structure.md",
  "conventions.md", "testing.md", "concerns.md", "design.md",
] as const;
export const BROWNFIELD_CODE_MAP_DOCUMENTS = [
  "stack.md", "integrations.md", "architecture.md", "structure.md", "conventions.md", "testing.md", "concerns.md",
] as const;
export const LEGACY_PROJECT_KNOWLEDGE_DOCUMENTS = ["business.md", "patterns.md"] as const;
export const REQUIRED_PROJECT_KNOWLEDGE_DOCUMENTS = BROWNFIELD_CODE_MAP_DOCUMENTS;

export type CanonicalKnowledgePath = typeof PROJECT_KNOWLEDGE_DOCUMENTS[number];
export type ProjectKind = "brownfield" | "greenfield" | "unknown";
export type KnowledgeQualityStatus = "valid" | "degraded" | "invalid" | "missing";

export interface KnowledgeDocumentContract { id: string; kind: string; requiredHeadings: readonly string[] }
export const PROJECT_KNOWLEDGE_CONTRACTS: Readonly<Record<CanonicalKnowledgePath, KnowledgeDocumentContract>> = {
  "index.md": { id: "index", kind: "index", requiredHeadings: ["Project snapshot", "Context routing", "Document inventory", "Cross-document constraints", "Unresolved high-impact questions", "Facts", "Inferences", "Open questions", "Sources"] },
  "project.md": { id: "project", kind: "project", requiredHeadings: ["Product definition", "Users", "Core value", "Workflows", "Capabilities", "Goals", "Non-goals", "Constraints", "Success measures", "Vocabulary", "Decisions", "Facts", "Inferences", "Open questions", "Sources"] },
  "stack.md": { id: "stack", kind: "stack", requiredHeadings: ["Runtime and languages", "Frameworks and libraries", "Package and dependency management", "Build and developer tooling", "Data and storage technologies", "Deployment and infrastructure", "Platform requirements", "Facts", "Inferences", "Open questions", "Sources"] },
  "integrations.md": { id: "integrations", kind: "integrations", requiredHeadings: ["External services and APIs", "Databases, queues, and storage", "Authentication and identity", "Inbound interfaces", "Outbound interfaces", "Configuration and secrets boundary", "Failure handling and observability", "Local substitutes and test doubles", "Facts", "Inferences", "Open questions", "Sources"] },
  "architecture.md": { id: "architecture", kind: "architecture", requiredHeadings: ["System shape", "Entry points and execution paths", "Module and service boundaries", "Dependency direction", "Data and control flow", "State and persistence", "Trust boundaries and permissions", "Error and recovery model", "Cross-cutting concerns", "Facts", "Inferences", "Open questions", "Sources"] },
  "structure.md": { id: "structure", kind: "structure", requiredHeadings: ["Top-level map", "Source layout", "Test layout", "Configuration and tooling layout", "Generated, vendored, and ignored areas", "Placement rules", "Navigation examples", "Facts", "Inferences", "Open questions", "Sources"] },
  "conventions.md": { id: "conventions", kind: "conventions", requiredHeadings: ["Policy sources", "Naming", "Formatting and style", "Types and interfaces", "Imports and module boundaries", "Error handling and logging", "Configuration and environment handling", "Documentation and comments", "Change and review practices", "Representative examples", "Facts", "Inferences", "Open questions", "Sources"] },
  "testing.md": { id: "testing", kind: "testing", requiredHeadings: ["Test strategy", "Frameworks and configuration", "Test organization and naming", "Unit, integration, end-to-end, and contract coverage", "Fixtures, factories, and test data", "Mocks, fakes, and external boundaries", "Assertions and representative patterns", "Commands and CI gates", "Coverage and known gaps", "Facts", "Inferences", "Open questions", "Sources"] },
  "concerns.md": { id: "concerns", kind: "concerns", requiredHeadings: ["Active risks and fragile areas", "Security and privacy", "Reliability and data integrity", "Performance and scalability", "Maintainability and complexity", "Test and observability gaps", "Dependency and platform risks", "Known debt and deferred work", "Operational constraints", "Facts", "Inferences", "Open questions", "Sources"] },
  "design.md": { id: "design", kind: "design", requiredHeadings: ["Scope and design status", "Product surfaces", "Users and contexts", "Experience principles", "Key flows", "Information architecture and navigation", "Visual language", "Design tokens", "Typography", "Layout and responsive behavior", "Components and composition", "Interaction and states", "Accessibility", "Content and microcopy", "Assets and iconography", "Design-system governance", "Approved references and provenance", "Decisions", "Facts", "Inferences", "Open questions", "Sources"] },
};

export interface ProjectKnowledgeOptions {
  maxDocumentBytes?: number; maxTotalBytes?: number; maxDecisions?: number;
  maxSourceBytes?: number; maxSourceTotalBytes?: number; maxSources?: number;
  maxDiscoveryDepth?: number; maxDiscoveryEntries?: number; maxDiscoveryManifests?: number;
  maxDiscoveryCodePaths?: number; maxDiscoveryGuidance?: number; maxDiscoveryCandidates?: number;
}
export interface KnowledgeSourceMetadata { path: string; sha256?: string; /** @deprecated Use sha256. */ hash?: string }
export interface KnowledgeMetadata {
  schemaVersion?: number; id?: string; kind?: string; reviewedAt?: string; reviewedCommit?: string;
  sources?: KnowledgeSourceMetadata[];
}
export interface KnowledgeDiagnostic {
  path: string;
  code: "invalid-selection" | "symlink" | "not-regular" | "empty" | "placeholder" | "oversized" | "budget" |
    "unreadable-or-changed" | "malformed-metadata" | "invalid-metadata" | "unsafe-source" | "source-unreadable" |
    "missing-heading" | "discovery-truncated";
  message: string;
}
export interface SourceFreshness {
  path: string; expectedHash?: string; currentHash?: string; status: "current" | "stale" | "unknown" | "untracked";
}
export interface KnowledgeFreshness { status: "fresh" | "stale" | "unknown" | "untracked"; sources: SourceFreshness[] }
export interface KnowledgeQuality {
  status: KnowledgeQualityStatus; requiredHeadings: string[]; missingHeadings: string[]; nonSubstantiveHeadings: string[];
}
export interface KnowledgeDocumentInfo {
  path: string; presence: boolean; bytes?: number; sha256?: string; modifiedAt?: string;
  metadata?: KnowledgeMetadata; freshness?: KnowledgeFreshness; quality: KnowledgeQuality; diagnostics: KnowledgeDiagnostic[];
}
export interface LoadedKnowledgeDocument extends KnowledgeDocumentInfo { presence: true; content: string; prose: string }
export interface ProjectDiscoveryResult {
  projectRoot: string; projectKind: ProjectKind; packageManifests: string[]; representativeCodePaths: string[];
  existingGuidance: string[]; candidates: string[]; entriesScanned: number; truncated: boolean;
  omissions: string[]; diagnostics: KnowledgeDiagnostic[];
  bounds: { maxDepth: number; maxEntries: number; maxManifests: number; maxCodePaths: number; maxGuidance: number; maxCandidates: number };
}
export interface ProjectKnowledgeInventory {
  projectRoot: string; namespace: string; projectKind: ProjectKind; pointer: KnowledgeDocumentInfo;
  documents: KnowledgeDocumentInfo[]; diagnostics: KnowledgeDiagnostic[]; discovery: ProjectDiscoveryResult;
  bounds: { maxDocumentBytes: number; maxTotalBytes: number; maxDecisions: number; maxSourceBytes: number; maxSourceTotalBytes: number; maxSources: number };
}
export interface ProjectKnowledgeLoadResult {
  projectRoot: string; namespace: string; documents: LoadedKnowledgeDocument[]; diagnostics: KnowledgeDiagnostic[];
  bytes: number; maxTotalBytes: number; omitted: string[];
}
export interface ProjectKnowledgeCompleteness {
  complete: boolean; projectKind: ProjectKind; designRequired: boolean; indexPresent: boolean;
  required: string[]; requiredPresent: string[]; missing: string[]; degraded: string[]; invalid: string[]; designPresent: boolean;
}
export interface TrustedBaselineSource { path: string; sha256: string }
export interface TrustedBaselineDocument { id: string; path: string; sha256: string; sources: TrustedBaselineSource[] }
export interface ProjectKnowledgeBaseline { schemaVersion: 1; documents: TrustedBaselineDocument[] }
export interface ProjectKnowledgeBaselineCapture { baseline: ProjectKnowledgeBaseline; diagnostics: KnowledgeDiagnostic[]; omitted: string[] }
export type BaselineChangeKind = "document-changed" | "document-deleted" | "document-unreadable" | "source-changed" | "source-deleted" | "source-unreadable";
export interface ProjectKnowledgeBaselineChange { kind: BaselineChangeKind; path: string; affectedDocumentIds: string[]; expectedHash: string; currentHash?: string }
export interface ProjectKnowledgeBaselineComparison { status: "current" | "changed" | "unknown"; changes: ProjectKnowledgeBaselineChange[]; diagnostics: KnowledgeDiagnostic[] }

const defaults = {
  maxDocumentBytes: 256 * 1024, maxTotalBytes: 1024 * 1024, maxDecisions: 100,
  maxSourceBytes: 2 * 1024 * 1024, maxSourceTotalBytes: 32 * 1024 * 1024, maxSources: 512,
  maxDiscoveryDepth: 5, maxDiscoveryEntries: 2_000, maxDiscoveryManifests: 32,
  maxDiscoveryCodePaths: 64, maxDiscoveryGuidance: 32, maxDiscoveryCandidates: 64,
};
type Bounds = typeof defaults;
type SafeRead = { buffer: Buffer; bytes: number; sha256: string; modifiedAt: string };
type SourceBudget = { bytes: number; sources: number };

const MANIFEST_NAMES = new Set(["package.json", "deno.json", "deno.jsonc", "bun.lock", "pnpm-workspace.yaml", "pyproject.toml", "requirements.txt", "poetry.lock", "Pipfile", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "composer.json", "Gemfile", "mix.exs", "Package.swift", "CMakeLists.txt", "Makefile", "pubspec.yaml", "Podfile"]);
const GUIDANCE_NAMES = new Set(["README", "AGENTS", "CONTRIBUTING", "ARCHITECTURE", "DESIGN", "PROJECT", "PRODUCT", "PRODUCT-AND-BRAND", "REQUIREMENTS", "ROADMAP", "STATE", "UI-SPEC"]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".rs", ".go", ".java", ".kt", ".kts", ".swift", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".php", ".ex", ".exs", ".scala", ".sh", ".vue", ".svelte"]);
const SKIP_DIRECTORIES = new Set([".git", ".hg", ".svn", ".sol", ".dart_tool", ".gradle", "node_modules", "vendor", "Pods", "ephemeral", "DerivedData", "dist", "build", "out", "target", "coverage", ".next", ".nuxt", ".cache", "generated", "__generated__"]);
const SECRET_PART = /(^|[._-])(secret|secrets|credential|credentials|private|token|tokens|password|passwd|key|keys|env)([._-]|$)/i;
const PLACEHOLDER = /^(?:[-*_`#\s]|todo|tbd|placeholder|coming soon|to be determined|fill (?:me|this) in)+[.!\s]*$/i;

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Knowledge bounds must be positive integers");
  return value;
}
function canonicalRoot(input: string): string {
  const root = realpathSync(resolve(input)); const stat = lstatSync(root);
  if (!stat.isDirectory()) throw new Error("Project root must be a directory");
  return root;
}
function diagnostic(path: string, code: KnowledgeDiagnostic["code"], message: string): KnowledgeDiagnostic { return { path, code, message }; }
function safeRelativePath(path: string): boolean {
  if (!path || path.includes("\0") || path.includes("\\") || isAbsolute(path)) return false;
  return !path.split("/").some(part => !part || part === "." || part === "..");
}
function secretLike(path: string): boolean { return path.split("/").some(part => SECRET_PART.test(part) || /^\.env(?:\.|$)/i.test(part)); }
function excludedSource(path: string): boolean {
  if (!safeRelativePath(path) || secretLike(path)) return true;
  if (path.startsWith(`${PROJECT_KNOWLEDGE_NAMESPACE}/`)) {
    const document = path.slice(PROJECT_KNOWLEDGE_NAMESPACE.length + 1);
    return !(PROJECT_KNOWLEDGE_DOCUMENTS as readonly string[]).includes(document);
  }
  return path.split("/").some(part => SKIP_DIRECTORIES.has(part));
}
function supportedSelection(path: string): boolean {
  return path === "SOL.md" || (PROJECT_KNOWLEDGE_DOCUMENTS as readonly string[]).includes(path) ||
    (LEGACY_PROJECT_KNOWLEDGE_DOCUMENTS as readonly string[]).includes(path) || /^decisions\/[^/]+\.md$/i.test(path);
}
function safeRead(root: string, relativePath: string, limit: number): SafeRead {
  if (!safeRelativePath(relativePath)) throw Object.assign(new Error("Path traversal is not allowed"), { code: "INVALID_PATH" });
  let current = root;
  for (const part of relativePath.split("/")) {
    current = join(current, part); const entry = lstatSync(current);
    if (entry.isSymbolicLink()) throw Object.assign(new Error("Symlinks are not allowed"), { code: "SYMLINK" });
  }
  const before = lstatSync(current);
  if (!before.isFile()) throw Object.assign(new Error("Path is not a regular file"), { code: "NOT_REGULAR" });
  if (before.size > limit) throw Object.assign(new Error("File exceeds its byte limit"), { code: "OVERSIZED" });
  let fd: number | undefined;
  try {
    fd = openSync(current, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd); const canonical = realpathSync(current); const rel = relative(root, canonical);
    if (canonical !== current || isAbsolute(rel) || rel === ".." || rel.startsWith("../")) throw new Error("File escaped its canonical root");
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error("File changed while being opened");
    const buffer = Buffer.alloc(opened.size); let offset = 0;
    while (offset < buffer.length) { const count = readSync(fd, buffer, offset, buffer.length - offset, offset); if (!count) throw new Error("File changed while being read"); offset += count; }
    const after = fstatSync(fd);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || realpathSync(current) !== canonical) throw new Error("File changed while being read");
    return { buffer, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), modifiedAt: opened.mtime.toISOString() };
  } finally { if (fd !== undefined) closeSync(fd); }
}
function errorCode(error: unknown): KnowledgeDiagnostic["code"] | "missing" {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "missing";
  if (code === "SYMLINK" || code === "ELOOP") return "symlink";
  if (code === "NOT_REGULAR") return "not-regular";
  if (code === "OVERSIZED") return "oversized";
  if (code === "INVALID_PATH") return "invalid-selection";
  return "unreadable-or-changed";
}
function scalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function parseFrontmatter(path: string, content: string): { metadata?: KnowledgeMetadata; prose: string; diagnostics: KnowledgeDiagnostic[]; hasFrontmatter: boolean } {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return { prose: content, diagnostics: [], hasFrontmatter: false };
  const lines = content.split(/\r?\n/); const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end < 0) return { prose: content, diagnostics: [diagnostic(path, "malformed-metadata", "Frontmatter has no closing delimiter")], hasFrontmatter: true };
  const prose = lines.slice(end + 1).join("\n"); const metadata: KnowledgeMetadata = {}; const sources: KnowledgeSourceMetadata[] = [];
  let source: KnowledgeSourceMetadata | undefined; let inSources = false;
  const fail = (message: string) => ({ prose, diagnostics: [diagnostic(path, "malformed-metadata", message)], hasFrontmatter: true });
  for (const raw of lines.slice(1, end)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const top = /^([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/.exec(raw);
    if (top) {
      const key = top[1]!; const rawValue = top[2] ?? ""; inSources = key === "sources"; source = undefined;
      if (inSources) { if (rawValue.trim() && rawValue.trim() !== "[]") return fail("sources must be a list"); continue; }
      const value = scalar(rawValue);
      if (key === "schemaVersion") { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) return fail("schemaVersion must be a positive integer"); metadata.schemaVersion = parsed; }
      else if (["id", "kind", "reviewedAt", "reviewedCommit"].includes(key)) { if (!value) return fail(`${key} must be a non-empty scalar`); (metadata as Record<string, unknown>)[key] = value; }
      continue;
    }
    if (inSources) {
      const first = /^\s*-\s+path:\s*(.+)$/.exec(raw); const field = /^\s+(path|sha256|hash):\s*(.+)$/.exec(raw);
      if (first) { if (sources.length >= 128) return fail("sources exceeds the 128-entry limit"); source = { path: scalar(first[1]!) }; sources.push(source); continue; }
      if (field && source) { source[field[1] as "path" | "sha256" | "hash"] = scalar(field[2]!); continue; }
    }
    return fail(`Unsupported frontmatter syntax: ${raw.trim()}`);
  }
  for (const item of sources) {
    const digest = item.sha256 ?? item.hash;
    if (!item.path || (digest !== undefined && !/^[a-fA-F0-9]{64}$/.test(digest))) return fail("Each source requires a path and an optional SHA-256 hash");
    if (digest) item.sha256 = digest.toLowerCase();
    delete item.hash;
  }
  if (sources.length) metadata.sources = sources;
  return { metadata, prose, diagnostics: [], hasFrontmatter: true };
}

function headings(prose: string): Map<string, string> {
  const bodies = new Map<string, string[]>(); const active: Array<{ level: number; title: string }> = [];
  const lines = prose.split(/\r?\n/);
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      const level = match[1]!.length, title = match[2]!.trim().toLowerCase();
      while (active.length && active[active.length - 1]!.level >= level) active.pop();
      active.push({ level, title }); if (!bodies.has(title)) bodies.set(title, []);
    } else for (const heading of active) bodies.get(heading.title)!.push(line);
  }
  return new Map([...bodies].map(([title, body]) => [title, body.join("\n").trim()]));
}
function sourcesFromMarkdown(prose: string): KnowledgeSourceMetadata[] {
  const lines = prose.split(/\r?\n/); let inSources = false; const sources: KnowledgeSourceMetadata[] = [];
  for (const line of lines) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { inSources = heading[1]!.trim().toLowerCase() === "sources"; continue; }
    if (!inSources) continue;
    const item = /^\s*[-*]\s+`([^`]+)`(?:\s|$)/.exec(line);
    if (item && !sources.some(source => source.path === item[1])) sources.push({ path: item[1]! });
    if (sources.length >= 128) break;
  }
  return sources;
}
function effectiveMetadata(metadata: KnowledgeMetadata | undefined, prose: string): KnowledgeMetadata | undefined {
  const markdownSources = sourcesFromMarkdown(prose);
  if (!metadata && !markdownSources.length) return undefined;
  const sources = [...(metadata?.sources ?? [])];
  for (const source of markdownSources) if (!sources.some(current => current.path === source.path)) sources.push(source);
  return { ...(metadata ?? {}), ...(sources.length ? { sources } : {}) };
}
function substantive(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.replace(/<!--[^]*?-->/g, "").trim();
  return /^(?:not detected|not applicable)\.?$/i.test(normalized) || (normalized.length >= 12 && !PLACEHOLDER.test(normalized));
}
function expectedContract(path: string): KnowledgeDocumentContract | undefined { return PROJECT_KNOWLEDGE_CONTRACTS[path as CanonicalKnowledgePath]; }
function evaluateQuality(path: string, prose: string, metadata: KnowledgeMetadata | undefined,
    diagnostics: KnowledgeDiagnostic[], projectKind: ProjectKind): KnowledgeQuality {
  const contract = expectedContract(path); const requiredHeadings = contract ? [...contract.requiredHeadings] : [];
  const sections = headings(prose); const missingHeadings = requiredHeadings.filter(heading => !sections.has(heading.toLowerCase()));
  const nonSubstantiveHeadings = requiredHeadings.filter(heading => sections.has(heading.toLowerCase()) && !substantive(sections.get(heading.toLowerCase())));
  for (const heading of missingHeadings) diagnostics.push(diagnostic(path, "missing-heading", `Missing required heading: ${heading}`));
  for (const heading of nonSubstantiveHeadings) diagnostics.push(diagnostic(path, "placeholder", `Required section is not substantive: ${heading}`));
  if (contract && metadata) {
    if (metadata.schemaVersion !== undefined && metadata.schemaVersion !== PROJECT_KNOWLEDGE_SCHEMA_VERSION) diagnostics.push(diagnostic(path, "invalid-metadata", `schemaVersion must be ${PROJECT_KNOWLEDGE_SCHEMA_VERSION}`));
    if (metadata.id !== undefined && metadata.id !== contract.id) diagnostics.push(diagnostic(path, "invalid-metadata", `id must be ${contract.id}`));
    if (metadata.kind !== undefined && metadata.kind !== contract.kind) diagnostics.push(diagnostic(path, "invalid-metadata", `kind must be ${contract.kind}`));
  }
  const sourceProvenanceMissing = projectKind === "brownfield" && (BROWNFIELD_CODE_MAP_DOCUMENTS as readonly string[]).includes(path) && !metadata?.sources?.length;
  const hardInvalid = diagnostics.some(item => ["empty", "placeholder", "invalid-metadata", "unsafe-source"].includes(item.code));
  const degraded = !contract || missingHeadings.length > 0 || sourceProvenanceMissing || diagnostics.some(item => item.code === "malformed-metadata");
  const status: KnowledgeQualityStatus = hardInvalid ? "invalid" : degraded ? "degraded" : "valid";
  return { status, requiredHeadings, missingHeadings, nonSubstantiveHeadings };
}
function sourceFreshness(root: string, documentPath: string, metadata: KnowledgeMetadata | undefined, bounds: Bounds,
    budget: SourceBudget, enabled: boolean): { freshness: KnowledgeFreshness; diagnostics: KnowledgeDiagnostic[] } {
  if (!metadata?.sources?.length) return { freshness: { status: "untracked", sources: [] }, diagnostics: [] };
  const diagnostics: KnowledgeDiagnostic[] = [];
  const sources = metadata.sources.map((source): SourceFreshness => {
    const expected = source.sha256 ? { expectedHash: source.sha256 } : {};
    if (excludedSource(source.path)) { diagnostics.push(diagnostic(documentPath, "unsafe-source", `Unsafe source path: ${source.path}`)); return { path: source.path, ...expected, status: "unknown" }; }
    if (!enabled) return { path: source.path, ...expected, status: "unknown" };
    if (budget.sources <= 0 || budget.bytes <= 0) { diagnostics.push(diagnostic(documentPath, "budget", "Source hash budget exhausted")); return { path: source.path, ...expected, status: "unknown" }; }
    try {
      budget.sources--; const observed = safeRead(root, source.path, Math.min(bounds.maxSourceBytes, budget.bytes)); budget.bytes -= observed.bytes;
      return { path: source.path, ...expected, currentHash: observed.sha256, status: source.sha256 ? (observed.sha256 === source.sha256 ? "current" : "stale") : "untracked" };
    } catch (error) {
      diagnostics.push(diagnostic(documentPath, errorCode(error) === "symlink" ? "unsafe-source" : "source-unreadable", `Source cannot be safely hashed: ${source.path}`));
      return { path: source.path, ...expected, status: "unknown" };
    }
  });
  const status = sources.some(item => item.status === "stale") ? "stale" : sources.some(item => item.status === "unknown") ? "unknown" :
    sources.some(item => item.status === "untracked") ? "untracked" : "fresh";
  return { freshness: { status, sources }, diagnostics };
}

function isGuidance(name: string): boolean { const stem = name.replace(/\.(md|markdown|txt)$/i, "").toUpperCase(); return GUIDANCE_NAMES.has(stem); }
function isCandidate(name: string): boolean { return /(^|[-_.])(ADR|PRD|SPEC|RFC)([-_.]|\d|$)/i.test(name); }
function addBounded(list: string[], value: string, limit: number, omissions: Set<string>, label: string): void {
  if (list.length < limit) list.push(value); else omissions.add(`${label} capped at ${limit}`);
}

/** Inspect names and file metadata only. Discovery never reads file contents or follows symlinks. */
export function discoverProject(projectRoot: string, options: ProjectKnowledgeOptions = {}): ProjectDiscoveryResult {
  const root = canonicalRoot(projectRoot);
  const bounds = {
    maxDepth: positiveInteger(options.maxDiscoveryDepth, defaults.maxDiscoveryDepth),
    maxEntries: positiveInteger(options.maxDiscoveryEntries, defaults.maxDiscoveryEntries),
    maxManifests: positiveInteger(options.maxDiscoveryManifests, defaults.maxDiscoveryManifests),
    maxCodePaths: positiveInteger(options.maxDiscoveryCodePaths, defaults.maxDiscoveryCodePaths),
    maxGuidance: positiveInteger(options.maxDiscoveryGuidance, defaults.maxDiscoveryGuidance),
    maxCandidates: positiveInteger(options.maxDiscoveryCandidates, defaults.maxDiscoveryCandidates),
  };
  const packageManifests: string[] = []; const representativeCodePaths: string[] = []; const existingGuidance: string[] = []; const candidates: string[] = [];
  const diagnostics: KnowledgeDiagnostic[] = []; const omissions = new Set<string>(); let entriesScanned = 0; let truncated = false;
  const queue: Array<{ path: string; depth: number }> = [{ path: "", depth: 0 }];
  while (queue.length && entriesScanned < bounds.maxEntries) {
    const item = queue.shift()!; const absolute = item.path ? join(root, item.path) : root;
    let entries;
    try { entries = readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en")); }
    catch (error) { diagnostics.push(diagnostic(item.path || ".", "unreadable-or-changed", (error as Error).message)); continue; }
    for (const entry of entries) {
      if (entriesScanned >= bounds.maxEntries) { truncated = true; break; }
      entriesScanned++;
      if (secretLike(entry.name) || SKIP_DIRECTORIES.has(entry.name)) continue;
      const path = item.path ? `${item.path}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (item.depth < bounds.maxDepth) queue.push({ path, depth: item.depth + 1 }); else { truncated = true; omissions.add(`directory depth capped at ${bounds.maxDepth}`); } continue; }
      if (!entry.isFile()) continue;
      if (MANIFEST_NAMES.has(entry.name)) addBounded(packageManifests, path, bounds.maxManifests, omissions, "package manifests");
      if (CODE_EXTENSIONS.has(extname(entry.name).toLowerCase())) addBounded(representativeCodePaths, path, bounds.maxCodePaths, omissions, "representative code paths");
      if (isGuidance(entry.name)) addBounded(existingGuidance, path, bounds.maxGuidance, omissions, "existing guidance");
      if (isCandidate(entry.name)) addBounded(candidates, path, bounds.maxCandidates, omissions, "planning candidates");
    }
  }
  if (queue.length) { truncated = true; omissions.add(`entry scan capped at ${bounds.maxEntries}`); }
  for (const list of [packageManifests, representativeCodePaths, existingGuidance, candidates]) list.sort();
  if (truncated || omissions.size) diagnostics.push(diagnostic(".", "discovery-truncated", [...omissions].sort().join("; ") || "Discovery was truncated"));
  const projectKind: ProjectKind = packageManifests.length || representativeCodePaths.length ? "brownfield" : truncated || diagnostics.some(item => item.code === "unreadable-or-changed") ? "unknown" : "greenfield";
  return { projectRoot: root, projectKind, packageManifests, representativeCodePaths, existingGuidance, candidates,
    entriesScanned, truncated: truncated || omissions.size > 0, omissions: [...omissions].sort(), diagnostics, bounds };
}
export const discoverProjectKnowledge = discoverProject;

function missingQuality(requiredHeadings: readonly string[] = []): KnowledgeQuality { return { status: "missing", requiredHeadings: [...requiredHeadings], missingHeadings: [...requiredHeadings], nonSubstantiveHeadings: [] }; }

export class ProjectKnowledge {
  readonly projectRoot: string; readonly namespace: string; private readonly bounds: Bounds;
  constructor(projectRoot: string, options: ProjectKnowledgeOptions = {}) {
    this.projectRoot = canonicalRoot(projectRoot); this.namespace = join(this.projectRoot, PROJECT_KNOWLEDGE_NAMESPACE);
    this.bounds = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, positiveInteger(options[key as keyof ProjectKnowledgeOptions], fallback)])) as Bounds;
  }
  discover(): ProjectDiscoveryResult { return discoverProject(this.projectRoot, this.bounds); }

  private observe(path: string, remaining: number, includeContent: boolean, sourceBudget: SourceBudget, checkFreshness: boolean,
      projectKind: ProjectKind): { info: KnowledgeDocumentInfo; loaded?: LoadedKnowledgeDocument; consumed: number } {
    const diskPath = path === "SOL.md" ? path : `${PROJECT_KNOWLEDGE_NAMESPACE}/${path}`; const contract = expectedContract(path);
    try {
      const observed = safeRead(this.projectRoot, diskPath, this.bounds.maxDocumentBytes);
      if (observed.bytes > remaining) return { info: { path, presence: true, quality: missingQuality(contract?.requiredHeadings), diagnostics: [diagnostic(path, "budget", "Total knowledge byte budget exhausted")] }, consumed: 0 };
      const content = observed.buffer.toString("utf8"); const parsed = parseFrontmatter(path, content);
      const metadata = effectiveMetadata(parsed.metadata, parsed.prose);
      const fresh = sourceFreshness(this.projectRoot, path, metadata, this.bounds, sourceBudget, checkFreshness);
      const diagnostics = [...parsed.diagnostics, ...(content.trim() ? [] : [diagnostic(path, "empty", "Knowledge document is empty")]), ...fresh.diagnostics];
      const quality = evaluateQuality(path, parsed.prose, metadata, diagnostics, projectKind);
      const info: KnowledgeDocumentInfo = { path, presence: true, bytes: observed.bytes, sha256: observed.sha256, modifiedAt: observed.modifiedAt,
        ...(metadata ? { metadata } : {}), freshness: fresh.freshness, quality, diagnostics };
      return { info, consumed: observed.bytes, ...(includeContent ? { loaded: { ...info, presence: true, content, prose: parsed.prose } } : {}) };
    } catch (error) {
      const code = errorCode(error);
      if (code === "missing") return { info: { path, presence: false, quality: missingQuality(contract?.requiredHeadings), diagnostics: [] }, consumed: 0 };
      return { info: { path, presence: true, quality: { ...missingQuality(contract?.requiredHeadings), status: "invalid" }, diagnostics: [diagnostic(path, code, (error as Error).message)] }, consumed: 0 };
    }
  }
  private decisions(diagnostics: KnowledgeDiagnostic[]): string[] {
    const directoryPath = `${PROJECT_KNOWLEDGE_NAMESPACE}/decisions`;
    try {
      let current = this.projectRoot;
      for (const part of directoryPath.split("/")) { current = join(current, part); if (lstatSync(current).isSymbolicLink()) throw Object.assign(new Error("Decisions directory contains a symlink"), { code: "SYMLINK" }); }
      if (!lstatSync(current).isDirectory() || realpathSync(current) !== current) throw new Error("Decisions path is not a canonical directory");
      const names = readdirSync(current, { withFileTypes: true }).filter(entry => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".md") && !secretLike(entry.name)).map(entry => entry.name).sort();
      if (names.length > this.bounds.maxDecisions) diagnostics.push(diagnostic("decisions", "budget", `Decision inventory capped at ${this.bounds.maxDecisions}`));
      return names.slice(0, this.bounds.maxDecisions).map(name => `decisions/${name}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") diagnostics.push(diagnostic("decisions", errorCode(error) === "symlink" ? "symlink" : "unreadable-or-changed", (error as Error).message));
      return [];
    }
  }
  inventory(options: { includeDecisions?: boolean; checkFreshness?: boolean; projectKind?: ProjectKind } = {}): ProjectKnowledgeInventory {
    const discovery = this.discover(); const projectKind = options.projectKind ?? discovery.projectKind; const diagnostics = [...discovery.diagnostics];
    let remaining = this.bounds.maxTotalBytes; const sourceBudget = { bytes: this.bounds.maxSourceTotalBytes, sources: this.bounds.maxSources };
    const pointer = this.observe("SOL.md", remaining, false, sourceBudget, options.checkFreshness ?? true, projectKind); remaining -= pointer.consumed;
    const paths = [...PROJECT_KNOWLEDGE_DOCUMENTS, ...LEGACY_PROJECT_KNOWLEDGE_DOCUMENTS, ...(options.includeDecisions === false ? [] : this.decisions(diagnostics))];
    const documents = paths.map(path => { const result = this.observe(path, remaining, false, sourceBudget, options.checkFreshness ?? true, projectKind); remaining -= result.consumed; return result.info; });
    diagnostics.push(...pointer.info.diagnostics, ...documents.flatMap(document => document.diagnostics));
    return { projectRoot: this.projectRoot, namespace: this.namespace, projectKind, pointer: pointer.info, documents, diagnostics, discovery,
      bounds: { maxDocumentBytes: this.bounds.maxDocumentBytes, maxTotalBytes: this.bounds.maxTotalBytes, maxDecisions: this.bounds.maxDecisions,
        maxSourceBytes: this.bounds.maxSourceBytes, maxSourceTotalBytes: this.bounds.maxSourceTotalBytes, maxSources: this.bounds.maxSources } };
  }
  status(): ProjectKnowledgeInventory { return this.inventory(); }
  load(selected: readonly string[], options: { projectKind?: ProjectKind; checkFreshness?: boolean } = {}): ProjectKnowledgeLoadResult {
    const diagnostics: KnowledgeDiagnostic[] = []; const documents: LoadedKnowledgeDocument[] = []; const omitted: string[] = [];
    let remaining = this.bounds.maxTotalBytes; const sourceBudget = { bytes: this.bounds.maxSourceTotalBytes, sources: this.bounds.maxSources };
    const projectKind = options.projectKind ?? this.discover().projectKind;
    for (const path of [...new Set(selected)]) {
      if (!safeRelativePath(path) || !supportedSelection(path)) { diagnostics.push(diagnostic(path, "invalid-selection", "Selection is outside supported project knowledge documents")); continue; }
      const result = this.observe(path, remaining, true, sourceBudget, options.checkFreshness ?? true, projectKind); remaining -= result.consumed;
      diagnostics.push(...result.info.diagnostics); if (result.loaded) documents.push(result.loaded); else if (result.info.presence) omitted.push(path);
    }
    return { projectRoot: this.projectRoot, namespace: this.namespace, documents, diagnostics, bytes: this.bounds.maxTotalBytes - remaining, maxTotalBytes: this.bounds.maxTotalBytes, omitted };
  }
  loadSelected(selected: readonly string[]): ProjectKnowledgeLoadResult { return this.load(selected); }

  captureBaseline(selected: readonly string[] = PROJECT_KNOWLEDGE_DOCUMENTS): ProjectKnowledgeBaselineCapture {
    const diagnostics: KnowledgeDiagnostic[] = []; const omitted: string[] = []; const documents: TrustedBaselineDocument[] = [];
    let documentBytes = this.bounds.maxTotalBytes; const sourceBudget = { bytes: this.bounds.maxSourceTotalBytes, sources: this.bounds.maxSources };
    for (const path of [...new Set(selected)].sort()) {
      if (!safeRelativePath(path) || !supportedSelection(path)) { diagnostics.push(diagnostic(path, "invalid-selection", "Cannot baseline unsupported document")); omitted.push(path); continue; }
      const diskPath = path === "SOL.md" ? path : `${PROJECT_KNOWLEDGE_NAMESPACE}/${path}`;
      try {
        const observed = safeRead(this.projectRoot, diskPath, Math.min(this.bounds.maxDocumentBytes, documentBytes)); documentBytes -= observed.bytes;
        const content = observed.buffer.toString("utf8"); const parsed = parseFrontmatter(path, content); diagnostics.push(...parsed.diagnostics);
        const metadata = effectiveMetadata(parsed.metadata, parsed.prose);
        const id = metadata?.id ?? expectedContract(path)?.id ?? path.replace(/\.md$/i, ""); const sources: TrustedBaselineSource[] = [];
        for (const source of metadata?.sources ?? []) {
          if (excludedSource(source.path)) { diagnostics.push(diagnostic(path, "unsafe-source", `Unsafe source path: ${source.path}`)); continue; }
          if (sourceBudget.sources <= 0 || sourceBudget.bytes <= 0) { diagnostics.push(diagnostic(path, "budget", "Source baseline budget exhausted")); continue; }
          try { sourceBudget.sources--; const current = safeRead(this.projectRoot, source.path, Math.min(this.bounds.maxSourceBytes, sourceBudget.bytes)); sourceBudget.bytes -= current.bytes; sources.push({ path: source.path, sha256: current.sha256 }); }
          catch { diagnostics.push(diagnostic(path, "source-unreadable", `Source cannot be safely hashed: ${source.path}`)); }
        }
        documents.push({ id, path, sha256: observed.sha256, sources: sources.sort((a, b) => a.path.localeCompare(b.path)) });
      } catch (error) { const code = errorCode(error); if (code !== "missing") diagnostics.push(diagnostic(path, code, (error as Error).message)); omitted.push(path); }
    }
    return { baseline: { schemaVersion: 1, documents }, diagnostics, omitted: [...new Set(omitted)].sort() };
  }

  compareBaseline(baseline: ProjectKnowledgeBaseline): ProjectKnowledgeBaselineComparison {
    const diagnostics: KnowledgeDiagnostic[] = []; const changes: ProjectKnowledgeBaselineChange[] = [];
    const sourceOwners = new Map<string, { hash: string; ids: Set<string> }>();
    let documentBytes = this.bounds.maxTotalBytes;
    const maximumDocuments = PROJECT_KNOWLEDGE_DOCUMENTS.length + LEGACY_PROJECT_KNOWLEDGE_DOCUMENTS.length + this.bounds.maxDecisions + 1;
    if (baseline.schemaVersion !== 1) diagnostics.push(diagnostic("baseline", "invalid-metadata", "Unsupported baseline schemaVersion"));
    if (baseline.documents.length > maximumDocuments) diagnostics.push(diagnostic("baseline", "budget", `Baseline document count capped at ${maximumDocuments}`));
    for (const document of baseline.documents.slice(0, maximumDocuments)) {
      if (!safeRelativePath(document.path) || !supportedSelection(document.path) || !/^[a-f0-9]{64}$/i.test(document.sha256)) { diagnostics.push(diagnostic(document.path, "invalid-selection", "Unsafe or malformed baseline document")); continue; }
      const diskPath = document.path === "SOL.md" ? document.path : `${PROJECT_KNOWLEDGE_NAMESPACE}/${document.path}`;
      if (documentBytes <= 0) { diagnostics.push(diagnostic(document.path, "budget", "Document comparison budget exhausted")); changes.push({ kind: "document-unreadable", path: document.path, affectedDocumentIds: [document.id], expectedHash: document.sha256 }); continue; }
      try { const current = safeRead(this.projectRoot, diskPath, Math.min(this.bounds.maxDocumentBytes, documentBytes)); documentBytes -= current.bytes; if (current.sha256 !== document.sha256) changes.push({ kind: "document-changed", path: document.path, affectedDocumentIds: [document.id], expectedHash: document.sha256, currentHash: current.sha256 }); }
      catch (error) { const code = errorCode(error); changes.push({ kind: code === "missing" ? "document-deleted" : "document-unreadable", path: document.path, affectedDocumentIds: [document.id], expectedHash: document.sha256 }); }
      for (const source of document.sources) {
        if (excludedSource(source.path) || !/^[a-f0-9]{64}$/i.test(source.sha256)) { diagnostics.push(diagnostic(document.path, "unsafe-source", `Unsafe or malformed baseline source: ${source.path}`)); continue; }
        const owner = sourceOwners.get(source.path);
        if (owner && owner.hash !== source.sha256) { diagnostics.push(diagnostic(document.path, "invalid-metadata", `Conflicting baseline hashes for source: ${source.path}`)); continue; }
        if (owner) owner.ids.add(document.id); else sourceOwners.set(source.path, { hash: source.sha256, ids: new Set([document.id]) });
      }
    }
    let bytes = this.bounds.maxSourceTotalBytes; let count = this.bounds.maxSources;
    for (const [path, source] of [...sourceOwners].sort(([a], [b]) => a.localeCompare(b))) {
      const affectedDocumentIds = [...source.ids].sort();
      if (count <= 0 || bytes <= 0) { diagnostics.push(diagnostic(path, "budget", "Source comparison budget exhausted")); changes.push({ kind: "source-unreadable", path, affectedDocumentIds, expectedHash: source.hash }); continue; }
      try { count--; const current = safeRead(this.projectRoot, path, Math.min(this.bounds.maxSourceBytes, bytes)); bytes -= current.bytes; if (current.sha256 !== source.hash) changes.push({ kind: "source-changed", path, affectedDocumentIds, expectedHash: source.hash, currentHash: current.sha256 }); }
      catch (error) { changes.push({ kind: errorCode(error) === "missing" ? "source-deleted" : "source-unreadable", path, affectedDocumentIds, expectedHash: source.hash }); }
    }
    changes.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
    return { status: changes.some(change => !change.kind.endsWith("unreadable")) ? "changed" : changes.length || diagnostics.length ? "unknown" : "current", changes, diagnostics };
  }
}

export function projectKnowledgeCompleteness(input: ProjectKnowledgeInventory | readonly KnowledgeDocumentInfo[],
    options: { projectKind?: ProjectKind; designSelected?: boolean } = {}): ProjectKnowledgeCompleteness {
  const documents = "documents" in input ? input.documents : input; const projectKind = options.projectKind ?? ("projectKind" in input ? input.projectKind : "unknown");
  const designRequired = options.designSelected ?? false;
  const required = projectKind === "brownfield" ? ["index.md", "project.md", ...BROWNFIELD_CODE_MAP_DOCUMENTS] :
    projectKind === "greenfield" ? ["index.md", "project.md"] : ["index.md", "project.md"];
  if (designRequired) required.push("design.md");
  const byPath = new Map(documents.map(document => [document.path, document]));
  const requiredPresent = required.filter(path => { const document = byPath.get(path); return document?.presence &&
    (document.quality.status === "valid" || document.quality.status === "degraded") && document.quality.missingHeadings.length === 0; });
  const invalid = required.filter(path => byPath.get(path)?.quality.status === "invalid");
  const missing = required.filter(path => !requiredPresent.includes(path));
  const degraded = required.filter(path => byPath.get(path)?.quality.status === "degraded");
  const design = byPath.get("design.md");
  return { complete: projectKind !== "unknown" && missing.length === 0, projectKind, designRequired,
    indexPresent: requiredPresent.includes("index.md"), required, requiredPresent, missing, degraded, invalid,
    designPresent: Boolean(design?.presence && design.quality.status !== "invalid") };
}

export function inventoryProjectKnowledge(projectRoot: string, options?: ProjectKnowledgeOptions): ProjectKnowledgeInventory { return new ProjectKnowledge(projectRoot, options).inventory(); }
export function loadProjectKnowledge(projectRoot: string, selected: readonly string[], options?: ProjectKnowledgeOptions): ProjectKnowledgeLoadResult { return new ProjectKnowledge(projectRoot, options).load(selected); }
export function captureProjectKnowledgeBaseline(projectRoot: string, selected?: readonly string[], options?: ProjectKnowledgeOptions): ProjectKnowledgeBaselineCapture { return new ProjectKnowledge(projectRoot, options).captureBaseline(selected); }
export function compareProjectKnowledgeBaseline(projectRoot: string, baseline: ProjectKnowledgeBaseline, options?: ProjectKnowledgeOptions): ProjectKnowledgeBaselineComparison { return new ProjectKnowledge(projectRoot, options).compareBaseline(baseline); }
