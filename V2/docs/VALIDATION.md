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

## Verificación de esta revisión

El 1 de octubre de 2026 se ejecutaron `npm run build` y `npm run verify` desde `V2/` antes de integrarse los cambios de documentación de esta revisión. `build` terminó correctamente: composición en memoria de 21 archivos, sin salidas generadas. `verify` terminó **PASS**: checks estructurales correctos y 105 tests (105 pasaron, 0 fallaron, 0 omitidos). Esa cifra es una observación anterior, no valida helpers/configuración/tracking incorporados después ni esta revisión documental. No se ha ejecutado aquí una verificación final; no presentar el conteo 105 como gate actual. Las pruebas anteriores no sustituyen aceptación live.

También se comprobó `node install.mjs --help` y `node install.mjs uninstall --dry-run` con un `HOME` temporal vacío; la vista previa no indicó escrituras ni retiros. `git diff --check` y comparación contra V1 descritos en el registro previo no cubren los cambios posteriores.

No se instaló contra el HOME real, no se aplicó tracking al repo de usuario, no se modificó configuración global y no se probó sesión live de OpenCode v2; `nativeRuntime` queda **NOT_RUN**. No se verificó el catálogo de modelos en sesión real, wizard con confirmación/aprobación host ni la precedencia de modelo seleccionado en una sesión concreta. Las pruebas automatizadas usan fixtures/perfiles/Git temporales y no demuestran integración live, aprobación de herramientas ni permisos efectivos. Instalación real también **NOT_RUN**; requiere instalar/actualizar y reiniciar OpenCode antes de evaluar los nuevos recursos.
