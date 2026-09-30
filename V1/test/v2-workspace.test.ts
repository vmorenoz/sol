import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { WorkspaceManager } from '../src/v2/workspace.js';
import { fingerprint } from '../src/v2/evidence.js';

const roots: string[] = [];
function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function fixture(mode: 'head' | 'unborn' | 'plain' = 'head') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'sol-workspace-test-')));
  roots.push(root);
  const project = path.join(root, 'project');
  const storage = path.join(root, 'storage');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'a.txt'), 'original a\n');
  fs.writeFileSync(path.join(project, 'b.txt'), 'original b\n');
  if (mode !== 'plain') {
    git(project, 'init');
    git(project, 'config', 'user.email', 'fixture@example.invalid');
    git(project, 'config', 'user.name', 'Workspace Fixture');
    if (mode === 'head') {
      git(project, 'add', '.');
      git(project, 'commit', '-m', 'fixture');
    }
  }
  return { project, storage, manager: new WorkspaceManager(project, storage) };
}
const write = (root: string, file: string, value: string | Buffer) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), value);
};
const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf8');

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('WorkspaceManager', () => {
  it.each(['head', 'plain'] as const)('ignores Flutter dependency links and quarantines them on cleanup (%s)', mode => {
    const { project, storage, manager } = fixture(mode);
    const dependency = path.join(path.dirname(project), 'dependency');
    write(dependency, 'plugin.dart', 'external dependency');
    const originalLink = path.join(project, 'ios/.symlinks/plugins/original');
    fs.mkdirSync(path.dirname(originalLink), { recursive: true });
    fs.symlinkSync(dependency, originalLink);
    const w = manager.prepare('flutter');
    const before = fingerprint(w.directory);
    const links = ['ios/Flutter/ephemeral/Packages/.packages/app_links-7.2.1',
      'macos/Flutter/ephemeral/plugin', 'windows/flutter/ephemeral/plugin',
      'linux/flutter/ephemeral/plugin', 'ios/.symlinks/plugins/app_links', 'macos/.symlinks/plugins/app_links'];
    for (const file of links) {
      fs.mkdirSync(path.dirname(path.join(w.directory, file)), { recursive: true });
      fs.symlinkSync(dependency, path.join(w.directory, file));
    }
    expect(fingerprint(w.directory, ['build/**'])).toBe(before);
    expect(manager.capture(w.id, [], ['build/**']).changedFiles).toEqual([]);
    write(w.directory, 'a.txt', 'accepted');
    const accepted = manager.capture(w.id, ['a.txt']);
    const receipt = manager.integrate(w.id);
    write(w.directory, 'b.txt', 'safe archive data');
    manager.cleanup(w.id);
    expect(fs.existsSync(w.directory)).toBe(false);
    const record = manager.list()[0]!;
    expect(record.artifactPath).toBe(accepted.artifactPath);
    const archive = JSON.parse(read(storage, `artifacts/${path.basename(record.archivePath!)}`));
    expect(archive.quarantinedLinks).toEqual(links.sort().map(file => ({ path: file, target: dependency, reason: 'unsafe-symlink' })));
    const snapshot = JSON.parse(read(storage, `snapshots/${archive.snapshotId}.json`));
    expect(Buffer.from(snapshot['b.txt'].data, 'base64').toString()).toBe('safe archive data');
    for (const file of links) expect(snapshot[file]).toBeUndefined();
    const restarted = new WorkspaceManager(project, storage);
    expect(restarted.integrated(w.id)).toEqual(receipt);
    expect(restarted.integrationMatches(w.id)).toBe(true);
    expect(restarted.archive(w.id).artifactPath).toBe(record.archivePath);
    expect(read(dependency, 'plugin.dart')).toBe('external dependency');
    expect(fs.readlinkSync(originalLink)).toBe(dependency);
    expect(read(project, 'b.txt')).toBe('original b\n');
    if (mode === 'head') expect(git(project, 'worktree', 'list', '--porcelain')).not.toContain(w.directory);
  });

  it('protects tracked Flutter inputs even if the worker removes them from its index', () => {
    const { project, manager } = fixture();
    const file = 'ios/Flutter/ephemeral/input.txt';
    write(project, file, 'tracked');
    git(project, 'add', file);
    const w = manager.prepare('flutter-input');
    const before = fingerprint(w.directory);
    git(w.directory, 'rm', '--cached', '--ignore-unmatch', file);
    write(w.directory, file, 'changed');
    expect(fingerprint(w.directory)).not.toBe(before);
    expect(() => manager.capture(w.id, [], ['ios/**'])).toThrow(/outside write scopes/);
    expect(manager.capture(w.id, [file], ['ios/**']).changedFiles).toEqual([file]);
    fs.rmSync(path.join(w.directory, 'ios/Flutter/ephemeral'), { recursive: true });
    fs.symlinkSync(project, path.join(w.directory, 'ios/Flutter/ephemeral'));
    expect(() => fingerprint(w.directory)).toThrow(/symlink/);
    expect(() => manager.capture(w.id, ['**'])).toThrow(/symlink/);
    manager.cleanup(w.id);
    expect(read(project, file)).toBe('tracked');
  });

  it.each(['absolute', 'relative'] as const)('rejects ordinary %s external source links but archives pointers and removes owned data', targetKind => {
    const { project, storage, manager } = fixture();
    const w = manager.prepare('malicious');
    const outside = path.join(path.dirname(project), 'outside');
    write(outside, 'keep.txt', 'user data');
    const file = 'src/ephemeral/escape';
    fs.mkdirSync(path.dirname(path.join(w.directory, file)), { recursive: true });
    const target = targetKind === 'absolute' ? outside : path.relative(path.dirname(path.join(w.directory, file)), outside);
    fs.symlinkSync(target, path.join(w.directory, file));
    write(w.directory, 'a.txt', 'preserved');
    expect(() => fingerprint(w.directory)).toThrow(/symlink/);
    expect(() => manager.capture(w.id, ['**'])).toThrow(/Unsafe symlink/);
    expect(() => manager.integrate(w.id)).toThrow(/Capture/);
    manager.cleanup(w.id);
    expect(fs.existsSync(w.directory)).toBe(false);
    const archive = JSON.parse(fs.readFileSync(manager.list()[0]!.archivePath!, 'utf8'));
    expect(archive.quarantinedLinks).toEqual([{ path: file, target, reason: 'unsafe-symlink' }]);
    const snapshot = JSON.parse(read(storage, `snapshots/${archive.snapshotId}.json`));
    expect(snapshot[file]).toBeUndefined();
    expect(Buffer.from(snapshot['a.txt'].data, 'base64').toString()).toBe('preserved');
    expect(read(outside, 'keep.txt')).toBe('user data');
    expect(read(project, 'a.txt')).toBe('original a\n');
    // Pointer metadata participates in the artifact identity, not just the safe snapshot.
    archive.quarantinedLinks[0].target = 'forged';
    fs.writeFileSync(archive.artifactPath, JSON.stringify(archive));
    expect(() => manager.archive(w.id)).toThrow('Invalid workspace artifact');
  });

  it('discards only declared new outputs while retaining every baseline file under overlapping patterns', () => {
    const { project, manager } = fixture('unborn');
    write(project, 'src/input.js', 'input');
    write(project, 'dist/tracked.js', 'tracked');
    git(project, 'add', 'dist/tracked.js');
    const w = manager.prepare('outputs');
    write(w.directory, 'dist/output.js', 'disposable');
    write(w.directory, 'src/input.js', 'modified');
    write(w.directory, 'dist/tracked.js', 'modified');
    expect(() => manager.capture(w.id, [], ['dist/**', 'src/**'])).toThrow(/outside write scopes/);
    expect(manager.capture(w.id, ['src/**', 'dist/**'], ['dist/**', 'src/**']).changedFiles).toEqual(['dist/tracked.js', 'src/input.js']);
    manager.integrate(w.id);
    expect(fs.existsSync(path.join(project, 'dist/output.js'))).toBe(false);
    expect(read(project, 'dist/tracked.js')).toBe('modified');
  });

  it('rejects symlinked disposable directories at capture', () => {
    const { manager } = fixture('plain'), w = manager.prepare('symlink-output');
    fs.mkdirSync(path.join(w.directory, 'src'));
    write(w.directory, 'src/input.js', 'source');
    fs.symlinkSync('src', path.join(w.directory, 'dist'));
    expect(() => manager.capture(w.id, ['**'], ['dist/**'])).toThrow(/Symlink/);
  });

  it('materializes dirty tracked and nonignored untracked files without changing HEAD or index', () => {
    const { project, manager } = fixture();
    const head = git(project, 'rev-parse', 'HEAD');
    write(project, 'a.txt', 'staged\n');
    git(project, 'add', 'a.txt');
    write(project, 'a.txt', 'unstaged\n');
    fs.unlinkSync(path.join(project, 'b.txt'));
    write(project, 'new.txt', 'untracked\n');
    write(project, '.gitignore', 'ignored/\n');
    write(project, 'ignored/file', 'ignored');
    write(project, '.env', 'secret');
    write(project, 'credentials.json', 'secret');
    write(project, 'node_modules/pkg/index.js', 'cache');
    write(project, '.sol/private', 'metadata');
    const index = fs.readFileSync(path.join(project, '.git/index'));
    const status = git(project, 'status', '--porcelain');
    const workspace = manager.prepare('dirty');
    expect(workspace.mode).toBe('worktree');
    expect(workspace.directory.startsWith(project + path.sep)).toBe(false);
    expect(read(workspace.directory, 'a.txt')).toBe('unstaged\n');
    expect(read(workspace.directory, 'new.txt')).toBe('untracked\n');
    for (const file of ['b.txt', '.env', 'credentials.json', 'ignored', 'node_modules', '.sol']) {
      expect(fs.existsSync(path.join(workspace.directory, file))).toBe(false);
    }
    expect(git(workspace.directory, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('HEAD');
    expect(manager.capture('dirty', ['**']).changedFiles).toEqual([]);
    expect(git(project, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(project, 'status', '--porcelain')).toBe(status);
    expect(fs.readFileSync(path.join(project, '.git/index'))).toEqual(index);
  });

  it('integrates binary, deletion, executable mode, and additions over a dirty baseline', () => {
    const { project, manager } = fixture();
    write(project, 'a.txt', 'user baseline');
    write(project, 'untracked.bin', Buffer.from([0, 255, 10]));
    const head = git(project, 'rev-parse', 'HEAD');
    const index = fs.readFileSync(path.join(project, '.git/index'));
    const { directory } = manager.prepare('binary');
    write(directory, 'untracked.bin', Buffer.from([255, 0, 128, 33]));
    fs.unlinkSync(path.join(directory, 'b.txt'));
    fs.chmodSync(path.join(directory, 'a.txt'), 0o755);
    write(directory, 'src/new.ts', 'export {};');
    write(project, 'unrelated.txt', 'user concurrent edit');
    expect(manager.capture('binary', ['*.bin', '*.txt', 'src/**']).changedFiles)
      .toEqual(['a.txt', 'b.txt', 'src/new.ts', 'untracked.bin']);
    const result = manager.integrate('binary');
    expect(result.snapshotId).toMatch(/^[a-f0-9]{64}$/);
    expect(read(project, 'a.txt')).toBe('user baseline');
    expect(fs.statSync(path.join(project, 'a.txt')).mode & 0o777).toBe(0o755);
    expect(fs.readFileSync(path.join(project, 'untracked.bin'))).toEqual(Buffer.from([255, 0, 128, 33]));
    expect(fs.existsSync(path.join(project, 'b.txt'))).toBe(false);
    expect(read(project, 'src/new.ts')).toBe('export {};');
    expect(read(project, 'unrelated.txt')).toBe('user concurrent edit');
    expect(git(project, 'rev-parse', 'HEAD')).toBe(head);
    expect(fs.readFileSync(path.join(project, '.git/index'))).toEqual(index);
  });

  it('preflights every file and leaves artifacts on overlapping concurrent changes', () => {
    const { project, storage, manager } = fixture();
    const first = manager.prepare('first');
    const second = manager.prepare('second');
    write(first.directory, 'b.txt', 'first');
    write(second.directory, 'a.txt', 'second a');
    write(second.directory, 'b.txt', 'second b');
    manager.capture('first', ['**']);
    const artifact = manager.capture('second', ['**']);
    manager.integrate('first');
    const restarted = new WorkspaceManager(project, storage);
    expect(() => restarted.integrate('second')).toThrow('Integration conflict: b.txt');
    expect(read(project, 'a.txt')).toBe('original a\n');
    expect(read(project, 'b.txt')).toBe('first');
    expect(fs.existsSync(artifact.artifactPath)).toBe(true);
    expect(restarted.list().find(record => record.id === 'second')?.state).toBe('captured');
  });

  it('rejects out-of-scope changes and traversal, and supports recursive globs', () => {
    const { manager } = fixture();
    expect(() => manager.prepare('../outside')).toThrow('Invalid workspace ID');
    const { directory } = manager.prepare('scope');
    write(directory, 'src/a.ts', 'one');
    write(directory, 'src/deep/b.ts', 'two');
    expect(() => manager.capture('scope', ['src/*.ts'])).toThrow('outside write scopes');
    expect(() => manager.capture('scope', ['../**'])).toThrow('Unsafe workspace path');
    expect(manager.capture('scope', ['src/**/*.ts']).changedFiles).toEqual(['src/a.ts', 'src/deep/b.ts']);
    write(directory, 'a.txt', 'outside');
    manager.cleanup('scope');
    expect(fs.existsSync(directory)).toBe(false);
    const archived = JSON.parse(fs.readFileSync(manager.list()[0]!.archivePath!, 'utf8'));
    expect(archived.changedFiles).toEqual(['a.txt', 'src/a.ts', 'src/deep/b.ts']);
    expect(archived.preservationOnly).toBe(true);
    expect(() => manager.integrate('scope')).toThrow('Capture the workspace before integration');
  });

  it.each(['unborn', 'plain'] as const)('uses an explicit isolated snapshot for %s projects', mode => {
    const { project, manager } = fixture(mode);
    const record = manager.prepare('fallback');
    expect(record.mode).toBe('snapshot');
    expect(fs.existsSync(path.join(record.directory, '.git'))).toBe(false);
    expect(manager.capture(record.id, ['**']).changedFiles).toEqual([]);
    write(record.directory, 'a.txt', 'fallback change');
    manager.capture(record.id, ['a.txt']);
    manager.integrate(record.id);
    expect(read(project, 'a.txt')).toBe('fallback change');
    if (mode === 'unborn') expect(() => git(project, 'rev-parse', '--verify', 'HEAD')).toThrow();
  });

  it('keeps managed worktrees outside project-local storage', () => {
    const { project } = fixture();
    const manager = new WorkspaceManager(project, path.join(project, '.sol/workspaces'));
    const record = manager.prepare('local-storage');
    expect(record.directory.startsWith(project + path.sep)).toBe(false);
    manager.cleanup(record.id);
    expect(fs.existsSync(record.directory)).toBe(false);
    fs.rmdirSync(path.dirname(record.directory));
  });

  it('captures dirty work before cleanup and rejects forged directory registrations', () => {
    const { project, storage, manager } = fixture();
    const record = manager.prepare('cleanup');
    write(record.directory, 'a.txt', 'saved before destruction');
    manager.cleanup(record.id);
    expect(fs.existsSync(record.directory)).toBe(false);
    const cleaned = manager.list()[0]!;
    expect(cleaned.state).toBe('cleaned');
    const artifact = JSON.parse(fs.readFileSync(cleaned.artifactPath!, 'utf8'));
    expect(artifact.changedFiles).toEqual(['a.txt']);
    const snapshot = JSON.parse(read(storage, `snapshots/${artifact.snapshotId}.json`));
    expect(Buffer.from(snapshot['a.txt'].data, 'base64').toString()).toBe('saved before destruction');
    manager.cleanup(record.id);
    expect(() => manager.cleanup('missing')).toThrow();
    const forged = manager.prepare('forged');
    write(storage, 'records/forged.json', JSON.stringify({ ...forged, directory: project }));
    expect(() => manager.cleanup('forged')).toThrow('Unowned workspace directory');
    expect(read(project, 'a.txt')).toBe('original a\n');
  });

  it('rejects unsafe symlinks and symlink replacement of an owned directory', () => {
    const { project, manager } = fixture('plain');
    fs.symlinkSync('../outside', path.join(project, 'escape'));
    expect(() => manager.prepare('escape')).toThrow('Unsafe symlink');
    fs.unlinkSync(path.join(project, 'escape'));
    const record = manager.prepare('owned');
    fs.rmSync(record.directory, { recursive: true });
    fs.symlinkSync(project, record.directory);
    expect(() => manager.cleanup(record.id)).toThrow('Symlink path is not allowed');
    expect(read(project, 'a.txt')).toBe('original a\n');
  });

  it('preserves safe relative symlinks and rejects indirect escapes', () => {
    const { project, manager } = fixture('plain');
    fs.symlinkSync('a.txt', path.join(project, 'link'));
    const record = manager.prepare('links');
    expect(fs.readlinkSync(path.join(record.directory, 'link'))).toBe('a.txt');
    fs.unlinkSync(path.join(record.directory, 'link'));
    fs.symlinkSync('b.txt', path.join(record.directory, 'link'));
    manager.capture('links', ['link']);
    manager.integrate('links');
    expect(fs.readlinkSync(path.join(project, 'link'))).toBe('b.txt');
    fs.symlinkSync('link', path.join(record.directory, 'indirect'));
    const archive = manager.archive('links');
    expect(JSON.parse(fs.readFileSync(archive.artifactPath, 'utf8')).quarantinedLinks)
      .toEqual([{ path: 'indirect', target: 'link', reason: 'unsafe-symlink' }]);
  });

  it('rejects destination ancestor symlinks before applying any changes', () => {
    const { project, manager } = fixture();
    const record = manager.prepare('parents');
    write(record.directory, 'a.txt', 'must not apply');
    write(record.directory, 'z/new.txt', 'must not escape');
    manager.capture(record.id, ['**']);
    fs.symlinkSync('..', path.join(project, 'z'));
    expect(() => manager.integrate(record.id)).toThrow('Symlink path is not allowed');
    expect(read(project, 'a.txt')).toBe('original a\n');
  });

  it('rolls back an interrupted journal on restart without overwriting later user edits', () => {
    const { project, storage, manager } = fixture();
    const record = manager.prepare('restart');
    write(record.directory, 'a.txt', 'agent a');
    write(record.directory, 'b.txt', 'agent b');
    const artifact = manager.capture(record.id, ['**']);
    const storedArtifact = JSON.parse(fs.readFileSync(artifact.artifactPath, 'utf8'));
    const before = JSON.parse(read(storage, `snapshots/${record.baseSnapshotId}.json`));
    const after = JSON.parse(read(storage, `snapshots/${storedArtifact.snapshotId}.json`));
    write(storage, 'journals/restart.json', JSON.stringify({ id: record.id, before, after,
      changedFiles: artifact.changedFiles, snapshotId: storedArtifact.snapshotId }));
    const storedRecord = JSON.parse(read(storage, 'records/restart.json'));
    write(storage, 'records/restart.json', JSON.stringify({ ...storedRecord, state: 'integrating' }));
    write(project, 'a.txt', 'agent a');
    write(project, 'b.txt', 'later user edit');
    const restarted = new WorkspaceManager(project, storage);
    expect(restarted.recover()).toEqual({ recovered: [], conflicts: ['restart:b.txt'], interrupted: [] });
    expect(read(project, 'a.txt')).toBe('original a\n');
    expect(read(project, 'b.txt')).toBe('later user edit');
    expect(() => restarted.cleanup('restart')).toThrow('Pending integration journal');
    write(project, 'b.txt', 'original b\n');
    expect(restarted.recover()).toEqual({ recovered: ['restart'], conflicts: [], interrupted: [] });
    restarted.integrate('restart');
    expect(read(project, 'a.txt')).toBe('agent a');
    expect(read(project, 'b.txt')).toBe('agent b');
  });

  it('serializes cooperative managers using a project-wide lock', () => {
    const { project, manager } = fixture();
    const lock = path.join(fs.realpathSync(tmpdir()), 'sol-v2-workspaces',
      createHash('sha256').update(project).digest('hex') + '.lock');
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'test-owner' }), { flag: 'wx' });
    try { expect(() => manager.prepare('busy')).toThrow('cooperative project lock'); }
    finally { fs.unlinkSync(lock); }
    expect(manager.prepare('free').state).toBe('ready');
  });

  it('rolls back earlier writes when applying a later file fails', () => {
    const { project, manager } = fixture();
    const record = manager.prepare('rollback');
    write(record.directory, 'a.txt', 'agent a');
    write(record.directory, 'b.txt', 'agent b');
    const artifact = manager.capture(record.id, ['**']);
    // Fault injection at the filesystem-write boundary, after successful preflight.
    const internals = manager as unknown as { put(root: string, file: string, entry: unknown): void };
    const original = internals.put.bind(manager);
    let failed = false;
    const spy = vi.spyOn(internals, 'put').mockImplementation((root, file, entry) => {
      if (root === project && file === 'b.txt' && !failed) {
        failed = true;
        throw new Error('simulated write failure');
      }
      original(root, file, entry);
    });
    expect(() => manager.integrate(record.id)).toThrow('simulated write failure');
    expect(read(project, 'a.txt')).toBe('original a\n');
    expect(read(project, 'b.txt')).toBe('original b\n');
    expect(fs.existsSync(artifact.artifactPath)).toBe(true);
    expect(manager.list()[0]?.state).toBe('captured');
    expect(manager.recover()).toEqual({ recovered: [], conflicts: [], interrupted: [] });
    spy.mockRestore();
    manager.integrate(record.id);
    expect(read(project, 'a.txt')).toBe('agent a');
  });

  it('preflights new-file collisions and preserves a concurrent user-created file', () => {
    const { project, manager } = fixture();
    const record = manager.prepare('collision');
    write(record.directory, 'a.txt', 'agent');
    write(record.directory, 'z.txt', 'agent new file');
    manager.capture(record.id, ['**']);
    write(project, 'z.txt', 'user new file');
    expect(() => manager.integrate(record.id)).toThrow('Integration conflict: z.txt');
    expect(read(project, 'a.txt')).toBe('original a\n');
    expect(read(project, 'z.txt')).toBe('user new file');
  });

  it('detects snapshot corruption before touching project files', () => {
    const { project, storage, manager } = fixture();
    const record = manager.prepare('corruption');
    write(record.directory, 'a.txt', 'agent');
    const artifact = manager.capture(record.id, ['**']);
    const stored = JSON.parse(fs.readFileSync(artifact.artifactPath, 'utf8'));
    write(storage, `snapshots/${stored.snapshotId}.json`, '{}');
    expect(() => manager.integrate(record.id)).toThrow('Corrupt workspace snapshot');
    expect(read(project, 'a.txt')).toBe('original a\n');
  });

  it('returns effective main-tree snapshots including independent integrations and user edits', () => {
    const { project, storage, manager } = fixture();
    const first = manager.prepare('effective-first');
    const second = manager.prepare('effective-second');
    write(first.directory, 'a.txt', 'first integration');
    write(second.directory, 'b.txt', 'second integration');
    manager.capture(first.id, ['a.txt']);
    const secondArtifact = manager.capture(second.id, ['b.txt']);
    const branch = JSON.parse(fs.readFileSync(secondArtifact.artifactPath, 'utf8'));
    manager.integrate(first.id);
    write(project, 'user.txt', 'independent user addition');
    const integrated = manager.integrate(second.id);
    expect(integrated.snapshotId).not.toBe(branch.snapshotId);
    const effective = JSON.parse(read(storage, `snapshots/${integrated.snapshotId}.json`));
    expect(Buffer.from(effective['a.txt'].data, 'base64').toString()).toBe('first integration');
    expect(Buffer.from(effective['b.txt'].data, 'base64').toString()).toBe('second integration');
    expect(Buffer.from(effective['user.txt'].data, 'base64').toString()).toBe('independent user addition');
    expect(manager.integrationMatches(first.id)).toBe(true);
    expect(manager.integrationMatches(second.id)).toBe(true);
    expect(manager.integrated(second.id)).toEqual(integrated);
  });

  it('retains receipts through restart, archival, and cleanup without ever reapplying', () => {
    const { project, storage, manager } = fixture();
    expect(manager.integrated('unknown')).toBeUndefined();
    expect(manager.integrationMatches('unknown')).toBe(false);
    const record = manager.prepare('receipt');
    expect(manager.integrated(record.id)).toBeUndefined();
    write(record.directory, 'a.txt', 'accepted');
    const artifact = manager.capture(record.id, ['a.txt']);
    expect(manager.integrated(record.id)).toBeUndefined();
    const result = manager.integrate(record.id);
    expect(manager.integrate(record.id)).toEqual(result);
    expect(() => manager.capture(record.id, ['**'])).toThrow('Cannot recapture an integrated attempt');
    write(record.directory, 'a.txt', 'unaccepted workspace edits after integration');
    manager.cleanup(record.id);
    const cleaned = manager.list()[0]!;
    expect(cleaned.archivePath).not.toBe(artifact.artifactPath);
    const restarted = new WorkspaceManager(project, storage);
    expect(restarted.integrated(record.id)).toEqual(result);
    expect(restarted.integrationMatches(record.id)).toBe(true);
    expect(restarted.integrate(record.id)).toEqual(result);
    write(project, 'a.txt', 'later user edit');
    expect(restarted.integrationMatches(record.id)).toBe(false);
    expect(restarted.integrate(record.id)).toEqual(result);
    expect(read(project, 'a.txt')).toBe('later user edit');
    expect(restarted.integrated(record.id)).toEqual(result);
  });

  it('recovers orphan journals after durable integration but before driver acceptance', () => {
    const { project, storage, manager } = fixture();
    const first = manager.prepare('orphan-first');
    const second = manager.prepare('orphan-second');
    write(first.directory, 'a.txt', 'first');
    write(second.directory, 'b.txt', 'second');
    manager.capture(first.id, ['a.txt']);
    const artifact = manager.capture(second.id, ['b.txt']);
    const branch = JSON.parse(fs.readFileSync(artifact.artifactPath, 'utf8'));
    manager.integrate(first.id);
    const result = manager.integrate(second.id);
    // Reconstitute the exact persisted journal remaining if the process exits
    // after saving its receipt and before removing the journal/driver acceptance.
    const before = JSON.parse(read(storage, `snapshots/${second.baseSnapshotId}.json`));
    const after = JSON.parse(read(storage, `snapshots/${branch.snapshotId}.json`));
    write(storage, `journals/${second.id}.json`, JSON.stringify({ id: second.id, before, after,
      changedFiles: artifact.changedFiles, artifactSnapshotId: branch.snapshotId, integratedSnapshotId: result.snapshotId }));
    const restarted = new WorkspaceManager(project, storage);
    expect(restarted.integrated(second.id)).toEqual(result);
    expect(restarted.integrate(second.id)).toEqual(result);
    expect(restarted.recover()).toEqual({ recovered: [second.id], conflicts: [], interrupted: [] });
    expect(read(project, 'a.txt')).toBe('first');
    expect(read(project, 'b.txt')).toBe('second');
    expect(fs.readdirSync(path.join(storage, 'journals'))).toEqual([]);
  });

  it('does not accept a completed orphan journal when its changed files have diverged', () => {
    const { project, storage, manager } = fixture();
    const record = manager.prepare('diverged');
    write(record.directory, 'a.txt', 'accepted');
    const artifact = manager.capture(record.id, ['a.txt']);
    const branch = JSON.parse(fs.readFileSync(artifact.artifactPath, 'utf8'));
    const result = manager.integrate(record.id);
    write(storage, `journals/${record.id}.json`, JSON.stringify({ id: record.id,
      before: JSON.parse(read(storage, `snapshots/${record.baseSnapshotId}.json`)),
      after: JSON.parse(read(storage, `snapshots/${branch.snapshotId}.json`)), changedFiles: ['a.txt'],
      artifactSnapshotId: branch.snapshotId, integratedSnapshotId: result.snapshotId }));
    write(project, 'a.txt', 'later user edit');
    const restarted = new WorkspaceManager(project, storage);
    expect(restarted.recover()).toEqual({ recovered: [], conflicts: ['diverged:a.txt'], interrupted: [] });
    expect(restarted.integrationMatches(record.id)).toBe(false);
    expect(read(project, 'a.txt')).toBe('later user edit');
    expect(fs.existsSync(path.join(storage, 'journals/diverged.json'))).toBe(true);
    write(project, 'a.txt', 'accepted');
    expect(restarted.recover().recovered).toEqual([record.id]);
  });

  it('never exposes a successful receipt if saving integration failed', () => {
    const { project, storage, manager } = fixture();
    const record = manager.prepare('not-durable');
    write(record.directory, 'a.txt', 'agent');
    manager.capture(record.id, ['a.txt']);
    const internals = manager as unknown as { saveRecord(value: { state: string }): void };
    const original = internals.saveRecord.bind(manager);
    const spy = vi.spyOn(internals, 'saveRecord').mockImplementation(value => {
      if (value.state === 'integrated') throw new Error('simulated receipt persistence failure');
      original(value);
    });
    expect(() => manager.integrate(record.id)).toThrow('simulated receipt persistence failure');
    spy.mockRestore();
    const restarted = new WorkspaceManager(project, storage);
    expect(restarted.integrated(record.id)).toBeUndefined();
    expect(restarted.integrationMatches(record.id)).toBe(false);
    expect(read(project, 'a.txt')).toBe('original a\n');
    expect(restarted.recover().conflicts).toEqual([]);
    expect(restarted.integrate(record.id).changedFiles).toEqual(['a.txt']);
  });

  it('archives rejected changes without widening scopes or permitting archive integration', () => {
    const { project, storage, manager } = fixture();
    const record = manager.prepare('archive');
    write(record.directory, 'a.txt', 'approved path');
    manager.capture(record.id, ['a.txt']);
    write(record.directory, 'b.txt', 'out of scope');
    expect(() => manager.capture(record.id, [])).toThrow('outside write scopes');
    const archive = manager.archive(record.id);
    expect(archive.changedFiles).toEqual(['a.txt', 'b.txt']);
    const saved = JSON.parse(fs.readFileSync(archive.artifactPath, 'utf8'));
    expect(saved.preservationOnly).toBe(true);
    expect(JSON.parse(read(storage, 'records/archive.json')).scopes).toEqual(['a.txt']);
    expect(() => manager.integrate(record.id)).toThrow('Capture the workspace before integration');
    // Defense in depth: even a captured state cannot authorize an archive artifact.
    const storedRecord = JSON.parse(read(storage, 'records/archive.json'));
    write(storage, 'records/archive.json', JSON.stringify({ ...storedRecord, state: 'captured', artifactPath: archive.artifactPath }));
    expect(() => manager.integrate(record.id)).toThrow('Preservation-only archives cannot be integrated');
    manager.cleanup(record.id);
    expect(fs.existsSync(record.directory)).toBe(false);
    expect(fs.readdirSync(path.join(storage, 'workspaces'))).toEqual([]);
    expect(manager.archive(record.id)).toEqual(archive);
    expect(manager.integrated(record.id)).toBeUndefined();
    expect(read(project, 'b.txt')).toBe('original b\n');
    const snapshot = JSON.parse(read(storage, `snapshots/${saved.snapshotId}.json`));
    expect(Buffer.from(snapshot['b.txt'].data, 'base64').toString()).toBe('out of scope');
    expect(git(project, 'worktree', 'list', '--porcelain')).not.toContain(record.directory);
  });

  it('cleans and archives a workspace whose first capture with empty scopes failed', () => {
    const { storage, manager } = fixture();
    const record = manager.prepare('empty-scopes');
    write(record.directory, 'outside.txt', 'preserve me');
    expect(() => manager.capture(record.id, [])).toThrow('outside write scopes');
    manager.cleanup(record.id);
    const cleaned = manager.list()[0]!;
    const artifact = JSON.parse(fs.readFileSync(cleaned.archivePath!, 'utf8'));
    expect(artifact.preservationOnly).toBe(true);
    expect(artifact.changedFiles).toEqual(['outside.txt']);
    expect(JSON.parse(read(storage, 'records/empty-scopes.json')).scopes).toBeUndefined();
    expect(fs.existsSync(record.directory)).toBe(false);
    expect(() => manager.integrate(record.id)).toThrow('Capture the workspace before integration');
  });

  it('allows environment templates and tracked build products but excludes caches and actual env files', () => {
    const { project, manager } = fixture();
    for (const file of ['.env.example', '.env.sample', 'dist/tracked.js', 'build/tracked.bin', 'target/tracked.txt']) write(project, file, 'tracked fixture');
    git(project, 'add', '.');
    git(project, 'commit', '-m', 'fixture templates and tracked outputs');
    for (const file of ['.env', '.env.local', '.env.production', '.env.example.local', '.dart_tool/cache',
      'dist/cache.js', 'build/cache.bin', 'target/cache.txt', 'node_modules/pkg/index.js']) write(project, file, 'excluded');
    write(project, '.gitignore', 'other-cache/\n');
    write(project, 'other-cache/large', 'ignored cache');
    const record = manager.prepare('templates');
    for (const file of ['.env.example', '.env.sample', 'dist/tracked.js', 'build/tracked.bin', 'target/tracked.txt']) {
      expect(read(record.directory, file)).toBe('tracked fixture');
    }
    for (const file of ['.env', '.env.local', '.env.production', '.env.example.local', '.dart_tool',
      'dist/cache.js', 'build/cache.bin', 'target/cache.txt', 'node_modules', 'other-cache']) {
      expect(fs.existsSync(path.join(record.directory, file))).toBe(false);
    }
    expect(manager.capture(record.id, ['**']).changedFiles).toEqual([]);
    write(record.directory, 'dist/tracked.js', 'updated tracked output');
    write(record.directory, '.env.example', 'KEY=placeholder');
    write(record.directory, 'build/generated', 'discardable generated cache');
    expect(manager.capture(record.id, ['dist/tracked.js', '.env.example'], ['build/**']).changedFiles).toEqual(['.env.example', 'dist/tracked.js']);
    manager.integrate(record.id);
    expect(read(project, 'dist/tracked.js')).toBe('updated tracked output');
    expect(read(project, '.env.example')).toBe('KEY=placeholder');
    expect(read(project, 'dist/cache.js')).toBe('excluded');
  });

  it('includes earlier explicitly integrated ignored files in later effective snapshots', () => {
    const { project, storage, manager } = fixture();
    write(project, '.gitignore', 'ignored.txt\n');
    const first = manager.prepare('ignored-first');
    const second = manager.prepare('ignored-second');
    write(first.directory, 'ignored.txt', 'explicitly accepted despite ignore rule');
    write(second.directory, 'b.txt', 'second');
    manager.capture(first.id, ['ignored.txt']);
    manager.capture(second.id, ['b.txt']);
    manager.integrate(first.id);
    manager.cleanup(first.id);
    const result = manager.integrate(second.id);
    const effective = JSON.parse(read(storage, `snapshots/${result.snapshotId}.json`));
    expect(Buffer.from(effective['ignored.txt'].data, 'base64').toString()).toBe('explicitly accepted despite ignore rule');
    expect(Buffer.from(effective['b.txt'].data, 'base64').toString()).toBe('second');
  });

  it('does not infer durable success from a fully applied journal without a saved receipt', () => {
    const { project, storage, manager } = fixture();
    const record = manager.prepare('unaccepted-journal');
    write(record.directory, 'a.txt', 'applied but not durably recorded');
    const artifact = manager.capture(record.id, ['a.txt']);
    const branch = JSON.parse(fs.readFileSync(artifact.artifactPath, 'utf8'));
    const storedRecord = JSON.parse(read(storage, `records/${record.id}.json`));
    write(storage, `records/${record.id}.json`, JSON.stringify({ ...storedRecord, state: 'integrating' }));
    write(storage, `journals/${record.id}.json`, JSON.stringify({ id: record.id,
      before: JSON.parse(read(storage, `snapshots/${record.baseSnapshotId}.json`)),
      after: JSON.parse(read(storage, `snapshots/${branch.snapshotId}.json`)), changedFiles: ['a.txt'],
      artifactSnapshotId: branch.snapshotId, integratedSnapshotId: branch.snapshotId }));
    write(project, 'a.txt', 'applied but not durably recorded');
    const restarted = new WorkspaceManager(project, storage);
    expect(restarted.integrated(record.id)).toBeUndefined();
    expect(restarted.integrationMatches(record.id)).toBe(false);
    expect(restarted.recover()).toEqual({ recovered: [record.id], conflicts: [], interrupted: [] });
    expect(read(project, 'a.txt')).toBe('original a\n');
    expect(restarted.integrated(record.id)).toBeUndefined();
  });
});
