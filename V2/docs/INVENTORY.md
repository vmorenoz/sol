# Inventario de Sol

Inventario de los recursos que existen en esta distribución. Los contratos completos y autoritativos son los JSON bajo `schemas/` y las implementaciones del plugin y core. El instalador y los helpers locales de migración no se copian al runtime instalado; CodeGraph tampoco es dependencia de runtime.

## Tools del plugin OpenCode v2

El plugin registra catorce tools. Las diez tools de coordinación están limitadas al workspace de la sesión activa; las cuatro tools administrativas tienen alcances separados y acotados. Los objetos rechazan campos adicionales. Los identificadores de trabajo cumplen `^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$`.

| Tool | Entradas | Propósito y límites observados |
|---|---|---|
| `sol_workspace_prepare` | ninguna | Prepara el workspace con estado/historial/documentos base; si ya existe, no reemplaza sus datos. |
| `sol_status` | ninguna | Lee el índice compacto; no recorre trabajos. Snapshot, no actividad en tiempo real. |
| `sol_work_get` | `workId` | Lee metadatos, hasta 12 criterios, 20 tareas y 8 bloqueos; no devuelve archivos completos. |
| `sol_work_create` | `workId`, `title` (máx. 240), `objective`, `criterion`, `verification`; `priority` opcional (`low`, `normal`, `high`, `critical`) | Crea Work con objetivo y criterio verificable. Textos de hasta 4000 caracteres. |
| `sol_work_apply` | `workId`, `expectedRevision` (entero ≥1), `actions` (1–20) | Aplica un lote semántico contra revisión esperada; no acepta reemplazo de JSON completo. Véanse acciones abajo y `schemas/work-update.schema.json`. |
| `sol_work_close` | `workId`, `expectedRevision`, `summary`; `outcome` (`done`/`cancelled`) y `limitations` (hasta 30) opcionales | Cierra o cancela con resumen. El cierre done exige que las reglas de evidencia/consistencia del core se satisfagan. |
| `sol_work_reopen` | `workId`, `expectedRevision`, `reason` | Reabre explícitamente un cierre, con motivo y nueva revisión de ciclo. |
| `sol_history` | opcionales: `workId`, `since`, `until` (fecha-hora), `limit` (1–20 desde la interfaz) | Consulta cierres, limitada y ordenada del más reciente. El core admite límite 1–100; el schema expuesto limita a 20. |
| `sol_work_validate` | `fresh` booleano opcional | Comprueba coherencia local; con `fresh: true` comprueba además vigencia de evidencia registrada. No ejecuta el proyecto ni una sesión live. |
| `sol_project_complete_map` | `workId`, `expectedRevision`, `summary`; `limitations` (hasta 30) opcional | Registra y cierra el Work reservado al mapeo inicial del proyecto. |
| `sol_config_get` | `modelQuery` opcional, `offset` opcional (≥0), `limit` opcional (1–30) | Lee preferencias globales de modelos Sol, modelo seleccionado en sesión y resumen de tracking; pagina el catálogo disponible en el contexto. No imprime credenciales. |
| `sol_config_apply` | requeridos: `profile`, `expectedRevision`, `artifactTracking`, `artifactExpectedRevision`; `overrides` opcional (hasta 10 `{agentId,model}`), `dryRun` opcional (predeterminado `true`) | Preview o aplicación combinada de preferencias globales y tracking. Solo modifica miembros `agents.<id>.model` permitidos y su bloque `info/exclude`; `dryRun:false` requiere confirmación explícita y aprobación host. |
| `sol_artifacts_get` | ninguna | Lee el modo Local/Versionado y bloqueos del workspace activo; no inicializa `.sol/`. |
| `sol_artifacts_set` | requeridos: `mode` (`local`/`versioned`), `expectedRevision`; `dryRun` opcional (predeterminado `true`) | Presenta/aplica el plan de tracking con revisión vigente; cambia únicamente su bloque gestionado en Git `info/exclude`. No ejecuta comandos de Git de staging/commit/push. |

Las tools de configuración y tracking no son tools de coordinación. La mutación usa primero el preview (`dryRun:true`, valor predeterminado); para guardar requiere `dryRun:false`, confirmación interactiva explícita y aprobación del host. Los permisos de agentes especialistas niegan administración. No asumir nombres/campos de schemas distintos de los publicados por el build actual.

