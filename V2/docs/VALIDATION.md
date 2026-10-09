# Validación y evidencia

## Verificación local

Desde `V2/`:

```sh
npm run build
npm run verify
```

`build` compone recursos nativos. `verify` ejecuta `scripts/check.mjs` y `node --test tests/*.test.mjs`; son checks y pruebas automatizadas locales. Las pruebas de módulos nuevos usan repositorios Git temporales para tracking, fixtures/perfiles temporales para JSONC/modelos/instalación y contextos simulados. No son una escritura de Git metadata del usuario ni una prueba de LLM, catálogo global, OpenCode real, sesión de agente, delegación, prompt final o permisos efectivos.

Para informar resultado, distinguir explícitamente: comando ejecutado, PASS/FAIL, tests cubiertos, mocks/fixtures y límites. No reutilizar un PASS anterior como prueba de un cambio posterior.

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
