import { createVersionReader } from "./version-view.mjs"

// Structural contract from https://opencode.ai/v2/docs/build/plugins/cli/.
// No client, session, prompt, synthetic message or generation capability is used.
type VersionCommand = {
  id: string; title: string; group: string; palette: boolean
  slash: { name: string }
  run(): Promise<void>
}
type OpenCodeCLIContext = {
  app?: { version: string }
  keymap: { layer(factory: () => { mode: "global"; commands: VersionCommand[] }): unknown }
  ui: { dialog: { alert(input: { title: string; message: string }): Promise<unknown> } }
}

export default {
  id: "sol.cli",
  async setup(ctx: OpenCodeCLIContext) {
    const readVersion = await createVersionReader(ctx.app?.version, "CLI local; no acredita el plugin de un servidor remoto")
    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "sol.version", title: "Versión de Sol", group: "Sol", palette: true,
        slash: { name: "sol-version" },
        async run() {
          await ctx.ui.dialog.alert({ title: "Sol · versión", message: readVersion() })
        },
      }],
    }))
  },
}