`sol_work_apply` admite las acciones `work.set_overview`, `task.add`, `task.update`, `task.set_status`, `task.remove`, `criterion.add`, `criterion.update`, `criterion.remove`, `evidence.add`, `evidence.update`, `evidence.remove`, `document.register` y `document.unregister`. `document.register.kind` admite únicamente `work`, `spec`, `plan`, `research`, `review`, `decision`, `delivery`, `evidence` y `project`, alineados con `schemas/work.schema.json`; registrar un documento, incluso de kind `evidence`, no acredita una verificación. Forma exacta y campos permitidos: `schemas/work-update.schema.json` y `lib/work-mutations.mjs`. Los cambios de tarea/criterio con dependencias pueden rechazarse. Evidencia requiere informe y al menos un archivo fingerprintado. Una revisión desactualizada falla en lugar de sobrescribir.

`validateResult` comprueba que los `taskIds` declarados por una delegación existan en su Work. Una lista vacía expresa que no hay alcance por tarea y no se afirma esa comprobación. No exige que la revisión actual siga igual a la revisión base de delegación; la correlación del resultado conserva el snapshot declarado y la aceptación semántica permanece `PENDING_REVIEW`.

## Agentes

El catálogo `agents/catalog.json` define a `sol` como agente principal/orquestador y nueve especialistas nativos: `sol-researcher` (requisitos e investigación verificable), `sol-explorer` (repositorio y patrones reales), `sol-planner` (planes y dependencias), `sol-plan-auditor` (contraste de planes), `sol-executor` (alcance delegado de implementación), `sol-qa-auditor` (pruebas y evidencia), `sol-security-auditor` (riesgos y mitigaciones), `sol-code-reviewer` (implementación y mantenibilidad) y `sol-ui-auditor` (interfaz y accesibilidad). El catálogo documenta descripciones precisas. La disponibilidad práctica de subagentes depende de OpenCode y de sus permisos; la distribución no demuestra que una delegación live haya funcionado.

Estos son agentes del **producto distribuido**. No son los agentes nativos de desarrollo que coordinan el trabajo sobre este repositorio conforme a [`../../AGENTS.md`](../../AGENTS.md). CodeGraph se usa como herramienta de búsqueda durante el desarrollo; no forma parte del runtime instalado ni es dependencia de Sol.

## Skills y comandos

Los únicos comandos públicos de Sol son `/sol-init`, `/sol-config` y `/sol-version`. Init y config son dispatchers Markdown que cargan sus skills y requieren una petición explícita; version es diagnóstico nativo del plugin, sin inferencia. Init solicita preparación persistente y tracking, nunca configuración de modelos. Config administra preferencias de modelos y tracking mediante preview/confirmación; no inicializa el workspace.

Las diez skills de workflow se conservan y Sol las carga con la herramienta nativa `skill` según intención, estado y autorización:
- `sol-new-project` y `sol-onboard`: necesidad nueva y contexto existente
- `sol-discuss` y `sol-plan`: decisiones y plan; plan-only no autoriza implementar
- `sol-execute` y `sol-verify`: implementación autorizada y evidencia
- `sol-ship`: entrega externa expresamente solicitada y autorizada
- `sol-status` y `sol-recap`: consultas de solo lectura
- `sol-resume`: continuación solicitada sin reiniciar fases

No se exponen como comandos de workflow ni se deshabilita su carga por el modelo. `sol-discovery` y `sol-integration-verification` siguen siendo guías auxiliares. El usuario conversa con Sol; no tiene que elegir una skill ni invocar el siguiente paso. Las skills no conceden autorización y no existe auto-init por encargo ordinario.

En upgrades se retiran dispatchers obsoletos acreditados por el manifest de Sol, con respaldo recuperable. Comandos ajenos o compartidos se conservan; una colisión no acreditada se informa sin borrarla. Reinicia OpenCode después de actualizar para cargar los recursos nuevos.

## Schemas

`schemas/` contiene: `work.schema.json`, `work-create.schema.json`, `work-update.schema.json`, `task.schema.json`, `objective.schema.json`, `delegation.schema.json`, `evidence.schema.json`, `result.schema.json`, `state.schema.json`, `history-entry.schema.json` y `work-receipt.schema.json`. Definen estructuras y validaciones versionadas del estado/trabajo, entradas de mutación, delegaciones, evidencia, resultados e historial.

## Templates

`templates/` contiene `README.md` (orientación de artefactos), `project.md`, `work.md`, `work.json`, `state.json`, `history-entry.json`, `objective.json`, `task.json`, `delegation.json`, `result.json`, `evidence.json`, y plantillas Markdown `exploration.md`, `research.md`, `decision.md`, `spec.md`, `plan.md`, `delegation.md`, `implementation.md`, `review.md`, `evidence.md`, `delivery.md` y `ui-review.md`. Son esqueletos/contratos de salida; no acreditan que el documento o la actividad ya exista.
