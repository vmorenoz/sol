import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import { pathToFileURL } from "node:url"
import { createPermissionBridge } from "./permission-bridge.mjs"
import { createVersionReader } from "./version-view.mjs"
import { formatStatusPage, formatWorkView, pageBounds, workSections } from "./work-views.mjs"

// Narrow structural surface from the official OpenCode v2 documentation (2026-10-08).
// This is not a claim that a published SDK version or a live host has been tested.
type WorkQuery = { section?: string; offset?: number; limit?: number; itemId?: string; taskId?: string; criterionId?: string }
type NativeSession = { agent?: string; metadata?: Record<string, unknown>; id?: string; sessionID?: string; location?: { directory?: string }; model?: { providerID: string; id: string; variant?: string } }
type NativeModel = { providerID: string; id: string; name?: string; enabled: boolean; status: string; variants?: readonly { id: string }[] }
type NativeToolContext = { sessionID: string; agent: string; id: string; messageID: string; signal: AbortSignal }
type NativeTool = { name: string; options?: { permission: string }; description: string; input: unknown; execute(input: unknown, context: NativeToolContext): Promise<{ content: string }> }
type NativeToolEditor = { add(tool: NativeTool): void }
type OpenCodeV2Context = {
  rpc?: any
  event?: any
  app?: { version: string }
  tool: { transform(edit: (editor: NativeToolEditor) => void): Promise<unknown> }
  session: { get(input: { sessionID: string }): Promise<NativeSession> }
  permission: { hook(name: "evaluate", callback: (event: { sessionID: string; action: string; resources: readonly string[]; effect: string; message?: string }) => Promise<void>): Promise<unknown> }
  model: { list(input: { location: { directory: string } }): Promise<{ data: readonly NativeModel[] }> }
}

const solRoot = path.join(os.homedir(), ".sol", "lib")
const core = async (name: string) => import(pathToFileURL(path.join(solRoot, name)).href)
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object", properties, required, additionalProperties: false,
})
const string = (description: string, maxLength = 4000) => ({ type: "string", description, maxLength })
const id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$" }
const list = (items: unknown, maxItems = 50) => ({ type: "array", items, maxItems })
const updateSchema = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".sol", "schemas", "work-update.schema.json"), "utf8"))
const workSchema = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".sol", "schemas", "work.schema.json"), "utf8"))
// Keep the complete schema root so local $defs/$ref stay resolvable in OpenCode's tool schema.
const workUpdateToolSchema = structuredClone(updateSchema)
const privateApprovalAction = "shipping.approval.record"

