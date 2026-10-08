# Instalación y retirada

## Interfaz disponible

Desde `V2/`, con Node.js 22+ y OpenCode v2 en `PATH` para instalar:

```sh
node install.mjs --help
node install.mjs --version
node version.mjs
node install.mjs --dry-run
node install.mjs
node install.mjs --dry-run --profile balanced
node install.mjs --profile balanced
node install.mjs --profile custom --model sol=openai/gpt-6.1-sol#medium
node install.mjs uninstall --dry-run
node install.mjs uninstall
```

La ayuda funciona antes de comprobar Node/OpenCode. La CLI usa texto en español, muestra fases de comprobación/aplicación/retirada, resume archivos y configuraciones legacy detectadas y da siguientes pasos accionables ante errores; no usa TUI ni hace preguntas interactivas. Desinstalar usa el manifest y no requiere detectar OpenCode. La vista previa presenta acciones, destino, clases/rutas de configuración (no su contenido) y retiros previstos. Sin `--profile` se conservan las preferencias de modelos existentes, incluidas las de agentes Sol; una primera instalación sin preferencias sigue heredando las de OpenCode. `--profile inherited` solicita explícitamente retirar las asignaciones Sol reconocidas: revisa `--dry-run --profile inherited` antes de aplicarlo. `--profile balanced` solicita las asignaciones fijas de la [guía de flujo](WORKFLOW.md). Para `custom`, proporciona al menos una opción repetible `--model agente=provider/model#variante`; `inherit` quita una asignación. No se permiten `--model` con otro perfil.

`--dry-run` es de solo lectura: no crea archivos, directorios ni respaldos. La instalación efectiva es global para el usuario, registra recursos propios en `.sol/installation.json` y distribuye plugin, agentes, skills (incluido `sol-config`), comandos, core, schemas, templates y docs. Instala helpers de configuración JSONC, perfiles y tracking, además de recursos de coordinación. Los datos de Work están separados por proyecto. Sin `--profile`, la reinstalación conserva los modelos Sol y ajenos y el modelo principal, incluso si los recursos Sol se sustituyen por completo. Con `--profile`, aplica el perfil pedido a los agentes Sol actuales y limpia asignaciones obsoletas acreditadas por el manifest. Un reset de modelos requiere `--profile inherited` explícito; no borra permisos, prompts ni modelos de agentes ajenos. Tras instalar, reinicia OpenCode, elige `sol` como agente principal y consulta `/sol-version`. Para nuevos comandos/skills instala o actualiza: OpenCode no recibe esos recursos automáticamente antes de aplicar el instalador.

## Casos legacy reconocidos

El descubrimiento se limita a la configuración OpenCode dentro del HOME seleccionado. Reconoce los siguientes casos concretos:

- **`loader-v1` sin manifest:** un `plugins/sol.js` bajo el directorio OpenCode con la firma histórica del loader (id `sol`, método `server`, llamada `SolPlugin`) y una importación `file://…/dist/v2/plugin.js`. Si el patrón no coincide, no se considera propiedad Sol.
- **`sol-install.json` versión 2:** comprueba estructura, `packageRoot`, URL/firma del plugin, rutas absolutas dentro del HOME, archivos regulares y metadatos TUI. Procesa los archivos consignados y referencias exactas del plugin/MCP en ambos archivos de configuración, si existen.

En los casos reconocidos, puede retirar los archivos legacy enumerados, `sol-install.json` y/o `plugins/sol.js`, e instalar los recursos actuales. La limpieza de `opencode.json`/`opencode.jsonc` es selectiva:

- `default_agent` solo si su valor es exactamente `sol`; cuando el manifest guarda un agente anterior distinto de `sol`, vuelve a dejarlo. Un valor como `sol-custom` permanece intacto.
- `plugin`/`plugins`: solo entradas que coinciden con el spec de plugin legacy, como URL exacta o `{ "package": spec }`.
- `mcp.sol` y `mcp.servers.sol`: solo si la entrada coincide con el MCP instalado consignado o con la forma conocida que ejecuta `dist/v2/mcp.js`. No es una limpieza de servidores MCP arbitrarios.
- TUI: solo con manifest v2 y metadatos que declaran propiedad; solo referencia exacta y en `tui.json`, `tui.jsonc`, `cli.json` o `cli.jsonc` permitidos bajo la config de OpenCode.

