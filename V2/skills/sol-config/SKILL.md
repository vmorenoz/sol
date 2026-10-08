---
name: sol-config
description: Configurar en dos pasos perfiles globales fijos de modelos Sol y tracking local del repo activo, con previews y confirmación nativa.
---

# Asistente de configuración Sol

Atiende solo una petición explícita. No inicialices `.sol`, no crees Work y no edites archivos con shell/write/edit. Este asistente tiene dos pasos ordenados: primero perfil/modelos globales de los diez agentes Sol; después modo de tracking Local/Versionado del repo Git actual. El tracking es estrictamente local a este repo y nunca una preferencia global.

No gestiones providers, credenciales, permisos, ajustes globales ajenos a modelos Sol, reglas Git compartidas, staging, commits/pushes, el modelo principal de OpenCode ni el modelo activo de sesión. No cambies modelos automáticamente por tarea, esfuerzo/escalación ni sesión.

## Wizard de dos pasos

1. Llama `sol_config_get` y presenta en secciones separadas perfil/asignaciones globales, modelo elegido en la sesión (informativo, no editable) y estado de tracking del repo actual. No muestres configuración completa, cuerpos, headers o secretos.
2. **Paso 1, perfil:** pregunta con la herramienta nativa `question` en la conversación principal qué opción quiere:
   - `inherited`: los diez agentes heredan, sin overrides propios.
   - `balanced`: fijo `medium` para Sol (`openai/gpt-6.1-sol`) y Explorador (`openai/gpt-6-luna`); fijo `high` para Executor (`openai/gpt-6-luna`) y los otros siete agentes (`openai/gpt-6.1-sol`). Sin esfuerzo dinámico.
   - `custom`: conservar lo actual y preguntar secuencialmente qué agente editar, qué modelo disponible usar y, si ofrece variantes, cuál variante fija escoger. Ofrece solo catálogo actual de la sesión devuelto por `sol_config_get`, filtrado/paginado; jamás inventes variantes. `model: null` restaura herencia para ese agente. Repite la selección solo si el usuario lo pide.
   La opción “solo consultar” termina sin cambios.
3. **Paso 2, tracking:** vuelve a usar el estado incluido en `sol_config_get` y pregunta con `question` nativa, después de terminar el paso de perfil. Presenta exclusivamente `Local` o `Versionado` para este repo y explícate así: Local excluye `.sol/` del índice Git local; Versionado deja que el usuario decida manualmente si usar Git. Ningún modo añade, commitea, sube ni habilita sincronización automática. Si ya está configurado, marca y preserva siempre el modo actual como predeterminado y ofrece explícitamente “mantener actual” o cambiar al otro; nunca migres automáticamente un modo previo. Si está `unconfigured`, informa que no hay elección guardada y propone inequívocamente `Local` como valor sugerido/predeterminado de este flujo, con `Versionado` como alternativa explícita. El estado sigue siendo `unconfigured` hasta confirmar y aplicar; sugerir Local no significa que `.sol/` ya esté excluido. Esta elección solo concierne al repo actual y no se guarda como default global.
4. Si no hay repo Git válido, el estado no está disponible o el modo elegido está bloqueado, informa el motivo y no simules Versionado ni caigas automáticamente a Local. Se puede terminar la consulta, pero no guardar el wizard combinado hasta que haya un repo válido y una elección real. Si `.sol` ya tiene rutas versionadas al elegir Local, o una regla ignore externa impide Versionado, no alteres índices ni reglas compartidas: explica que debe resolverlo manualmente y detén el guardado.
5. Llama `sol_config_apply` una vez para obtener **vista previa combinada** con la elección de perfil/modelos y tracking y sus dos revisiones actuales. Muestra el diff de los diez agentes, los cambios de tracking y cualquier migración JSON→JSONC/respaldo privado previsto. El helper backend valida IDs, disponibilidad del modelo/variant, ambas revisiones y metadata Git; no pases una ruta root suministrada por el modelo.
6. Pide confirmación nueva e inequívoca mediante `question`, incluyendo ambos alcances: preferencias globales nativas en `opencode.jsonc` y tracking solo en el repo actual. Cancelar no cambia nada. Solo tras confirmar llama `sol_config_apply` con las mismas opciones y revisiones y `dryRun: false`; el runtime pedirá además aprobación host `ask`. Si falla cualquier preflight/revisión, no repitas el write: relee, presenta preview conjunta nueva y pide confirmación otra vez.
7. El plugin aplica primero tracking, después configuración global. Si el segundo guardado falla, intenta restaurar solo los bytes del tracking que él aplicó; informa el resultado real y las rutas de recuperación. No afirmes atomicidad frente a caída abrupta/proceso concurrente. En Versionado los datos siguen locales hasta que el usuario decida manualmente operar Git. La sesión actual conserva su modelo.

No copies estas opciones a `AGENTS.md`, `.sol/` ni preferencias globales de tracking. Para cambiar solo tracking puede usarse `sol_artifacts_get` + preview de `sol_artifacts_set`, confirmación nueva y aprobación host; nunca como atajo para saltar el orden del wizard cuando el usuario solicita `/sol-config`.
