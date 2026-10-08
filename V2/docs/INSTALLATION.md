# Instalación y retirada

## Interfaz disponible

Desde `V2/`, con Node.js 22+ y OpenCode v2 en `PATH` para instalar:

```sh
node install.mjs --help
node install.mjs --dry-run
node install.mjs
node install.mjs --dry-run --profile balanced
node install.mjs --profile balanced
node install.mjs --profile custom --model sol=openai/gpt-6.1-sol#medium
node install.mjs uninstall --dry-run
node install.mjs uninstall
```

La ayuda funciona antes de comprobar Node/OpenCode. La CLI usa texto en español, muestra fases de comprobación/aplicación/retirada, resume archivos y configuraciones legacy detectadas y da siguientes pasos accionables ante errores; no usa TUI ni hace preguntas interactivas. Desinstalar usa el manifest y no requiere detectar OpenCode. La vista previa presenta acciones, destino, clases/rutas de configuración (no su contenido) y retiros previstos. El perfil por omisión es `inherited`; `--profile balanced` solicita las asignaciones fijas de la [guía de flujo](WORKFLOW.md). Para `custom`, proporciona al menos una opción repetible `--model agente=provider/model#variante`; `inherit` quita una asignación. No se permiten `--model` con otro perfil.

`--dry-run` es de solo lectura: no crea archivos, directorios ni respaldos. La instalación efectiva es global para el usuario, registra recursos propios en `.sol/installation.json` y distribuye plugin, agentes, skills (incluido `sol-config`), comandos, core, schemas, templates y docs. Instala helpers de configuración JSONC, perfiles y tracking, además de recursos de coordinación. Los datos de Work están separados por proyecto. Sin `--profile`, la instalación deja los modelos heredados y limpia solo asignaciones obsoletas de Sol que el manifest previo acredita como propias; conserva preferencias ajenas y el modelo principal. Con `--profile`, aplica el perfil pedido. No limpia modelos personalizados/unrelated sin metadata de propiedad. Tras instalar, reinicia OpenCode y elige `sol` como agente principal. Para nuevos comandos/skills instala o actualiza: OpenCode no recibe esos recursos automáticamente antes de aplicar el instalador.

## Casos legacy reconocidos

El descubrimiento se limita a la configuración OpenCode dentro del HOME seleccionado. Reconoce los siguientes casos concretos:

- **`loader-v1` sin manifest:** un `plugins/sol.js` bajo el directorio OpenCode con la firma histórica del loader (id `sol`, método `server`, llamada `SolPlugin`) y una importación `file://…/dist/v2/plugin.js`. Si el patrón no coincide, no se considera propiedad Sol.
- **`sol-install.json` versión 2:** comprueba estructura, `packageRoot`, URL/firma del plugin, rutas absolutas dentro del HOME, archivos regulares y metadatos TUI. Procesa los archivos consignados y configuración asociada al manifest.

En los casos reconocidos, puede retirar los archivos legacy enumerados, `sol-install.json` y/o `plugins/sol.js`, e instalar los recursos actuales. La limpieza de `opencode.json`/`opencode.jsonc` es selectiva:

- `default_agent` solo si su valor es exactamente `sol`; cuando el manifest guarda un agente anterior distinto de `sol`, vuelve a dejarlo. Un valor como `sol-custom` permanece intacto.
- `plugin`/`plugins`: solo entradas que coinciden con el spec de plugin legacy, como URL exacta o `{ "package": spec }`.
- `mcp.sol` y `mcp.servers.sol`: solo si la entrada coincide con el MCP instalado consignado o con la forma conocida que ejecuta `dist/v2/mcp.js`. No es una limpieza de servidores MCP arbitrarios.
- TUI: solo con manifest v2 y metadatos que declaran propiedad; solo referencia exacta y en `tui.json`, `tui.jsonc`, `cli.json` o `cli.jsonc` permitidos bajo la config de OpenCode.

Los archivos de configuración `opencode.json[c]` pueden editarse para retirar referencias identificadas y, solo si se solicita un perfil, actualizar `agents.<id>.model` de agentes Sol. Se preservan valores no relacionados, incluido modelo raíz, auth y plugins/MCP de terceros. El editor JSONC preserva comentarios/ajustes ajenos; la representación interna de un miembro editado puede cambiar. El contenido íntegro anterior se respalda antes si el archivo va a cambiar.