Los archivos de configuración `opencode.json[c]` pueden editarse para retirar referencias identificadas y, solo si se solicita un perfil, actualizar `agents.<id>.model` de agentes Sol. Se preservan valores no relacionados, incluido modelo raíz, auth y plugins/MCP de terceros. El editor JSONC preserva comentarios/ajustes ajenos; la representación interna de un miembro editado puede cambiar. El contenido íntegro anterior se respalda antes si el archivo va a cambiar.

El asistente `/sol-config` ofrece cambios posteriores con wizard nativo (no TUI CLI): perfil/modelos, tracking del workspace, y preview más confirmación interactiva, seguido de aprobación del host para mutar. Solo preferencias de modelos de agentes Sol están en alcance; no muestra credenciales ni toca providers/permisos/modelo principal. El CLI sí es no interactivo y sirve para instalar con `--profile`; para los cambios posteriores individuales se usa `/sol-config`.

Si existe solo `opencode.json`, migrar preferencias a `opencode.jsonc` crea respaldo privado de los bytes originales antes de retirar el JSON. Si coexisten JSON y JSONC, el instalador consolida en JSONC únicamente claves complementarias o valores equivalentes: recorre objetos, conserva arrays solo si son idénticos y nunca elige una precedencia. Ambos originales se respaldan, se conservan los comentarios del JSONC y se retira el JSON solo al terminar la escritura nueva. Los comentarios del JSON original permanecen en el respaldo. Un valor incompatible detiene todo antes de escribir e identifica la ruta del conflicto sin mostrar sus valores. `/sol-config` por sí solo sigue rechazando dos configuraciones simultáneas; la consolidación corresponde a la instalación. El tracking Local/Versionado no vive en configuración OpenCode ni en el manifest: queda en un bloque propio de `.git/info/exclude`. La instalación/desinstalación no explora repositorios y no elimina elecciones guardadas allí.

## Desconocidos, conflictos y alcance

No se barre por nombre todo lo que contenga `sol`. Un loader `sol.js`, `sol.mjs` o `sol.ts` no reconocido se conserva y bloquea la instalación para evitar cargar dos integraciones; las colisiones con archivos/plugins ajenos, symlinks, rutas fuera de HOME, manifest malformado/no soportado, configuración inválida o referencias cuya propiedad no se puede probar bloquean o quedan sin modificar según el punto del flujo. Una instalación local anterior incompatible no se migra silenciosamente. Revisa siempre `--dry-run`; resuelve conflictos preservando los archivos antes de reintentar.

La limpieza completa se refiere al payload Sol acreditado, no a borrar el perfil del usuario: elimina recursos gestionados obsoletos del manifest e instala el payload actual, sin conservar código Sol obsoleto registrado. También reconoce skills antiguas registradas en `.agents/skills`, `.copilot/skills` y `.claude/skills`; las ajenas o ambiguas requieren revisión. Nunca borra por glob, retira directorios de proyectos ni elimina el repositorio fuente legacy referido por un loader.

El instalador puede reemplazar un recurso Sol conocido que fue editado por el usuario: el manifest prueba su propiedad aunque el contenido haya cambiado. El contenido actual se respalda antes de reemplazarlo/quitarlo. Recursos sin propiedad reconocible no se pisan. `OPENCODE_CONFIG_DIR` externo al HOME se rechaza para no ampliar el límite de administración. No se alteran deliberadamente modelos, permisos ni configuración ajena; sí se limpian selectivamente las referencias de Sol listadas arriba.

