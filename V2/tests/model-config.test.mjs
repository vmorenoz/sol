import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SOL_AGENT_IDS, resolveModelAssignments } from '../lib/model-profiles.mjs';
import { readModelConfig, planModelConfig, applyModelConfig, resolveConfigPaths } from '../lib/model-config.mjs';
import { safePath } from '../lib/fs.mjs';

const catalog = [
  { providerID: 'openai', id: 'gpt-6.1-sol', enabled: true, status: 'active', variants: [{ id: 'medium' }, { id: 'high' }] },
  { providerID: 'openai', id: 'gpt-6-luna', enabled: true, status: 'active', variants: [{ id: 'medium' }, { id: 'high' }, { id: 'none' }] },
];
test('model config paths are portable with Windows semantics and remain confined to HOME', () => {
  const home = 'C:\\Users\\alice';
  const defaultPaths = resolveConfigPaths(home, {}, path.win32);
  assert.equal(defaultPaths.root, 'C:\\Users\\alice\\.config\\opencode');
  assert.equal(defaultPaths.configRelativePath, '.config/opencode/opencode.jsonc');
  assert.equal(defaultPaths.jsonRel, '.config/opencode/opencode.json');
  const configuredPaths = resolveConfigPaths(home, { OPENCODE_CONFIG_DIR: 'C:\\Users\\alice\\settings\\oc' }, path.win32);
  assert.equal(configuredPaths.configRelativePath, 'settings/oc/opencode.jsonc');
  const xdgPaths = resolveConfigPaths(home, { XDG_CONFIG_HOME: 'C:\\Users\\alice\\xdg' }, path.win32);
  assert.equal(xdgPaths.configRelativePath, 'xdg/opencode/opencode.jsonc');
  assert.throws(() => resolveConfigPaths(home, { OPENCODE_CONFIG_DIR: 'C:\\Users\\bob\\oc' }, path.win32), /dentro de HOME/);
  assert.throws(() => resolveConfigPaths(home, { OPENCODE_CONFIG_DIR: 'D:\\OpenCode' }, path.win32), /dentro de HOME/);
  assert.throws(() => safePath(home, 'C:/outside/file'), /Ruta relativa inválida/);
});
function fixture(config = null, extra = {}) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-model-test-'));
  const root = path.join(homeDir, '.config', 'opencode'); fs.mkdirSync(root, { recursive: true });
  if (config !== null) fs.writeFileSync(path.join(root, extra.legacy ? 'opencode.json' : 'opencode.jsonc'), config);
  fs.mkdirSync(path.join(homeDir, '.sol'), { recursive: true });
  fs.writeFileSync(path.join(homeDir, '.sol', 'installation.json'), JSON.stringify({ schemaVersion: 1, version: '2.0.0', runtimes: ['opencode-v2'], files: {}, modelConfig: { path: '.config/opencode/opencode.jsonc', agentIds: [] } }));
  return { homeDir, root, env: {}, dispose: () => fs.rmSync(homeDir, { recursive: true, force: true }) };
}

test('fixed balanced assignments and inherited profile', () => {
  const result = resolveModelAssignments({ profile: 'balanced', catalog });
  assert.deepEqual(Object.keys(result), SOL_AGENT_IDS);
  assert.equal(result.sol, 'openai/gpt-6.1-sol#medium');
  assert.equal(result['sol-explorer'], 'openai/gpt-6-luna#medium');
  assert.equal(result['sol-executor'], 'openai/gpt-6-luna#high');
  assert.equal(result['sol-security-auditor'], 'openai/gpt-6.1-sol#high');
  assert.ok(Object.values(resolveModelAssignments({ profile: 'inherited' })).every(x => x === null));
  assert.equal(resolveModelAssignments({ profile: 'custom', overrides: { sol: 'openai/gpt-6-luna#none' }, catalog }).sol, 'openai/gpt-6-luna#none');
  assert.throws(() => resolveModelAssignments({ profile: 'custom', overrides: { sol: 'openai/gpt-6.1-sol#none' }, catalog }), /variante/);
  assert.throws(() => resolveModelAssignments({ profile: 'custom', overrides: { sol: 'openai/gpt-6-luna#high' }, catalog: [{ ...catalog[1], enabled: false }] }), /no habilitado/);
  assert.equal(resolveModelAssignments({ profile: 'custom', overrides: { sol: 'openai/gpt-6.1-sol/submodel#high' }, catalog: [{ ...catalog[0], id: 'gpt-6.1-sol/submodel' }] }).sol, 'openai/gpt-6.1-sol/submodel#high');
});

