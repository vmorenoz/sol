# Validación y evidencia

## Verificación local

Desde `V2/`:

```sh
npm run build
npm run verify
```

`build` compone recursos nativos. `verify` ejecuta `scripts/check.mjs` y `node --test tests/*.test.mjs`; son checks y pruebas automatizadas locales. Las pruebas de módulos nuevos usan repositorios Git temporales para tracking, fixtures/perfiles temporales para JSONC/modelos/instalación y contextos simulados. No son una escritura de Git metadata del usuario ni una prueba de LLM, catálogo global, OpenCode real, sesión de agente, delegación, prompt final o permisos efectivos.

Para informar resultado, distinguir explícitamente: comando ejecutado, PASS/FAIL, tests cubiertos, mocks/fixtures y límites. No reutilizar un PASS anterior como prueba de un cambio posterior.

## Diagnóstico local de preflight Git

Los fallos del wrapper de `lib/shipping-snapshot.mjs` conservan el prefijo `Snapshot Git readonly incompleto (<comando>).` y añaden JSON con una operación estable (`root`, `HEAD`, `base`, etc.), el `cwd` efectivo enviado al proceso y `status`, `signal`, `code` cuando se observaron. Un `null` observado se conserva; un campo ausente no se inventa ni se interpreta como éxito. El fallo sigue bloqueando el snapshot. La observación opcional de publicación sigue devolviendo estado desconocido cuando falla, sin acreditar publicación.

No se muestran argv, stdout, mensajes arbitrarios de excepciones, entorno ni configuración. `stderr` se reduce a un catálogo acotado de motivos reconocibles, sin argumentos ni URLs; el resto se marca como omitido, también en mensajes localizados desconocidos. No es una copia completa del error: puede perder detalle y no demuestra por sí solo la causa original. El directorio conserva espacios, se limita a 1000 caracteres y elimina controles y componentes con patrones de credenciales/URLs. Este saneamiento de rutas es heurístico: un secreto arbitrario sin patrón dentro del nombre de un directorio no es distinguible de un nombre legítimo. Revisar la ruta antes de compartir el diagnóstico externamente.

`node --test tests/shipping-snapshot-diagnostics.test.mjs` cubre fallos por operación y resultados de proceso simulados, saneamiento y Git real en una carpeta temporal con espacios. No instala el producto ni demuestra el comportamiento del servidor OpenCode o un cambio de ubicación de sesión live; tampoco acredita que se haya corregido la causa del preflight original.

## Aceptación live

La aceptación de integración requiere una instalación de prueba revisada (idealmente perfil/configuración aislado), OpenCode v2 real, reinicio, selección de `sol`, activación de tools y comandos, una consulta/encargo, delegación nativa observable y comprobación de datos/workspace y permisos. El instalador debe probarse con vista previa, instalación, repetición idempotente, conflictos, recursos legacy, backup/limpieza y desinstalación, preservando archivos ajenos y datos de proyectos.

No instalar o modificar el perfil personal para fingir aceptación. Registrar por separado los pasos no ejecutados o bloqueados. La tool `sol_work_validate` valida coherencia del workspace (y opcionalmente huellas de evidencia); no ejecuta la suite del producto ni valida integración live.

## Registro histórico previo

El 1 de octubre de 2026 se ejecutaron `npm run build` y `npm run verify` desde `V2/` antes de integrarse los cambios de documentación de esta revisión. `build` terminó correctamente: composición en memoria de 21 archivos, sin salidas generadas. `verify` terminó **PASS**: checks estructurales correctos y 105 tests (105 pasaron, 0 fallaron, 0 omitidos). Esa cifra es una observación anterior, no valida helpers/configuración/tracking incorporados después ni esta revisión documental. No se ha ejecutado aquí una verificación final; no presentar el conteo 105 como gate actual. Las pruebas anteriores no sustituyen aceptación live.

También se comprobó `node install.mjs --help` y `node install.mjs uninstall --dry-run` con un `HOME` temporal vacío; la vista previa no indicó escrituras ni retiros. `git diff --check` y comparación contra V1 descritos en el registro previo no cubren los cambios posteriores.

No se instaló contra el HOME real, no se aplicó tracking al repo de usuario, no se modificó configuración global y no se probó sesión live de OpenCode v2; `nativeRuntime` queda **NOT_RUN**. No se verificó el catálogo de modelos en sesión real, wizard con confirmación/aprobación host ni la precedencia de modelo seleccionado en una sesión concreta. Las pruebas automatizadas usan fixtures/perfiles/Git temporales y no demuestran integración live, aprobación de herramientas ni permisos efectivos. Instalación real también **NOT_RUN**; requiere instalar/actualizar y reiniciar OpenCode antes de evaluar los nuevos recursos.

