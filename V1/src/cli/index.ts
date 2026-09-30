#!/usr/bin/env node
import { doctor, install, uninstall } from "./installer.js";
import { generateMedia } from "../media/generator.js";
import type { MediaKind } from "../media/types.js";
import { SolCore, planTemplates } from "../v2/core.js";
import { SessionStore } from "../v2/session-store.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const command = process.argv[2] ?? "doctor";

try {
  if (command === "install") {
    const result = install();
    console.log(`Sol installed for OpenCode. Default agent: sol\nConfig: ${result.configPath}\nRestart OpenCode to activate it.`);
  } else if (command === "uninstall") {
    const result = uninstall();
    console.log(`Sol removed (${result.removed} managed files).\nConfig: ${result.configPath}\nRestart OpenCode to apply it.`);
  } else if (command === "doctor") {
    console.log(JSON.stringify(doctor(), null, 2));
  } else if (command === "status" || command === "plans") {
    const core = new SolCore(option("--project") ?? process.cwd(), option("--database"));
    try {
      const value = command === "status" ? core.digest(option("--plan")) : core.listPlans().map(plan => ({
        id: plan.id, title: plan.draft.title, revision: plan.revision, status: plan.status,
      }));
      console.log(JSON.stringify(value, null, 2));
    } finally { core.close(); }
  } else if (command === "templates") {
    const name = option("--template") ?? "fast";
    if (!(name in planTemplates)) throw new Error("Unknown template; choose fast, standard, investigation, critical or release");
    console.log(JSON.stringify(planTemplates[name as keyof typeof planTemplates](), null, 2));
  } else if (command === "metrics") {
    const store = new SessionStore(option("--database"));
    try { console.log(JSON.stringify(store.usage(option("--project") ?? process.cwd()), null, 2)); }
    finally { store.close(); }
  } else if (command === "media" && process.argv[3] === "create") {
    const prompt = option("--prompt");
    const outputPath = option("--output");
    const kind = option("--kind");
    const aspectRatio = option("--aspect");
    if (!prompt || !outputPath || (kind && kind !== "image" && kind !== "video")) {
      throw new Error("Usage: sol media create --prompt <prompt> --output <path> [--kind image|video] [--aspect 1:1|16:9|9:16]");
    }
    const result = await generateMedia({ prompt, outputPath, ...(kind ? { kind: kind as MediaKind } : {}), ...(aspectRatio ? { aspectRatio } : {}) });
    console.log(JSON.stringify(result));
    if (!result.success) process.exitCode = 1;
  } else {
    console.error("Usage: sol <install|uninstall|doctor|status|plans|templates|metrics|media>");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