test('inherited rejects non-empty overrides directly and during planning without touching files', () => {
  assert.ok(Object.values(resolveModelAssignments({ profile: 'inherited', overrides: {} })).every(value => value === null));
  assert.throws(() => resolveModelAssignments({ profile: 'inherited', overrides: { sol: 'openai/model#high' } }), /heredado no admite overrides/);

  const original = '{"agents":{"sol":{"model":"openai/gpt-6-luna#high"}}}';
  const f = fixture(original);
  try {
    const configPath = path.join(f.root, 'opencode.jsonc');
    const manifestPath = path.join(f.homeDir, '.sol/installation.json');
    const configBefore = fs.readFileSync(configPath);
    const manifestBefore = fs.readFileSync(manifestPath);
    assert.throws(() => planModelConfig({ ...f, profile: 'inherited', overrides: { sol: 'openai/model#high' }, catalog }), /heredado no admite overrides/);
    assert.deepEqual(fs.readFileSync(configPath), configBefore);
    assert.deepEqual(fs.readFileSync(manifestPath), manifestBefore);
    assert.equal(fs.existsSync(path.join(f.homeDir, '.sol/backups')), false);
  } finally { f.dispose(); }
});

test('custom preserves other assignments and validates known enabled models and variants', () => {
  const current = { sol: 'openai/gpt-6-luna#medium' };
  const result = resolveModelAssignments({ profile: 'custom', current, overrides: { 'sol-executor': 'openai/gpt-6.1-sol#high' }, catalog });
  assert.equal(result.sol, current.sol); assert.equal(result['sol-executor'], 'openai/gpt-6.1-sol#high');
  for (const selector of ['other/nope', 'openai/gpt-6-luna#default', 'bad selector'])
    assert.throws(() => resolveModelAssignments({ profile: 'custom', overrides: { sol: selector }, catalog }));
  assert.throws(() => resolveModelAssignments({ profile: 'custom', overrides: { unknown: 'openai/gpt-6-luna' }, catalog }));
});

test('read and plan preserve unrelated config/comments and reject ambiguous JSON/JSONC', () => {
  const f = fixture('{\n  // retain\n  "permission": {"read": "allow"},\n  "provider": {"openai": {"options": {"apiKey": "secret"}}},\n  "root": "keep",\n  "agents": {"sol": {"prompt": "keep"}}\n}\n');
  try {
    const snapshot = readModelConfig(f);
    assert.equal(snapshot.assignments.sol, null);
    assert.equal(JSON.stringify(snapshot).includes('secret'), false);
    const plan = planModelConfig({ ...f, profile: 'balanced', catalog, expectedRevision: snapshot.revision });
    const text = plan.files.get('.config/opencode/opencode.jsonc');
    assert.match(text, /\/\/ retain/); assert.match(text, /"permission"/); assert.match(text, /"apiKey": "secret"/); assert.match(text, /"root": "keep"/);
  } finally { f.dispose(); }
  const dual = fixture('{}'); fs.writeFileSync(path.join(dual.root, 'opencode.json'), '{}');
  try { assert.throws(() => readModelConfig(dual), /precedencia es ambigua/); } finally { dual.dispose(); }
});

test('legacy JSON is read as migration source; inherited cleanup removes only model fields', () => {
  const f = fixture('{"agents":{"sol":{"model":{"providerID":"openai","model":"gpt-6.1-sol"},"prompt":"custom"},"someone":{"model":"keep"}}}', { legacy: true });
  try {
    const plan = planModelConfig({ ...f, profile: 'inherited' });
    assert.equal(plan.migration, true); assert.deepEqual(plan.removals, ['.config/opencode/opencode.json']);
    const output = plan.files.get('.config/opencode/opencode.jsonc');
    assert.match(output, /"prompt":"custom"/); assert.match(output, /"someone"/); assert.doesNotMatch(output, /"model":"gpt-6.1-sol"/);
  } finally { f.dispose(); }
});

test('revision and malformed config fail closed', () => {
  const f = fixture('{"agents":{}}');
  try {
    const snap = readModelConfig(f); fs.writeFileSync(path.join(f.root, 'opencode.jsonc'), '{"agents":{},"root":true}');
    assert.throws(() => planModelConfig({ ...f, expectedRevision: snap.revision }), /cambió/);
  } finally { f.dispose(); }
  const malformed = fixture('{"agents":{},"agents":{}}');
  try { assert.throws(() => readModelConfig(malformed), /Duplicate key/); } finally { malformed.dispose(); }
});

