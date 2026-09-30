import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { disposableFlutterPath } from './file-policy.js';

export interface WorkspaceRecord {
  id: string;
  directory: string;
  baseSnapshotId: string;
  state: 'preparing' | 'ready' | 'captured' | 'integrating' | 'integrated' | 'cleaned';
  mode: 'worktree' | 'snapshot';
  artifactPath?: string;
  archivePath?: string;
}

export interface ChangeArtifact {
  id: string;
  baseSnapshotId: string;
  changedFiles: string[];
  artifactPath: string;
}
export interface WorkspaceInventory {
  storage: { path: string; classification: 'runtime-external' | 'project-local' };
  records: { total: number; byState: Record<string, number> };
  artifacts: { workspaceArtifacts: number; snapshots: number; journals: number };
}

type Entry = { kind: 'file' | 'symlink'; data: string; mode: number };
type Snapshot = Record<string, Entry>;
type StoredRecord = WorkspaceRecord & {
  protectedPaths?: string[];
  generatedOutputs?: string[];
  scopes?: string[];
  integratedSnapshotId?: string;
  integratedArtifactPath?: string;
};
type QuarantinedLink = { path: string; target: string; reason: 'unsafe-symlink' };
type StoredArtifact = ChangeArtifact & { snapshotId: string; preservationOnly?: true; quarantinedLinks?: QuarantinedLink[] };
type Journal = {
  id: string;
  before: Snapshot;
  after: Snapshot;
  changedFiles: string[];
  artifactSnapshotId: string;
  integratedSnapshotId?: string;
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const exists = (file: string) => {
  try { fs.lstatSync(file); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};
const within = (root: string, file: string) => file === root || file.startsWith(root + path.sep);
const equal = (a: Entry | undefined, b: Entry | undefined) =>
  a?.kind === b?.kind && a?.data === b?.data && a?.mode === b?.mode;
const blocked = (file: string) => file.split('/').some(part =>
  /^(?:\.git|\.sol|node_modules|\.cache|\.npm|\.yarn|\.pnpm-store|\.next|\.nuxt|\.turbo|\.dart_tool|coverage|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.venv|venv|\.aws|\.ssh|\.gnupg)$/i.test(part)
  || (/^\.env(?:\..*)?$/i.test(part) && !/^\.env\.(?:example|sample)$/i.test(part))
  || /^(?:credentials(?:\..*)?|secrets?(?:\..*)?|id_rsa(?:\..*)?|id_ed25519(?:\..*)?|\.netrc|\.npmrc|\.pypirc)$/i.test(part)
  || /\.(?:pem|key|p12|pfx)$/i.test(part));
const generated = (file: string) => file.split('/').some(part => /^(?:target|dist|build)$/.test(part));

// Runtime-owned snapshot policy; never derived from a worker's mutable git index.
const protections = new Map<string, ReadonlySet<string>>();
export const workspaceProtection = (directory: string): ReadonlySet<string> | undefined => protections.get(fs.realpathSync(directory));
export function disposableOutput(file: string, outputs: string[], protectedPaths: ReadonlySet<string>): boolean {
  return !protectedPaths.has(file) && outputs.some(scope => !blocked(scope) && scopeMatcher(scope).test(file));
}

function safeRelative(file: string): void {
  if (!file || file.includes('\\') || file.includes('\0') || path.posix.isAbsolute(file)
    || file.split('/').some(part => !part || part === '.' || part === '..') || blocked(file)) {
    throw new Error(`Unsafe workspace path: ${file}`);
  }
}

// Deliberately small, portable glob grammar: *, **, ?, and literal paths.
function scopeMatcher(scope: string): RegExp {
  safeRelative(scope);
  let result = '^';
  for (let i = 0; i < scope.length; i++) {
    const char = scope[i]!;
    if (char === '*' && scope[i + 1] === '*') {
      i++;
      if (scope[i + 1] === '/') { i++; result += '(?:.*/)?'; }
      else result += '.*';
    } else if (char === '*') result += '[^/]*';
    else if (char === '?') result += '[^/]';
    else result += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(result + '$');
}

/** Filesystem isolation for cooperative agents, not an OS sandbox. No method commits. */
export class WorkspaceManager {
  private readonly projectRoot: string;
  private readonly storageRoot: string;
  private readonly managedRoot: string;
  private readonly lockPath: string;

  constructor(projectRoot: string, storageRoot: string) {
    this.projectRoot = fs.realpathSync(projectRoot);
    this.storageRoot = path.resolve(storageRoot);
    this.assertNoSymlinkParents(this.storageRoot);
    if (within(this.storageRoot, this.projectRoot)) throw new Error('Storage must not contain the project root');
    fs.mkdirSync(this.storageRoot, { recursive: true, mode: 0o700 });
    // Even project-local metadata storage must not put a worktree inside the project.
    const externalRoot = path.join(fs.realpathSync(tmpdir()), 'sol-v2-workspaces');
    this.managedRoot = within(this.projectRoot, this.storageRoot)
      ? path.join(externalRoot, hash(this.projectRoot + '\0' + this.storageRoot))
      : path.join(this.storageRoot, 'workspaces');
    this.assertNoSymlinkParents(this.managedRoot);
    fs.mkdirSync(this.managedRoot, { recursive: true, mode: 0o700 });
    for (const dir of ['records', 'snapshots', 'artifacts', 'journals']) {
      const target = path.join(this.storageRoot, dir);
      this.assertNoSymlinkParents(target);
      fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    }
    const ownerPath = path.join(this.storageRoot, 'owner.json');
    this.assertNoSymlinkParents(ownerPath);
    try {
      fs.writeFileSync(ownerPath, JSON.stringify({ projectRoot: this.projectRoot }), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (JSON.parse(fs.readFileSync(ownerPath, 'utf8')).projectRoot !== this.projectRoot) {
        throw new Error('Workspace storage belongs to another project');
      }
    }
    // Shared by managers using different metadata roots for the same project.
    this.assertNoSymlinkParents(externalRoot);
    fs.mkdirSync(externalRoot, { recursive: true, mode: 0o700 });
    this.lockPath = path.join(externalRoot, hash(this.projectRoot) + '.lock');
    this.list(); // Restore immutable baseline policies before any recovered worker check.
  }

  prepare(attemptId: string): WorkspaceRecord {
    this.validateId(attemptId);
    return this.locked(() => {
      if (exists(this.recordPath(attemptId))) throw new Error(`Workspace already registered: ${attemptId}`);
      const directory = path.join(this.managedRoot, attemptId);
      if (exists(directory)) throw new Error(`Workspace directory already exists: ${directory}`);
      const baseline = this.scanProject();
      const baseSnapshotId = this.saveSnapshot(baseline);
      const mode = this.hasHead() ? 'worktree' : 'snapshot';
      const record: StoredRecord = { id: attemptId, directory, baseSnapshotId, state: 'preparing', mode };
      let tracked: string[] = [];
      try { tracked = this.git(['ls-files', '-z', '--cached']).split('\0').filter(file => file && !blocked(file)); } catch { /* Snapshot-only project. */ }
      record.protectedPaths = [...new Set([...Object.keys(baseline), ...tracked])];
      this.saveRecord(record);
      try {
        if (mode === 'worktree') {
          this.git(['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', '--no-checkout', directory, 'HEAD']);
          this.git(['read-tree', 'HEAD'], directory);
        } else fs.mkdirSync(directory, { mode: 0o700 });
        for (const file of Object.keys(baseline).sort()) this.put(directory, file, baseline[file]);
        protections.set(fs.realpathSync(directory), new Set(record.protectedPaths));
        record.state = 'ready';
        this.saveRecord(record);
        return this.publicRecord(record);
      } catch (error) {
        // The persisted preparing record makes interrupted creation recoverable.
        throw new Error(`Workspace preparation failed (${attemptId}): ${String(error)}`);
      }
    });
  }

  capture(id: string, writeScopes: string[], generatedOutputs: string[] = []): ChangeArtifact {
    return this.locked(() => this.captureInternal(this.loadRecord(id), writeScopes, generatedOutputs));
  }

  /** Preserve all snapshot-eligible paths, without granting any integration scopes. */
  archive(id: string): ChangeArtifact {
    return this.locked(() => this.archiveInternal(this.loadRecord(id)));
  }

  /** Historical durable receipt, including after cleanup. Does not assert current tree contents. */
  integrated(id: string): { snapshotId: string; changedFiles: string[] } | undefined {
    return this.locked(() => exists(this.recordPath(id)) ? this.integratedInternal(this.loadRecord(id)) : undefined);
  }

  /** Check only this integration's changed paths; independent changes remain valid. */
  integrationMatches(id: string): boolean {
    return this.locked(() => {
      if (!exists(this.recordPath(id))) return false;
      const record = this.loadRecord(id);
      return Boolean(this.integratedInternal(record)) && this.integrationConflicts(record).length === 0;
    });
  }

  integrate(id: string): { snapshotId: string; changedFiles: string[] } {
    return this.locked(() => {
      const record = this.loadRecord(id);
      const durable = this.integratedInternal(record);
      if (durable) return durable;
      if (record.state !== 'captured' || !record.artifactPath) throw new Error('Capture the workspace before integration');
      if (fs.readdirSync(path.join(this.storageRoot, 'journals')).some(name => name.endsWith('.json'))) {
        throw new Error('Pending integration journal; call recover() first');
      }
      const artifact = this.loadArtifact(record);
      if (artifact.preservationOnly) throw new Error('Preservation-only archives cannot be integrated');
      const before = this.loadSnapshot(record.baseSnapshotId);
      const after = this.loadSnapshot(artifact.snapshotId);
      const changedFiles = this.diff(before, after);
      if (JSON.stringify(changedFiles) !== JSON.stringify(artifact.changedFiles)) throw new Error('Invalid artifact change list');
      this.checkScopes(changedFiles, record.scopes ?? []);
      // Preflight every path before the first write; index and unrelated paths are untouched.
      for (const file of changedFiles) {
        this.assertDestination(file);
        if (!equal(this.readEntry(this.projectRoot, file), before[file])) throw new Error(`Integration conflict: ${file}`);
        const entry = after[file];
        if (entry?.kind === 'symlink') {
          this.assertNoSymlinkParents(path.resolve(path.dirname(path.join(this.projectRoot, file)), entry.data));
        }
      }
      const journal: Journal = { id, before, after, changedFiles, artifactSnapshotId: artifact.snapshotId };
      this.writeJson(this.journalPath(id), journal);
      record.state = 'integrating';
      this.saveRecord(record);
      try {
        for (const file of changedFiles) {
          // Also detect ordinary non-cooperative edits arriving after preflight.
          if (!equal(this.readEntry(this.projectRoot, file), before[file])) throw new Error(`Integration conflict: ${file}`);
          this.put(this.projectRoot, file, after[file]);
        }
        // Snapshot the resulting main tree, including independently integrated tasks
        // and explicitly changed paths even if a project ignore rule hides them.
        const previouslyIntegrated = this.list().flatMap(item => {
          const prior = this.loadRecord(item.id);
          return prior.integratedSnapshotId
            ? this.loadArtifact(prior, prior.integratedArtifactPath ?? prior.artifactPath).changedFiles : [];
        });
        const effective = this.scanProject([...previouslyIntegrated, ...changedFiles]);
        for (const file of changedFiles) {
          const current = this.readEntry(this.projectRoot, file);
          if (!equal(current, after[file])) throw new Error(`Integration conflict: ${file}`);
          if (current) effective[file] = current;
          else delete effective[file];
        }
        journal.integratedSnapshotId = this.saveSnapshot(effective);
        this.writeJson(this.journalPath(id), journal);
        record.state = 'integrated';
        record.integratedSnapshotId = journal.integratedSnapshotId;
        record.integratedArtifactPath = artifact.artifactPath;
        this.saveRecord(record);
      } catch (error) {
        delete record.integratedSnapshotId;
        delete record.integratedArtifactPath;
        // Roll back only values still equal to our output. Preserve intervening user edits.
        const conflicts = this.rollback(journal);
        record.state = conflicts.length ? 'integrating' : 'captured';
        this.saveRecord(record);
        if (!conflicts.length) {
          fs.unlinkSync(this.journalPath(id));
        }
        throw new Error(`${String(error)}${conflicts.length ? `; recovery required: ${conflicts.join(', ')}` : ''}`);
      }
      // Once the integrated record is durable, journal removal is housekeeping.
      // A removal failure must not roll back an already committed journal state.
      fs.unlinkSync(this.journalPath(id));
      return { snapshotId: record.integratedSnapshotId!, changedFiles };
    });
  }

  cleanup(id: string, generatedOutputs?: string[]): void {
    this.locked(() => {
      const record = this.loadRecord(id);
      if (record.state === 'cleaned') return;
      if (generatedOutputs) record.generatedOutputs = [...generatedOutputs];
      if (exists(this.journalPath(id))) throw new Error('Pending integration journal; call recover() before cleanup');
      this.assertOwnedDirectory(record);
      if (exists(record.directory)) {
        // Persist even uncaptured dirty work before removing a registered directory.
        this.archiveInternal(record);
        this.removeDirectory(record);
      }
      record.state = 'cleaned';
      this.saveRecord(record);
    });
  }

  list(): WorkspaceRecord[] {
    return fs.readdirSync(path.join(this.storageRoot, 'records')).filter(name => name.endsWith('.json'))
      .sort().map(name => this.publicRecord(this.loadRecord(name.slice(0, -5))));
  }

  inventory(): WorkspaceInventory {
    const records = this.list(), byState: Record<string, number> = {};
    for (const record of records) byState[record.state] = (byState[record.state] ?? 0) + 1;
    const count = (directory: string) => fs.readdirSync(path.join(this.storageRoot, directory), { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json')).length;
    return { storage: { path: this.storageRoot, classification: within(this.projectRoot, this.storageRoot) ? 'project-local' : 'runtime-external' }, records: { total: records.length, byState },
      artifacts: { workspaceArtifacts: count('artifacts'), snapshots: count('snapshots'), journals: count('journals') } };
  }

  recover(): { recovered: string[]; conflicts: string[]; interrupted: string[] } {
    return this.locked(() => {
      const recovered: string[] = [];
      const conflicts: string[] = [];
      const interrupted: string[] = [];
      for (const name of fs.readdirSync(path.join(this.storageRoot, 'journals')).filter(name => name.endsWith('.json')).sort()) {
        const id = name.slice(0, -5);
        const record = this.loadRecord(id);
        const journal = this.readJson(this.journalPath(id)) as Journal;
        // Read journals written by the initial v2 implementation as well.
        journal.artifactSnapshotId ??= (journal as Journal & { snapshotId: string }).snapshotId;
        this.validateJournal(journal, record);
        journal.before = this.loadSnapshot(record.baseSnapshotId);
        journal.after = this.loadSnapshot(journal.artifactSnapshotId);
        const durable = this.integratedInternal(record);
        if (durable) {
          if (journal.integratedSnapshotId && durable.snapshotId !== journal.integratedSnapshotId) {
            throw new Error('Integration receipt does not match journal');
          }
          const unresolved = this.integrationConflicts(record);
          if (unresolved.length) { conflicts.push(...unresolved.map(file => `${id}:${file}`)); continue; }
          fs.unlinkSync(this.journalPath(id));
          recovered.push(id);
          continue;
        }
        const unresolved = this.rollback(journal);
        if (unresolved.length) { conflicts.push(...unresolved.map(file => `${id}:${file}`)); continue; }
        record.state = 'captured';
        this.saveRecord(record);
        fs.unlinkSync(this.journalPath(id));
        recovered.push(id);
      }
      for (const record of this.list()) if (record.state === 'preparing') interrupted.push(record.id);
      return { recovered, conflicts, interrupted };
    });
  }

  private captureInternal(record: StoredRecord, scopes: string[], outputs: string[]): ChangeArtifact {
    if (record.integratedSnapshotId) throw new Error('Cannot recapture an integrated attempt; prepare a new workspace');
    if (record.state === 'cleaned' || record.state === 'preparing' || record.state === 'integrating') {
      throw new Error(`Cannot capture workspace in state ${record.state}`);
    }
    this.assertOwnedDirectory(record);
    const baseline = this.loadSnapshot(record.baseSnapshotId);
    const protectedPaths = new Set(record.protectedPaths ?? Object.keys(baseline));
    const current = this.scanDirectory(record.directory, protectedPaths, false);
    if (outputs.length && Object.values(current).some(entry => entry.kind === 'symlink')) throw new Error('Symlink source or generated output is not allowed');
    for (const file of Object.keys(current)) if (disposableOutput(file, outputs, protectedPaths)) {
      if (current[file]!.kind === 'symlink') throw new Error(`Symlink generated output: ${file}`);
      delete current[file];
    }
    const changedFiles = this.diff(baseline, current);
    this.checkScopes(changedFiles, scopes);
    const artifact = this.saveArtifact(record, current, changedFiles, false);
    record.artifactPath = artifact.artifactPath;
    record.scopes = [...scopes];
    record.generatedOutputs = [...outputs];
    record.state = 'captured';
    this.saveRecord(record);
    return this.publicArtifact(artifact);
  }

  private archiveInternal(record: StoredRecord): ChangeArtifact {
    if (exists(this.journalPath(record.id)) || record.state === 'integrating') {
      throw new Error('Pending integration journal; call recover() before archiving');
    }
    if (record.state === 'cleaned') {
      if (!record.archivePath) throw new Error('Cleaned workspace has no archive');
      return this.publicArtifact(this.loadArtifact(record, record.archivePath));
    }
    this.assertOwnedDirectory(record);
    const baseline = this.loadSnapshot(record.baseSnapshotId);
    const protectedPaths = new Set(record.protectedPaths ?? Object.keys(baseline));
    const quarantinedLinks: QuarantinedLink[] = [];
    const current = this.scanDirectory(record.directory, protectedPaths, false, quarantinedLinks);
    for (const file of Object.keys(current)) if (current[file]!.kind !== 'symlink' && disposableOutput(file, record.generatedOutputs ?? [], protectedPaths)) delete current[file];
    const changedFiles = this.diff(baseline, current);
    const artifact = this.saveArtifact(record, current, changedFiles, true, quarantinedLinks);
    // Retain the exact accepted artifact independently of the latest archive.
    if (record.integratedSnapshotId && !record.integratedArtifactPath && record.artifactPath) {
      record.integratedArtifactPath = record.artifactPath;
    }
    record.archivePath = artifact.artifactPath;
    record.artifactPath ??= artifact.artifactPath;
    if (record.state === 'captured') record.state = 'ready';
    // Scopes are deliberately left unchanged. Archiving never authorizes changes.
    this.saveRecord(record);
    return this.publicArtifact(artifact);
  }

  private saveArtifact(record: StoredRecord, current: Snapshot, changedFiles: string[], archive: boolean, quarantinedLinks: QuarantinedLink[] = []): StoredArtifact {
    const snapshotId = this.saveSnapshot(current);
    const quarantine = quarantinedLinks.length ? { quarantinedLinks } : {};
    const id = hash(JSON.stringify({ workspace: record.id, base: record.baseSnapshotId, snapshotId, ...(archive ? { archive: true } : {}), ...quarantine }));
    const artifactPath = path.join(this.storageRoot, 'artifacts', id + '.json');
    const artifact: StoredArtifact = {
      id, baseSnapshotId: record.baseSnapshotId, changedFiles, artifactPath, snapshotId,
      ...(archive ? { preservationOnly: true as const } : {}),
      ...quarantine,
    };
    this.writeJson(artifactPath, artifact);
    return artifact;
  }

  private publicArtifact(artifact: StoredArtifact): ChangeArtifact {
    const { id, baseSnapshotId, changedFiles, artifactPath } = artifact;
    return { id, baseSnapshotId, changedFiles: [...changedFiles], artifactPath };
  }

  private integratedInternal(record: StoredRecord): { snapshotId: string; changedFiles: string[] } | undefined {
    if (!record.integratedSnapshotId || (record.state !== 'integrated' && record.state !== 'cleaned')) return undefined;
    const artifact = this.loadArtifact(record, record.integratedArtifactPath ?? record.artifactPath);
    if (artifact.preservationOnly) throw new Error('An archive is not an integration receipt');
    this.loadSnapshot(record.integratedSnapshotId);
    return { snapshotId: record.integratedSnapshotId, changedFiles: [...artifact.changedFiles] };
  }

  private integrationConflicts(record: StoredRecord): string[] {
    const artifact = this.loadArtifact(record, record.integratedArtifactPath ?? record.artifactPath);
    const after = this.loadSnapshot(artifact.snapshotId);
    return artifact.changedFiles.filter(file => {
      try {
        this.assertDestination(file);
        return !equal(this.readEntry(this.projectRoot, file), after[file]);
      } catch { return true; }
    });
  }

  private checkScopes(files: string[], scopes: string[]): void {
    const matchers = scopes.map(scopeMatcher);
    const outside = files.filter(file => !matchers.some(matcher => matcher.test(file)));
    if (outside.length) throw new Error(`Changes outside write scopes: ${outside.join(', ')}`);
  }

  private scanProject(includeFiles: string[] = []): Snapshot {
    let paths: string[];
    let tracked: Set<string>;
    try {
      if (fs.realpathSync(this.git(['rev-parse', '--show-toplevel']).trim()) !== this.projectRoot) {
        return this.scanDirectory(this.projectRoot, new Set(includeFiles));
      }
      tracked = new Set(this.git(['ls-files', '-z', '--cached']).split('\0').filter(Boolean));
      paths = [...tracked, ...this.git(['ls-files', '-z', '--others', '--exclude-standard']).split('\0').filter(Boolean), ...includeFiles];
    } catch { return this.scanDirectory(this.projectRoot, new Set(includeFiles)); }
    const included = new Set([...tracked, ...includeFiles]);
    const result: Snapshot = Object.create(null) as Snapshot;
    for (const file of [...new Set(paths)].sort()) {
      if (blocked(file) || within(this.storageRoot, path.join(this.projectRoot, file))) continue;
      if ((generated(file) && !included.has(file)) || disposableFlutterPath(file, included)) continue;
      safeRelative(file);
      const entry = this.readEntry(this.projectRoot, file);
      if (entry) result[file] = entry;
    }
    return result;
  }

  private scanDirectory(root: string, included = new Set<string>(), omitGenerated = true, quarantine?: QuarantinedLink[]): Snapshot {
    this.assertNoSymlinkParents(root);
    if (!fs.statSync(root).isDirectory()) throw new Error('Workspace is not a directory');
    const result: Snapshot = Object.create(null) as Snapshot;
    const includedDirectories = new Set<string>();
    for (const file of included) {
      let parent = path.posix.dirname(file);
      while (parent !== '.') { includedDirectories.add(parent); parent = path.posix.dirname(parent); }
    }
    const walk = (relative: string) => {
      for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
        const file = relative ? `${relative}/${name}` : name;
        if (blocked(file) || (root === this.projectRoot && within(this.storageRoot, path.join(root, file)))) continue;
        if (omitGenerated && generated(file) && !included.has(file) && !includedDirectories.has(file)) continue;
        const flutterOutput = disposableFlutterPath(file, included);
        if (flutterOutput && !quarantine) continue;
        safeRelative(file);
        const stat = fs.lstatSync(path.join(root, file));
        if (stat.isDirectory()) walk(file);
        else {
          // Archive pointers as metadata only. Never read through or materialize them.
          if (quarantine && stat.isSymbolicLink()) {
            try { this.readEntry(root, file); }
            catch {
              quarantine.push({ path: file, target: fs.readlinkSync(path.join(root, file)), reason: 'unsafe-symlink' });
              continue;
            }
          }
          if (!flutterOutput) {
            const entry = this.readEntry(root, file);
            if (entry) result[file] = entry;
          }
        }
      }
    };
    walk('');
    return result;
  }

  private readEntry(root: string, file: string): Entry | undefined {
    safeRelative(file);
    const full = path.join(root, file);
    this.assertNoSymlinkParents(path.dirname(full));
    let stat: fs.Stats;
    try { stat = fs.lstatSync(full); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(full);
      this.validateLink(file, target);
      this.assertNoSymlinkParents(path.resolve(path.dirname(full), target));
      return { kind: 'symlink', data: target, mode: 0o777 };
    }
    if (!stat.isFile()) throw new Error(`Unsupported workspace entry (directory transition or special file): ${file}`);
    return { kind: 'file', data: fs.readFileSync(full).toString('base64'), mode: stat.mode & 0o777 };
  }

  private validateLink(file: string, target: string): void {
    if (path.isAbsolute(target) || target.includes('\\') || target.includes('\0')) throw new Error(`Unsafe symlink: ${file}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
    try { safeRelative(resolved); } catch { throw new Error(`Unsafe symlink: ${file}`); }
    // Link chains are conservatively rejected by readEntry, including ignored targets.
  }

  private put(root: string, file: string, entry: Entry | undefined): void {
    safeRelative(file);
    const full = path.join(root, file);
    this.assertNoSymlinkParents(path.dirname(full));
    if (!entry) { if (exists(full)) fs.unlinkSync(full); return; }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const temporary = path.join(path.dirname(full), `.sol-write-${randomUUID()}`);
    try {
      if (entry.kind === 'symlink') {
        this.validateLink(file, entry.data);
        this.assertNoSymlinkParents(path.resolve(path.dirname(full), entry.data));
        fs.symlinkSync(entry.data, temporary);
      } else {
        const fd = fs.openSync(temporary, 'wx', entry.mode);
        try {
          fs.writeFileSync(fd, Buffer.from(entry.data, 'base64'));
          fs.fchmodSync(fd, entry.mode);
          fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
      }
      fs.renameSync(temporary, full);
    } finally { if (exists(temporary)) fs.unlinkSync(temporary); }
  }

  private assertDestination(file: string): void {
    safeRelative(file);
    if (within(this.storageRoot, path.join(this.projectRoot, file))) throw new Error(`Cannot integrate workspace metadata: ${file}`);
    this.assertNoSymlinkParents(path.dirname(path.join(this.projectRoot, file)));
    // Existing non-directory ancestors must fail before applying any file.
    let parent = path.dirname(path.join(this.projectRoot, file));
    while (within(this.projectRoot, parent) && parent !== this.projectRoot) {
      if (exists(parent) && !fs.lstatSync(parent).isDirectory()) throw new Error(`Integration conflict: ${file}`);
      parent = path.dirname(parent);
    }
  }

  private rollback(journal: Journal): string[] {
    const conflicts: string[] = [];
    for (const file of [...journal.changedFiles].reverse()) {
      try {
        this.assertDestination(file);
        const current = this.readEntry(this.projectRoot, file);
        if (equal(current, journal.before[file])) continue;
        if (!equal(current, journal.after[file])) { conflicts.push(file); continue; }
        this.put(this.projectRoot, file, journal.before[file]);
      } catch { conflicts.push(file); }
    }
    return conflicts;
  }

  private validateJournal(journal: Journal, record: StoredRecord): void {
    if (journal.id !== record.id || journal.artifactSnapshotId !== this.loadArtifact(record, record.integratedArtifactPath ?? record.artifactPath).snapshotId
      || JSON.stringify(journal.before) !== JSON.stringify(this.loadSnapshot(record.baseSnapshotId))
      || JSON.stringify(journal.after) !== JSON.stringify(this.loadSnapshot(journal.artifactSnapshotId))
      || JSON.stringify(journal.changedFiles) !== JSON.stringify(this.diff(journal.before, journal.after))) {
      throw new Error('Invalid integration journal');
    }
  }

  private diff(before: Snapshot, after: Snapshot): string[] {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter(file => !equal(before[file], after[file]));
  }

  private saveSnapshot(snapshot: Snapshot): string {
    const ordered = Object.fromEntries(Object.keys(snapshot).sort().map(file => [file, snapshot[file]]));
    const text = JSON.stringify(ordered);
    const id = hash(text);
    this.writeJson(path.join(this.storageRoot, 'snapshots', id + '.json'), ordered);
    return id;
  }

  private loadSnapshot(id: string): Snapshot {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid snapshot ID');
    const file = path.join(this.storageRoot, 'snapshots', id + '.json');
    this.assertNoSymlinkParents(file);
    const text = fs.readFileSync(file, 'utf8');
    if (hash(text) !== id) throw new Error('Corrupt workspace snapshot');
    const snapshot = JSON.parse(text) as Snapshot;
    for (const [name, entry] of Object.entries(snapshot)) {
      safeRelative(name);
      if (!entry || !['file', 'symlink'].includes(entry.kind) || typeof entry.data !== 'string'
        || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) throw new Error('Invalid snapshot entry');
      if (entry.kind === 'symlink') this.validateLink(name, entry.data);
      else if (Buffer.from(entry.data, 'base64').toString('base64') !== entry.data) throw new Error('Invalid snapshot content');
    }
    return Object.assign(Object.create(null), snapshot) as Snapshot;
  }

  private loadArtifact(record: StoredRecord, artifactPath = record.artifactPath): StoredArtifact {
    if (!artifactPath || !/^[a-f0-9]{64}\.json$/.test(path.basename(artifactPath))
      || path.dirname(artifactPath) !== path.join(this.storageRoot, 'artifacts')) throw new Error('Invalid artifact path');
    const artifact = this.readJson(artifactPath) as StoredArtifact;
    if (artifact.artifactPath !== artifactPath || artifact.baseSnapshotId !== record.baseSnapshotId
      || artifact.id !== path.basename(artifactPath, '.json')
      || artifact.id !== hash(JSON.stringify({ workspace: record.id, base: record.baseSnapshotId, snapshotId: artifact.snapshotId,
        ...(artifact.preservationOnly ? { archive: true } : {}),
        ...(artifact.quarantinedLinks?.length ? { quarantinedLinks: artifact.quarantinedLinks } : {}) }))) {
      throw new Error('Invalid workspace artifact');
    }
    if (artifact.quarantinedLinks && (!artifact.preservationOnly || !Array.isArray(artifact.quarantinedLinks)
      || artifact.quarantinedLinks.some(link => typeof link.path !== 'string' || typeof link.target !== 'string' || link.reason !== 'unsafe-symlink'))) {
      throw new Error('Invalid archive quarantine');
    }
    const changedFiles = this.diff(this.loadSnapshot(record.baseSnapshotId), this.loadSnapshot(artifact.snapshotId));
    if (JSON.stringify(changedFiles) !== JSON.stringify(artifact.changedFiles)) throw new Error('Invalid artifact change list');
    return artifact;
  }

  private validateId(id: string): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) throw new Error('Invalid workspace ID');
  }
  private recordPath(id: string): string { this.validateId(id); return path.join(this.storageRoot, 'records', id + '.json'); }
  private journalPath(id: string): string { this.validateId(id); return path.join(this.storageRoot, 'journals', id + '.json'); }
  private loadRecord(id: string): StoredRecord {
    const record = this.readJson(this.recordPath(id)) as StoredRecord;
    if (record.id !== id || !['worktree', 'snapshot'].includes(record.mode)
      || !['preparing', 'ready', 'captured', 'integrating', 'integrated', 'cleaned'].includes(record.state)) throw new Error('Invalid workspace record');
    this.assertOwnedDirectory(record);
    if (exists(record.directory)) protections.set(fs.realpathSync(record.directory), new Set(record.protectedPaths ?? Object.keys(this.loadSnapshot(record.baseSnapshotId))));
    return record;
  }
  private saveRecord(record: StoredRecord): void { this.writeJson(this.recordPath(record.id), record); }
  private publicRecord(record: StoredRecord): WorkspaceRecord {
    const { generatedOutputs: _outputs, protectedPaths: _protected, scopes: _scopes, integratedSnapshotId: _snapshot, integratedArtifactPath: _artifact, ...result } = record;
    return result;
  }
  private assertOwnedDirectory(record: WorkspaceRecord): void {
    this.validateId(record.id);
    if (record.directory !== path.join(this.managedRoot, record.id)) throw new Error('Unowned workspace directory');
    this.assertNoSymlinkParents(record.directory);
  }
  private removeDirectory(record: WorkspaceRecord): void {
    this.assertOwnedDirectory(record);
    if (record.mode === 'worktree') this.git(['worktree', 'remove', '--force', record.directory]);
    else fs.rmSync(record.directory, { recursive: true });
  }
  private assertNoSymlinkParents(file: string): void {
    let current = path.resolve(file);
    while (true) {
      if (exists(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink path is not allowed: ${current}`);
      const parent = path.dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }
  private readJson(file: string): unknown {
    this.assertNoSymlinkParents(file);
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  }
  private writeJson(file: string, value: unknown): void {
    this.assertNoSymlinkParents(file);
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(value));
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, file);
      const directory = fs.openSync(path.dirname(file), 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } finally { if (exists(temporary)) fs.unlinkSync(temporary); }
  }
  private git(args: string[], cwd = this.projectRoot): string {
    // Do not inherit repository/index routing from the caller's shell.
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024,
      env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
  }
  private hasHead(): boolean {
    try {
      return fs.realpathSync(this.git(['rev-parse', '--show-toplevel']).trim()) === this.projectRoot
        && Boolean(this.git(['rev-parse', '--verify', 'HEAD']).trim());
    } catch { return false; }
  }
  private locked<T>(operation: () => T): T {
    this.assertNoSymlinkParents(this.lockPath);
    const token = randomUUID();
    try {
      const fd = fs.openSync(this.lockPath, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Never break a lock based on age: only a definitely dead local owner.
      let owner: { pid: number; token: string };
      try { owner = this.readJson(this.lockPath) as typeof owner; }
      catch { throw new Error('Workspace lock is unreadable; manual recovery required'); }
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid workspace lock');
      try { process.kill(owner.pid, 0); }
      catch (failure) {
        if ((failure as NodeJS.ErrnoException).code === 'ESRCH') {
          // Serialize stale-lock reclamation, so two reclaimers cannot unlink a
          // newly acquired lock between identity checking and unlinking.
          const reclaim = this.lockPath + '.reclaim';
          try { fs.mkdirSync(reclaim, { mode: 0o700 }); }
          catch { throw new Error('Workspace lock recovery is busy; retry or inspect stale reclaim directory'); }
          try {
            if (exists(this.lockPath)) {
              const latest = this.readJson(this.lockPath) as typeof owner;
              if (latest.token === owner.token) fs.unlinkSync(this.lockPath);
            }
          } finally { fs.rmdirSync(reclaim); }
          return this.locked(operation);
        }
      }
      throw new Error('Workspace manager is busy (cooperative project lock)');
    }
    try { return operation(); }
    finally {
      const owner = this.readJson(this.lockPath) as { token: string };
      if (owner.token === token) fs.unlinkSync(this.lockPath);
    }
  }
}