La instalación/desinstalación opera en el perfil global, no recorre ni modifica los workspaces. Sus `.sol/` (incluyendo datos legacy como `.sol/store.db`) y reglas de tracking en metadata Git quedan fuera del alcance. La ruta global `.sol/backups/` no es la carpeta de datos de ningún proyecto. El backup de preferencias globales y el respaldo privado de tracking Git tienen alcances distintos; ninguno certifica protección frente a crash, sandbox del SO o interferencia concurrente.

## Respaldos y recuperación

Una operación efectiva que va a mutar archivos crea un respaldo privado en `.sol/backups/<id>/`. Cada archivo previo se almacena como `files/<ruta-original>` y `recovery.json` registra ruta original, ruta de copia y SHA-256. Permisos solicitados: directorio 0700, archivos e índice 0600 cuando la plataforma lo admite. Puede contener secretos de configuraciones previas; no está cifrado, mantenlo protegido.

El respaldo **no se restaura automáticamente** tras una migración/desinstalación exitosa. Para recuperación manual, consulta `recovery.json` y copia el contenido de `files/<ruta-original>` a la ruta original con herramientas del sistema, tras revisar el impacto. Conserva el directorio hasta que decidas que ya no lo necesitas. Una ejecución idempotente sin cambios puede no producir backup; `--dry-run` nunca lo produce.

Antes de aplicar se cotejan las huellas previstas de recursos, configuración y manifest para detectar cambios desde la planificación. Ante un error dentro del proceso, hay rollback en memoria de los archivos tocados y se intenta restaurar el estado previo; el mensaje puede señalar también el respaldo. Esto no es una transacción durable: no garantiza recuperación ante crash, pérdida de energía ni escrituras concurrentes. No equivale a backup externo ni elimina la necesidad de conservarlo.

## Saber qué versión se ejecuta

La identidad central de esta distribución está en `release.json` (Sol 2.1.0). El instalador genera `.sol/release.json` y la identidad del manifest con un `buildHash` SHA-256 determinista sobre el payload canónico, sin timestamps ni rutas HOME; el manifest generado no entra en su propia huella. `baseCommit` identifica la base de desarrollo. `sourceCommit` permanece `null` cuando no existe un commit exacto de release verificado, y no se presenta la base como si contuviera los cambios actuales.

- `node install.mjs --version` identifica la distribución que ejecuta ese comando y no instala nada.
- `node version.mjs` desde `V2/`, o `node ~/.sol/version.mjs` después de instalar, muestra la identidad cargada por ese **proceso CLI** y la registrada en disco. No certifica el proceso OpenCode.
- `/sol-version` invoca `sol_version` en el plugin nativo: el snapshot `loaded` se captura al cargar su módulo; `installed` se lee del manifest vigente. Una discrepancia requiere reiniciar OpenCode y volver a consultar. La identidad registrada no es una firma ni una comprobación de integridad de cada archivo en vivo.

Actualizar archivos no prueba que OpenCode haya descartado su caché o cargado el nuevo plugin. No se promete invalidación automática de caché ni una sesión live validada por ejecutar la CLI.

## Validación

Las pruebas del instalador usan perfiles/HOME temporales, incluyendo dry-run sin efectos, reemplazo respaldado, migración legacy reconocida, conflictos y preservación de datos de proyecto. No se ejecutó el instalador contra el HOME real ni se probó OpenCode live en esta revisión de documentos; consulta [Validación](VALIDATION.md) para distinguir evidencia automatizada de aceptación nativa.


### Actualización a workflow conversacional

La composición instala únicamente los dispatchers Markdown `sol-init` y `sol-config`; `sol-version` se registra de forma nativa en el plugin. No se instalan comandos para new-project, onboard, discuss, plan, execute, verify, ship, status, recap ni resume: sus skills permanecen cargables por Sol durante la conversación. La actualización retira los dispatchers anteriores solo cuando su propiedad está acreditada en el manifest, conserva comandos ajenos y respalda los recursos retirados. Una colisión no acreditada bloquea la instalación sin borrarla. Pedir trabajo ordinario no inicializa automáticamente el contexto persistente.