test('apply migrates unchanged JSON exactly, backs up originals privately, and updates only native preference metadata', () => {
  const original = '{\n  "provider": {"openai": {"options": {"apiKey": "fixture-only-secret"}}},\n  "permission": {"read": "allow"},\n  "agents": {"unrelated": {"prompt": "keep"}}\n}\n';
  const f = fixture(original, { legacy: true });
  try {
    const plan = planModelConfig({ ...f, profile: 'inherited' });
    const result = applyModelConfig(plan);
    assert.equal(result.changed, true); assert.equal(fs.readFileSync(path.join(f.root, 'opencode.jsonc'), 'utf8'), original);
    assert.equal(fs.existsSync(path.join(f.root, 'opencode.json')), false);
    const backupManifest = JSON.parse(fs.readFileSync(result.recovery, 'utf8'));
    const legacyBackup = backupManifest.files.find(entry => entry.path === '.config/opencode/opencode.json');
    assert.ok(legacyBackup); assert.equal(fs.readFileSync(path.join(f.homeDir, legacyBackup.backup), 'utf8'), original);
    assert.equal(fs.statSync(path.join(f.homeDir, legacyBackup.backup)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(result.recovery).mode & 0o777, 0o600);
    const install = JSON.parse(fs.readFileSync(path.join(f.homeDir, '.sol/installation.json'), 'utf8'));
    assert.deepEqual(install.files, {}); assert.deepEqual(install.modelConfig.agentIds, []);
  } finally { f.dispose(); }
});

test('apply balanced then inherited; cleanup is tracked-only and preserves instructions and permissions', () => {
  const f = fixture('{"permission":{"read":"allow"},"agents":{"sol":{"prompt":"mine"},"sol-old":{"model":"openai/gpt-6-luna#high","prompt":"old"},"sol-foo":{"model":"do-not-touch"}}}');
  try {
    const first = planModelConfig({ ...f, profile: 'balanced', catalog }); applyModelConfig(first);
    let config = JSON.parse(fs.readFileSync(path.join(f.root, 'opencode.jsonc'), 'utf8'));
    assert.deepEqual(config.agents.sol.model, { providerID: 'openai', model: 'gpt-6.1-sol', variant: 'medium' });
    const manifestPath = path.join(f.homeDir, '.sol/installation.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.modelConfig.agentIds.push('sol-old'); fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const inherited = planModelConfig({ ...f, profile: 'inherited' });
    assert.ok(inherited.changes.some(change => change.agentId === 'sol-old' && change.after === null));
    applyModelConfig(inherited);
    config = JSON.parse(fs.readFileSync(path.join(f.root, 'opencode.jsonc'), 'utf8'));
    assert.equal(config.permission.read, 'allow'); assert.equal(config.agents.sol.prompt, 'mine');
    assert.equal(config.agents['sol-old'].model, undefined); assert.equal(config.agents['sol-old'].prompt, 'old');
    assert.equal(config.agents['sol-foo'].model, 'do-not-touch');
  } finally { f.dispose(); }
});

test('apply no-op creates no recovery; preflight catches changed source and symlinks/outside paths', () => {
  const f = fixture('{"agents":{}}');
  try {
    const plan = planModelConfig({ ...f, profile: 'inherited' });
    const result = applyModelConfig(plan);
    assert.equal(result.changed, false); assert.equal(result.recovery, null);
    assert.equal(fs.existsSync(path.join(f.homeDir, '.sol/backups')), false);
    const stale = planModelConfig({ ...f, profile: 'balanced', catalog });
    fs.writeFileSync(path.join(f.root, 'opencode.jsonc'), '{"agents":{},"other":true}');
    assert.throws(() => applyModelConfig(stale), /cambió/);
  } finally { f.dispose(); }
  const outside = fixture('{}');
  try { assert.throws(() => readModelConfig({ ...outside, env: { OPENCODE_CONFIG_DIR: path.join(os.tmpdir(), 'outside-opencode') } }), /dentro de HOME/); }
  finally { outside.dispose(); }
  const symlink = fixture('{}');
  try {
    fs.unlinkSync(path.join(symlink.homeDir, '.sol/installation.json'));
    fs.symlinkSync(path.join(os.tmpdir(), 'not-read'), path.join(symlink.homeDir, '.sol/installation.json'));
    assert.throws(() => readModelConfig(symlink), /symlink|Symlink|No es un archivo normal/);
  } finally { symlink.dispose(); }
  const solAncestor = fixture('{}');
  try {
    fs.renameSync(path.join(solAncestor.homeDir, '.sol'), path.join(solAncestor.homeDir, '.sol-real'));
    fs.symlinkSync(path.join(solAncestor.homeDir, '.sol-real'), path.join(solAncestor.homeDir, '.sol'));
    assert.throws(() => readModelConfig(solAncestor), /symlink|Symlink/);
  } finally { solAncestor.dispose(); }
  const configLink = fixture('{}');
  try {
    fs.unlinkSync(path.join(configLink.root, 'opencode.jsonc'));
    fs.symlinkSync(path.join(os.tmpdir(), 'not-read-config'), path.join(configLink.root, 'opencode.jsonc'));
    assert.throws(() => readModelConfig(configLink), /symlink|Symlink|No es un archivo normal/);
  } finally { configLink.dispose(); }
});

test('migration overlay is read from legacy source and survives no-model edits', () => {
  const f = fixture('{"mcp":{"servers":{"legacy":{"command":"keep"}}}}', { legacy: true });
  try {
    const editedLegacy = '{"mcp":{"servers":{"legacy":{"command":"keep"},"new":{"command":"installer"}}}}';
    const plan = planModelConfig({ ...f, profile: 'inherited', sourceTexts: new Map([['.config/opencode/opencode.json', editedLegacy]]) });
    assert.equal(plan.files.get('.config/opencode/opencode.jsonc'), editedLegacy);
    const result = applyModelConfig(plan);
    assert.equal(fs.readFileSync(path.join(f.root, 'opencode.jsonc'), 'utf8'), editedLegacy);
    assert.equal(fs.existsSync(path.join(f.root, 'opencode.json')), false);
    assert.ok(result.recovery);
  } finally { f.dispose(); }
});

test('explicit trusted cleanup removes obsolete untracked Sol models only when passed by installer', () => {
  const f = fixture('{"agents":{"sol-obsolete":{"model":{"providerID":"openai","model":"gpt-6-luna","variant":"high"},"permission":{"read":"allow"}},"sol-unowned":{"model":"openai/gpt-6-luna#high","permission":{"read":"deny"}}}}');
  try {
    const untouched = planModelConfig({ ...f, profile: 'inherited' });
    assert.ok(!untouched.changes.some(change => change.agentId === 'sol-obsolete'));
    const plan = planModelConfig({ ...f, profile: 'inherited', cleanupAgentIds: ['sol-obsolete'] });
    assert.ok(plan.changes.some(change => change.agentId === 'sol-obsolete' && change.before === 'openai/gpt-6-luna#high' && change.after === null));
    applyModelConfig(plan);
    const config = JSON.parse(fs.readFileSync(path.join(f.root, 'opencode.jsonc'), 'utf8'));
    assert.equal(config.agents['sol-obsolete'].model, undefined);
    assert.deepEqual(config.agents['sol-obsolete'].permission, { read: 'allow' });
    assert.equal(config.agents['sol-unowned'].model, 'openai/gpt-6-luna#high');
  } finally { f.dispose(); }
});

test('apply rolls back earlier writes if a later atomic rename fails', () => {
  const f = fixture('{"keep":true}', { legacy: true });
  const original = fs.readFileSync(path.join(f.root, 'opencode.json'));
  const manifest = path.join(f.homeDir, '.sol/installation.json');
  const originalManifest = fs.readFileSync(manifest);
  const plan = planModelConfig({ ...f, profile: 'balanced', catalog });
  const rename = fs.renameSync;
  let calls = 0;
  fs.renameSync = function (...args) { calls++; if (calls === 5) { const error = new Error('fixture write fault'); error.code = 'EIO'; throw error; } return rename.apply(this, args); };
  try {
    assert.throws(() => applyModelConfig(plan), /Se restauraron los originales/);
    assert.deepEqual(fs.readFileSync(path.join(f.root, 'opencode.json')), original);
    assert.deepEqual(fs.readFileSync(manifest), originalManifest);
    assert.equal(fs.existsSync(path.join(f.root, 'opencode.jsonc')), false);
  } finally { fs.renameSync = rename; f.dispose(); }
});
