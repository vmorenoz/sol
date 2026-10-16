// Bounded views of canonical metadata. No referenced document or evidence file is opened.
export const workSections = ["summary", "criteria", "tasks", "discovery", "sources", "claims", "questions", "assumptions", "decisions", "evidence", "documents", "blockers", "pendingDecisions"]
export function pageBounds(offset = 0, limit = 10) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("offset debe ser un entero no negativo")
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("limit debe estar entre 1 y 20")
  return { offset, limit }
}
const brief = (value, size = 240) => { const text = String(value ?? "").replace(/\s+/g, " ").trim(); return text.length > size ? `${text.slice(0, size)}…` : text }
const refs = (values) => Array.isArray(values) && values.length ? values.join(", ") : "ninguno"
export function formatStatusPage(state, offset = 0, limit = 10) {
  pageBounds(offset, limit)
  const works = state.works, page = works.slice(offset, offset + limit)
  const lines = page.map((work) => `- ${work.id}${work.id === state.focusWorkId ? " [foco]" : ""} · ${work.status} · ${work.progress.done}/${work.progress.total} · ${work.priority}\n  ${brief(work.objective)}\n  Siguiente: ${brief(work.nextAction || "sin acción registrada")}\n  Bloqueos: ${work.blockers.length} · decisiones pendientes: ${work.decisionsPending.length}`)
  return [`Sol · ${works.length} frentes abiertos · foco: ${state.focusWorkId || "ninguno"}`, `Frentes ${page.length ? offset + 1 : 0}-${offset + page.length} de ${works.length}`, ...lines, ...(offset + page.length < works.length ? [`Más frentes: sol_status con offset ${offset + page.length}, limit ${limit}.`] : []), "Detalle de un frente: sol_work_get con workId."].join("\n")
}
function detail(value, prefix = "") {
  if (Array.isArray(value)) return value.length ? value.flatMap((item, index) => detail(item, `${prefix}${index + 1}. `)) : [`${prefix}ninguno`]
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => (item && typeof item === "object") ? [`${prefix}${key}:`, ...detail(item, `${prefix}  `)] : [`${prefix}${key}: ${String(item ?? "no disponible")}`])
  return [`${prefix}${String(value ?? "no disponible")}`]
}
export function formatWorkView(work, query = {}, scope) {
  const { section = "summary", offset = 0, limit = 10, itemId, taskId, criterionId } = query
  pageBounds(offset, limit)
  if (!workSections.includes(section)) throw new Error("section no reconocida")
  if (taskId && !work.tasks.some((task) => task.id === taskId)) throw new Error(`Tarea inexistente: ${taskId}`)
  if (criterionId && !work.objective.criteria.some((criterion) => criterion.id === criterionId)) throw new Error(`Criterio inexistente: ${criterionId}`)
  const header = `${work.id} · revisión ${work.revision} · ${work.status}\n${work.title}: ${brief(work.objective.outcome, 400)}`
  const ledger = work.discovery || {}
  if (section === "summary" || section === "discovery") {
    if (itemId) throw new Error("itemId requiere una sección de registros, por ejemplo tasks, questions o decisions")
    const counts = `Secciones: criteria ${work.objective.criteria.length}, tasks ${work.tasks.length}, evidence ${work.evidence.length}, documents ${work.documents.length}, blockers ${work.blockers.length}, pendingDecisions ${work.decisionsPending.length}, sources ${(ledger.sources || []).length}, claims ${(ledger.claims || []).length}, questions ${(ledger.questions || []).length}, assumptions ${(ledger.assumptions || []).length}, decisions ${(ledger.decisions || []).length}`
    return [header, `Resultado acordado: ${work.objective.outcome}`, `Contexto: ${ledger.contextLane || "unknown"}`, `Progreso: ${work.tasks.filter((task) => task.status === "done").length}/${work.tasks.length}`, `Resumen: ${brief(work.summary, 600) || "sin resumen"}`, `Bloqueos: ${work.blockers.length} · decisiones pendientes: ${work.decisionsPending.length}`, `Siguiente: ${work.nextAction || "sin acción registrada"}`, counts, "Consulta una sección con section y offset/limit (máximo 20); itemId devuelve un registro completo. taskId/criterionId seleccionan alcance. No se leen documentos citados."].join("\n")
  }
  let records = section === "criteria" ? work.objective.criteria : section === "pendingDecisions" ? work.decisionsPending.map((text, index) => ({ id: `pending-${index + 1}`, statement: text })) : section === "blockers" ? work.blockers.map((text, index) => ({ id: `blocker-${index + 1}`, statement: text })) : ["tasks", "evidence", "documents"].includes(section) ? work[section] : ledger[section] || []
  const selectedTasks = scope?.relevantTaskIds || (taskId ? [taskId] : criterionId ? work.tasks.filter((task) => task.criterionIds.includes(criterionId)).map((task) => task.id) : [])
  const selectedCriteria = criterionId ? [criterionId] : scope?.criterionIds || []
  if (taskId || criterionId) records = records.filter((record) => {
    if (section === "tasks") return (!taskId || selectedTasks.includes(record.id)) && (!criterionId || record.criterionIds.includes(criterionId))
    if (section === "criteria") return !selectedCriteria.length || selectedCriteria.includes(record.id)
    // Unscoped records remain visible: they apply globally, not to an invented task.
    const tasks = record.taskIds || [], criteria = record.criterionIds || []
    return (!tasks.length && !criteria.length) || tasks.some((id) => selectedTasks.includes(id)) || criteria.some((id) => selectedCriteria.includes(id))
  })
  const recordId = (record) => record.id || record.path
  if (itemId) {
    const record = records.find((record) => recordId(record) === itemId)
    if (!record) throw new Error(`No se encontró ${itemId} en ${section} para este alcance`)
    return `${header}\n${section} · detalle completo ${itemId}\n${detail(record).join("\n")}`
  }
  const page = records.slice(offset, offset + limit)
  const rows = page.map((record) => {
    const key = recordId(record)
    const label = record.title || record.description || record.question || record.statement || record.summary || record.ref || record.path || record.kind
    const state = record.status || record.inspection || record.kind || "registrado"
    return `- ${key} [${state}] ${brief(label)}${section === "tasks" ? ` · criterios: ${refs(record.criterionIds)} · dependencias: ${refs(record.dependsOn)}` : ""}\n  Detalle completo: section ${section}, itemId ${key}`
  })
  return [header, `${section}: ${page.length ? offset + 1 : 0}-${offset + page.length} de ${records.length}${taskId || criterionId ? " · alcance seleccionado; incluye registros globales" : ""}`, ...rows, ...(offset + page.length < records.length ? [`Más: section ${section}, offset ${offset + page.length}, limit ${limit}.`] : []), ...(page.length ? [] : ["Sin registros en esta página."])].join("\n")
}
