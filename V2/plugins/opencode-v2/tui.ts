import { createVersionReader } from "./version-view.mjs"
import { createInitDispatcher } from "./init-dispatch.mjs"
import { createPermissionPresenter } from "./permission-ui.mjs"
import { createInitSessionResolver } from "./init-session.mjs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// Structural contract from https://opencode.ai/v2/docs/build/plugins/cli/.
// Version remains read-only. Init uses the native CLI client (OpenCode v2.0.29
// source contract), never starts another host and verifies a shared filesystem.
type VersionCommand = {
  id: string; title: string; group: string; palette: boolean
  slash?: { name: string; arguments?: boolean }
  run(input?: string): Promise<void>
}
type OpenCodeCLIContext = {
  app?: { version: string }
  keymap: { layer(factory: () => { mode: "global"; commands: VersionCommand[] }): unknown }
  client?: any
  data?: any
  ui: { router?: { current(): unknown }; dialog: { alert(input: { title: string; message: string }): Promise<unknown>; select?: any; confirm?: any } }
}

/**
 * OpenCode v2 routes identify sessions as {type: "session", sessionID}.
 * Keep the legacy structural form for compatible hosts; the dispatcher checks
 * the actual server-side agent before any init mutation.
 */
export function sessionIDFromRoute(route: unknown): string | undefined {
  if (!route || typeof route !== "object") return undefined
  const value = route as { name?: unknown; params?: { sessionID?: unknown }; type?: unknown; sessionID?: unknown }
  if (value.name === "session" && typeof value.params?.sessionID === "string") return value.params.sessionID
  if (value.type === "session" && typeof value.sessionID === "string") return value.sessionID
  return undefined
}

export default {
  id: "sol.cli",
  async setup(ctx: OpenCodeCLIContext) {
    const readVersion = await createVersionReader(ctx.app?.version, "CLI local; no acredita el plugin de un servidor remoto")
    const permissions = createPermissionPresenter(ctx)
    const resolveInitSession = createInitSessionResolver({client:ctx.client,router:ctx.ui.router,location:()=>ctx.location??ctx.data.location.default()})
    let dispatcher: ReturnType<typeof createInitDispatcher> | undefined
    const init = async () => {
      if (dispatcher) return dispatcher
      if (!ctx.client || !ctx.data?.on || !ctx.ui.dialog.select || !ctx.ui.dialog.confirm) throw new Error("Este host no expone el cliente y los diálogos CLI nativos requeridos por init.")
      const base = path.join(os.homedir(), ".sol", "lib")
      const core = await import(pathToFileURL(path.join(base, "init.mjs")).href)
      const tracking = await import(pathToFileURL(path.join(base, "artifact-tracking.mjs")).href)
      dispatcher = createInitDispatcher({ ctx, core, tracking })
      return dispatcher
    }
    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "sol.version", title: "Versión de Sol", group: "Sol", palette: true,
        slash: { name: "sol-version" },
        async run() {
          await ctx.ui.dialog.alert({ title: "Sol · versión", message: readVersion() })
        },
      }, {
        id: "sol.init", title: "Inicializar contexto Sol", group: "Sol", palette: true,
        slash: { name: "sol-init", arguments: true },
        async run(input = "") {
          try {
            const sessionID = await resolveInitSession(ctx.ui.router?.current())
            const dispatcher = await init()
            if (sessionIDFromRoute(ctx.ui.router?.current()) !== sessionID) throw new Error("La navegación cambió durante /sol-init; no se inició el despacho.")
            const result = await dispatcher.run(sessionID, input)
            if (result.status === "already-complete") await ctx.ui.dialog.alert({ title: "Sol · init", message: `${result.workId}: ya recibido o integrado; no se relanzaron exploradores.` })
          } catch (error) { await ctx.ui.dialog.alert({ title: "Sol · init detenido", message: (error as Error).message }) }
        },
      }, {
        id: "sol.init.cancel", title: "Cancelar init y sus exploradores", group: "Sol", palette: true,
        async run() {
          try {
            const sessionID = sessionIDFromRoute(ctx.ui.router?.current())
            if (!sessionID) throw new Error("La cancelación de init requiere abrir su sesión Sol.")
            dispatcher?.cancel(sessionID)
          }
          catch (error) { await ctx.ui.dialog.alert({ title: "Sol · init", message: (error as Error).message }) }
        },
      }],
    }))
    return () => { dispatcher?.dispose(); permissions.dispose() }
  },
}
