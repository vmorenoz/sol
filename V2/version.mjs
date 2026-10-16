#!/usr/bin/env node
import { getSolVersionInfo, getInstalledSolVersionInfo } from './lib/version.mjs';

try {
  const loaded = getSolVersionInfo(), installed = getInstalledSolVersionInfo();
  console.log(JSON.stringify({ process: 'sol-version-cli', loaded, installed,
    note: 'Esta consulta identifica este proceso CLI y los archivos instalados. Para conocer el plugin cargado en OpenCode usa /sol-version; reiniciar y volver a consultar es necesario después de actualizar.' }, null, 2));
} catch (error) { console.error(`[ERROR] ${error.message}`); process.exitCode = 1; }
