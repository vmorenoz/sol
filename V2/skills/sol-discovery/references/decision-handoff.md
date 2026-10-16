# Handoff de decisiones · sol-discovery refs@1

Usa formatos canónicos existentes: `decision.md`, `spec.md`, `plan.md` y Work. No crees un shadow log Markdown/JSON. Un informe research puede proponer; la decisión no cambia de estado hasta que la herramienta/contrato canónico la registre.

El handoff de investigación es proporcional: comparte la respuesta condicionada, fuentes que soportan cada afirmación decisiva, discrepancias/límites y únicamente la pregunta material que corresponde a una persona. Hechos investigables no se convierten en preguntas al usuario. No repitas en research el PRD/SPEC, plan, tasks ni estado ya canónico; el Markdown es orientación, no mutación de metadata.

## Resumen para la conversación y siguiente especialista

```text
Objetivo y revisión/base: [referencia canónica; no inventar ID]
Resultado/AC relacionado: [ID existente o lenguaje explícito si aún no existe]
Evidencia: [hecho/hipótesis/recomendación, fuente exacta, fecha/versión, estado y unknown]
Decisión: [propuesta | confirmada | reemplazada | abierta] · quién la reportó · cuándo/contexto
Texto acordado: [respuesta fiel, sin paráfrasis que altere alcance]
Alternativas/razón: [por qué, consecuencias, condición que reabre]
Supuestos: [impacto material/no material, abierto/validado/rechazado + evidencia/resolución]
Question: [por qué importa, options/consequences, recomendación/contra-premisa, estado]
Qué puede continuar / qué acción queda bloqueada: [específico]
```

Este bloque es contenido orientativo: adapta títulos, orden y profundidad; no rellenes campos vacíos ni impongas un parser. Puede ser una respuesta Markdown o el artefacto asignado, **no** un payload `sol_work_apply`. Para metadata formal, usar la revisión vigente y contrato de herramientas disponibles. Si el core ofrece acciones tipadas, las referencias actuales son `discovery.source.add`, `discovery.claim.add`, `discovery.assumption.add`, `discovery.assumption.resolve`, `discovery.question.add`, `discovery.question.answer`, `discovery.decision.add`, `discovery.decision.supersede`; usar solo campos/enum que el schema publicado acepte. Una respuesta user-reported no autentica identidad ni permiso. Respuesta nueva a una pregunta respondida requiere nueva pregunta o supersession explícita que conserve historial/razón. El schema vigente distingue `resolutionKind: human_decision | investigation`. Para preguntas, supuestos y decisiones, `taskIds`/`criterionIds` opcionales delimitan el alcance; sin ambos el impacto se considera global. Conserva referencias a IDs existentes y registra solo datos observados.

Si el encargo es readonly/Plan mode o el host no permite una mutación, deja el handoff efímero; no fabriques IDs/revisiones ni uses shell para metadata. Un specialist puede recibir la síntesis, no una segunda conversación de usuario. Antes de pasar a Planner, entrega decisiones confirmadas, incertidumbres que serán tareas de research/specification/planning, AC y limitaciones.