function resolveLocalRef(root: any, ref: string): any {
  if (!ref.startsWith("#/")) return undefined
  return ref.slice(2).split("/").map((part: string) => part.replaceAll("~1", "/").replaceAll("~0", "~")).reduce((value: any, part: string) => value?.[part], root)
}
function enumStrings(schema: any, root: any, seen = new Set<any>()): string[] {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return []
  seen.add(schema)
  const values = [...(typeof schema.const === "string" ? [schema.const] : []), ...(Array.isArray(schema.enum) ? schema.enum.filter((value: unknown) => typeof value === "string") : [])]
  if (typeof schema.$ref === "string") values.push(...enumStrings(resolveLocalRef(root, schema.$ref), root, seen))
  for (const keyword of ["anyOf", "oneOf"]) for (const alternative of schema[keyword] || []) values.push(...enumStrings(alternative, root, seen))
  return [...new Set(values)]
}
function actionKinds(branch: any, root: any, seen = new Set<any>()): string[] {
  if (!branch || typeof branch !== "object" || seen.has(branch)) return []
  seen.add(branch)
  const values = enumStrings(branch.properties?.type, root)
  if (typeof branch.$ref === "string") values.push(...actionKinds(resolveLocalRef(root, branch.$ref), root, seen))
  for (const keyword of ["anyOf", "oneOf"]) for (const alternative of branch[keyword] || []) values.push(...actionKinds(alternative, root, seen))
  return [...new Set(values)]
}
function closedObjectSchemas(node: any, root: any, seen = new Set<any>()): boolean {
  if (!node || typeof node !== "object" || seen.has(node)) return true
  seen.add(node)
  if (typeof node.$ref === "string") {
    const target = resolveLocalRef(root, node.$ref)
    if (!target || !closedObjectSchemas(target, root, seen)) return false
  }
  if (node.type === "object" && node.additionalProperties !== false) return false
  for (const child of Object.values(node.properties || {})) if (!closedObjectSchemas(child, root, seen)) return false
  if (node.items && !closedObjectSchemas(node.items, root, seen)) return false
  for (const keyword of ["anyOf", "oneOf"]) for (const child of node[keyword] || []) if (!closedObjectSchemas(child, root, seen)) return false
  return true
}
function resolveActionUnion(root: any): any {
  let item = root?.properties?.actions?.items
  const seen = new Set<any>()
  while (item && typeof item === "object" && item.$ref) {
    if (seen.has(item)) throw new Error("Referencia cíclica en schema de acciones")
    seen.add(item)
    item = resolveLocalRef(root, item.$ref)
  }
  if (!item || typeof item !== "object") throw new Error("Schema de work-update sin items de acciones")
  const keyword = ["oneOf", "anyOf"].find(key => Array.isArray(item[key]))
  if (!keyword) throw new Error("Schema de work-update sin unión tipada de acciones")
  return { schema: item, keyword }
}
function makePublicWorkUpdateSchema(root: any): any {
  const exposed = structuredClone(root)
  const { schema, keyword } = resolveActionUnion(exposed)
  let foundPrivate = false
  const branches: any[] = []
  for (const branch of schema[keyword]) {
    const kinds = actionKinds(branch, exposed)
    if (kinds.includes(privateApprovalAction)) foundPrivate = true
    // The canonical schema retains a legacy multi-discriminator branch for a few
    // actions. Never expose that permissive branch directly: expand its missing
    // actions into individually discriminated, closed input contracts instead.
    if (kinds.length !== 1) continue
    if (kinds[0] === privateApprovalAction) continue
    if (!closedObjectSchemas(branch, exposed)) throw new Error(`Acción pública ${kinds[0]} tiene objetos no cerrados`)
    branches.push(branch)
  }
  const legacy = schema[keyword].find((branch: any) => actionKinds(branch, exposed).length > 1)
  if (legacy) {
    const legacyKinds = actionKinds(legacy, exposed)
    const explicitKinds = new Set(branches.flatMap((item: any) => actionKinds(item, exposed)))
    const task = workSchema.properties.tasks.items
    const inputTask = {
      type: "object", additionalProperties: false,
      required: task.required.filter((key: string) => key !== "contractRevision"),
      properties: Object.fromEntries(task.required.filter((key: string) => key !== "contractRevision").concat("kind").map((key: string) => [key, task.properties[key]])),
    }
    const evidence = workSchema.properties.evidence.items
    const inputEvidence = {
      type: "object", additionalProperties: false,
      required: evidence.required.filter((key: string) => !["checkedAt", "contractBindings", "criterionIds", "command", "exitCode"].includes(key)),
      properties: Object.fromEntries(["id", "kind", "status", "criterionIds", "taskIds", "report", "command", "cwd", "exitCode", "basis", "summary"].map(key => [key, evidence.properties[key]]).concat([["files", { type: "array", minItems: 1, maxItems: 50, items: { type: "string", minLength: 1 } }]])),
    }
    const inputByKind: Record<string, { key: string; value: any; required: string[] }> = {
      "task.add": { key: "task", value: inputTask, required: ["type", "task"] },
      "evidence.add": { key: "evidence", value: inputEvidence, required: ["type", "evidence"] },
    }
    for (const kind of legacyKinds) {
      if (explicitKinds.has(kind) || kind === privateApprovalAction) continue
      const input = inputByKind[kind]
      if (!input) continue
      branches.push({
        type: "object", additionalProperties: false, required: input.required,
        properties: { type: { const: kind }, [input.key]: input.value },
      })
    }
  }
  if (!foundPrivate) throw new Error("Schema de work-update sin variante privada shipping.approval.record")
  if (!branches.length) throw new Error("Schema público de mutaciones sin acciones tipadas")
  schema[keyword] = branches
  return exposed
}
const publicWorkUpdateToolSchema = makePublicWorkUpdateSchema(workUpdateToolSchema)

