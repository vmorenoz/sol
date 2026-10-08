import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// One snapshot per loaded module; disk installation is read again on each invocation.
export async function createVersionReader(hostVersion = "no disponible", surface = "servidor") {
  const { getSolVersionInfo, getInstalledSolVersionInfo } = await import(pathToFileURL(path.join(os.homedir(), ".sol", "lib", "version.mjs")).href)
  const loadedVersion = Object.freeze({ ...getSolVersionInfo() })
  return () => {
    let installed
    try { installed = getInstalledSolVersionInfo() }
    catch (error) { return `Sol cargado (${surface}): ${loadedVersion.version || "no disponible"} · build ${loadedVersion.buildHash || "no disponible"}\nInstalación actual: no legible (${error.message}).\nreloadRequired: unknown · no se pudo comparar. OpenCode: ${hostVersion}.` }
    const keys = ["version", "buildHash", "sourceCommit", "baseCommit"]
    const comparable = Boolean(installed && loadedVersion.buildHash && installed.buildHash)
    const knownDifference = installed && ["version", "sourceCommit", "baseCommit"].some(key => loadedVersion[key] && installed[key] && loadedVersion[key] !== installed[key])
    const reloadRequired = comparable ? keys.some(key => loadedVersion[key] !== installed[key]) : knownDifference ? true : null
    const describe = (value) => value ? `${value.version || "no disponible"} · build ${value.buildHash || "no disponible"} · commit ${value.sourceCommit || "no verificado"} · base ${value.baseCommit || "no disponible"}` : "sin manifiesto verificable"
    return `Sol cargado por esta instancia: ${describe(loadedVersion)}\nSuperficie identificada: ${surface}\nSol instalado actualmente: ${describe(installed)}\nOpenCode informado por el host: ${hostVersion}\nreloadRequired: ${reloadRequired === null ? "unknown" : reloadRequired}${reloadRequired === true ? " · recarga/reinicia OpenCode para cargar la instalación actual" : reloadRequired === null ? " · no se puede acreditar igualdad de builds" : " · coincide el payload identificado"}\nLa invocación identifica esta instancia; no certifica otras sesiones ni una aceptación live completa.`
  }
}