## Revisión 2.1 — 8 de octubre de 2026

En el entorno remoto se verificaron los checks estructurales y un happy path de paquete (`npm_config_cache=/tmp/sol-npm-cache node --test tests/package-payload.test.mjs`): tarball, instalación aislada y plugin sobre dos raíces de sesión. El primer intento falló por caché npm no escribible del entorno; repetir con caché temporal pasó. Las pruebas focalizadas de contratos/instalación y sus límites están resumidas en la entrega. No se afirma que estas comprobaciones ejecuten OpenCode ni un modelo real. `nativeRuntime` y aceptación conversacional siguen **NOT_RUN**.

Ver [cambios e instrucciones de prueba](HARDENING-2.1.md).

Cierre de esta revisión (snapshot final antes de publicar): `node scripts/check.mjs` **PASS** y `node --test tests/package-payload.test.mjs tests/install-clean.test.mjs tests/scoped-readiness.test.mjs tests/native-tools.test.mjs` **13/13 PASS**, sin skips, en aproximadamente 1,3 segundos de pruebas. `git diff --check` **PASS**. Incluye el happy path de paquete/plugin simulado, limpieza y preservación de configuración, rollback en proceso, scopes, decisiones, paginación y comparación de versiones. No se ejecutó la suite completa ni una conversación con modelos. Los escenarios de diálogo documentados son criterios para pruebas reales, no resultados observados.

## Revisión 2.2.0 — 8–9 de octubre de 2026

La [auditoría 2.2](AUDIT-2.2.md) registra correcciones y límites de esta revisión. El check estructural y los 17 tests focalizados de orquestación, recuperación y workflow conversacional pasan. Los slash init/version son TUI nativos; únicamente config conserva dispatcher Markdown. Son tres slash públicos; cancelar init es una acción de paleta, sin slash adicional.

El bridge servidor/TUI ya está implementado contra el contrato oficial de OpenCode, paquete `@opencode/plugin` 2.0.24 (revisión `5b312918ecd673fdcc76094471a87067f0fa36e7`), con correlación de eventos nativos, nonce e input hash. RPC permite describir/cancelar, nunca aprobar. El timeout de diez segundos cubre conexión inicial, no deliberación del usuario. La verificación final reporta check estructural PASS y 36 tests focalizados de servidor/core/payload/contratos PASS. Separadamente, init-dispatch y permission-ui pasan 29/29, incluida carga del archivo real `tui.ts`, registro de slash/paleta y cancelación en curso correlacionada al prompt exacto. No se suman los grupos porque sus ámbitos pueden solaparse. El smoke final de entrada TUI pasa con fixtures; OpenCode live continúa pendiente. Esta evidencia con fixtures no sustituye aceptación live del bridge ni prueba de permisos efectivos; no acredita publicación o instalación en el perfil personal.

## Integración de prácticas upstream — 16 de octubre de 2026

`npm run build` **PASS**, composición en memoria de 58 archivos OpenCode v2; no escribió salidas generadas. `npm run verify` ejecutó el check estructural (**11 checks PASS**) y **331 tests: 325 PASS, 6 FAIL, 0 omitidos**. Los seis fallos observados son los fallos históricos conocidos: tres harness que no proporcionan `ctx.permission.hook` (`artifact-integration`, `config-plugin`, `contract-coherence`); contrato stale de init en `artifact-integration`; fallo de rollback esperado en `install-clean`; expectativa antigua de dispatcher init en `install`. No se corrigieron fuera de scope. El primer verify de esta integración encontró además un error nuevo en la resolución de destino instalado del mapa (`context-engineering` apuntaba a `agents/common.md`, que no se distribuye como archivo independiente); se corrigió a agentes compuestos reales. El verify final volvió a **6 FAIL**, sin regresiones adicionales.

Después de la corrección, `node --test tests/engineering-practices.test.mjs` **3/3 PASS**, `node scripts/check.mjs` **11 checks PASS** y `node --test tests/package-payload.test.mjs` **1/1 PASS**. Estos validan mapa de 25 entradas, base de rutas `skill-root`, destinos en fuente y paquete instalado, bytes de recursos compuestos/instalados y avisos MIT en discovery/engineering. Son verificaciones estructurales y de paquete temporal, no conducta de modelo. La evaluación sintética fue ejecutada por un agente general nativo durante esta integración con fuentes ficticias; es observación cualitativa, no aceptación live de Sol ni medición estadística de mejora. `nativeRuntime` y aceptación live continúan **NOT_RUN**.

