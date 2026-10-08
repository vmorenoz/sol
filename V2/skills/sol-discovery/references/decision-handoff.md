# Handoff de decisiones · sol-discovery refs@1

Usa formatos canónicos existentes: `decision.md`, `spec.md`, `plan.md` y Work. No crees un shadow log Markdown/JSON. Un informe research puede proponer; la decisión no cambia de estado hasta que la herramienta/contrato canónico la registre.

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

Este bloque es una guía para escribir el artefacto narrativo asignado, **no** payload `sol_work_apply`. Para metadata formal, usar la revisión vigente y contrato de herramientas disponibles. Si el core ofrece acciones tipadas, las referencias actuales son `discovery.source.add`, `discovery.claim.add`, `discovery.assumption.add`, `discovery.assumption.resolve`, `discovery.question.add`, `discovery.question.answer`, `discovery.decision.add`, `discovery.decision.supersede`; usar solo campos/enum que el schema publicado acepte. Una respuesta user-reported no autentica identidad ni permiso. Respuesta nueva a una pregunta respondida requiere nueva pregunta o supersession explícita que conserve historial/razón. La resolución de pregunta como investigación frente a decisión humana depende del campo final de A; no inventar `resolutionKind` mientras no esté confirmado.

Si el encargo es readonly/Plan mode o el host no permite una mutación, deja el handoff efímero; no fabriques IDs/revisiones ni uses shell para metadata. Un specialist puede recibir la síntesis, no una segunda conversación de usuario. Antes de pasar a Planner, entrega decisiones confirmadas, incertidumbres que serán tareas de research/specification/planning, AC y limitaciones.
