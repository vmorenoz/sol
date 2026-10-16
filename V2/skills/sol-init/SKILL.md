---
name: sol-init
description: Integrar las exploraciones del init nativo y publicar su mapa trazable sin reiniciar el bootstrap.
slash: false
---
# Integración del init nativo

Esta skill es la guía de Sol después del dispatcher nativo `/sol-init`, no un dispatcher Markdown ni una orden para que el modelo inicialice el proyecto. Cargarla no crea tracking, Work o sesiones. Un saludo, consulta de estado o encargo ordinario nunca activa init.

## Preparación y exploración nativas

El comando TUI inicia el flujo sin un turno inicial de Sol. El bootstrap exige tracking Local/Versionado previamente configurado y autorizado; si falta o está bloqueado, se detiene antes de preparar `.sol`. No inicializa Git ni cambia modelos. La UI de tracking y el permiso efectivo del host son requisitos del bridge: no declares aprobación ni compatibilidad live por leer esta guía o por pasar fixtures.

El core reserva o recupera un Work `initialization.kind: native-init` y sus tareas reales antes del despacho. Según unidades locales detectadas superficialmente, asigna uno o varios Exploradores con lecturas selectivas y outputs disjuntos `.sol/work/<workId>/context/<taskId>.md`. Esa selección no prueba arquitectura. Los hijos no escriben `.sol/project.md`, no editan producto ni mutan metadata. El host gestiona las sesiones; sus IDs y resultados se conservan para no duplicar lanzamientos ante repetición o respuesta incierta. Bootstrap, registro de hijos, resultados y continuación pertenecen al flujo nativo, no a herramientas del modelo ni a scripts invocados por Sol.

## Integración por Sol

1. Recibe la continuación nativa y consulta `sol_init_get({workId})`. Usa el workspace real, las revisiones, tareas, rutas y resultados devueltos. No inventes IDs ni recrees el Work; no vuelvas a despachar hijos que ya tienen resultado. La ejecución nativa decide la continuación, no un polling o scheduler propio.
2. Lee las entregas exactas y contrasta las referencias necesarias. Un resultado `completed` significa entrega recibida, no aceptación global; las tareas permanecen pendientes de integración. Si hay hijos pendientes, fallidos o entregas alteradas, conserva avances y comunica el alcance parcial/bloqueo. No publiques ni cierres un mapa completo con una rama fallida; no conviertas límites en PASS.
3. Integra lo observado en Discovery mediante `sol_work_apply`: `discovery.context.set`, `discovery.source.add` y `discovery.claim.add`. Los prefijos de fuentes/claims propuestos por cada hijo evitan colisiones; verifica IDs, contenido y procedencia antes de registrarlos. El core calcula hashes de paths locales; no envíes hashes ni provenance inventados. No registres documentos/evidencias de cierre manualmente ni cambies los contratos reservados de init.
4. Compón una sola vista narrativa `project@1.0` siguiendo `sol-discovery/references/context-map.md` y la plantilla `project.md`. Cada claim incluido conserva statement literal y anclas `<!-- claim:ID --> <!-- source:ID -->`. Distingue observación, hipótesis, intención y desconocidos; no declares actualizadas áreas no inspeccionadas.
5. Publica exclusivamente con `sol_init_project_publish({workId, expectedRevision, expectedProjectSha256, content})`, usando revisión vigente y la base `projectBaseSha256` o `publishedSha256` observada en el snapshot. Esta herramienta estrecha solo publica `.sol/project.md` del init y valida ledger, entregas y base antes de escribir. No sustituyas un rechazo por shell/write/edit ni regeneres hashes para ocultar cambios ajenos.
6. Solo con todas las entregas completadas y el mapa publicado vigente, llama `sol_init_complete({workId, expectedRevision, summary, limitations})` con la revisión devuelta por publicación. El core vincula evidencia estática a todas las tareas y conserva las entregas antes del cierre. No uses `sol_project_complete_map`: ese helper de compatibilidad para un único mapa no completa el init nativo de varios hijos.
7. Entrega al usuario el resultado útil, mapa y límites reales. El cierre estructural no demuestra ejecución del producto, verdad semántica, aprobación humana ni validación live del host.

## Recuperación

Ante resultado incierto, consulta el snapshot/Work antes de repetir. Un conflicto de base exige reconciliar; no sobreescribas project.md ajeno. Conserva entregas históricas y no relances automáticamente un hijo fallido ya registrado. Un nuevo alcance o ciclo se realiza mediante el flujo nativo compatible, no reabriendo y alterando contratos de init a mano. Si falta una tool o el bridge está bloqueado, informa la parte pendiente y conserva resultados; no afirmes que se reanudó ni que init terminó.
