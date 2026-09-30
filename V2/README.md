# Sol · OpenCode v2

Sol es un **Asistente IA para desarrollo** que orquesta especialistas nativos de OpenCode v2 y conserva planes, contexto, trabajos, estado e historial en `.sol/`. Sus delegaciones siguen siendo llamadas nativas inspeccionables; el plugin ofrece tools semánticas con recibos breves para reducir ruido de escrituras.

El core valida y persiste artefactos localmente. Sol no es runtime de agentes, MCP server, daemon, scheduler ni base de datos. OpenCode v2 es el único runtime distribuido; OpenCode v1 se rechaza y VS Code queda fuera hasta tener un adaptador propio.

## Instalar

Requiere Node.js 22+ y OpenCode v2 disponible en `PATH`:

```sh
node install.mjs
```

Para comprobar la vista previa sin escribir:

```sh
node install.mjs --dry-run
```

Después reinicia OpenCode y selecciona `sol` como agente principal. La instalación administra agentes, comandos, skills, plugin y core globales; cada workspace conserva sus propios datos `.sol/`. Para desinstalar recursos globales:

```sh
node install.mjs uninstall
```

El instalador no modifica la configuración del host, MCP, credenciales, modelos ni permisos del usuario. [Detalles](docs/INSTALLER.md).

## Uso

- `/sol-status`: consultar el snapshot guardado.
- `/sol-recap`: resumir cierres recientes y trabajos abiertos.
- `/sol-resume`: retomar un Work existente.
- `/sol-init`: solicitar contexto inicial cuando haga falta.

Las tools `sol_work_create`, `sol_work_apply`, `sol_work_close` y `sol_work_reopen` mantienen el estado canónico. Las mutaciones requieren revisión esperada; los lotes se validan y escriben una vez. Las delegaciones a especialistas permanecen visibles. El recibo no es una prueba de calidad ni de ejecución semántica.

Un saludo no inicia herramientas ni prepara el workspace. La preparación solo ocurre ante el primer encargo concreto o `/sol-init`. Datos legacy o incompatibles se preservan y bloquean; no se migran automáticamente.

## Verificación y desarrollo

```sh
cd v2
npm run build
npm run verify
```

Las pruebas offline cubren core, schemas, plugin assets y migración del instalador. No equivalen a smoke test de TUI ni a aceptación live de modelos/tools; esos criterios quedan `NOT_RUN` hasta validarse en OpenCode v2 real.

[Arquitectura](docs/ARCHITECTURE.md) · [Runtime](docs/RUNTIMES.md) · [Instalador](docs/INSTALLER.md) · [Operaciones](docs/OPERATIONS.md) · [Seguridad](docs/SECURITY.md).
