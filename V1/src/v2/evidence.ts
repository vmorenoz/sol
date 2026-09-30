import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, realpathSync, writeFileSync, writeSync } from "node:fs";
import { isAbsolute, join, matchesGlob, parse, relative, resolve } from "node:path";
import { scopeSchema, type AssignmentPacket, type EvidenceRecord, type SolCore } from "./core.js";
import { compileAssignmentContext } from "./context.js";
import { disposableOutput, workspaceProtection } from "./workspace.js";
import { disposableFlutterPath } from "./file-policy.js";

function fingerprintProtection(directory: string): ReadonlySet<string> {
  const owned = workspaceProtection(directory);
  if (owned) return owned;
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && key !== 'GIT_OPTIONAL_LOCKS') delete env[key];
  try {
    const git = (args: string[]) => execFileSync('git', args, { cwd: directory, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (realpathSync(git(['rev-parse', '--show-toplevel']).trim()) !== realpathSync(directory)) return new Set();
    return new Set(git(['ls-files', '-z', '--cached']).split('\0').filter(Boolean));
  } catch { return new Set(); }
}

/** Same hard exclusions as WorkspaceManager; generated files are deliberately included here. */
export const excludedEvidencePath = (file: string): boolean => file.split(/[\\/]/).some(part =>
  /^(?:\.git|\.sol|node_modules|\.cache|\.npm|\.yarn|\.pnpm-store|\.next|\.nuxt|\.turbo|\.dart_tool|coverage|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.venv|venv|\.aws|\.ssh|\.gnupg)$/i.test(part)
  || (/^\.env(?:\..*)?$/i.test(part) && !/^\.env\.(?:example|sample)$/i.test(part))
  || /^(?:credentials(?:\..*)?|secrets?(?:\..*)?|id_rsa(?:\..*)?|id_ed25519(?:\..*)?|\.netrc|\.npmrc|\.pypirc)$/i.test(part)
  || /\.(?:pem|key|p12|pfx)$/i.test(part));
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\");
};
function workspace(directory: string): string {
  if (!isAbsolute(directory)) throw new Error("Workspace must be absolute");
  const root = realpathSync(directory);
  if (root === parse(root).root || !lstatSync(root).isDirectory()) throw new Error("Invalid workspace root");
  return root;
}

/** Hash contents, paths, modes and symlink targets; never follow source symlinks. Locks are source. */
export function fingerprint(directory: string, outputs: string[] = [], protectedPaths: ReadonlySet<string> = fingerprintProtection(directory), capturePaths?: Set<string>): string {
  const root = workspace(directory);
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (excludedEvidencePath(path)) continue;
      if (disposableFlutterPath(path, protectedPaths)) continue;
      capturePaths?.add(path);
      if (entry.isSymbolicLink() && (outputs.length > 0 || !inside(root, realpathSync(join(root, path)))))
        throw new Error(`Unsafe source or generated output symlink: ${path}`);
      if (!entry.isDirectory() && disposableOutput(path, outputs, protectedPaths)) continue;
      if (entry.isDirectory()) walk(path); else files.push(path);
    }
  };
  walk("");
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    const path = resolve(root, file);
    if (!inside(root, path)) throw new Error("Invalid fingerprint path");
    hash.update(JSON.stringify(file));
    try {
      // A tracked file's parent may have been replaced by a symlink.
      if (!inside(root, realpathSync(join(path, "..")))) throw new Error("Source parent escapes workspace");
      const stat = lstatSync(path);
      hash.update(`${stat.mode}:`);
      if (stat.isSymbolicLink()) hash.update(readlinkSync(path));
      else if (stat.isFile()) hash.update(createHash("sha256").update(readFileSync(path)).digest());
      else throw new Error("Unsupported fingerprint entry");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update("missing");
    }
  }
  return hash.digest("hex");
}

