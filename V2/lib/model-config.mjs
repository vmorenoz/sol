import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseJSONC, upsertJSONC, editJSONC } from './jsonc.mjs';
import { safePath, atomicWrite, portableRelative } from './fs.mjs';
import { SOL_AGENT_IDS, resolveModelAssignments, detectModelProfile } from './model-profiles.mjs';

const MANIFEST = '.sol/installation.json';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const idRE = /^sol(?:-[a-z0-9-]+)?$/;

export function resolveConfigPaths(homeDir, env, pathAPI = path) {
  const home = pathAPI.resolve(homeDir);
  const configured = env.OPENCODE_CONFIG_DIR || (env.XDG_CONFIG_HOME ? pathAPI.join(env.XDG_CONFIG_HOME, 'opencode') : pathAPI.join(home, '.config', 'opencode'));
  const root = pathAPI.resolve(configured), rel = pathAPI.relative(home, root);
  if (!rel || rel === '..' || rel.startsWith(`..${pathAPI.sep}`) || pathAPI.isAbsolute(rel)) throw new Error('La configuración de OpenCode debe estar dentro de HOME; no se administrarán rutas externas.');
  const configRelativePath = portableRelative(home, pathAPI.join(root, 'opencode.jsonc'), pathAPI);
  safePath(home, configRelativePath);
  return { home, root, configPath: pathAPI.join(root, 'opencode.jsonc'), configRelativePath,
    jsonRel: portableRelative(home, pathAPI.join(root, 'opencode.json'), pathAPI) };
}
function readBytes(home, relative) {
  const file = safePath(home, relative);
  try { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`No es un archivo normal: ${relative}`); return fs.readFileSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const hashBytes = bytes => bytes === null ? null : digest(bytes);

function parseManifest(home, required = false) {
  const bytes = readBytes(home, MANIFEST);
  if (!bytes) {
    if (required) throw new Error('Se requiere una instalación reconocida de Sol antes de guardar preferencias.');
    return { bytes: null, data: null, tracked: [] };
  }
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Manifest de instalación no reconocido.'); }
  if (!data || data.schemaVersion !== 1 || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)) throw new Error('Manifest de instalación no reconocido.');
  let tracked = [];
  if (data.modelConfig !== undefined) {
    const mc = data.modelConfig;
    if (!mc || typeof mc !== 'object' || Array.isArray(mc) || typeof mc.path !== 'string' || path.posix.isAbsolute(mc.path) || mc.path.split('/').some(x => !x || x === '.' || x === '..') || !/^.+\/opencode\.jsonc?$/.test(mc.path) || !Array.isArray(mc.agentIds) || mc.agentIds.some(id => typeof id !== 'string' || !idRE.test(id)) || new Set(mc.agentIds).size !== mc.agentIds.length)
      throw new Error('Metadatos de modelos no reconocidos en el manifest.');
    tracked = mc.agentIds;
  }
  return { bytes, data, tracked };
}
function readModel(model, id) {
  if (model === undefined) return null;
  let selector;
  if (typeof model === 'string') selector = model;
  else if (model && typeof model === 'object' && !Array.isArray(model) && typeof model.providerID === 'string' && typeof model.model === 'string' && (model.variant === undefined || typeof model.variant === 'string'))
    selector = `${model.providerID}/${model.model}${model.variant === undefined ? '' : `#${model.variant}`}`;
  else throw new Error(`La preferencia model de ${id} tiene un formato no admitido; edítala manualmente antes de continuar.`);
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+(?:#[A-Za-z0-9._-]+)?$/.test(selector)) throw new Error(`La preferencia model de ${id} tiene una referencia no admitida; edítala manualmente.`);
  return selector;
}
// Installer-only consolidation: no precedence guessing or concatenating arrays.
// Existing JSONC comments survive; both original documents are backed up by install.
function mergeComplementaryJSONC(jsoncText, jsonText) {
  const primary = parseJSONC(jsoncText), secondary = parseJSONC(jsonText);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(primary) || !object(secondary)) throw new Error('La raíz de la configuración OpenCode debe ser un objeto.');
  const additions = [];
  const visit = (left, right, keys = []) => {
    for (const [key, value] of Object.entries(right)) {
      const location = [...keys, key];
      if (!own(left, key)) additions.push({ path: location, value });
      else if (isDeepStrictEqual(left[key], value)) continue;
      else if (object(left[key]) && object(value)) visit(left[key], value, location);
      else throw new Error(`Conflicto entre opencode.json y opencode.jsonc en ${JSON.stringify(location)}. Decide qué valor conservar; no se modificó ninguno ni se muestran sus valores.`);
    }
  };
  visit(primary, secondary);
  return upsertJSONC(jsoncText, additions);
}
function readConfig(options) {
  const home = path.resolve(options.homeDir || os.homedir()), paths = resolveConfigPaths(home, options.env || process.env);
  const jsonc = readBytes(home, paths.configRelativePath), json = readBytes(home, paths.jsonRel);
  const overlay = relative => options.sourceTexts instanceof Map ? options.sourceTexts.get(relative) : options.sourceTexts?.[relative];
  if (jsonc && json && !options.mergeComplementary) throw new Error('Existen opencode.json y opencode.jsonc; la precedencia es ambigua. No se modificó ninguno.');
  const legacy = !!json, sourceRel = jsonc ? paths.configRelativePath : legacy ? paths.jsonRel : paths.configRelativePath, rawBytes = jsonc ?? json;
  const jsoncText = overlay(paths.configRelativePath) ?? jsonc?.toString('utf8');
  const jsonText = overlay(paths.jsonRel) ?? json?.toString('utf8');
  const raw = jsonc && json ? mergeComplementaryJSONC(jsoncText, jsonText) : (jsonc ? jsoncText : jsonText) ?? null;
  const value = raw === null ? {} : parseJSONC(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La raíz de la configuración OpenCode debe ser un objeto.');
  if (value.agents !== undefined && (!value.agents || typeof value.agents !== 'object' || Array.isArray(value.agents))) throw new Error('agents debe ser un objeto; se requiere corregir la configuración antes de continuar.');
  for (const [id, agent] of Object.entries(value.agents || {}))
    if (!agent || typeof agent !== 'object' || Array.isArray(agent)) throw new Error(`La configuración de agents.${id} debe ser un objeto; no se modificó.`);
  const manifest = parseManifest(home);
  if (manifest.data?.modelConfig && manifest.data.modelConfig.path !== paths.configRelativePath && manifest.data.modelConfig.path !== paths.jsonRel)
    throw new Error('La ruta de preferencias registrada no coincide con una configuración nativa permitida de OpenCode.');
  const agentIds = [...new Set([...SOL_AGENT_IDS, ...manifest.tracked])];
  const assignments = Object.fromEntries(agentIds.map(id => [id, readModel(value.agents?.[id]?.model, id)]));
  const revision = digest(`${hashBytes(jsonc) ?? 'missing-jsonc'}\0${hashBytes(json) ?? 'missing-json'}\0${hashBytes(manifest.bytes) ?? 'missing-manifest'}`);
  return { ...paths, home, raw, rawBytes, sourceRel, sourceHash: hashBytes(rawBytes), jsonHash: hashBytes(json), jsoncHash: hashBytes(jsonc), legacy, value, assignments, manifest, revision, agentIds };
}

export function readModelConfig(options = {}) {
  const state = readConfig(options);
  const assignments = Object.fromEntries(SOL_AGENT_IDS.map(id => [id, state.assignments[id] ?? null]));
  return { root: state.root, configPath: state.configPath, configRelativePath: state.configRelativePath,
    revision: state.revision, profile: detectModelProfile(assignments), assignments, migration: state.legacy, trackedAgentIds: state.manifest.tracked };
}

function nativeSelector(selector) {
  const [model, variant] = selector.split('#'), slash = model.indexOf('/');
  return { providerID: model.slice(0, slash), model: model.slice(slash + 1), ...(variant ? { variant } : {}) };
}
function updateConfig(raw, edits) {
  let text = raw;
  for (const { agentId, after } of edits) {
    const value = parseJSONC(text), model = value.agents?.[agentId]?.model;
    const before = readModel(model, agentId);
    if (before === after) continue;
    if (after === null) {
      if (model !== undefined) text = editJSONC(text, [{ path: ['agents', agentId, 'model'], value: undefined }]);
    } else text = upsertJSONC(text, [{ path: ['agents', agentId, 'model'], value: nativeSelector(after) }]);
  }
  return text;
}

export function planModelConfig({ homeDir = os.homedir(), env = process.env, profile = 'inherited', overrides = {}, catalog = [], expectedRevision, cleanupAgentIds = [], sourceTexts = new Map(), mergeComplementary = false, preserveAssignments = false } = {}) {
  const state = readConfig({ homeDir, env, sourceTexts, mergeComplementary });
  if (expectedRevision !== undefined && expectedRevision !== state.revision) throw new Error('La configuración cambió desde que se leyó; vuelve a consultar y reintenta.');
  for (const id of cleanupAgentIds) if (typeof id !== 'string' || !idRE.test(id)) throw new Error(`Agente fuera del alcance de limpieza: ${id}.`);
  const knownCurrent = Object.fromEntries(SOL_AGENT_IDS.map(id => [id, state.assignments[id]]));
  if (preserveAssignments && Object.keys(overrides).length) throw new Error('Para cambiar modelos especifica un perfil explícito.');
  const assignments = preserveAssignments ? knownCurrent : resolveModelAssignments({ profile, current: knownCurrent, overrides, catalog });
  if (preserveAssignments) profile = detectModelProfile(assignments);
  const ids = [...new Set([...state.agentIds, ...cleanupAgentIds])];
  const changes = preserveAssignments ? [] : ids.map(agentId => ({ agentId,
    before: own(state.assignments, agentId) ? state.assignments[agentId] : readModel(state.value.agents?.[agentId]?.model, agentId),
    after: SOL_AGENT_IDS.includes(agentId) ? assignments[agentId] : null })).filter(change => change.before !== change.after);
  const hasOverlay = sourceTexts instanceof Map ? sourceTexts.has(state.sourceRel) : own(sourceTexts || {}, state.sourceRel);
  const base = state.raw ?? '{\n  "$schema": "https://opencode.ai/config.json",\n}\n';
  const output = updateConfig(base, changes);
  const files = new Map();
  if (output !== base || state.legacy || hasOverlay) files.set(state.configRelativePath, output);
  const removals = state.legacy ? [state.jsonRel] : [];
  const expectedHashes = { [state.configRelativePath]: state.jsoncHash, [state.jsonRel]: state.jsonHash, [MANIFEST]: hashBytes(state.manifest.bytes) };
  return { homeDir: state.home, root: state.root, configPath: state.configPath, configRelativePath: state.configRelativePath,
    revision: state.revision, profile, preservedModels: preserveAssignments, assignments, changes, files, removals, expectedHashes,
    modelConfig: { path: state.configRelativePath, agentIds: preserveAssignments ? state.manifest.tracked.filter(id => state.assignments[id] != null) : SOL_AGENT_IDS.filter(id => assignments[id] !== null) }, migration: state.legacy };
}

function validatePlanPath(home, relative) {
  if (typeof relative !== 'string' || !relative || path.posix.isAbsolute(relative) || relative.split('/').some(x => !x || x === '.' || x === '..')) throw new Error('Ruta del plan inválida.');
  return safePath(home, relative);
}
function privateMkdir(home, relative) {
  const dir = validatePlanPath(home, relative);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  safePath(home, relative);
  fs.chmodSync(dir, 0o700);
  if ((fs.statSync(dir).mode & 0o777) !== 0o700) throw new Error(`No se pudo proteger el directorio privado: ${relative}`);
  return dir;
}

export function applyModelConfig(plan) {
  if (!plan || !(plan.files instanceof Map) || !plan.expectedHashes || !plan.modelConfig) throw new TypeError('Plan de modelos inválido.');
  const home = path.resolve(plan.homeDir || os.homedir());
  if (typeof plan.configRelativePath !== 'string' || !/^.+\/opencode\.jsonc$/.test(plan.configRelativePath) || plan.configRelativePath.split('/').some(part => !part || part === '.' || part === '..') || plan.modelConfig.path !== plan.configRelativePath || plan.configPath !== path.join(home, ...plan.configRelativePath.split('/')))
    throw new Error('Ruta de configuración nativa inválida en el plan.');
  const manifestPath = validatePlanPath(home, MANIFEST);
  const jsonRelativePath = plan.configRelativePath.slice(0, -'opencode.jsonc'.length) + 'opencode.json';
  const allowed = new Set([plan.configRelativePath, jsonRelativePath, MANIFEST]);
  if (!plan.expectedHashes[plan.configRelativePath] && plan.expectedHashes[plan.configRelativePath] !== null) throw new Error('El plan no protege la configuración JSONC esperada.');
  if (!own(plan.expectedHashes, jsonRelativePath) || !own(plan.expectedHashes, MANIFEST)) throw new Error('El plan no protege todas las rutas nativas de configuración.');
  for (const relative of [...Object.keys(plan.expectedHashes), ...plan.files.keys(), ...plan.removals])
    if (!allowed.has(relative)) throw new Error(`Ruta fuera del alcance del plan: ${relative}.`);
  const originals = new Map();
  for (const [relative, expected] of Object.entries(plan.expectedHashes)) {
    const bytes = readBytes(home, relative);
    if (hashBytes(bytes) !== expected) throw new Error(`El archivo cambió tras la planificación: ${relative}.`);
    originals.set(relative, bytes);
  }
  const manifestRead = parseManifest(home, true), manifest = manifestRead.data;
  const manifestOut = { ...manifest, modelConfig: { path: plan.modelConfig.path, agentIds: plan.modelConfig.agentIds } };
  const manifestText = JSON.stringify(manifestOut, null, 2) + '\n';
  const manifestRel = MANIFEST;
  const writes = new Map(plan.files);
  const oldMeta = manifest.modelConfig;
  const metadataUnchanged = oldMeta?.path === plan.modelConfig.path && Array.isArray(oldMeta.agentIds) && oldMeta.agentIds.length === plan.modelConfig.agentIds.length && oldMeta.agentIds.every((id, index) => id === plan.modelConfig.agentIds[index]);
  if (!metadataUnchanged) writes.set(manifestRel, manifestText);
  else writes.delete(manifestRel);
  if (!writes.size && !plan.removals.length) return { saved: true, changed: false, profile: plan.profile, configPath: plan.configPath, changes: [], migration: plan.migration, recovery: null, restartRequired: false };

  // Recheck immediately before creating backups or mutating any source.
  for (const [relative, expected] of Object.entries(plan.expectedHashes)) if (hashBytes(readBytes(home, relative)) !== expected) throw new Error(`El archivo cambió tras la planificación: ${relative}.`);
  const backupId = `models-${crypto.randomUUID()}`, backupRel = `.sol/backups/${backupId}`;
  privateMkdir(home, `${backupRel}/files`);
  const backups = [];
  try {
    const affected = new Set([...writes.keys(), ...plan.removals]);
    for (const relative of affected) {
      const bytes = originals.get(relative);
      if (bytes === null || bytes === undefined) continue;
      const backupPath = `${backupRel}/files/${relative}`;
      const backupFile = validatePlanPath(home, backupPath);
      fs.mkdirSync(path.dirname(backupFile), { recursive: true, mode: 0o700 });
      safePath(home, backupPath);
      atomicWrite(home, backupPath, bytes);
      fs.chmodSync(backupFile, 0o600);
      if ((fs.statSync(backupFile).mode & 0o777) !== 0o600) throw new Error(`No se pudo proteger el respaldo privado: ${backupPath}`);
      backups.push({ path: relative, backup: backupPath, sha256: digest(bytes) });
    }
    const recoveryRel = `${backupRel}/recovery.json`;
    atomicWrite(home, recoveryRel, JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), purpose: 'Sol model preferences recovery', files: backups }, null, 2) + '\n');
    fs.chmodSync(validatePlanPath(home, recoveryRel), 0o600);
    const touched = [];
    try {
      for (const relative of plan.removals) { const file = validatePlanPath(home, relative); if (readBytes(home, relative) !== null) { fs.unlinkSync(file); touched.push(relative); } }
      for (const [relative, text] of writes) { atomicWrite(home, relative, text); touched.push(relative); }
    } catch (cause) {
      const failures = [];
      for (const relative of touched.reverse()) {
        try { const bytes = originals.get(relative); if (bytes === null || bytes === undefined) fs.unlinkSync(validatePlanPath(home, relative)); else atomicWrite(home, relative, bytes); }
        catch (error) { failures.push(`${relative}: ${error.code || error.message}`); }
      }
      throw new Error(`No se pudieron guardar las preferencias. ${failures.length ? `Restauración parcial (${failures.join('; ')}). ` : 'Se restauraron los originales. '}Recuperación: ${path.join(home, recoveryRel)}`, { cause });
    }
    return { saved: true, changed: true, profile: plan.profile, configPath: plan.configPath, changes: plan.changes,
      migration: plan.migration, recovery: path.join(home, recoveryRel), restartRequired: true };
  } catch (error) {
    throw error;
  }
}
