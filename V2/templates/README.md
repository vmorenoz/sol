# Catálogo de plantillas · versión 1.0
<!-- Versiones de formato narrativo; no equivalen a versión de schema/API Work. -->
Una plantilla define la entrega, no obliga a crear el archivo. Las secciones marcadas
«condicional» se omiten si no aplican; no rellenar con ficción. Los marcadores `{{...}}`
son instrucciones de autoría, no un lenguaje ejecutable. Una entrega final no conserva
marcadores pendientes: usa «pendiente» con motivo y responsable cuando falte una decisión.

| Archivo | Autor habitual | Uso |
|---|---|---|
| project.md | Sol con hallazgos del Explorador | Vista selectiva de contexto; anclas `<!-- claim:ID -->` / `<!-- source:ID -->` deben coincidir con el ledger del Work para mapeo validable. Un documento previo sin esa procedencia puede seguir siendo útil, pero se considera legacy_unverified hasta refresco selectivo. |
| work.md | Sol | Narrativa opcional del trabajo; estado canónico en work.json |
| objective.json / task.json | Sol | Ejemplos de datos y esquemas asociados |
| spec.md | Researcher / Planificador, según encargo | Comportamiento y contratos |
| plan.md | Planificador | Plan maestro y subplan: mismo formato |
| research.md | Researcher | Triage de evidencia, alternativas, preguntas y unknowns |
| exploration.md | Explorador | Mapa real del repositorio |
| implementation.md | Ejecutor | Cambios y comprobaciones del encargo |
| review.md | Auditores y Code Reviewer | Hallazgos y límites de revisión |
| evidence.md / evidence.json | QA | Verificación documentada y referencias estructuradas |
| ui-review.md | UI Auditor | Revisión visual, funcional y accesible |
| decision.md | Sol | Decisión humana/técnica confirmada |
| delivery.md | Sol | Entrega preparada para revisión humana |
| delegation.json / delegation.md | Sol | Encargo autosuficiente al especialista |
| result.json | Cada especialista | Respuesta compacta, nunca una instrucción para ejecutar |

## Versiones y coordinación de discovery/delivery

Los marcadores vigentes son `project@1.0`, `research@1.0`, `spec@1.0`, `plan@1.0`, `decision@1.0`, `evidence@1.0`, `delivery@1.0` (y los demás encabezados correspondientes). Son formatos Markdown narrativos, no identificadores de schema ni enums canónicos. Las secciones opcionales se omiten si no aplican; un archivo no es obligatorio solo porque tenga plantilla.

En metadata, Work/revision/task/AC IDs existentes y tools Sol son autoridad. `decision.md`, `evidence.md` y `delivery.md` no duplican status ni guardan el registro canónico. Nunca inventar request payloads con campos solo porque una plantilla los muestre.

Acciones discovery tipadas anunciadas por el contrato de integración actual: `discovery.source.add`, `discovery.claim.add`, `discovery.assumption.add`, `discovery.assumption.resolve`, `discovery.question.add`, `discovery.question.answer`, `discovery.decision.add`, `discovery.decision.supersede`. Las preguntas/resoluciones deben preservar procedencia, decisión previa y razón de cambio según el schema efectivo. La distinción final entre resolución por investigación y decisión humana queda condicionada al campo/API de A; no inventar `resolutionKind` ni payload.

Acciones de shipping anunciadas por contrato: `shipping.intent.record`, `shipping.approval.record`, `shipping.intent.invalidate`, `shipping.receipt.record`. Intent/preflight, consentimiento reportado y recibo observado son eventos distintos. No son identidad autenticada, auth token, permiso del host, autorización implícita por Work ni evidencia de efecto remoto. Ver `skills/sol-ship/references/preflight-and-authorization.md`; la implementación/preflight de Owner B y la aceptación de tools integradas quedan separadas.

El plan permite narrar tipos `research`, `exploration`, `specification`, `planning`, `implementation`, `verification`, `delivery`, `shipping`, pero aceptar esos task.kind depende del schema vigente de A, no de esta tabla Markdown.

Las rutas de los ejemplos son relativas a la raíz del proyecto. Sustituirlas por rutas
reales; el esquema valida estructura, no inventa el contenido. No duplicar estados de
tareas en los planes. Cada plan enlaza los IDs de tareas canónicos tras su aceptación.

`state.json` y `history-entry.json` ilustran la proyección global y un cierre. No copiar ejemplos al estado real: las utilidades crean y sincronizan esos archivos a partir del work canónico.

## Profundidad y revisión humana

Una corrección pequeña requiere párrafos breves y referencias precisas, no todos los
documentos. Para varios módulos detalla contratos, dependencias y evidencia; no añadas
secciones vacías para aparentar cobertura. Referencia código como `ruta:línea` más su
revisión cuando sea relevante; comandos con directorio y resultado real; documentación
con enlace oficial y fecha. Los IDs de tarea/criterio apuntan al work canónico.

Antes de finalizar, el autor y Sol revisan que las instrucciones de plantilla fueron
sustituidas por contenido específico. «No aplica» o «pendiente» requieren motivo. No
marcar como incompleto código legítimo que usa dobles llaves. No se añade un detector
léxico ni un evaluador automático de calidad. Para los contratos de evidencia y el flujo
de trabajo, consulta `docs/INVENTORY.md` y `docs/WORKFLOW.md` en la instalación global.

## Trazabilidad, historial y auditorías (guía condicional)

- Un `result.json` y su informe pertenecen a una entrega/delegationId y son históricos: output único, no overwrite. Una corrección recibe nuevo delegationId y output dentro del scope; referencia el reporte anterior en contexto/Markdown. No inventar campos de schema ni alterar artifacts/changedFiles para fingir una nueva entrega. El código y otros archivos vivos siguen sus permisos normales.
- Antes de editar, establece baseline suficiente en el scope autorizado; HEAD, conteos o hashes aislados no demuestran checkout limpio ni preservación semántica. No copiar secretos ni recorrer diffs globales; separar preexistente, propio e indeterminado.
- Para aceptación cubre todos los criterios/tareas pertinentes (covered con evidencia vigente, partial, uncovered, blocked, unverifiable), no solo la última subtask. Informe narrativo, result del runtime, `sol_work_validate` o fingerprint no prueban por sí solos ejecución. Reporta únicamente checks observados; static/manual/not_run no son executed ni aceptación live. No exigir E2E sin necesidad y autorización.
- En auditorías de app, traza flujos críticos solo donde sea pertinente (entrada→servicio→contrato→persistencia/backend→resultado), con fuentes y límites. Estados: demo, implementado parcial, conectado no verificado, ejecutado/verificado para alcance observado, ausente o desconocido. No hallado en búsqueda acotada significa desconocido, no ausencia global. Presencia de código/tests no equivale a ruta usable/PASS.
- Clasifica conocimiento como vigente, contexto necesario, histórico, obsoleto o duplicado para reducir ruido/contradicción. Separar/retirar material exige alcance autorizado, enlaces que preserven contexto necesario y cuidado de fuentes únicas; no volcar snapshots en mega-doc ni forzar un conteo de borrados. “Actual/vigente” solo si se contrastó; snapshots llevan fecha/origen y nombre histórico.
