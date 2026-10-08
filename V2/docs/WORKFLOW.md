# Flujo de trabajo

## Descubrimiento adaptable

Sol integra comprensión de necesidad (resultado, límites, criterios) e investigación de alternativas en la conversación cuando aporten valor; no impone una fase de preguntas. Antes de preguntar un hecho, contrasta fuentes disponibles. Distingue hecho, hipótesis, recomendación y decisión del usuario, y declara fuente/vigencia y desconocidos. Pregunta solo una decisión humana material, con motivo, opciones, consecuencias y recomendación condicional. Adapta el follow-up, incorpora respuestas sin repetir confirmaciones y vuelve a investigar si una respuesta abre una cuestión verificable. Research/spec/plan pueden ser el trabajo que resuelva la incertidumbre; bloquea solo la acción dependiente. Véase [Descubrimiento e investigación](DISCOVERY.md).

Esta guía describe el flujo del producto Sol al trabajar en un workspace OpenCode. No sustituye las [instrucciones para contribuir a este repositorio](../../AGENTS.md), que regulan el alcance de desarrollo y el uso de agentes nativos de desarrollo/CodeGraph. Los especialistas `sol-*` descritos en el [inventario](INVENTORY.md) son parte del producto, no agentes para implementar Sol.

## Dos modos de encargo

**Consulta puntual:** status, recap o lectura de un Work son de solo lectura. No inicializar, crear trabajo ni mapear por ceremonia. Si no hay datos Sol, decirlo con claridad.

**Trabajo planificado:** para un cambio significativo, Sol aclara el resultado y los criterios de aceptación; explora el estado real, propone tareas y dependencias cuando aporten valor y coordina especialistas nativos. El usuario mantiene el control del alcance y aprobaciones. Los permisos configurados en OpenCode siguen vigentes. Para una petición sencilla puede usarse un Work proporcionado y omitir planificación innecesaria, pero sigue registrándose lo que sea útil para continuidad.

Un saludo, onboarding readonly o encargo normal no activa tracking/preparación de `.sol/`; estos requieren intención explícita de inicializar/preparar Sol o `/sol-init`. Si se solicita, el mapeo es diferido: si existe `project.md` suficiente se reutiliza; si falta y mapear es pertinente, el Explorador inspecciona selectivamente, Sol registra fuentes/claims con acciones tipadas y el documento los enlaza con anclas exactas. El ledger se valida según [contrato de mapeo](../skills/sol-discovery/references/context-map.md); un `current` estructural no certifica verdad/cobertura. Legacy puede quedar `legacy_unverified`. No se inventan IDs, revisiones ni resultados.

Ante una petición explícita que vaya a crear/preparar artefactos `.sol/`, Sol consulta tracking del workspace activo. Si ya hay elección Local/Versionado, la reutiliza; si no, propone Local/Versionado y completa preview, confirmación y aprobación host antes de `sol_workspace_prepare`. Sin Git disponible bloquea e informa; no inicializa Git. Un saludo/status, onboarding readonly y encargo ordinario no configuran tracking. `/sol-init` no configura perfil/modelos. Los worktrees pueden compartir metadata Git: no se debe presentar `info/exclude` como necesariamente aislado por worktree.

## Configuración explícita (`/sol-config`)

El asistente nativo tiene tres pasos ordenados: (1) perfil/modelos Sol, (2) modo de tracking de artefactos del repo activo, (3) vista previa y confirmación interactiva nueva. Tras confirmar, la tool mutativa solicita además la aprobación del host; rechazo o falta de aprobación no se describe como cambio aplicado. Si solo se quiere tracking, `/sol-init` o las tools dedicadas no alteran preferencias de modelos.

Perfiles disponibles: **Heredado** (no fija preferencias y deja decidir a OpenCode), **Equilibrado** (asignaciones fijas para futuras delegaciones) y **Personalizado** (mantiene las demás asignaciones y permite cambiar una asignación elegida usando modelos/variantes reales disponibles). El catálogo proviene de `ctx.model.list` de la sesión y su disponibilidad es contextual; no se promete catálogo global. Se valida `provider/model` y variante `#variant` contra entradas habilitadas; no se agrega `#default` implícito. Equilibrado asigna exactamente: `sol` → `openai/gpt-6.1-sol#medium`; `sol-explorer` → `openai/gpt-6-luna#medium`; `sol-executor` → `openai/gpt-6-luna#high`; `sol-researcher`, `sol-planner`, `sol-plan-auditor`, `sol-qa-auditor`, `sol-code-reviewer`, `sol-security-auditor` y `sol-ui-auditor` → `openai/gpt-6.1-sol#high`. No alterna automáticamente entre Terra/Luna ni escala esfuerzo.

Las preferencias se guardan en la configuración global nativa `opencode.jsonc`, en `agents.<id>.model`; no hay un segundo archivo autoritativo de perfiles. El manifest de instalación solo registra propiedad/metadata. No se cambia `model` raíz (modelo principal), providers, permisos, credenciales ni overrides de sesión. El modelo ya seleccionado en la sesión principal puede prevalecer; para elegirlo explícitamente el usuario usa `/models`. Si coexisten `opencode.json` y `opencode.jsonc`, se bloquea por ambigüedad en vez de asumir precedencia. Migrar configuración antigua JSON a JSONC respalda los bytes originales antes de retirar el JSON; se conservan comentarios/ajustes ajenos. Credenciales no se muestran.