export interface CheckLedger {
  evidenceId: string; attemptId: string; checkId: string;
  before: string; after: string; sourcesBefore: string; sourcesAfter: string;
  actualExitCode: number | null; signal: NodeJS.Signals | null; durationMs: number;
  timedOut: boolean; aborted: boolean; valid: boolean;
}

export interface ObservationLedger {
  evidenceId: string; attemptId: string; snapshotId: string; path: string;
  sourceHash: string; workspaceFingerprint?: string; scope?: "source-only" | "workspace"; claim: string;
  meaning: "source-observed-not-claim-verified";
}
export interface ExternalReference {
  origin: "native-webfetch";
  meaning: "historical-source-observed-not-truth-verified";
  attemptId: string; snapshotId: string; observedAt: string; url: string;
  contentHash: string; contentBytes: number; excerpt: string; excerptBytes: number; truncated: boolean;
}
const referenceLimit = 1024 * 1024;
const sha256 = (content: string): string => createHash("sha256").update(content, "utf8").digest("hex");
function externalUrl(input: string): string {
  if (input.length > 8192) throw new Error("External source URL exceeds limit");
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("External sources require HTTPS without credentials");
  for (const key of url.searchParams.keys()) {
    if (/token|key|password|signature|secret|credential|authorization|^sig$|^auth$/i.test(key))
      throw new Error("External source URL contains a sensitive query parameter");
  }
  url.hash = "";
  return url.href;
}
const referenceSummary = (serialized: string): string =>
  `External source observed at fetch time; truth not verified. Reference SHA256: ${sha256(serialized)}.`;
interface Execution {
  actualExitCode: number | null; signal: NodeJS.Signals | null; durationMs: number;
  timedOut: boolean; aborted: boolean; valid: boolean; reason: string; artifactPath: string;
}
export class EnvironmentPreparationError extends Error {
  constructor(readonly preparation: Execution) {
    super(`Environment preparation ${preparation.reason}; inspect ${preparation.artifactPath}, correct task.environment.prepare or its inputs and replan.`);
    this.name = "EnvironmentPreparationError";
  }
}
export interface IntegrationReport {
  attemptId: string; planId: string; revision: number; snapshotId: string;
  baselineEvidenceIds: string[]; before: string; after: string;
  checks: (Execution & { checkId: string; command: string; before: string; after: string })[];
  passed: boolean; summary: string; artifactPath: string;
}
export interface EvidenceInventory {
  storage: { path: string; classification: "runtime-external" };
  artifactsByCategory: Record<string, number>;
}

/** Bound the read itself, including files that grow after stat. Hash the complete source, never a snippet. */
function observedSource(assignment: AssignmentPacket, path: string): string {
  scopeSchema.parse(path);
  if (excludedEvidencePath(path)) throw new Error("Excluded observation source");
  const root = workspace(assignment.workspacePath);
  const scoped = (file: string): boolean => [...assignment.task.reads, ...assignment.task.writes].some(scope =>
    file === scope || file.startsWith(`${scope}/`) || matchesGlob(file, scope)) ||
    assignment.sources.some(source => source.path === file && assignment.task.sourceIds?.includes(source.id));
  if (!scoped(path)) throw new Error("Observation source outside task scope");
  const full = realpathSync(resolve(root, path));
  if (!inside(root, full) || !scoped(relative(root, full).split("\\").join("/")) || excludedEvidencePath(relative(root, full)))
    throw new Error("Observation source escapes allowed scope");
  if (!lstatSync(full).isFile()) throw new Error("Observation requires a regular source file");
  const fd = openSync(full, "r");
  try {
    const max = 1024 * 1024;
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > max) throw new Error("Observation requires a regular source file of at most 1 MiB");
    const buffer = Buffer.alloc(max + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > max) throw new Error("Observation source exceeds 1 MiB");
    return createHash("sha256").update(buffer.subarray(0, length)).digest("hex");
  } finally { closeSync(fd); }
}

