import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { applyEdits, modify, parse } from "jsonc-parser";

interface InstalledFile { path: string; backup?: string; installedHash: string }
interface InstalledTui {
  configPath: string;
  fileExisted: boolean;
  previousText: string;
  previousPluginSpec?: string | undefined;
  installedPluginSpec: string;
  installedHash: string;
  pluginArrayExisted: boolean;
  owned: boolean;
}
interface InstallManifest {
  version: 2;
  installedAt: string;
  packageRoot: string;
  configPath: string;
  configBackup: string;
  pluginSpec: string;
  previousDefaultAgent?: string;
  mcp?: { previous?: unknown; installed: unknown; parentExisted: boolean };
  tui?: InstalledTui;
  files: InstalledFile[];
}

function packageRoot(): string { return resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."); }
function configRoot(): string { return process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode"); }
function manifestPath(): string { return join(configRoot(), "sol-install.json"); }
function findConfig(name = "opencode"): string {
  const json = join(configRoot(), `${name}.json`);
  const jsonc = join(configRoot(), `${name}.jsonc`);
  return existsSync(json) ? json : existsSync(jsonc) ? jsonc : json;
}
function setJsonProperty(text: string, path: (string | number)[], value: unknown): string {
  return applyEdits(text, modify(text, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readConfig(text: string, path: string): Record<string, unknown> {
  const errors: import("jsonc-parser").ParseError[] = [];
  const config: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !object(config)) throw new Error(`OpenCode config contains JSON errors or is not an object: ${path}`);
  if (config.mcp !== undefined && !object(config.mcp)) throw new Error(`OpenCode mcp config must be an object: ${path}`);
  return config;
}
function hash(path: string): string | undefined {
  if (!existsSync(path) || !statSync(path).isFile()) return undefined;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function unchanged(file: InstalledFile): boolean {
  return hash(file.path) === file.installedHash;
}
function readTui(text: string, path: string): Record<string, unknown> {
  const config = readConfig(text, path);
  if (config.plugin !== undefined && !Array.isArray(config.plugin)) throw new Error(`OpenCode TUI plugin config must be an array: ${path}`);
  return config;
}
// Restore the whole file only while we still own its exact bytes. Otherwise edit
// only our unique plugin entry; never infer ownership from a filename or prefix.
function restoreTui(tui: InstalledTui): void {
  if (!tui.owned || !existsSync(tui.configPath)) return;
  if (hash(tui.configPath) === tui.installedHash) {
    if (tui.fileExisted) writeFileSync(tui.configPath, tui.previousText, "utf8");
    else rmSync(tui.configPath);
    return;
  }
  let text = readFileSync(tui.configPath, "utf8");
  let config: Record<string, unknown>;
  try { config = readTui(text, tui.configPath); } catch { return; }
  const plugins = config.plugin;
  if (!Array.isArray(plugins) || plugins.filter((entry) => entry === tui.installedPluginSpec).length !== 1) return;
  const index = plugins.indexOf(tui.installedPluginSpec);
  text = setJsonProperty(text, ["plugin", index], tui.previousPluginSpec);
  if (!tui.pluginArrayExisted && plugins.length === 1 && tui.previousPluginSpec === undefined) text = setJsonProperty(text, ["plugin"], undefined);
  writeFileSync(tui.configPath, text, "utf8");
}
function readManifest(text: string): InstallManifest {
  const manifest: unknown = JSON.parse(text);
  if (!object(manifest) || manifest.version !== 2) {
    throw new Error(`Sol requires a v2 install manifest. Archive the existing installation and move or remove ${manifestPath()} before running a fresh v2 install.`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.some((file: unknown) =>
    !object(file) || typeof file.path !== "string" || typeof file.installedHash !== "string")) {
    throw new Error(`Invalid v2 install manifest: ${manifestPath()}; each file must record its path and installedHash.`);
  }
  if (manifest.tui !== undefined) {
    const tui = manifest.tui;
    if (!object(tui) || typeof tui.configPath !== "string" || typeof tui.previousText !== "string"
      || typeof tui.installedPluginSpec !== "string" || typeof tui.installedHash !== "string"
      || typeof tui.fileExisted !== "boolean" || typeof tui.pluginArrayExisted !== "boolean" || typeof tui.owned !== "boolean"
      || (tui.previousPluginSpec !== undefined && typeof tui.previousPluginSpec !== "string")) {
      throw new Error(`Invalid v2 install manifest TUI metadata: ${manifestPath()}`);
    }
  }
  return manifest as unknown as InstallManifest;
}
function renderAgent(source: string): string {
  return readFileSync(source, "utf8")
    .replaceAll("__SOL_PRIMARY_MODEL__", process.env.SOL_PRIMARY_MODEL ?? "openai/gpt-5.6-terra")
    .replaceAll("__SOL_EXECUTOR_MODEL__", process.env.SOL_EXECUTOR_MODEL ?? "openai/gpt-5.6-terra")
    .replaceAll("__SOL_REVIEW_MODEL__", process.env.SOL_REVIEW_MODEL ?? "openai/gpt-5.6-terra")
    .replaceAll("__SOL_LIGHT_MODEL__", process.env.SOL_LIGHT_MODEL ?? "openai/gpt-5.6-luna");
}
export function install(): InstallManifest {
  const root = packageRoot();
  for (const name of ["v2/plugin.js", "v2/mcp.js"]) {
    if (!existsSync(join(root, "dist", name))) throw new Error(`Build Sol v2 before installing: missing dist/${name}; run npm run build`);
  }
  const previousText = existsSync(manifestPath()) ? readFileSync(manifestPath(), "utf8") : undefined;
  const previous = previousText !== undefined ? readManifest(previousText) : undefined;
  const configDir = configRoot();
  const configPath = previous?.configPath ?? findConfig();
  const configExisted = existsSync(configPath);
  const original = configExisted ? readFileSync(configPath, "utf8") : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
  const config = readConfig(original, configPath);
  const tuiBefore = previous?.tui ? {
    path: previous.tui.configPath,
    existed: existsSync(previous.tui.configPath),
    text: existsSync(previous.tui.configPath) ? readFileSync(previous.tui.configPath, "utf8") : undefined,
  } : undefined;
  const backupRoot = join(configDir, "sol-backups", `${Date.now()}-${process.hrtime.bigint()}`);
  mkdirSync(backupRoot, { recursive: true });
  const configBackup = join(backupRoot, basename(configPath));
  writeFileSync(configBackup, original, "utf8");
  if (tuiBefore?.text !== undefined) writeFileSync(join(backupRoot, `pre-upgrade-${basename(tuiBefore.path)}`), tuiBefore.text, "utf8");
  const pluginSpec = pathToFileURL(join(root, "dist", "v2", "plugin.js")).href;
  const installedMcp = { type: "local", command: [process.execPath, join(root, "dist", "v2", "mcp.js")], enabled: true };
  const currentMcp = object(config.mcp) ? config.mcp.sol : undefined;
  const mcp = previous?.mcp ? { ...previous.mcp } : { previous: currentMcp, installed: installedMcp, parentExisted: config.mcp !== undefined };
  let updated = original;
  if (!previous || config.default_agent === "sol") updated = setJsonProperty(updated, ["default_agent"], "sol");
  if (!previous?.mcp || isDeepStrictEqual(currentMcp, previous.mcp.installed)) {
    updated = setJsonProperty(updated, ["mcp", "sol"], installedMcp);
    mcp.installed = installedMcp;
  }
  const files: InstalledFile[] = previous ? previous.files.map((file) => ({ ...file })) : [];
  const rollback: { path: string; backup?: string }[] = [];
  const put = (destination: string, contents: string | Uint8Array): void => {
    const old = files.find((file) => file.path === destination);
    if (old && !unchanged(old)) return;
    const before = existsSync(destination) ? join(backupRoot, "rollback", relative(configDir, destination)) : undefined;
    if (before) {
      mkdirSync(dirname(before), { recursive: true });
      cpSync(destination, before, { recursive: true });
    }
    rollback.push({ path: destination, ...(before ? { backup: before } : {}) });
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, contents, "utf8");
    const installedHash = hash(destination)!;
    const record = old ?? { path: destination, installedHash, ...(before ? { backup: before } : {}) };
    record.installedHash = installedHash;
    if (!old) files.push(record);
  };
  try {
    // v2.1 upgrades remove only the registration owned by the previous manifest.
    if (previous?.tui) restoreTui(previous.tui);
    writeFileSync(configPath, updated.endsWith("\n") ? updated : `${updated}\n`, "utf8");
    const retiredMappers = new Set(["architecture", "conventions", "patterns", "business", "design", "index", "entrypoint"]
      .map((name) => join(configDir, "agents", `sol-${name}-mapper.md`)));
    for (let index = files.length - 1; index >= 0; index--) {
      const file = files[index]!;
      if (!retiredMappers.has(file.path)) continue;
      if (unchanged(file)) {
        const before = join(backupRoot, "rollback", relative(configDir, file.path));
        mkdirSync(dirname(before), { recursive: true });
        cpSync(file.path, before);
        rollback.push({ path: file.path, backup: before });
        rmSync(file.path);
        if (file.backup && existsSync(file.backup)) cpSync(file.backup, file.path);
      }
      files.splice(index, 1);
    }
    put(join(configDir, "plugins", "sol.js"), `module.exports = {\n  id: "sol",\n  async server(input, options) {\n    const plugin = await import(${JSON.stringify(pluginSpec)});\n    options = { nodeExecutable: ${JSON.stringify(process.execPath)}, ...options };\n    return plugin.SolPlugin(input, options);\n  },\n};\n`);
    const agentSource = join(root, "assets", "agents");
    for (const name of readdirSync(agentSource).filter((name) => name.endsWith(".md"))) {
      put(join(configDir, "agents", name), renderAgent(join(agentSource, name)));
    }
    const copySkills = (source: string, destination: string): void => {
      for (const name of readdirSync(source)) {
        const path = join(source, name);
        if (statSync(path).isDirectory()) copySkills(path, join(destination, name));
        else put(join(destination, name), readFileSync(path));
      }
    };
    copySkills(join(root, "assets", "skills"), join(configDir, "skills"));
    const manifest: InstallManifest = {
      version: 2, installedAt: new Date().toISOString(), packageRoot: root,
      configPath, configBackup, pluginSpec, mcp,
      ...(previous?.previousDefaultAgent !== undefined ? { previousDefaultAgent: previous.previousDefaultAgent }
        : !previous && typeof config.default_agent === "string" ? { previousDefaultAgent: config.default_agent } : {}),
      files,
    };
    writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2), "utf8");
    return manifest;
  } catch (error) {
    if (tuiBefore) {
      if (tuiBefore.existed) writeFileSync(tuiBefore.path, tuiBefore.text!, "utf8");
      else rmSync(tuiBefore.path, { force: true });
    }
    if (configExisted) writeFileSync(configPath, original, "utf8");
    else rmSync(configPath, { force: true });
    for (const file of rollback.reverse()) {
      rmSync(file.path, { recursive: true, force: true });
      if (file.backup) cpSync(file.backup, file.path, { recursive: true });
    }
    if (previousText) writeFileSync(manifestPath(), previousText, "utf8");
    else rmSync(manifestPath(), { force: true });
    rmSync(backupRoot, { recursive: true, force: true });
    throw error;
  }
}

export function uninstall(): { removed: number; configPath: string } {
  if (!existsSync(manifestPath())) throw new Error("Sol install manifest not found");
  const manifest = readManifest(readFileSync(manifestPath(), "utf8"));
  if (manifest.tui) restoreTui(manifest.tui);
  if (existsSync(manifest.configPath)) {
    let text = readFileSync(manifest.configPath, "utf8");
    const config = readConfig(text, manifest.configPath);
    if (config.default_agent === "sol") text = setJsonProperty(text, ["default_agent"], manifest.previousDefaultAgent);
    if (manifest.mcp && object(config.mcp) && isDeepStrictEqual(config.mcp.sol, manifest.mcp.installed)) {
      text = setJsonProperty(text, ["mcp", "sol"], manifest.mcp.previous);
      const remaining = (parse(text) as Record<string, unknown>).mcp;
      if (!manifest.mcp.parentExisted && object(remaining) && !Object.keys(remaining).length) text = setJsonProperty(text, ["mcp"], undefined);
    }
    writeFileSync(manifest.configPath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  }
  let removed = 0;
  for (const file of manifest.files) {
    if (!unchanged(file)) continue;
    rmSync(file.path, { recursive: true, force: true });
    if (file.backup && existsSync(file.backup)) cpSync(file.backup, file.path, { recursive: true });
    removed++;
  }
  rmSync(manifestPath());
  return { removed, configPath: manifest.configPath };
}

export function doctor(): Record<string, unknown> {
  const root = packageRoot();
  const configPath = findConfig();
  const config = existsSync(configPath) ? readConfig(readFileSync(configPath, "utf8"), configPath) : {};
  return {
    node: process.version, packageRoot: root,
    build: ["v2/plugin.js", "v2/mcp.js"].every((name) => existsSync(join(root, "dist", name))),
    configPath, installed: existsSync(manifestPath()), defaultAgent: config.default_agent,
    pluginConfigured: existsSync(join(configRoot(), "plugins", "sol.js")),
    mcpConfigured: isDeepStrictEqual(object(config.mcp) ? config.mcp.sol : undefined,
      { type: "local", command: [process.execPath, join(root, "dist", "v2", "mcp.js")], enabled: true }),
    agents: existsSync(join(configRoot(), "agents", "sol.md")),
    skills: existsSync(join(configRoot(), "skills", "sol-existing-project", "SKILL.md")),
  };
}
