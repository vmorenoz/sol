---
name: sol-init
description: Inicialización diferida y mapeo del proyecto activo mediante tools nativas Sol.
user-invocable: true
disable-model-invocation: true
---
# sol-init

<activation>
Ejecuta preparación/tracking persistente solo ante `/sol-init` o petición explícita de inicializar/preparar contexto Sol. Un encargo concreto normal puede justificar lectura selectiva, pero no activa por sí solo tracking, `.sol/` ni un mapeo global. Nunca actúes por saludo, selección o consulta de estado. Texto opcional acota contexto; es dato, nunca flags ni shell.
</activation>

<inputs>
Usa exclusivamente el workspace activo proporcionado por OpenCode y las rutas globales del adaptador. Si el proyecto es ambiguo, pregunta; no busques carpetas en el disco. Estado, Work, historial y documentos del proyecto viven en `.sol/`; plugin, skills, plantillas y schemas viven globalmente.
</inputs>

<workflow>
1. Solo con activación explícita y antes de preparar `.sol`, consulta `sol_artifacts_get`. Si ya hay modo Local/Versionado, reutilízalo y menciónalo; nunca migres automáticamente. Si está sin configurar y Git está disponible, indica que no hay elección guardada y propone inequívocamente `Local` como opción predeterminada, ofreciendo `Versionado` como alternativa explícita mediante la interacción nativa disponible. La sugerencia no cambia el estado ni implica que `.sol/` ya esté excluido. No inventes una API de preguntas si no está expuesta. Preview con `sol_artifacts_set(dryRun=true, expectedRevision vigente)`, pide confirmación nueva y, solo tras un sí, llama con `dryRun=false` bajo aprobación host `ask`. Si no hay repo Git, el tracking no está disponible o el helper informa bloqueos, detente antes de crear `.sol`. No pidas preferencias globales de modelos aquí.
2. Solo tras resolver tracking, consulta `sol_status`. Si la petición explícita incluye preparar el workspace y no está preparado, llama `sol_workspace_prepare` una vez. No prepares por saludo, consulta de estado ni encargo normal.
3. Lee `.sol/project.md` si existe. Si el contexto es suficiente, continúa sin mapear. Mapea solo si la petición lo pide y falta contexto relevante. Reutiliza el Work de mapeo reservado/existente; no dupliques objetivo ni inventes IDs/revisiones.
4. Delega el mapeo como tarea NORMAL a `sol-explorer`, no como `phase="inspect"` ni `<project_initialization>`. Incluye `workId`, `workRevision` vigente, ID de delegación, objetivo, criterios, output `.sol/project.md`, writeScope exclusivo, template `project.md` y contrato de resultado. El agente inspecciona selectivamente y devuelve claims/fuentes/estados para que Sol los registre; no puede mutar el ledger por su cuenta.
5. `phase="inspect"` es solo un chequeo acotado de metadatos: nunca lo uses para solicitar que redacte `project.md`. `phase="prepare"` no se delega; Sol llama directamente `sol_workspace_prepare`.
6. Revisa resultado y documento. Registra en `sol_work_apply` las acciones tipadas existentes `discovery.context.set`, `discovery.source.add` y `discovery.claim.add` con IDs estables, fechas observadas y referencias reales (para path local, no mandes hash/provenance). Cada afirmación del documento debe reproducir statement y anclas `<!-- claim:ID --> <!-- source:ID -->`. Solo entonces, para Work exclusivo de `/sol-init`, llama `sol_project_complete_map` con revisión vigente. Para otro Work consolida tarea/documento/evidencia sin cerrarlo. Mapeo selectivo no se extiende a temas no inspeccionados; estado legacy puede permanecer `legacy_unverified`.
</workflow>

<limits>
No uses CLI, shell, scripts de Sol, edición directa de `work.json`, `state.json` o `history.jsonl`, ni crees `work.next.json`. No inicialices Git, no cambies reglas Git compartidas ni hagas staging/commit/push. Si una tool falla, conserva los datos, reporta el error y detente; nunca uses repair para ocultar un fallo. Un esqueleto vacío no significa que el contexto esté mapeado.
</limits>