/** Trusted runtime only: sol_check must call tool context.ask BEFORE run with the named command.
 * This is process management, not an OS sandbox. Storage must be outside project/workspace.
 * Call verifyCurrent immediately before submission/acceptance; core does not enforce this sidecar.
 */
export class EvidenceRunner {
  private readonly storageRoot: string;
  private readonly baselines = new Map<string, ReadonlySet<string>>();
  private readonly prepared = new Map<string, string>();
  private readonly preparing = new Map<string, Promise<Execution | undefined>>();
  private readonly preparationFailures = new Map<string, EnvironmentPreparationError>();
  assertEnvironment(attemptId: string): void {
    const failure = this.preparationFailures.get(attemptId);
    if (failure) throw failure;
  }
  private sourceFingerprint(root: string, outputs: string[]): string {
    let policy = workspaceProtection(root) ?? this.baselines.get(root);
    if (!policy) {
      const paths = new Set(fingerprintProtection(root));
      fingerprint(root, [], paths, paths);
      policy = paths;
      this.baselines.set(root, policy);
    }
    return fingerprint(root, outputs, policy);
  }
  /** Host must authorize the declared preparation command as well as the named check. */
  async prepare(attemptId: string, directory?: string, options: { signal?: AbortSignal } = {}): Promise<Execution | undefined> {
    const assignment = this.core.assignment(attemptId);
    const root = workspace(directory ?? assignment.workspacePath);
    const environment = assignment.task.environment;
    if (!environment?.prepare) return undefined;
    const pending = this.preparing.get(root);
    if (pending) { await pending; return this.prepare(attemptId, directory, options); }
    const command = environment.prepare;
    const before = this.sourceFingerprint(root, environment.generatedOutputs);
    const key = JSON.stringify([before, command]);
    if (this.prepared.get(root) === key && !options.signal?.aborted) return undefined;
    const operation = (async () => {
      const execution = await this.execute(root, command, "preparations", options);
      try {
        if (before !== this.sourceFingerprint(root, environment.generatedOutputs)) {
          execution.valid = false; execution.reason = "changed protected sources";
        }
      } catch {
        execution.valid = false; execution.reason = "left unsafe or unreadable protected sources";
      }
      writeFileSync(join(this.storageRoot, `${execution.artifactPath}.json`), JSON.stringify({ attemptId, directory: root, before, ...execution }), { flag: "wx", mode: 0o600 });
      if (!execution.valid) {
        this.prepared.delete(root);
        const error = new EnvironmentPreparationError(execution);
        this.preparationFailures.set(attemptId, error);
        throw error;
      }
      this.preparationFailures.delete(attemptId);
      this.prepared.set(root, key);
      return execution;
    })();
    this.preparing.set(root, operation);
    try { return await operation; } finally { this.preparing.delete(root); }
  }
  constructor(private readonly core: SolCore, storageRoot: string) {
    const root = resolve(storageRoot);
    if (inside(realpathSync(core.projectRoot), root)) throw new Error("Evidence storage must be outside project");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.storageRoot = realpathSync(root);
    if (inside(realpathSync(core.projectRoot), this.storageRoot)) throw new Error("Evidence storage must be outside project");
  }
  inventory(): EvidenceInventory {
    const categories = ["checks", "preparations", "observations", "references", "integrations"];
    const artifactsByCategory: Record<string, number> = {};
    for (const category of categories) {
      const directory = join(this.storageRoot, category);
      try { artifactsByCategory[category] = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile()).length; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        artifactsByCategory[category] = 0;
      }
    }
    return { storage: { path: this.storageRoot, classification: "runtime-external" }, artifactsByCategory };
  }
  private artifacts(root: string, category = "checks"): string {
    if (inside(root, this.storageRoot)) throw new Error("Evidence storage must be outside workspace");
    const path = join(this.storageRoot, category);
    if (inside(root, path)) throw new Error("Evidence artifacts must be outside workspace");
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (realpathSync(path) !== path) throw new Error("Invalid artifact directory");
    return path;
  }
  readLedger(evidence: EvidenceRecord): CheckLedger {
    if (!/^checks\/[a-f0-9-]+\.log$/.test(evidence.artifactPath ?? "")) throw new Error("Missing runner artifact");
    return JSON.parse(readFileSync(join(this.storageRoot, `${evidence.artifactPath}.json`), "utf8")) as CheckLedger;
  }
  verifyCurrent(attemptId: string): void {
    const assignment = this.core.assignment(attemptId);
    const current = assignment.task.checks.length ? this.sourceFingerprint(assignment.workspacePath, assignment.task.environment?.generatedOutputs ?? []) : undefined;
    const sources = assignment.task.checks.length ? compileAssignmentContext(this.core, attemptId).sourceFingerprint : undefined;
    const entries = this.core.listEvidence(attemptId);
    for (const check of assignment.task.checks) {
      const entry = entries.filter((entry) => entry.checkId === check.id).at(-1);
      if (!entry || entry.exitCode !== 0) throw new Error(`Missing or failed current check: ${check.id}`);
      const ledger = this.readLedger(entry);
      if (ledger.evidenceId !== entry.id || ledger.attemptId !== attemptId || ledger.checkId !== check.id ||
          !ledger.valid || ledger.before !== current || ledger.after !== current || ledger.sourcesAfter !== sources || ledger.sourcesBefore !== sources)
        throw new Error(`Stale check: ${check.id}; retry against final sources`);
    }
    const refs = new Set(this.core.getAttempt(attemptId).result?.criteria.flatMap(criterion => criterion.evidenceRefs) ?? []);
    for (const entry of entries.filter(entry => entry.kind === "inspection" && refs.has(entry.id))) {
      if (!entry.artifactPath) throw new Error("Missing observation artifact; use runner.observe against actual source");
      if (entry.artifactPath.startsWith("references/")) {
        const reference = this.readExternalReference(entry);
        if (reference.attemptId !== attemptId || reference.snapshotId !== assignment.snapshotId) throw new Error("External reference provenance mismatch");
        continue;
      }
      const ledger = this.readObservation(entry);
      if (ledger.evidenceId !== entry.id || ledger.attemptId !== attemptId || ledger.snapshotId !== assignment.snapshotId ||
          ledger.meaning !== "source-observed-not-claim-verified" || observedSource(assignment, ledger.path) !== ledger.sourceHash)
        throw new Error("Stale observation source; observe again");
    }
  }
  observe(attemptId: string, path: string, claim: string): EvidenceRecord {
    const assignment = this.core.assignment(attemptId);
    if (this.core.getAttempt(attemptId).status !== "running") throw new Error("Observation requires running attempt");
    if (!claim.trim() || claim.length > 2000) throw new Error("Invalid observation claim");
    const sourceHash = observedSource(assignment, path);
    // A read-only inspection attests the selected file, not every unrelated cache or link
    // in the original project. Avoid walking the entire repository for a README observation.
    const scope = this.core.isInspection(assignment.planId) ? { scope: "source-only" as const } :
      { scope: "workspace" as const, workspaceFingerprint: fingerprint(assignment.workspacePath) };
    if (sourceHash !== observedSource(assignment, path)) throw new Error("Observation source changed during capture");
    const directory = this.artifacts(workspace(assignment.workspacePath), "observations");
    const name = `${randomUUID()}.json`, artifactPath = `observations/${name}`;
    const evidence = this.core.recordEvidence(attemptId, { kind: "inspection", snapshotId: assignment.snapshotId, artifactPath,
      summary: `Source observed: ${path}. Claim (not verified): ${claim}` });
    const ledger: ObservationLedger = { evidenceId: evidence.id, attemptId, snapshotId: assignment.snapshotId, path,
      sourceHash, ...scope, claim, meaning: "source-observed-not-claim-verified" };
    writeFileSync(join(directory, name), JSON.stringify(ledger), { flag: "wx", mode: 0o600 });
    return evidence;
  }
  readObservation(evidence: EvidenceRecord): ObservationLedger {
    if (!/^observations\/[a-f0-9-]+\.json$/.test(evidence.artifactPath ?? "")) throw new Error("Missing observation artifact");
    return JSON.parse(readFileSync(join(this.storageRoot, evidence.artifactPath!), "utf8")) as ObservationLedger;
  }
  /** TRUSTED HOST ONLY: call from tool.execute.after with the actual native webfetch URL/output.
   * Never expose content as a model-facing tool argument. The plugin must enforce the role,
   * session/attempt binding, native tool identity, successful fetch and permission policy.
   * This captures the host-supplied fetch result, not proof of truth or current remote content.
   */
  observeExternal(attemptId: string, url: string, content: string): EvidenceRecord {
    const assignment = this.core.assignment(attemptId);
    if (this.core.getAttempt(attemptId).status !== "running") throw new Error("External observation requires running attempt");
    const normalizedUrl = externalUrl(url);
    if (typeof content !== "string") throw new Error("External observation requires retrieved text");
    const directory = this.artifacts(workspace(assignment.workspacePath), "references");
    const name = `${randomUUID()}.json`, artifactPath = `references/${name}`;
    // Bound the serialized artifact, including JSON escaping and metadata, rather than only raw text.
    const prefix = content.slice(0, referenceLimit);
    let excerpt = new TextDecoder().decode(Buffer.from(prefix).subarray(0, referenceLimit), { stream: true });
    const reference: ExternalReference = { origin: "native-webfetch", meaning: "historical-source-observed-not-truth-verified",
      attemptId, snapshotId: assignment.snapshotId, observedAt: new Date().toISOString(), url: normalizedUrl,
      contentHash: sha256(content), contentBytes: Buffer.byteLength(content), excerpt: "", excerptBytes: 0, truncated: false };
    let serialized: string;
    for (;;) {
      reference.excerpt = excerpt; reference.excerptBytes = Buffer.byteLength(excerpt);
      reference.truncated = reference.excerptBytes < reference.contentBytes;
      serialized = JSON.stringify(reference);
      if (Buffer.byteLength(serialized) <= referenceLimit) break;
      excerpt = new TextDecoder().decode(Buffer.from(excerpt).subarray(0, Math.floor(reference.excerptBytes / 2)), { stream: true });
    }
    const evidence = this.core.recordEvidence(attemptId, { kind: "inspection", snapshotId: assignment.snapshotId, artifactPath,
      summary: referenceSummary(serialized) });
    writeFileSync(join(directory, name), serialized, { flag: "wx", mode: 0o600 });
    return evidence;
  }
  /** Read a historical reference and verify its digest against the trusted core evidence summary. */
  readExternalReference(evidence: EvidenceRecord): ExternalReference {
    if (evidence.kind !== "inspection" || !/^references\/[a-f0-9-]+\.json$/.test(evidence.artifactPath ?? "")) throw new Error("Invalid external reference artifact");
    const path = join(this.storageRoot, evidence.artifactPath!);
    if (realpathSync(path) !== path || !lstatSync(path).isFile() || lstatSync(path).size > referenceLimit) throw new Error("Invalid external reference file");
    const serialized = readFileSync(path, "utf8");
    if (Buffer.byteLength(serialized) > referenceLimit || evidence.summary !== referenceSummary(serialized)) throw new Error("External reference digest mismatch");
    const reference = JSON.parse(serialized) as ExternalReference;
    if (reference.origin !== "native-webfetch" || reference.meaning !== "historical-source-observed-not-truth-verified" ||
        reference.attemptId !== evidence.attemptId || reference.snapshotId !== evidence.snapshotId ||
        externalUrl(reference.url) !== reference.url || !Number.isFinite(Date.parse(reference.observedAt)) ||
        !/^[a-f0-9]{64}$/.test(reference.contentHash) || !Number.isSafeInteger(reference.contentBytes) || reference.contentBytes < 0 ||
        reference.excerptBytes !== Buffer.byteLength(reference.excerpt) || reference.excerptBytes > reference.contentBytes ||
        reference.truncated !== (reference.excerptBytes < reference.contentBytes) ||
        (!reference.truncated && sha256(reference.excerpt) !== reference.contentHash)) throw new Error("Invalid external reference provenance or content");
    return reference;
  }
  async run(attemptId: string, checkId: string, options: { signal?: AbortSignal } = {}): Promise<EvidenceRecord> {
    const assignment = this.core.assignment(attemptId);
    if (this.core.getAttempt(attemptId).status !== "running") throw new Error("Check requires running attempt");
    const check = assignment.task.checks.find((check) => check.id === checkId);
    if (!check) throw new Error("Unknown named check");
    const root = workspace(assignment.workspacePath);
    const outputs = assignment.task.environment?.generatedOutputs ?? [];
    await this.prepare(attemptId, undefined, options);
    const before = this.sourceFingerprint(root, outputs), sourcesBefore = compileAssignmentContext(this.core, attemptId).sourceFingerprint;
    const execution = await this.execute(root, check, "checks", options);
    const after = this.sourceFingerprint(root, outputs), sourcesAfter = compileAssignmentContext(this.core, attemptId).sourceFingerprint;
    const changed = before !== after || sourcesBefore !== sourcesAfter;
    const valid = execution.valid && !changed;
    const reason = changed ? "source changed; retry required" : execution.reason;
    const evidence = this.core.recordEvidence(attemptId, { kind: "command", checkId, command: check.command,
      exitCode: valid ? 0 : execution.actualExitCode && execution.actualExitCode > 0 ? execution.actualExitCode : -1,
      durationMs: execution.durationMs, snapshotId: assignment.snapshotId, artifactPath: execution.artifactPath,
      summary: `Check ${checkId}: ${reason} (${execution.durationMs} ms).` });
    const ledger: CheckLedger = { evidenceId: evidence.id, attemptId, checkId, before, after, sourcesBefore, sourcesAfter,
      actualExitCode: execution.actualExitCode, signal: execution.signal, durationMs: execution.durationMs,
      timedOut: execution.timedOut, aborted: execution.aborted, valid };
    writeFileSync(join(this.storageRoot, `${execution.artifactPath}.json`), JSON.stringify(ledger), { flag: "wx", mode: 0o600 });
    return evidence;
  }
  /** Trusted driver only: supply an isolated merged-tree snapshot, never the primary tree.
   * Commands are predefined and already authorized by the host; no tool permission UI here.
   * Receipts are historical. Recovery must rerun against a fresh merged-tree snapshot.
   */
  async verifyIntegration(attemptId: string, directory: string, options: { signal?: AbortSignal } = {}): Promise<{ passed: boolean; summary: string; artifactPath: string }> {
    const assignment = this.core.assignment(attemptId);
    if (this.core.getAttempt(attemptId).status !== "submitted") throw new Error("Integration checks require submitted attempt");
    const root = workspace(directory), primary = workspace(this.core.projectRoot), worker = workspace(assignment.workspacePath);
    if (inside(primary, root) || inside(root, primary) || inside(worker, root) || inside(root, worker))
      throw new Error("Integration checks require a separate isolated merged-tree snapshot");
    const artifacts = this.artifacts(root, "integrations");
    const outputs = assignment.task.environment?.generatedOutputs ?? [];
    await this.prepare(attemptId, directory, options);
    const before = this.sourceFingerprint(root, outputs);
    const checks: IntegrationReport["checks"] = [];
    for (const check of assignment.task.checks) {
      const checkBefore = this.sourceFingerprint(root, outputs);
      const execution = await this.execute(root, check, "integrations", options);
      const after = this.sourceFingerprint(root, outputs);
      checks.push({ ...execution, checkId: check.id, command: check.command, before: checkBefore, after,
        valid: execution.valid && checkBefore === after,
        reason: checkBefore !== after ? "source changed; retry required" : execution.reason });
    }
    const after = this.sourceFingerprint(root, outputs);
    const passed = !options.signal?.aborted && before === after && checks.every(check => check.valid);
    const summary = !checks.length ? (passed ? "No executable checks declared; merged-tree fingerprint captured." : "Integration verification aborted; no executable checks declared.") :
      `Merged-tree checks ${passed ? "passed" : "failed"}: ${checks.filter(check => check.valid).length}/${checks.length}; sources ${before === after ? "unchanged" : "changed"}.`;
    const name = `${randomUUID()}.json`, artifactPath = `integrations/${name}`;
    const report: IntegrationReport = { attemptId, planId: assignment.planId, revision: assignment.revision, snapshotId: assignment.snapshotId,
      baselineEvidenceIds: this.core.listEvidence(attemptId).map(entry => entry.id), before, after, checks, passed, summary, artifactPath };
    writeFileSync(join(artifacts, name), JSON.stringify(report), { flag: "wx", mode: 0o600 });
    return { passed, summary, artifactPath };
  }
  readIntegrationReport(artifactPath: string): IntegrationReport {
    if (!/^integrations\/[a-f0-9-]+\.json$/.test(artifactPath)) throw new Error("Invalid integration artifact");
    return JSON.parse(readFileSync(join(this.storageRoot, artifactPath), "utf8")) as IntegrationReport;
  }
  private async execute(root: string, check: { command: string; timeoutMs?: number | undefined }, category: "checks" | "integrations" | "preparations", options: { signal?: AbortSignal }): Promise<Execution> {
    const directory = this.artifacts(root, category);
    const name = `${randomUUID()}.log`, artifactPath = `${category}/${name}`;
    const fd = openSync(join(directory, name), "wx", 0o600);
    let logged = 0, timedOut = false, aborted = false, logFailed = false;
    const start = performance.now();
    const timeout = check.timeoutMs ?? 120_000;
    let result: { code: number | null; signal: NodeJS.Signals | null };
    try {
      result = await new Promise((done) => {
        if (options.signal?.aborted) { aborted = true; done({ code: null, signal: null }); return; }
        const unix = process.platform !== "win32";
        const child = spawn(unix ? "/bin/sh" : (process.env.ComSpec ?? "cmd.exe"), unix ? ["-lc", check.command] : ["/d", "/s", "/c", check.command],
          { cwd: root, detached: unix, stdio: ["ignore", "pipe", "pipe"] });
        const kill = (): void => {
          try { if (unix && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* Already exited. */ }
        };
        const abort = (): void => { aborted = true; kill(); };
        const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
        options.signal?.addEventListener("abort", abort, { once: true });
        const capture = (chunk: Buffer): void => {
          const size = Math.min(chunk.length, 1024 * 1024 - logged);
          if (size > 0 && !logFailed) {
            try { writeSync(fd, chunk.subarray(0, size)); logged += size; }
            catch { logFailed = true; kill(); }
          }
        };
        child.stdout.on("data", capture); child.stderr.on("data", capture);
        child.on("error", () => { /* close supplies a failed exit; never expose raw errors/logs. */ });
        child.on("close", (code, signal) => {
          clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
          kill(); done({ code, signal });
        });
      });
    } finally { closeSync(fd); }
    const durationMs = Math.ceil(performance.now() - start);
    const valid = result.code === 0 && !timedOut && !aborted && !logFailed && durationMs <= timeout;
    const reason = timedOut || durationMs > timeout ? "timed out" : aborted ? "aborted" : logFailed ? "log capture failed" : valid ? "passed" : "failed";
    return { actualExitCode: result.code, signal: result.signal, durationMs, timedOut, aborted, valid, reason, artifactPath };
  }
}