Tracking se persiste únicamente en un bloque marcado propio de `.git/info/exclude`, localizado mediante `git rev-parse --git-path`; nunca en configuración global ni en `.sol/`. Puede afectar metadata compartida por worktrees. Local excluye `.sol` solo si no hay artefactos ya versionados; no hace `git rm --cached`. Versionado elimina solo la regla propia y permite que el usuario gestione manualmente `git add`, commit y push: Sol nunca stagea ni sube. No modifica `.gitignore`, excludes globales ni reglas ajenas; si otra regla enmascara el plan lo vuelve a comprobar y revierte el cambio. En un repo que tiene padres, el path del workspace se incluye en la regla. Desinstalar preferencias globales no recorre repos ni elimina las elecciones de `.git/info/exclude`.

## Fuente canónica y escritura

El workspace activo lo determina el contexto de sesión de OpenCode. Los artefactos de coordinación viven en `.sol/`: `state.json` resume trabajos/foco, `work/<id>/work.json` guarda el registro canónico del Work y `history.jsonl` los cierres. Documentos de contexto, informes y archivos del producto quedan asociados por rutas; el código del proyecto sigue siendo fuente primaria para el comportamiento.

Sol lee estado con `sol_status`, `sol_work_get` y `sol_history`; crea y actualiza con tools específicas. `sol_work_apply` recibe acciones semánticas (máximo 20 por lote), valida y escribe una sola revisión. No editar manualmente state/history/work ni crear `work.next.json` para sortear validación. La herramienta devuelve un recibo compacto: confirma una mutación de metadata, no acredita ejecución de tests ni aprobación del contenido.

Cada modificación usa `expectedRevision`. Ante conflicto, releer el Work, revisar cambios y reconciliar; nunca repetir a ciegas ni forzar una versión vieja. Los estados terminales usan close/reopen; reabrir exige motivo. La evidencia se registra con informe, archivos y sus huellas. La comprobación de vigencia no vuelve a ejecutar el comando registrado.

## Delegar y revisar

Sol delega mediante el mecanismo nativo `subagent` de OpenCode. El encargo debe identificar objetivo, criterio, alcance/rutas de escritura y formato de resultado. Las delegaciones deben ser visibles; la distribución no crea scheduler, leases, sesiones ni procesos propios. Asignar scopes de escritura no solapados cuando haya tareas paralelas.

Al recibir un resultado, Sol lo contrasta con los archivos reales, criterios y evidencia antes de actualizar tareas o cerrar. Informe de agente no equivale a prueba independiente. Registra bloqueos, limitaciones y checks no ejecutados como tales. `sol-integration-verification` es una checklist auxiliar, no una certificación ni un agente extra obligatorio.

## Cerrar, continuar y recuperar

Antes de cerrar: verificar criterios con evidencia pertinente y vigente, resumir resultado/limitaciones y usar la revisión actual. Un cierre cancelado registra motivo. El historial permite consultar cierres por ID o fechas; el snapshot de abiertos no es una cronología completa.

Para retomar: consulta status, confirma el mismo ID con `sol_work_get`, revisa el Work canónico y abre solo documentos/evidencia relevantes; `sol_work_get` es un resumen acotado. Pide al Explorador contrastar los cambios/base actuales antes de repetir acciones. Conserva el ID. Recupera fuentes/claims/preguntas y respuestas/supuestos/decisiones (incluidas sustituciones y razones); no repitas respuestas confirmadas. Contrasta contradicciones nuevas y pregunta solo si cambian materialmente decisión, riesgo o alcance.

Valida vigencia de evidencia registrada con `sol_work_validate(fresh:true)`; esto no vuelve a ejecutar comandos ni equivale a acceptance actual. Distingue readiness de implementación y completion: un PASS/cierre histórico no satisface criterios si cambió contrato, binding o fuente. Para el contexto de proyecto, clasifica `not_mapped`, `legacy_unverified`, `stale` o `current` solo a partir de ledger, anclas y fingerprints realmente conservados/verificables; es una síntesis de recuperación, no API/campo nuevo ni certificación semántica. Si no puedes comprobarlo, conserva el límite.

La intención/preview/recibos de Ship preservan destino y scope pero no la autorización privada ligada a sesión. Si esa autoridad no está disponible al retomar, no derives “approved” de metadata/historia: requiere preview vigente, consentimiento y `sol_ship_authorize` con gates del host. Una consulta readonly o un plan no persiste cambios, no reabre Work ni crea delegación formal; puede usar exploración conversacional solo si se pidió evidencia actual. No reinicies fases completas cuando baste corregir la dependencia afectada.

Un Work cerrado solo continúa tras reapertura explícita y motivo con revisión vigente. Si el objetivo no puede identificarse inequívocamente, pregunta.

Si tools detectan datos legacy/incompatibles o un error, conserva los datos, describe el bloqueo y detente para decidir el siguiente paso. No adoptes estados legacy como actuales, no repares silenciosamente ni prometas migración automática.

Para la instalación global, `--dry-run` es estrictamente de solo lectura. Operaciones efectivas que mutan archivos globales generan respaldos de los previos bajo `.sol/backups/<id>/` y `recovery.json`; no se restauran automáticamente tras éxito. Los cambios de tracking respaldan la metadata Git local en una carpeta privada de recuperación del Git común. La recuperación es manual; rollback ante error no protege contra crash ni escritores concurrentes. Consultar [Instalación](INSTALLATION.md).
