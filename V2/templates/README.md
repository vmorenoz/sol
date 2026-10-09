# Catálogo de plantillas · versión 1.0

Las plantillas ayudan a producir contenido útil; no obligan a crear archivos, rellenar secciones vacías ni seguir encabezados fijos. Adapta párrafos, listas y tablas a cada encargo. Un resultado pequeño sin Work puede ser una respuesta Markdown; un artefacto solicitado tiene una sola entrega y un enlace, sin informe duplicado. Sustituye los marcadores por contenido real o una limitación concreta.

| Archivo | Autor habitual | Uso |
|---|---|---|
| project.md | Init: Exploradores aportan entregas; Sol integra/publica mediante tool estrecha | Mapa selectivo con anclas de claims/fuentes para el ledger |
| work.md | Especialista asignado; Sol integra y registra | Narrativa opcional; estado canónico en Work |
| spec.md | Researcher o Planner según encargo | Comportamiento, aceptación y contratos |
| plan.md | Planner | Estrategia y tareas propuestas, sin segundo tablero |
| research.md | Researcher | Hallazgos, procedencia, alternativas y decisión residual |
| exploration.md | Explorador | Realidad del repositorio y relaciones relevantes |
| implementation.md | Executor | Cambios y comprobaciones cuando se pide documento |
| review.md | Auditores y Code Reviewer | Hallazgos priorizados y límites |
| evidence.md | QA u otro rol que realiza la comprobación | Evidencia observada y cobertura |
| ui-review.md | UI Auditor | Interacción, estados y accesibilidad del alcance |
| decision.md | Researcher o Planner asignado; Sol conserva la decisión y registra | Decisión con procedencia y razón |
| delivery.md | Especialista asignado; Sol integra y registra | Entrega preparada para revisión humana |
| delegation.md | Sol | Encargo autosuficiente en Markdown flexible |
| objective.json / task.json / evidence.json | Sol / core | Ejemplos de datos tipados internos; no formato exigido al especialista |
| delegation.json / result.json | Lectura y validación legacy opt-in | Compatibilidad con registros antiguos; no transporte obligatorio de nuevas delegaciones |
| state.json / work.json / history-entry.json | Core | Ejemplos de estado, nunca copiar sobre datos reales |

## Conversación, documentos y estado

Encargos y respuestas son Markdown natural tanto con Work como sin persistencia. Cuando la tarea con Work requiere evidencia, Sol asigna desde el inicio una ruta única de Markdown y writeScope: ese mismo archivo sirve de entrega y report de evidencia, con resultados observados y referencias fingerprintables. No exige JSON ni un segundo reporte; un archivo de código no sustituye el informe. Sin Work puede bastar el mensaje. Sol integra y registra, mientras el especialista asignado escribe los documentos: ser responsable de una decisión no autoriza a Sol a eludir el deny de edición de .sol por shell. Conservan objetivo, alcance, evidencia y referencias suficientes, sin parser por títulos. Sol correlaciona con la llamada nativa y traduce solo hechos verificados a las tools tipadas. Si falta un dato esencial, pide ese dato; no inventa IDs, autoría, ejecución ni aprobación.

Work/revisión/taskIds/criterionIds existentes y el contrato publicado de tools son autoridad. Consulta los schemas efectivos de `schemas/`; los marcadores narrativos `project@1.0`, `research@1.0`, `spec@1.0`, `plan@1.0`, `decision@1.0`, `evidence@1.0` y `delivery@1.0` no son versiones de API. Project conserva statements y anclas exactas donde el validador de mapeo las necesita; esa necesidad técnica no impone un formato universal a las respuestas.

Sol registra discovery con `sol_work_apply`: fuentes, claims, supuestos, preguntas y decisiones. Preguntas distinguen `resolutionKind: human_decision | investigation` según el schema vigente. Los `taskIds` y `criterionIds` opcionales de preguntas, supuestos y decisiones acotan el impacto; ausencia de ambos significa global, no ausencia de bloqueo. Nunca añadas campos a partir de una tabla narrativa.

Shipping usa `sol_ship_preflight`, registra el intent devuelto con `sol_work_apply` / `shipping.intent.record` y conserva la nueva revisión; después del consentimiento para contenido/destino/acciones usa `sol_ship_authorize`. Preflight es readonly y no persiste el intent. `shipping.approval.record` es interno y no se invoca mediante `sol_work_apply`. Un registro, intención o recibo no prueba por sí solo identidad, permiso o efecto externo. Ver la skill sol-ship y su referencia de autorización.

## Evidencia e historial

Una entrega histórica solicitada recibe ruta única; una corrección enlaza la anterior y no la reemplaza. Código y documentos vivos siguen editables dentro del scope. No hay obligación de producir la pareja result.json/report.md. Los registros JSON históricos se preservan y pueden consultarse.

Indica referencias puntuales, base relevante, método, comandos/directorio y resultados reales. Sol calcula los hashes requeridos al registrar. Un informe, fingerprint o validación de schema no demuestra ejecución. Distingue static/manual/executed/not_run, datos sintéticos/mocks frente a conectividad y PASS histórico frente a aceptación vigente. La cobertura se evalúa sobre los criterios/tareas asignados; el cierre global requiere todos los aplicables.

Para auditorías, traza solo flujos relevantes y separa realidad local, intención documentada y despliegue observado. Una búsqueda parcial sin resultado no demuestra ausencia. Mantén límites y contradicciones visibles. Retirar conocimiento o archivos exige alcance autorizado; no maximices borrados ni pierdas fuentes únicas al resumir.

Consulta `docs/ORCHESTRATION.md` y `docs/DISCOVERY.md` para el criterio de uso. La estructura de un documento no prueba calidad del diálogo ni conducta live de OpenCode.
