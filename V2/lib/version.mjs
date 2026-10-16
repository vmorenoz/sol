import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safePath, sha256 } from './fs.mjs';

function versionInfo(value) {
  if (!value || typeof value !== 'object' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value.version))
    throw new Error('Identidad de versión de Sol no reconocida.');
  for (const field of ['sourceCommit', 'baseCommit'])
    if (value[field] !== undefined && value[field] !== null && !/^[a-f0-9]{40}$/.test(value[field]))
      throw new Error('Identidad de origen de Sol no reconocida.');
  if (value.buildHash !== undefined && value.buildHash !== null && !/^[a-f0-9]{64}$/.test(value.buildHash))
    throw new Error('Identidad de build de Sol no reconocida.');
  return Object.freeze({ version: value.version, buildHash: value.buildHash ?? null, sourceCommit: value.sourceCommit ?? null, baseCommit: value.baseCommit ?? null });
}
function readIdentity(file, manifest = false) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (manifest && (value?.schemaVersion !== 1 || !value.files || typeof value.files !== 'object' || Array.isArray(value.files)))
      throw new Error('Manifest de instalación no reconocido.');
    return versionInfo(value);
  }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('No se pudo leer una identidad válida de Sol.', { cause: error }); }
}
// Capture at module load, never refresh this identity from disk on a tool call.
// A new file on disk does not prove that OpenCode reloaded its module cache.
const loaded = readIdentity(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../release.json'));
if (!loaded) throw new Error('Falta release.json de Sol. Reinstala desde una distribución completa.');
export const VERSION = loaded.version;
export function getSolVersionInfo() { return loaded; }
export function getInstalledSolVersionInfo({ homeDir = os.homedir() } = {}) {
  return readIdentity(safePath(path.resolve(homeDir), '.sol/installation.json'), true);
}
export function createSolBuildInfo(files) {
  if (!(files instanceof Map)) throw new TypeError('El payload de Sol debe ser un Map.');
  // The generated release and installation manifests are deliberately excluded.
  const entries = [...files].filter(([file]) => !['.sol/release.json', '.sol/installation.json'].includes(file))
    .map(([file, data]) => [file, sha256(data)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return versionInfo({ ...loaded, buildHash: sha256(JSON.stringify({ version: loaded.version, sourceCommit: loaded.sourceCommit, baseCommit: loaded.baseCommit, files: entries })) });
}