## Instalación personal y smoke live — 16 de octubre de 2026

Tras la vista previa `node install.mjs --dry-run`, se ejecutó `node install.mjs` en `V2/`, sin opciones de perfil/modelo. El instalador informó Sol **2.2.1**, build `fd4170dc5a38ce4f5e0f1a5b02242215056b990b55d159488193101a00c1e04d`, OpenCode **v2.0.29**, 15 archivos nuevos, 23 actualizados, 88 sin cambios y 0 retirados. El perfil `custom` y las preferencias existentes se conservaron; 0 cambios de modelos. El registro de instalación apunta a `.config/opencode/opencode.jsonc` dentro del HOME. Se conserva deliberadamente el respaldo protegido por el instalador en `/Users/victormoreno/.sol/backups/2026-10-16T06-02-10-318Z-45901-5266338428902916` (modo `0700`); no se restauró ni eliminó.

La skill quedó instalada bajo `/Users/victormoreno/.config/opencode/skills/sol-engineering-practices/`. En un proceso OpenCode standalone nuevo, una llamada real a `sol_version` identificó versión/build cargados iguales a la instalación, OpenCode `2.0.29` y `reloadRequired: false`. El primer smoke interactivo investigó un proyecto sintético bajo `/private/tmp/sol-live-smoke.NTx3kGju`: Sol leyó el SPEC, README, implementación y tests; `sol-researcher` confirmó que el SPEC aprobado prevalecía sobre el README borrador. Después, `opencode run --standalone --agent sol --session ses_ebcac6c5bffe94l7Euw3fzqYIM --format json` continuó la misma conversación con autorización explícita de edición limitada a `src/price.js`, `test/price.test.js` y `README.md`, y lectura de skills instaladas.

El flujo JSON de OpenCode registró `sol-executor` (`ses_ebca6deedffeBIW4wH5yWozMzt`) y luego `sol-code-reviewer` (`ses_ebca5e4f7ffeplgcYeKVVtJllS`). Se observaron llamadas reales a `skill`, `read`, `patch` y `shell`; el executor revisó `package.json`, ejecutó `npm test` (**4 PASS, 0 FAIL**) y el reviewer leyó los tres archivos finales. En seguimientos se cargó `sol-engineering-practices` y se leyó `references/implementation.md`, `references/testing.md` y `references/review.md`. La implementación aplica el porcentaje al subtotal, valida los límites prescritos, redondea al final y alinea el README. La revisión encontró un posible desbordamiento para magnitudes extremas (`Number.MAX_VALUE`), deducido estáticamente y **no reproducido**; se conserva como riesgo abierto, fuera de la regla aprobada. No se afirma mejora medida ni aceptación integral por ese resultado.

**Límites live:** el Research conversacional y la delegación fueron observados en TUI; la implementación, revisión y pruebas ocurrieron por la ruta headless standalone. La entrada PTY `/sol-init`/comando slash no quedó verificada, init no se ejecutó y no se probaron su selector de tracking ni sus permisos TUI. No se observaron solicitudes `ask` en el flujo headless ni se usó `--auto`; por tanto, permisos efectivos del flujo de init siguen **NOT_RUN**. El smoke no accedió a red, no instaló dependencias y no hizo commits/push. La suite V2 final y `git diff --check` fueron reportados por otro general como **PASS** (`npm run build`: 58 recursos; `npm run verify`: 331/331, 0 fallos, 0 omitidos; diff check: 0); no se repitieron aquí.

Se borró mediante `opencode session delete` la sesión Sol `ses_ebcac6c5bffe94l7Euw3fzqYIM` y sus sesiones hijas (Researcher `ses_ebcac42fdffesVOQhBuru71weN`, Executor y Reviewer), además de la sesión propia de versión `ses_ebcb11503ffe7xH1cxLa7oP4a6`. La exportación posterior confirmó las cinco sesiones ausentes. Se eliminó únicamente `/private/tmp/sol-live-smoke.NTx3kGju`, incluidos los logs `tui.log`, `full-tui.log`, `live-tui.log` e `init-tui.log`; la ruta y esos logs se comprobaron ausentes. No quedaron procesos standalone propios. El respaldo privado de instalación permanece conservado.