El asistente `/sol-config` ofrece cambios posteriores con wizard nativo (no TUI CLI): perfil/modelos, tracking del workspace, y preview más confirmación interactiva, seguido de aprobación del host para mutar. Solo preferencias de modelos de agentes Sol están en alcance; no muestra credenciales ni toca providers/permisos/modelo principal. El CLI sí es no interactivo y sirve para instalar con `--profile`; para los cambios posteriores individuales se usa `/sol-config`.

Si existe solo `opencode.json`, migrar preferencias a `opencode.jsonc` crea respaldo privado de los bytes originales antes de retirar el JSON. Si coexisten JSON y JSONC, se bloquea por precedencia ambigua; no se adivina cuál prevalece. El tracking Local/Versionado no vive en configuración OpenCode ni en el manifest: queda en un bloque propio de `.git/info/exclude`. La instalación/desinstalación no explora repositorios y no elimina elecciones guardadas allí.

## Desconocidos, conflictos y alcance

No se barre por nombre todo lo que contenga `sol`. Un loader no reconocido se deja intacto; las colisiones con archivos/plugins ajenos, symlinks, rutas fuera de HOME, manifest malformado/no soportado, configuración inválida o referencias cuya propiedad no se puede probar bloquean o quedan sin modificar según el punto del flujo. Una instalación local anterior incompatible no se migra silenciosamente. Revisa siempre `--dry-run`; resuelve conflictos preservando los archivos antes de reintentar.

El instalador puede reemplazar un recurso Sol conocido que fue editado por el usuario: el manifest prueba su propiedad aunque el contenido haya cambiado. El contenido actual se respalda antes de reemplazarlo/quitarlo. Recursos sin propiedad reconocible no se pisan. `OPENCODE_CONFIG_DIR` externo al HOME se rechaza para no ampliar el límite de administración. No se alteran deliberadamente modelos, permisos ni configuración ajena; sí se limpian selectivamente las referencias de Sol listadas arriba.

La instalación/desinstalación opera en el perfil global, no recorre ni modifica los workspaces. Sus `.sol/` (incluyendo datos legacy como `.sol/store.db`) y reglas de tracking en metadata Git quedan fuera del alcance. La ruta global `.sol/backups/` no es la carpeta de datos de ningún proyecto. El backup de preferencias globales y el respaldo privado de tracking Git tienen alcances distintos; ninguno certifica protección frente a crash, sandbox del SO o interferencia concurrente.

## Respaldos y recuperación

Una operación efectiva que va a mutar archivos crea un respaldo privado en `.sol/backups/<id>/`. Cada archivo previo se almacena como `files/<ruta-original>` y `recovery.json` registra ruta original, ruta de copia y SHA-256. Permisos solicitados: directorio 0700, archivos e índice 0600 cuando la plataforma lo admite. Puede contener secretos de configuraciones previas; no está cifrado, mantenlo protegido.

El respaldo **no se restaura automáticamente** tras una migración/desinstalación exitosa. Para recuperación manual, consulta `recovery.json` y copia el contenido de `files/<ruta-original>` a la ruta original con herramientas del sistema, tras revisar el impacto. Conserva el directorio hasta que decidas que ya no lo necesitas. Una ejecución idempotente sin cambios puede no producir backup; `--dry-run` nunca lo produce.

Ante un error dentro del proceso, hay rollback en memoria de los archivos tocados y se intenta restaurar el estado previo; el mensaje puede señalar también el respaldo. Esto no es una transacción durable: no garantiza recuperación ante crash, pérdida de energía ni escrituras concurrentes. No equivale a backup externo ni elimina la necesidad de conservarlo.

## Validación

Las pruebas del instalador usan perfiles/HOME temporales, incluyendo dry-run sin efectos, reemplazo respaldado, migración legacy reconocida, conflictos y preservación de datos de proyecto. No se ejecutó el instalador contra el HOME real ni se probó OpenCode live en esta revisión de documentos; consulta [Validación](VALIDATION.md) para distinguir evidencia automatizada de aceptación nativa.
