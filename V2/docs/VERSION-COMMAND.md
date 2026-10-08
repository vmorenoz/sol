# `/sol-version`: diagnóstico estático

En OpenCode v2 CLI, `/sol-version` abre un diálogo local con la versión y el build de Sol capturados al cargar el módulo, la instalación actual en disco, la versión informada por OpenCode y `reloadRequired`. También aparece en la paleta como «Versión de Sol».

El comando no invoca ningún modelo, no carga skills, no envía prompts, no agrega mensajes sintéticos y no requiere una sesión ni inicializa el workspace. Repetirlo vuelve a consultar la instalación; no reemplaza la identidad capturada del módulo cargado. Un manifiesto ausente o ilegible muestra incertidumbre, no igualdad de builds.

## Frontera nativa

- Entrada CLI: `plugins/opencode-v2/tui.ts`, exportada como `./tui` en el paquete.
- Registro: `keymap.layer`, `slash.name: "sol-version"`.
- Salida: `ui.dialog.alert`, fuera del historial que consume el modelo.
- Formato compartido con la herramienta existente `sol_version` mediante `version-view.mjs`.
- No existe una plantilla Markdown `/sol-version` que pueda reenviar la consulta al modelo.

La entrada del servidor sigue exponiendo `sol_version`. La herramienta identifica la instancia del servidor; el diálogo identifica la instancia CLI local. Contra un servidor remoto, el diálogo no acredita el build del servidor, y lo indica expresamente. No se afirma soporte para este slash en la interfaz web ni otros clientes.

El paquete exporta `./tui` junto con la entrada principal para la carga automática descrita en la [documentación oficial CLI](https://opencode.ai/v2/docs/build/plugins/cli/). El core no añade dependencias; usa la forma estructural `id`/`setup` del plugin. El host administra la vida útil de la capa. Si el host no soporta esta API, no hay fallback a una consulta al modelo.

## Verificación acotada

`node --test tests/native-tools.test.mjs` comprueba la salida, conservación de la identidad cargada, detección del cambio de instalación, registro slash/paleta, ausencia de acceso a modelo/sesión/cliente y presencia de ambas entradas en el payload compuesto. Los contextos del host son fixtures; esto no equivale a una validación live del renderizado, carga del plugin o conteo de tokens en OpenCode.

Validación live pendiente: instalar el payload completo, reiniciar OpenCode v2 CLI, ejecutar `/sol-version`, comprobar el diálogo y verificar que no aparece ninguna generación ni mensaje nuevo en la sesión.
