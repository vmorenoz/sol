---
name: sol-discovery
description: Método de descubrimiento, investigación adaptativa y preguntas ricas para Sol.
slash: false
---
# Descubrimiento integrado de Sol

Recurso de apoyo disponible al modelo (sin entrada slash). OpenCode lista metadatos; Sol carga el cuerpo cuando corresponde. Lee solo la referencia pertinente (cargar SKILL.md no carga automáticamente recursos vecinos):

| Necesidad | Referencia |
|---|---|
| Elegir herramientas de documentación, lectura remota o QA ya disponibles | `references/capability-selection.md` |
| Elegir lentes para el encargo | `references/interview-lenses.md` |
| Evaluar adaptación/confirmación redundante | `references/evaluation-cases.json` + refs `adaptive-dialogue.md`, `rich-questions.md`, `sufficiency.md` |
| Triage de fuentes, confianza y ausencia | `references/evidence-triage.md` |
| Método central de investigación trazable y suficiente | `references/research-method.md` |
| Diseñar pregunta rica y alternativas | `references/rich-questions.md` |
| Follow-up según respuesta real | `references/adaptive-dialogue.md` |
| Decisiones y handoff a spec/plan | `references/decision-handoff.md` |
| Suficiencia y readiness semánticos | `references/sufficiency.md` |
| Mapeo incremental de brownfield | `references/context-map.md` |

No crea modo separado, especialista de dominio obligatorio, cuota de preguntas ni artefacto canónico adicional. El usuario habla con Sol; los especialistas investigan y devuelven hallazgos a Sol.

## Modelo de trabajo

Integra qué/por qué (problema, usuarios, resultado, alcance, exclusiones y aceptación) con cómo/viabilidad (estado del proyecto, opciones, restricciones, riesgos y evidencia). No impongas orden fijo: sigue la incertidumbre material siguiente. En un proyecto existente, usa código y documentos pertinentes; en uno nuevo, entiende necesidad y límites antes de sugerir stack o arquitectura. Si hay contexto de proyecto dentro de un repo existente, distingue ese caso de greenfield.

Para una investigación, aplica `references/research-method.md` como método central: pregunta y suficiencia explícitas, subpreguntas adaptativas, fuentes inspeccionadas y citas precisas, contraevidencia, alternativas y conclusión condicionada. `references/UPSTREAM-NOTICE.md` registra procedencia/licencia, no es una guía de ejecución. Las referencias siguientes profundizan solo el aspecto pertinente; no son etapas ni una lista que haya que completar.

## Encontrar áreas grises

Elige lentes de `references/interview-lenses.md`; no leas la lista al usuario como cuestionario. Observa palabras elásticas y premisas. Para cada gris pregunta internamente qué evidencia existe, qué respuesta cambia, el coste de elegir mal, si puede investigarse después y qué queda fuera.

## Investigar antes de preguntar

Usa `references/evidence-triage.md` para hechos en código/configuración, documentos y documentación oficial. Protege secretos. La investigación externa puede resolver hechos técnicos, no preferencias humanas.

## Preguntar al usuario

Usa `references/rich-questions.md` para diseñar la decisión y `references/adaptive-dialogue.md` para el turno siguiente. Pregunta solo si la respuesta humana puede cambiar materialmente resultado, alcance, riesgo o permiso y no puede deducirse de evidencia autorizada.

Adapta el diálogo a la respuesta; no uses rondas fijas. Si hace falta handoff a decisión/spec/plan, usa `references/decision-handoff.md`.

## Suficiencia y handoff

Usa `references/sufficiency.md` para explicar suficiencia. Research, exploración, especificación o planificación pueden resolver una incógnita; solo se bloquea implementación/acción dependiente y se conserva el avance independiente.

Entrega los hallazgos al mismo hilo antes de congelar decisiones y plan. Mantén decisiones, evidencia y plan en las plantillas/Work existentes cuando aporten valor; no copies estado canónico en listas paralelas. Recomendaciones no son decisiones del usuario y documentos estáticos no son ejecución live.

Para contexto persistente solicitado, consulta `references/context-map.md`: ledger tipado vía `sol_work_apply`, vista narrativa `project@1.0` enlazada por IDs y verificación de frescura. No inicies tracking/mapeo completo por el mero hecho de recibir un encargo.

Los encargos y hallazgos circulan en Markdown natural con contexto puntual y referencias; no se exige JSON ni un reporte duplicado. El contrato tipado se aplica cuando Sol registra hechos verificados en las tools.
