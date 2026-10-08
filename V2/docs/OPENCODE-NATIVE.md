# Integración nativa OpenCode v2

Sol registra herramientas dentro de OpenCode y usa sus agentes, sesiones, permisos, skills y delegación. No contiene un runtime alternativo ni una capa de compatibilidad para otros hosts.

## Contrato contrastado

Consulta documental: 8 de octubre de 2026.

- [Plugins v2](https://opencode.ai/v2/docs/build/plugins): definición default con `id` y `setup`, registro síncrono mediante `ctx.tool.transform(editor => editor.add(...))`, ejecución con `sessionID`/señal y resultado `{content}`. El plugin resuelve cada workspace con `ctx.session.get({sessionID})`, no con la ubicación donde se cargó el plugin.
- [Referencia nativa](https://opencode.ai/v2/docs/api): `model.list` recibe la ubicación consultada y devuelve el catálogo bajo `data`. La lectura de catálogo no cambia el modelo activo.
- [Agentes y visibilidad](https://opencode.ai/v2/docs/agents#hidden): `hidden` excluye agentes del catálogo de subagentes. Los especialistas de Sol se publican como `mode: subagent` sin ocultarlos; esto no modifica sus permisos ni concede delegación recursiva.
- [Migración v1](https://opencode.ai/v2/docs/build/plugins/migrate-v1): las implementaciones v1 no son plugins v2. Sol no usa los antiguos hooks retornados ni `@opencode-ai/plugin` v1.

El código tipa la superficie nativa que consume, separada de los datos canónicos validados por schemas. No se incorporó una dependencia SDK sin versión publicada y compatible verificada. Estos tipos estructurales y fixtures no equivalen a compilación contra un paquete SDK oficial fijado.

## Consultas acotadas

`sol_status({offset, limit})` enumera todos los frentes del índice, incluidos los ajenos al foco. El límite predeterminado es 10 y el máximo 20; cada página indica el próximo offset.

`sol_work_get({workId, section, offset, limit, itemId, taskId, criterionId})` abre solamente la metadata de ese Work, con validación canónica y sin abrir documentos/evidencias referenciados. `summary` es la vista predeterminada. Las secciones paginadas son `criteria`, `tasks`, `sources`, `claims`, `questions`, `assumptions`, `decisions`, `evidence`, `documents`, `blockers` y `pendingDecisions`; `discovery` muestra el resumen del ledger. `itemId` devuelve el detalle completo del registro seleccionado; para documentos se usa su `path`. Los listados pueden abreviar texto, pero siempre señalan cómo recuperarlo completo.

La consulta por `taskId` incluye las dependencias transitivas y los registros globales pertinentes. La preparación de una tarea se distingue del gate global de cierre. Una consulta no registra aceptación ni convierte evidencia reportada en una prueba ejecutada.

## Qué versión está ejecutándose

`sol_version` captura la identidad del payload al cargar la instancia del plugin y vuelve a leer el manifiesto instalado en cada invocación. Devuelve versión, hash de build y procedencia disponible para ambos, junto con la versión que declara el host. `reloadRequired: true` indica diferencias; `false` exige identidades comparables coincidentes; `unknown` expresa ausencia de evidencia suficiente. No consulta ni inicializa un workspace.

Un archivo instalado o el comando diagnóstico externo no demuestra que OpenCode haya cargado el plugin. Para identificar la instancia activa debe invocarse `sol_version` dentro de esa sesión. El identificador `2.0.20` usado por fixtures no acredita compatibilidad ejecutada con ese host.

## Verificación pendiente en host real

Los tests locales verifican paginación, detalle completo, alcance de lectura, composición/permisos y comparación de versiones con HOME temporal. La aceptación real sigue pendiente: cargar Sol en un OpenCode v2 aislado, comprobar catálogo y herramientas, invocar `sol_version`, resolver dos workspaces distintos, observar delegación nativa y verificar approvals efectivos. No se ejecutaron modelos ni se modificó el perfil personal para esta revisión.
