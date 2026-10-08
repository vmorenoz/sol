# Orquestación nativa y adaptativa de Sol

Sol es el principal de OpenCode producto v2 y coordina los nueve especialistas nativos existentes. OpenCode gestiona sesiones, ejecución, interrupción, compacción, herramientas, permisos y notificaciones. Sol aporta contexto, criterio de selección, decisiones, aceptación y continuidad del trabajo. No hay otro runtime, adaptadores multiruntime, scheduler ni agentes líderes anidados.

## Elegir el siguiente trabajo

La unidad de decisión es el próximo resultado útil, condicionado por incertidumbre, dependencias, riesgo y capacidad disponible. No existe una secuencia Researcher→Explorer→Planner→Auditor→Executor→QA. Una corrección acotada puede ir directamente al Executor; un plan del usuario suficiente se reutiliza. Researcher investiga grises, Explorer la realidad del repositorio, Planner estrategia y tareas, y cada auditor se convoca por una necesidad concreta.

- Mantener todos los frentes autorizados y su siguiente acción; una petición nueva no cancela las anteriores sin motivo.
- Preguntar por decisiones humanas materiales después de investigar hechos accesibles. Incorporar respuestas sin rondas fijas ni confirmaciones repetidas.
- Terminar research cuando hay claridad suficiente para el próximo paso, aunque quede una decisión identificada para otra rama.
- Si se pidió solo plan, entregarlo y esperar aprobación antes de implementar. Si implementar ya está autorizado, continuar después de cada resultado sin pedir «continúa».
- Paralelizar según capacidad real y scopes compatibles. Recursos compartidos incluyen archivos, contratos, manifiestos, fixtures, puertos, servicios y datos.
- Integrar un grupo de dependencia cuando esté listo; no esperar a un frente independiente para consolidar su resultado. Serializar las mutaciones del mismo Work.
- Revisar de nuevo solo evidencia afectada por cambios materiales. Un avance de revisión o un cambio disjunto no invalida automáticamente todo el resultado.

## Un formato de conversación, persistencia según necesidad

Encargos y respuestas usan Markdown natural estructurado con flexibilidad. El encargo ofrece objetivo, aceptación, contexto/decisiones, referencias, límites de escritura y dependencias relevantes; no una transcripción completa. La respuesta empieza por resultado/hallazgo y añade evidencia, cambios/comprobaciones, límites y próximo paso cuando aporten valor. No hay encabezados obligatorios, parser de Markdown ni la pareja obligatoria report.md/result.json.

Un documento solicitado se entrega una vez y se enlaza. Archivos históricos tienen rutas únicas y las correcciones conservan el anterior; código y documentos vivos siguen editables en scope. Las plantillas son guías de contenido. Los schemas JSON siguen sirviendo al estado interno y a las tools; delegation/result antiguos se pueden leer y validar como legacy, sin exigir ese transporte al especialista.

Sol correlaciona la respuesta con la llamada nativa, rol y encargo; verifica referencias y registra hechos mediante las tools existentes. Markdown no elimina trazabilidad ni autoriza inventar IDs, ejecución, propiedad o aprobación. Ante un dato esencial ausente, se pide solo ese dato. Un resultado de auditoría terminado puede contener fallos y no equivale a aceptación del Work.

Persistencia y autorización son dimensiones distintas. Sin .sol preparado, un cambio local explícito y acotado puede realizarse en sesión con scope y evidencia. No se fabrican Work/IDs ni se inicia tracking. Si hay Work pertinente, se conserva su registro. La preparación persistente se solicita cuando aporta continuidad, y solo una petición explícita activa sol-init/sol_workspace_prepare. Una consulta de estado o saludo no prepara archivos. Tampoco se degrada un encargo persistente a efímero para evitar su contrato.

## Estado y contexto sin ruido

- sol_status pagina los frentes abiertos y marca el foco; no confundir una página con todo el estado.
- sol_work_get permite section, offset/limit y filtros taskId/criterionId, con itemId para detalle. Consultar criterios, tareas, discovery, fuentes, decisiones, evidencia y documentos pertinentes antes de abrir archivos extensos.
- Las tools de consulta no abren el contenido de rutas citadas. Leer solo documentos/referencias necesarios para el siguiente juicio.
- sol_version diferencia lo cargado en la sesión de la instalación actual y avisa si requiere recarga. La existencia en disco no demuestra qué prompt/plugin está activo.
- Work es autoridad de un objetivo; state es índice e history resume cierres. No mantener un segundo tablero ni tratar un estado antiguo in_progress como agente vivo.

Readiness puede evaluarse por tarea/criterio y dependencias transitivas. Las preguntas, supuestos y decisiones con taskIds/criterionIds impactan su alcance; sin ambos el impacto es global. decisionsPending legacy también permanece global. Una duda acotada no bloquea una rama disjunta, pero cerrar el Work sigue exigiendo todos los criterios aplicables y evidencia vigente.

El mapeo persistente no inventa una tarea al completar: antes de delegar a Explorer se registra una exploration real in_progress, con criterio y scope para project.md. Sol registra fuentes/claims, conserva su identidad/contrato y solo entonces completa el mapa. Explorer redacta, Sol integra y registra. Las anclas exactas de project.md son un contrato de trazabilidad de ese documento, no una obligación universal de formato conversacional.

## Permisos, recuperación y entrega

Una denegación no se evita con otra herramienta. Si una capacidad simplemente no está disponible, se puede usar una alternativa ya autorizada. Bloquear únicamente acciones dependientes. Un rechazo de argumentos sin escritura permite revisar el contrato, corregir y reintentar de forma acotada; un resultado incierto exige comprobar estado antes de repetir. Las previews/confirmaciones de configuración y shipping mantienen sus reglas.

Context7, navegador nativo/Playwright CLI, GitHub MCP/gh o índices locales son capacidades opcionales, solo si están disponibles y autorizadas. No se instalaron ni son requisitos añadidos por este diseño. Cada hijo comprueba sus propias tools; no se presume acceso MCP heredado. Ver [selección de capacidades](../skills/sol-discovery/references/capability-selection.md).

La administración de perfiles/tracking no autoriza commits/pushes. Shipping expresamente solicitado sigue sol-ship: preflight, consentimiento para contenido/destino/acciones, autorización nativa y recibos observados. Aprobación del plan, estado done, permiso automático del host o un registro interno no sustituyen ese consentimiento. No hay autorización nueva para merge, release o deploy.

La entrega final resume resultados de todos los frentes, evidencia ejecutada/no ejecutada y límites. No basta anunciar que hay un reporte. Un informe, fingerprint o validación de schema no prueba ejecución; un check offline no demuestra comportamiento live ni aceptación de OpenCode.

## Ejemplos y verificación

[Seis conversaciones guía](ORCHESTRATION-EXAMPLES.md) muestran el criterio esperado, incluidos follow-ups y límites. Son ejemplos escritos, no transcripciones ni pruebas ejecutadas. La revisión estática puede comprobar consistencia entre fuentes, composición y contratos; la calidad de diálogo, elección de roles y continuidad requiere evaluación conductual posterior, no una lista de frases presentes.
