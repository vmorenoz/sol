# Orquestación nativa y adaptativa de Sol

Sol es el principal de OpenCode producto v2 y coordina los nueve especialistas nativos existentes. OpenCode gestiona sesiones, ejecución, interrupción, compacción, herramientas, permisos y notificaciones. Sol aporta contexto, criterio de selección, decisiones, aceptación y continuidad del trabajo. No hay otro runtime, adaptadores multiruntime, scheduler ni agentes líderes anidados.

Las prácticas de ingeniería se consultan mediante `sol-engineering-practices` solo cuando son pertinentes, abriendo una referencia temática. La skill refuerza roles existentes; no añade agentes, delegación anidada, fases, autorización ni requisitos de herramientas. Research/ideación/especificación corresponden a `sol-discovery`, no a esta colección.

## Elegir el siguiente trabajo

La unidad de decisión es el próximo resultado útil, condicionado por incertidumbre, dependencias, riesgo y capacidad disponible. No existe una secuencia Researcher→Explorer→Planner→Auditor→Executor→QA. Una corrección acotada puede ir directamente al Executor; un plan del usuario suficiente se reutiliza. Researcher investiga grises, Explorer la realidad del repositorio, Planner estrategia y tareas, y cada auditor se convoca por una necesidad concreta.

- Mantener todos los frentes autorizados y su siguiente acción; una petición nueva no cancela las anteriores sin motivo.
- Preguntar por decisiones humanas materiales después de investigar hechos accesibles. Incorporar respuestas sin rondas fijas ni confirmaciones repetidas.
- Terminar research cuando hay claridad suficiente para el próximo paso, aunque quede una decisión identificada para otra rama.
- Si se pidió solo plan, entregarlo y esperar aprobación antes de implementar. Si implementar ya está autorizado, continuar después de cada resultado sin pedir «continúa».
- Paralelizar según capacidad real y scopes compatibles. Recursos compartidos incluyen archivos, contratos, manifiestos, fixtures, puertos, servicios y datos.
- Integrar un grupo de dependencia cuando esté listo; no esperar a un frente independiente para consolidar su resultado. Serializar las mutaciones del mismo Work.
- Revisar de nuevo solo evidencia afectada por cambios materiales. Un avance de revisión o un cambio disjunto no invalida automáticamente todo el resultado.

## Sesión por encargo y aceptación

La sesión pertenece al encargo, no al especialista ni al Work. Cada encargo nuevo se delega con `subagent` **sin `sessionID`**, incluso si repite especialista o Work. El handoff debe ser autosuficiente: objetivo, rol, alcance, base vigente, aceptación, decisiones y referencias concretas a evidencia y artefactos autorizados. El estado duradero reside en esos artefactos, no en el historial de una sesión hija; esto no autoriza preparar persistencia no solicitada.

Solo se reutiliza el `sessionID` nativo devuelto para aclarar, completar o corregir el **mismo encargo todavía no aceptado por Sol**, con rol, scope y base compatibles. Cambiar de encargo o rol, o pasar a un scope/base incompatible, requiere una sesión nueva. Un avance disjunto de revisión no es por sí solo incompatibilidad: Sol contrasta su efecto material. La entrega del especialista, incluso marcada completed, no cierra el encargo: lo cierra la aceptación del orquestador tras revisar resultado y evidencia. Después de aceptarlo, cualquier otro encargo comienza limpio.

Toda auditoría independiente empieza sin `sessionID`. El seguimiento compatible del mismo encargo auditor puede continuar hasta su aceptación; ni la sesión de implementación ni la de una auditoría ya aceptada se reutilizan para una auditoría nueva.

Ejemplos de decisión (guía, no ejecución observada):

- El Executor entrega sin evidencia suficiente: Sol pide la comprobación faltante en la misma sesión si sigue dentro del encargo y su base es compatible.
- Sol acepta una implementación y asigna otra tarea al mismo Executor dentro del mismo Work: nueva sesión y handoff desde los artefactos vigentes.
- Una revisión independiente detecta un fallo: el auditor puede aclarar el hallazgo en su sesión aún no aceptada; una corrección asignada al Executor es otro encargo y empieza limpia.