export default {
  id: "sol",
  async setup(ctx: OpenCodeV2Context) {
    const readVersion = await createVersionReader(ctx.app?.version)
    const permissionBridge = await createPermissionBridge(ctx)
    // This hook only narrows the host decision; it cannot grant permissions.
    await ctx.permission.hook("evaluate", async event => {
      if (!["edit", "subagent"].includes(event.action)) return
      const session = await ctx.session.get({ sessionID: event.sessionID })
      const init = session.metadata?.solInit as { output?: string } | undefined
      if (!init) return
      const directory = session.location?.directory
      const allowed = typeof directory === "string" && path.isAbsolute(directory) && typeof init.output === "string"
        ? path.resolve(directory, init.output) : undefined
      if (event.action === "subagent" || !allowed || event.resources.some(resource => path.resolve(directory!, resource) !== allowed)) {
        event.effect = "deny"
        event.message = "El mapeo inicial solo puede escribir el artefacto de exploración asignado."
      }
    })

    const register = (editor: NativeToolEditor, name: string, description: string, input: unknown, run: (args: any, root: string, session: NativeSession, assertActive: () => void) => Promise<string>) => {
      editor.add({ name, options: { permission: name }, description, input, async execute(args: unknown, context: NativeToolContext) {
        try {
          const assertActive = () => { permissionBridge.assertActive(); if (context?.signal?.aborted) throw new Error("Operación cancelada; no se iniciaron nuevos cambios.") }
          assertActive()
          if (context?.agent !== "sol") throw new Error("Esta herramienta requiere el agente Sol principal; no se modificó ningún archivo.")
          if (!context?.sessionID) throw new Error("OpenCode no proporcionó la sesión actual; no se modificó ningún archivo.")
          const session = await ctx.session.get({ sessionID: context.sessionID })
          assertActive()
          const activeDirectory = session.location?.directory
          if (typeof activeDirectory !== "string" || !path.isAbsolute(activeDirectory)) throw new Error("OpenCode no proporcionó el directorio de esta sesión; no se modificó ningún archivo.")
          if (name === "sol_ship_authorize" || (["sol_config_apply", "sol_artifacts_set"].includes(name) && (args as any)?.dryRun === false)) {
            await permissionBridge.authorize({ action: name, input: args, resources: [path.resolve(activeDirectory)], context })
            assertActive()
          }
          return { content: await run(args, path.resolve(activeDirectory), { ...session, sessionID: context.sessionID }, assertActive) }
        }
        catch (error) { return { content: `No se completó ${name}: ${(error as Error).message}` } }
      } })
    }
    const readinessSummary = async (work: any, taskId?: string) => {
      const { deriveWorkReadiness, deriveTaskReadiness } = await core("contracts.mjs")
      const globalReadiness = deriveWorkReadiness(work)
      const readiness = taskId ? deriveTaskReadiness(work, taskId) : globalReadiness
      const pending = readiness.implementationReasons || []
      const reasons = pending.length ? pending.slice(0, 10).join("; ") + (pending.length > 10 ? `; ${pending.length - 10} motivos más: consulta secciones questions, assumptions, decisions y pendingDecisions` : "") : "ninguna"
      return `${taskId ? `Ámbito de implementación: ${taskId} y dependencias · tarea habilitada: ${readiness.ready ? "sí" : "no"}\n` : "Ámbito de implementación: global; consulta taskId para una rama independiente\n"}Discovery para implementar: ${readiness.implementationReady ? "sin pendientes" : "pendiente"}\nDiscovery para cerrar: ${globalReadiness.completionReady ? "sin pendientes" : "pendiente"} (Work completo)\nAclaración: No acredita tareas, evidencia ni aceptación del cierre\nMotivos: ${reasons}\nSkills sugeridas (no cargadas automáticamente): ${(readiness.suggestedSkills || []).join(", ") || "ninguna"}`
    }
    await ctx.tool.transform((editor: NativeToolEditor) => {
      // Version diagnosis is intentionally independent of workspace/session state.
      editor.add({ name: "sol_version", description: "Identifica el payload cargado por esta instancia y la instalación actual; indica si requiere recarga.", input: object({}, []), async execute() {
        return { content: readVersion() }
      } })
      register(editor, "sol_workspace_prepare", "Inicializa el espacio Sol del workspace activo; conserva cualquier dato existente.", object({}, []), async (_args, root, _session, assertActive) => {
        const { prepareWorkspace } = await core("workspace.mjs");
        assertActive(); const result = prepareWorkspace(root)
        return result.existingWorkspace ? "Sol ya estaba preparado; no se modificaron los datos existentes." : "✓ Sol preparó el workspace con estado, historial y documentos base."
      })
      const pagination = { offset: { type: "integer", minimum: 0, default: 0 }, limit: { type: "integer", minimum: 1, maximum: 20, default: 10 } }
      register(editor, "sol_status", "Consulta todos los frentes del índice compacto por páginas; el foco no oculta otros trabajos.", object(pagination, []), async ({ offset = 0, limit = 10 }, root) => {
        pageBounds(offset, limit)
        if (!fs.existsSync(path.join(root, ".sol", "state.json"))) return "Sol no está preparado en este workspace; un encargo acotado puede continuar sin estado persistente. Prepara solo si el trabajo requiere continuidad persistente."
        const { readStatus } = await core("work-mutations.mjs")
        return formatStatusPage(readStatus(root), offset, limit)
      })
      register(editor, "sol_work_get", "Consulta metadata de un Work por sección y página; itemId recupera un registro completo, taskId/criterionId seleccionan alcance. No abre archivos referenciados.", object({ workId: id, section: { enum: workSections, default: "summary" }, ...pagination, itemId: string("ID del registro o path del documento para detalle completo", 1000), taskId: id, criterionId: id }, ["workId"]), async ({ workId, ...query }: WorkQuery & { workId: string }, root) => {
        const { readWork } = await core("artifacts.mjs")
        const work = readWork(root, workId, { files: false })
        const { deriveTaskReadiness } = await core("contracts.mjs")
        const scope = query.taskId ? deriveTaskReadiness(work, query.taskId) : undefined
        const view = formatWorkView(work, query, scope)
        return [view, ...(!query.section || query.section === "summary" || query.section === "discovery" || query.taskId ? [await readinessSummary(work, query.taskId)] : [])].join("\n")
      })
      register(editor, "sol_work_create", "Crea un trabajo Sol con objetivo, criterio verificable y prioridad.", object({ workId: id, title: string("Título", 240), objective: string("Resultado esperado"), criterion: string("Criterio de aceptación"), verification: string("Método de verificación"), priority: { enum: workSchema.properties.priority.enum } }, ["workId", "title", "objective", "criterion", "verification"]), async (args, root, _session, assertActive) => {
        const { createWorkOperation } = await core("work-mutations.mjs"); const { formatReceipt } = await core("receipts.mjs"); assertActive(); return formatReceipt(createWorkOperation(root, args))
      })
      register(editor, "sol_work_apply", "Aplica hasta 20 cambios semánticos tipados en una sola revisión de Work. No acepta JSON completo ni acciones desconocidas.", publicWorkUpdateToolSchema, async (args, root, _session, assertActive) => {
        // A user-reported approval record is documentary metadata, never native authorization.
        // Guard here as well as in the exposed schema: a fixture may invoke execute directly.
        if (Array.isArray(args?.actions) && args.actions.some((action: any) => action?.type === privateApprovalAction)) throw new Error("shipping.approval.record no está disponible mediante sol_work_apply; requiere autorización nativa dedicada.")
        const { applyWorkMutation } = await core("work-mutations.mjs"); const { formatReceipt } = await core("receipts.mjs"); assertActive(); const receipt = applyWorkMutation(root, args); const { readWork } = await core("artifacts.mjs"); const work = readWork(root, args.workId, { files: false }); return `${formatReceipt(receipt)}\n${await readinessSummary(work)}`
      })
      const shipRequestSchema = object({
        id: { ...id }, repository: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" }, remote: { type: "string", minLength: 1, maxLength: 200 }, branch: { type: "string", minLength: 1, maxLength: 300 }, base: { type: "string", minLength: 1, maxLength: 300 },
        title: { type: "string", minLength: 1, maxLength: 300 }, body: { type: "string", maxLength: 10000 }, commitMessage: { type: "string", minLength: 1, maxLength: 1000 },
        actions: { type: "array", minItems: 1, maxItems: 3, items: { enum: ["create_commit", "push_branch", "create_pr"] } }, expectedPaths: { type: "array", minItems: 0, maxItems: 500, items: { type: "string", minLength: 1 } }, includedCommitShas: { type: "array", maxItems: 100, items: { type: "string", pattern: "^[a-f0-9]{40,64}$" } },
      }, ["repository", "remote", "branch", "base", "title", "body", "commitMessage", "actions", "expectedPaths", "includedCommitShas"])
      const shipPreflightInput = object({ workId: id, expectedRevision: { type: "integer", minimum: 1 }, request: shipRequestSchema }, ["workId", "expectedRevision", "request"])
      const shipAuthorizeInput = object({ workId: id, expectedRevision: { type: "integer", minimum: 1 }, intentId: id, snapshotSha256: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["workId", "expectedRevision", "intentId", "snapshotSha256"])
      register(editor, "sol_ship_preflight", "Observa Git y Work en modo solo lectura y calcula un preflight Ship. No registra intent, no autoriza ni ejecuta Git/gh.", shipPreflightInput, async ({ workId, expectedRevision, request }, root) => {
        const { readWork } = await core("artifacts.mjs")
        const { observeShippingGit } = await core("shipping-snapshot.mjs")
        const { buildShippingPreflight } = await core("shipping.mjs")
        const work = readWork(root, workId, { files: false })
        const gitSnapshot = observeShippingGit({ sessionRoot: root, request, work })
        const result = buildShippingPreflight({ work, expectedRevision, gitSnapshot, request })
        return JSON.stringify({ ...result, gitSnapshot: undefined }, null, 2)
      })
      register(editor, "sol_ship_authorize", "Revalida y registra una secuencia Ship exacta. Su permiso nativo predeterminado es ask; solo planifica argv y nunca ejecuta Git/gh. La confianza en la aprobación depende de la política efectiva del host.", shipAuthorizeInput, async ({ workId, expectedRevision, intentId, snapshotSha256 }, root, session, assertActive) => {
        if (!session?.id && !session?.sessionID) throw new Error("No hay identidad de sesión para vincular la autorización.")
        const sessionID = session.id || session.sessionID
        const { readWork } = await core("artifacts.mjs")
        const { applyWorkMutation } = await core("work-mutations.mjs")
        const { observeShippingGit } = await core("shipping-snapshot.mjs")
        const { buildShippingPreflight, buildShippingArgv, computeShippingSnapshot } = await core("shipping.mjs")
        const { workContractDigest } = await core("contracts.mjs")
        const { rememberNativeShippingApproval } = await core("shipping-authority.mjs")
        let work = readWork(root, workId, { files: false })
        if (work.revision !== expectedRevision || work.status === "cancelled") throw new Error("Work obsoleto o cancelado; vuelve a preflight.")
        const intent = work.shipping?.intents?.find((entry: any) => entry.id === intentId)
        if (!intent || (!["previewed", "approved"].includes(intent.status)) || intent.snapshotSha256 !== snapshotSha256) throw new Error("Intent ausente, no previsualizado o snapshot diferente; vuelve a preflight.")
        const request = { id: intent.id, repository: intent.repository, remote: intent.remote, branch: intent.branch, base: intent.base, title: intent.title, body: intent.body, commitMessage: intent.commitMessage, actions: intent.actions, expectedPaths: intent.expectedPaths, includedCommitShas: intent.includedCommitShas }
        const gitSnapshot = observeShippingGit({ sessionRoot: root, request, work })
        const fresh = buildShippingPreflight({ work, expectedRevision, gitSnapshot, request })
        if (fresh.blockers.length || fresh.intent?.snapshotSha256 !== snapshotSha256 || fresh.intent?.contentSha256 !== intent.contentSha256) throw new Error(`El repo o Work cambió desde la preview; no se aprobó. ${fresh.blockers.slice(0, 5).join("; ")}`)
        const approvedAt = intent.approval?.approvedAt || new Date().toISOString()
        assertActive()
        applyWorkMutation(root, { workId, expectedRevision, actions: [{ type: "shipping.approval.record", intentId, snapshotSha256, actions: [...intent.actions], approvedAt }] })
        work = readWork(root, workId, { files: false })
        const approved = work.shipping?.intents?.find((entry: any) => entry.id === intentId)
        if (!approved || approved.status !== "approved" || approved.approval?.snapshotSha256 !== snapshotSha256 || JSON.stringify(approved.approval.actions) !== JSON.stringify(intent.actions)) throw new Error("Core no confirmó el registro coincidente; no se creó autoridad de sesión.")
        const currentSnapshot = computeShippingSnapshot({ gitSnapshot, work, request, workScope: approved.workScope, expectedPaths: approved.expectedPaths, evidenceIds: approved.evidenceIds, includedCommitShas: approved.includedCommitShas })
        const nextAction = approved.actions.find((action: any) => !(approved.completedActions || []).includes(action)) || approved.actions[0]
        const argv = buildShippingArgv(approved, nextAction, { receipts: work.shipping.receipts, currentSnapshot: { ...currentSnapshot, workContractSha256: workContractDigest(work) }, currentWork: work, expectedWorkId: workId, expectedRevision: work.revision })
        rememberNativeShippingApproval({ root, sessionID, workId, intent: approved, workContractSha256: workContractDigest(work) })
        return `Registro declarativo actualizado para el snapshot ${snapshotSha256}; autorización de sesión acotada a este root/session/Work/intent, tras observar la pregunta y respuesta nativas coincidentes del host para esta invocación. No se ejecutó ninguna acción. Primer paso argv planificado:\n${JSON.stringify(argv)}`
      })
      register(editor, "sol_work_close", "Cierra un Work tras validar evidencia positiva y revisión vigente.", object({ workId: id, expectedRevision: { type: "integer", minimum: 1 }, outcome: { enum: ["done", "cancelled"] }, summary: string("Resultado o motivo"), limitations: list(string("Limitación", 1000), 30) }, ["workId", "expectedRevision", "summary"]), async (args, root, _session, assertActive) => {
        const { closeWorkOperation } = await core("work-mutations.mjs"); const { formatReceipt } = await core("receipts.mjs"); assertActive(); return formatReceipt(closeWorkOperation(root, args))
      })
      register(editor, "sol_work_reopen", "Reabre un Work cerrado con motivo y nueva revisión de ciclo.", object({ workId: id, expectedRevision: { type: "integer", minimum: 1 }, reason: string("Motivo") }, ["workId", "expectedRevision", "reason"]), async (args, root, _session, assertActive) => {
        const { reopenWorkOperation } = await core("work-mutations.mjs"); const { formatReceipt } = await core("receipts.mjs"); assertActive(); return formatReceipt(reopenWorkOperation(root, args))
      })
      register(editor, "sol_history", "Consulta cierres por Work o por fechas ISO; resultado limitado.", object({ workId: id, since: { type: "string", format: "date-time" }, until: { type: "string", format: "date-time" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, []), async (args, root, _session, assertActive) => {
        const { readHistory } = await core("work-mutations.mjs"); const entries = readHistory(root, args)
        return entries.length ? entries.map((e: any) => `${e.workId} · ${e.outcome} · ${e.closedAt}\n${e.summary.slice(0, 320)}`).join("\n\n") : "No hay cierres para esa consulta."
      })
      register(editor, "sol_work_validate", "Valida coherencia canónica y, opcionalmente, vigencia de evidencia del proyecto.", object({ fresh: { type: "boolean" } }, []), async ({ fresh = false }, root) => {
        const { validateWorkspace } = await core("work-mutations.mjs"); const result = validateWorkspace(root, { fresh }); return `✓ Sol válido · ${result.works} trabajos · ${result.closures} cierres${fresh ? " · evidencia vigente comprobada" : ""}`
      })
      register(editor, "sol_project_complete_map", "Registra y cierra el Work reservado al mapeo inicial del proyecto.", object({ workId: id, expectedRevision: { type: "integer", minimum: 1 }, summary: string("Resumen verificado"), limitations: list(string("Limitación", 1000), 30) }, ["workId", "expectedRevision", "summary"]), async (args, root, _session, assertActive) => {
        const { completeMapOperation } = await core("work-mutations.mjs"); assertActive(); const result = completeMapOperation(root, args); return `✓ ${result.id} mapeado y cerrado · revisión ${result.revision} · evidencia ${result.evidenceId}`
      })
      register(editor, "sol_init_get", "Consulta el bootstrap init y sus entregas verificadas sin abrir los documentos.", object({ workId: id }, ["workId"]), async (args, root) => {
        const { readInit } = await core("init.mjs")
        return JSON.stringify(readInit(root, args), null, 2)
      })
      register(editor, "sol_init_project_publish", "Publica el mapa de proyecto integrado solo para un init propio, con revisión y base verificadas.", object({ workId: id, expectedRevision: { type: "integer", minimum: 1 }, expectedProjectSha256: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$" }, content: string("Mapa integrado con fuentes, claims y límites verificables", 200000) }, ["workId", "expectedRevision", "expectedProjectSha256", "content"]), async (args, root, _session, assertActive) => {
        const { publishInitProject } = await core("init.mjs")
        assertActive(); const result = publishInitProject(root, args)
        return `✓ Mapa init publicado · ${result.workId} · revisión ${result.revision}`
      })
      register(editor, "sol_init_complete", "Cierra el bootstrap init después de validar mapa publicado, entregas y gates vigentes.", object({ workId: id, expectedRevision: { type: "integer", minimum: 1 }, summary: string("Resumen verificado"), limitations: list(string("Limitación", 1000), 30) }, ["workId", "expectedRevision", "summary"]), async (args, root, _session, assertActive) => {
        const { completeInitMap } = await core("init.mjs")
        assertActive(); const result = completeInitMap(root, args)
        return `✓ Init completado · ${result.workId} · revisión ${result.revision}`
      })
      const configAgents = ["sol", "sol-explorer", "sol-executor", "sol-researcher", "sol-planner", "sol-plan-auditor", "sol-qa-auditor", "sol-code-reviewer", "sol-security-auditor", "sol-ui-auditor"]
      const modelQuery = string("Filtro por modelo o proveedor", 120)
      const configInput = object({ modelQuery, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 30 } }, [])
      const safeRef = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.-]+$/.test(value) ? value : "[referencia no válida]"
      const safeModelRef = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9._/-]+$/.test(value) ? value : "[referencia no válida]"
      const safeAssignment = (value: any) => {
        if (typeof value === "string") return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+(?:#[A-Za-z0-9._-]+)?$/.test(value) ? value : "[asignación no válida]"
        if (!value || typeof value !== "object") return "heredado"
        const provider = safeRef(value.providerID), model = safeModelRef(value.modelID || value.id)
        if (provider === "[referencia no válida]" || model === "[referencia no válida]") return "[asignación no válida]"
        const variant = value.variant ? `#${safeRef(value.variant)}` : ""
        return `${provider}/${model}${variant === "#[referencia no válida]" ? "" : variant}`
      }
      register(editor, "sol_config_get", "Consulta preferencias globales de perfiles/modelos Sol y tracking local del workspace; nunca altera el workspace.", configInput, async ({ modelQuery: query = "", offset = 0, limit = 20 }, root, session) => {
        const { readModelConfig } = await core("model-config.mjs")
        const current = readModelConfig()
        let artifactSummary = "Estado de tracking local: no disponible."
        try {
          const { readArtifactTracking } = await core("artifact-tracking.mjs")
          const tracking = readArtifactTracking(root)
          artifactSummary = tracking.available
            ? `Tracking local del repo ${tracking.repoRoot || tracking.workspace}: ${tracking.mode}${tracking.mode === "unconfigured" ? " · sin elección guardada; sugerencia predeterminada: Local (no implica exclusión actual)" : ""} · revisión ${tracking.revision} · ${tracking.trackedCount} rutas rastreadas · ${tracking.ignored ? "ignorado localmente" : "no ignorado localmente"}${tracking.sharedMetadata ? " · metadata compartida entre worktrees" : ""}${tracking.blockers?.length ? ` · bloqueos: ${tracking.blockers.slice(0, 4).join("; ")}` : ""}`
            : `Tracking local: no disponible${tracking.workspace ? ` · ${tracking.workspace}` : ""}${tracking.blockers?.length ? ` · ${tracking.blockers.slice(0, 4).join("; ")}` : " · el workspace no está dentro de un repo Git"}`
        } catch { /* La consulta global de preferencias sigue disponible sin el helper opcional. */ }
        const response = await ctx.model.list({ location: { directory: root } })
        const raw = Array.isArray(response?.data) ? response.data : []
        const catalog = raw.filter((m: any) => m && typeof m.id === "string" && typeof m.providerID === "string" && m.enabled === true && ["alpha", "beta", "active"].includes(m.status)).map((m: any) => ({
          ref: `${m.providerID}/${m.id}`,
          name: typeof m.name === "string" ? m.name.slice(0, 160) : m.id.slice(0, 160),
          variants: Array.isArray(m.variants) ? m.variants.filter((v: any) => v && typeof v.id === "string").map((v: any) => v.id.slice(0, 80)).sort() : [],
        })).sort((a: any, b: any) => a.ref.localeCompare(b.ref))
        const needle = String(query).toLowerCase()
        const matches = catalog.filter((m: any) => `${m.ref} ${m.name} ${m.variants.join(" ")}`.toLowerCase().includes(needle))
        const selected = session.model ? safeAssignment({ providerID: session.model.providerID, id: session.model.id, variant: session.model.variant }) : "no disponible"
        const rows = configAgents.map(agent => `${agent}: ${safeAssignment(current.assignments[agent])}`).join("\n")
        const page = matches.slice(offset, offset + limit).map((m: any) => `${m.ref} · ${m.name}${m.variants.length ? ` · variantes: ${m.variants.join(", ")}` : ""}`).join("\n")
        return `Preferencias globales OpenCode · ${current.configPath}\nRevisión: ${current.revision}\nPerfil: ${current.profile}\nPreferencias por agente:\n${rows}\nModelo seleccionado en esta sesión (no se cambia): ${selected}\n${artifactSummary}\nCatálogo disponible para este workspace (${offset + 1}-${Math.min(offset + limit, matches.length)} de ${matches.length}):\n${page || "sin resultados"}${offset + limit < matches.length ? `\nMás: offset ${offset + limit}` : ""}`
      })
      register(editor, "sol_config_apply", "Previsualiza y coordina preferencias globales de modelos Sol y tracking local del repo elegido; guardar requiere confirmación y aprobación del host.", object({ profile: { enum: ["inherited", "balanced", "custom"] }, overrides: list(object({ agentId: { enum: configAgents }, model: { type: ["string", "null"], maxLength: 300 } }, ["agentId", "model"]), 10), expectedRevision: { type: "string", pattern: "^[a-f0-9]{64}$" }, artifactTracking: { enum: ["local", "versioned"] }, artifactExpectedRevision: { type: "string", pattern: "^[a-f0-9]{64}$" }, dryRun: { type: "boolean", default: true } }, ["profile", "overrides", "expectedRevision", "artifactTracking", "artifactExpectedRevision"]), async ({ profile, overrides = [], expectedRevision, artifactTracking, artifactExpectedRevision, dryRun = true }, root, _session, assertActive) => {
        if (new Set(overrides.map((item: any) => item.agentId)).size !== overrides.length) throw new Error("Cada agente puede aparecer una sola vez en overrides.")
        const response = await ctx.model.list({ location: { directory: root } })
        const catalog = Array.isArray(response?.data) ? response.data : []
        const { planModelConfig, applyModelConfig } = await core("model-config.mjs")
        const overrideRecord = Object.fromEntries(overrides.map((item: any) => [item.agentId, item.model]))
        const plan = planModelConfig({ profile, overrides: overrideRecord, catalog, expectedRevision })
        const { planArtifactTracking, applyArtifactTracking, restoreArtifactTracking } = await core("artifact-tracking.mjs")
        const trackingPlan = planArtifactTracking(root, { mode: artifactTracking, expectedRevision: artifactExpectedRevision })
        if (dryRun) {
          const changes = plan.changes.map((item: any) => `${item.agentId}: ${safeAssignment(item.before)} → ${safeAssignment(item.after)}`).join("\n") || "sin cambios"
          return `Vista previa combinada (no guardada)\nModelos globales · ${plan.configPath}\nPerfil: ${plan.profile} · revisión: ${plan.revision}\nCambios:\n${changes}\n${plan.migration ? "Migración JSON→JSONC y respaldo privado previstos. " : ""}Tracking local del repo ${trackingPlan.repoRoot || trackingPlan.workspace} · ${trackingPlan.previousMode} → ${trackingPlan.mode} · ${trackingPlan.changed ? "cambios locales previstos" : "sin cambios"}${trackingPlan.sharedMetadata ? " · metadata Git compartida con worktrees" : ""}\n${trackingPlan.changes?.slice(0, 8).join("\n") || "Sin cambios de exclusión/metadata Git."}\nEl esfuerzo por agente es fijo; el modelo de esta sesión no cambiará. Guardar requiere una confirmación nueva y aprobación del host.`
        }
        assertActive()
        const trackingResult = applyArtifactTracking(trackingPlan)
        let result: any
        try { result = applyModelConfig(plan) }
        catch (error) {
          if (trackingResult.changed) {
            try {
              const restored = restoreArtifactTracking(trackingPlan, trackingResult)
              if (!restored.restored) throw new Error(restored.blockers?.join("; ") || "restauración no confirmada")
            }
            catch (rollbackError) { throw new Error(`Falló el guardado de modelos (${(error as Error).message}); también falló la restauración del tracking (${(rollbackError as Error).message}). Recuperación del tracking: ${trackingResult.recovery || "no disponible"}. No se afirma atomicidad.`) }
          }
          throw new Error(`Falló el guardado global de modelos; ${trackingResult.changed ? "se restauró el tracking local" : "el tracking local no cambió"}. Recuperación del tracking: ${trackingResult.recovery || "ninguna"}. Detalle: ${(error as Error).message}`)
        }
        return `✓ Guardado coordinado · perfil ${result.profile}, ${result.saved ? (result.changed ? "preferencias guardadas" : "sin cambios de modelo") : "modelos no guardados"}, ${result.changes.length} asignaciones cambiadas · tracking ${trackingResult.mode}${trackingResult.changed ? " actualizado" : " sin cambios"}. Configuración global: ${result.configPath}${result.recovery ? ` · respaldo privado: ${result.recovery}` : ""}${trackingResult.recovery ? ` · recuperación privada del tracking: ${trackingResult.recovery}` : ""}. El tracking versioned no sube datos: solo permite que el usuario use Git manualmente. Modelo de sesión no cambiado.`
      })
      register(editor, "sol_artifacts_get", "Consulta resumen seguro del tracking local del repo Git activo.", object({}, []), async (_args, root, _session, assertActive) => {
        const { readArtifactTracking } = await core("artifact-tracking.mjs")
        const state = readArtifactTracking(root)
        return state.available
           ? `Workspace: ${state.workspace}\nRepo Git: ${state.repoRoot}\nModo local: ${state.mode}${state.mode === "unconfigured" ? "\nSin elección guardada. Modo sugerido por defecto: local (esto no significa que .sol/ ya esté excluido)." : ""}\nRutas rastreadas: ${state.trackedCount}\nIgnorado localmente: ${state.ignored ? "sí" : "no"}${state.sharedMetadata ? "\nMetadata compartida entre worktrees" : ""}\nRevisión: ${state.revision}${state.blockers?.length ? `\nBloqueos: ${state.blockers.slice(0, 8).join("; ")}` : ""}`
          : `Tracking local no disponible${state.workspace ? ` · workspace ${state.workspace}` : ""}${state.blockers?.length ? `\nBloqueos: ${state.blockers.slice(0, 8).join("; ")}` : "\nNo hay repo Git aplicable; no se inicializó Git ni se creó estado Sol."}`
      })
      register(editor, "sol_artifacts_set", "Previsualiza o ajusta tracking local del repo Git activo; no agrega, commitea ni sube datos.", object({ mode: { enum: ["local", "versioned"] }, expectedRevision: { type: "string", pattern: "^[a-f0-9]{64}$" }, dryRun: { type: "boolean", default: true } }, ["mode", "expectedRevision"]), async ({ mode, expectedRevision, dryRun = true }, root, _session, assertActive) => {
        const { planArtifactTracking, applyArtifactTracking } = await core("artifact-tracking.mjs")
        const plan = planArtifactTracking(root, { mode, expectedRevision })
        if (dryRun) return `Vista previa (no guardada) · repo ${plan.repoRoot || plan.workspace}\nTracking local: ${plan.previousMode} → ${plan.mode}${plan.sharedMetadata ? " · metadata Git compartida con worktrees" : ""}\n${plan.changes?.slice(0, 12).join("\n") || "Sin cambios."}\nNo se ejecutan git add, commit, push ni init.`
        assertActive()
        const result = applyArtifactTracking(plan)
        return `✓ Tracking ${result.mode} ${result.changed ? "guardado" : "ya estaba configurado"} · ${result.workspace} · ${result.trackedCount ?? plan.trackedCount} rutas rastreadas${result.recovery ? ` · recuperación privada: ${result.recovery}` : ""}. Versionado no sube datos: git add/commit/push siguen siendo decisiones manuales del usuario.`
      })
    })
    return () => permissionBridge.dispose()
  },
}
