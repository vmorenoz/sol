# Sol 2.1 — robustecimiento para OpenCode v2

Esta revisión parte de `0a94cdda9e2f70e6991f9fd1db0b3ecc1d2b6108` y conserva V1 y las preferencias del usuario. Sólo cubre desarrollo: no añade asistencia de correo/calendario, un scheduler ni otro runtime.

## Cambios de esta entrega

- Encargos y respuestas entre agentes en Markdown natural, proporcionados al trabajo. JSON permanece en las herramientas y el estado interno, no como obligación de conversación.
- Research incluye preguntas al usuario y suficiente claridad para el próximo paso, continuidad de lo autorizado y pausa de la rama que realmente requiere una decisión. Planificar no autoriza implementar.
- Incertidumbres opcionalmente acotadas por tareas o criterios; el estado antiguo sin alcance sigue siendo global por seguridad. Cierre global del trabajo conservado.
- Mapeo con tarea real desde el inicio, sustituciones sucesivas de decisiones y referencias de fuentes comprobadas.
- Consulta multifrente y paginada; acceso al detalle completo sin perder registros por truncamiento.
- Composición exclusiva de agentes, skills y plugin nativos de OpenCode v2. Sin adaptadores multiruntime. Se conserva la distinción entre permisos del host e instrucciones de rol.
- Instalación limpia del payload Sol acreditado, conservación de configuraciones ajenas, preferencias de modelo y datos de proyectos. Backup recuperable y rollback ante fallos en el proceso; no se promete atomicidad ante apagado abrupto.
- Identidad 2.1.0 con huella del contenido. `/sol-version` compara el plugin cargado y la instalación en disco; la CLI por sí sola no acredita que otra sesión se haya recargado.

## Cómo probarlo

Desde una copia de esta rama, entra en `V2/`:

```sh
node install.mjs --version
node install.mjs --dry-run
node install.mjs
```

Revisa la vista previa antes de aplicar. Reinicia OpenCode, selecciona `sol` y consulta `/sol-version`. Sin `--profile` se preservan tus modelos existentes. Un conflicto de archivos desconocidos se informa, no se borra a ciegas. No pongas credenciales en informes de fallos.

Prueba conversacional sugerida: pide investigar dos frentes de un proyecto, deja una decisión humana pendiente en uno y comprueba que Sol pregunta sólo lo necesario mientras avanza el otro autorizado. Luego responde y observa si continúa sin otra orden de «continúa». Verifica que las sesiones especialistas sean legibles y que no afirmen pruebas que no realizaron.

## Límites de validación

Se comprobó estructura, composición y un happy path de empaquetado/instalación en un HOME temporal con APIs del host simuladas. No se ejecutó un modelo ni una instalación en el perfil personal. No se demuestra todavía calidad de diálogo, permisos efectivos o compatibilidad live con la distribución concreta del usuario; esos puntos corresponden a sesiones reales.

Las herramientas externas (Context7, navegador/Playwright, GitHub, búsqueda semántica) son opciones bajo demanda, no servicios instalados ni accesos nuevos de esta entrega.