La documentación de OpenCode v2 describe [contexto limpio de los subagentes](https://opencode.ai/v2/docs/agents/#modes) y [continuación mediante sessionID](https://opencode.ai/v2/docs/tools/#subagent). Sol expresa esta política en sus instrucciones y plantilla de delegación, distribuidas por la composición existente; no añade un selector ni enforcement determinista de fresh/resume al runtime. Los reintentos técnicos y la idempotencia del init nativo conservan la identidad de su operación: no se recrean sesiones/hijos por aplicar esta política. El dispatcher y el runtime de init mantienen su contrato.

## Contrato Markdown de mensajes; persistencia según necesidad

El transporte sigue siendo la herramienta `subagent` y sus sesiones/eventos nativos; este contrato solo estructura el contenido legible del mensaje, sin parser, JSON obligatorio ni wrapper XML.

**Entrada de Sol → especialista**, según `templates/delegation.md`:

```md
## Objetivo
Investigar por qué falla la exportación con CSV grandes.
## Contexto y referencias
Revisa `src/export.mjs` y el test de streaming; Work `csv-export`, rev. 3, tarea `T-2`.
## Alcance y restricciones
Lee esos archivos; escribe solo en `src/export.mjs` y su test. No añadas dependencias.
## Criterios de aceptación
Conservar filas y memoria acotada; comprobar regresión y errores pertinentes.
## Entrega esperada
Resumen, cambios, comprobaciones reales y límites según el rol.
```

Usa los cinco encabezados en ese orden, con extensión proporcional. Distingue rutas para leer de las de escritura; `writeScope` orienta conducta, no amplía permisos ni es sandbox del host. Incluye IDs/revisión de Work solo si existen y ayudan; no vuelques el Work ni repitas instrucciones comunes del rol. En una tarea trivial, cada sección puede ser una frase y los detalles opcionales se omiten.

**Respuesta especialista → Sol**: mínimo `## Resultado` (estado declarado `completo`, `parcial`, `bloqueado` o `fallido` y resumen), `## Evidencia y comprobaciones` y `## Pendientes y límites`; añade `## Cambios o hallazgos` cuando aplique. Research vincula afirmaciones a fuentes; Executor informa cambios y comprobaciones reales/no ejecutadas; auditores priorizan hallazgos o delimitan el alcance sin hallazgos; Planner y Explorer describen su resultado sin fingir cambios o pruebas.

El estado declarado no es el estado de sesión que informa OpenCode: `completed` del host no prueba cumplimiento ni aceptación. Sol contrasta respuesta, referencias, criterios, cambios y evidencia antes de aceptar y registrar metadata por las tools existentes. Si falta contenido o parece truncado, no acepta ni lo reconstruye; pide solo el faltante al mismo hijo si el encargo sigue sin aceptar y la sesión/rol/scope/base son compatibles. No repite todo el trabajo ni inventa evidencia; no añade aprobación del usuario.

Este contrato es para mensajes, no para documentos persistentes: las plantillas `research.md`, `implementation.md`, `review.md`, `exploration.md` y demás siguen siendo flexibles según su propósito. Si se pide un documento o el Work requiere evidencia durable, asigna desde el inicio una sola ruta y writeScope; el mismo Markdown sirve como entrega/evidencia, sin JSON ni duplicado. Si no, puede bastar el mensaje. Los schemas JSON son para estado/tools; `delegation`/`result` estructurados son legacy, no el transporte obligatorio ni prueba de ejecución o aceptación.

Sol correlaciona la respuesta con la llamada nativa, rol y encargo; verifica referencias y registra hechos mediante las tools existentes. Markdown no elimina trazabilidad ni autoriza inventar IDs, ejecución, propiedad o aprobación. Ante un dato esencial ausente, se pide solo ese dato. Un resultado de auditoría terminado puede contener fallos y no equivale a aceptación del Work.

Persistencia y autorización son dimensiones distintas. Sin .sol preparado, un cambio local explícito y acotado puede realizarse en sesión con scope y evidencia. No se fabrican Work/IDs ni se inicia tracking. Si hay Work pertinente, se conserva su registro. La preparación persistente se solicita cuando aporta continuidad, y solo una petición explícita activa sol-init/sol_workspace_prepare. Una consulta de estado o saludo no prepara archivos. Tampoco se degrada un encargo persistente a efímero para evitar su contrato.

## Estado y contexto sin ruido

- sol_status pagina los frentes abiertos y marca el foco; no confundir una página con todo el estado.
- sol_work_get permite section, offset/limit y filtros taskId/criterionId, con itemId para detalle. Consultar criterios, tareas, discovery, fuentes, decisiones, evidencia y documentos pertinentes antes de abrir archivos extensos.
- Las tools de consulta no abren el contenido de rutas citadas. Leer solo documentos/referencias necesarios para el siguiente juicio.
- sol_version diferencia lo cargado en la sesión de la instalación actual y avisa si requiere recarga. La existencia en disco no demuestra qué prompt/plugin está activo.
- Work es autoridad de un objetivo; state es índice e history resume cierres. No mantener un segundo tablero ni tratar un estado antiguo in_progress como agente vivo.

Readiness puede evaluarse por tarea/criterio y dependencias transitivas. Las preguntas, supuestos y decisiones con taskIds/criterionIds impactan su alcance; sin ambos el impacto es global. decisionsPending legacy también permanece global. Una duda acotada no bloquea una rama disjunta, pero cerrar el Work sigue exigiendo todos los criterios aplicables y evidencia vigente.

El init nativo reserva el Work y todas sus tareas antes del despacho. Uno o varios Exploradores escriben únicamente entregas disjuntas en .sol/work/<workId>/context/<taskId>.md. Después Sol lee los resultados con sol_init_get, registra fuentes/claims, publica project.md con sol_init_project_publish y cierra mediante sol_init_complete con revisión vigente. Una entrega fallida o alterada bloquea publicación/cierre completo, conservando lo útil. No usa el helper legacy de tarea única ni crea tareas retrospectivas. Las anclas exactas de project.md son un contrato de trazabilidad de ese documento, no una obligación universal de formato conversacional.

## Permisos, recuperación y entrega

Una denegación no se evita con otra herramienta. Si una capacidad simplemente no está disponible, se puede usar una alternativa ya autorizada. Bloquear únicamente acciones dependientes. Un rechazo de argumentos sin escritura permite revisar el contrato, corregir y reintentar de forma acotada; un resultado incierto exige comprobar estado antes de repetir. Las previews/confirmaciones de configuración y shipping mantienen sus reglas.

Context7, navegador nativo/Playwright CLI, GitHub MCP/gh o índices locales son capacidades opcionales, solo si están disponibles y autorizadas. No se instalaron ni son requisitos añadidos por este diseño. Cada hijo comprueba sus propias tools; no se presume acceso MCP heredado. Ver [selección de capacidades](../skills/sol-discovery/references/capability-selection.md).

La administración de perfiles/tracking no autoriza commits/pushes. Shipping expresamente solicitado sigue sol-ship: preflight readonly, registro del intent devuelto mediante shipping.intent.record y revisión nueva, consentimiento para contenido/destino/acciones, autorización nativa y recibos observados. Aprobación del plan, estado done, permiso automático del host o un registro interno no sustituyen ese consentimiento. No hay autorización nueva para merge, release o deploy.

La entrega final resume resultados de todos los frentes, evidencia ejecutada/no ejecutada y límites. No basta anunciar que hay un reporte. Un informe, fingerprint o validación de schema no prueba ejecución; un check offline no demuestra comportamiento live ni aceptación de OpenCode.

## Ejemplos y verificación

[Seis conversaciones guía](ORCHESTRATION-EXAMPLES.md) muestran el criterio esperado, incluidos follow-ups y límites. Son ejemplos escritos, no transcripciones ni pruebas ejecutadas. La revisión estática puede comprobar consistencia entre fuentes, composición y contratos; la calidad de diálogo, elección de roles y continuidad requiere evaluación conductual posterior, no una lista de frases presentes.


## Selección conversacional del siguiente paso

Sol decide qué skill cargar desde intención + estado + autorización, no desde una secuencia de comandos. Las diez skills de workflow permanecen disponibles al modelo sin slash: new-project, onboard, discuss, plan, execute, verify, ship, status, recap y resume. Solo /sol-config tiene dispatcher Markdown; /sol-init usa el dispatcher TUI nativo y /sol-version es diagnóstico nativo. Init/config siguen siendo explícitos y no hay auto-init por pedir trabajo.

Happy path esperado (guía de comportamiento, no prueba live): el usuario pide implementar un cambio acotado y comprobarlo; Sol usa contexto suficiente o investiga lo verificable, pregunta únicamente una decisión humana material que falte, incorpora la respuesta, delega ejecución y verifica el resultado sin exigir «/sol-execute», «/sol-verify» ni «continúa». Si el usuario pidió solo un plan, entrega el plan sin implementarlo. «Qué queda» y «resume lo hecho» son lecturas; «retoma la implementación aprobada» conserva el objetivo y continúa solo el alcance vigente. Shipping requiere petición y autorización específicas. Un bloqueo dependiente no detiene frentes independientes ya autorizados.
