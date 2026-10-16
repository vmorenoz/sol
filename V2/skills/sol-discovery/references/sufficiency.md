# Suficiencia, bloqueos y cierre · sol-discovery refs@1

No uses una puntuación de ambigüedad ni un checklist universal. Da un juicio explicado para el próximo acto, no una certificación de entendimiento.

| Próximo acto | Basta cuando | Mantener abierto/bloquear cuando |
|---|---|---|
| Research | La pregunta investigable, fuente/ámbito y resultado útil están claros. Puede cerrar su propio AC con síntesis, procedencia y límites aunque queden decisiones humanas. | No hay fuente/permiso/acceso esencial para ese research. Registrar límites, no fingir respuesta. |
| Exploration/context map | Scope de lectura y evidencia requerida están delimitados; lectura parcial y freshness se reportarán. | La raíz/scope no está autorizado o el cambio exige acceso no permitido. |
| Specification | Comportamientos/AC y límites se pueden describir; incertidumbres remanentes se marcan. | No se puede decidir una regla observable sin owner input; spec no autoriza a inventarla. |
| Planning | Es posible planificar tareas que resuelvan unknowns y su aceptación. La implementación puede figurar pendiente de gate, no bloquear la creación de ese plan. | Dependencias/contratos imposibles de acotar incluso como investigación; pedir solo la decisión que cambia el plan. |
| Implementation/acción externa | Las decisiones materiales de resultado, límites, AC y autorizaciones requeridas están confirmadas, evidencia técnica pertinente consultada y contrato/revisión coincide. Los detalles de bajo impacto alineados con intención pueden quedar como supuesto provisional, visible y corregible. | Falta decisión material; alto impacto (dinero, seguridad, privacidad, permisos, tenant, scope o efecto externo); conflicto; autorización o permiso. Bloquear solo tarea/rama dependiente. |

Un «provisional» no es una decisión canónica confirmada. Si la persona ya dio intención clara y el siguiente detalle es reversible y poco costoso, declara el default que seguirás y deja una vía de corrección; no conviertas la confirmación en trámite. No extrapoles esta tolerancia a seguridad/privacidad, dinero, permisos, contradicción de alcance o acción externa.

## Distinguir estado del Work y juicio semántico

- Work/task status y criterio son fuente canónica, no se reflejan con una segunda checklist narrativa.
- `completed` de research significa que su objetivo de investigación fue cubierto con evidencia suficiente y unknowns declarados; no significa que el proyecto esté listo para implementar.
- `blocked` solo si dependencia impide esa tarea concreta; no usarlo para evitar planificar cómo despejar incertidumbre.
- PASS registrado, ejecución histórica y aceptación actual son cosas distintas. Una edición posterior puede volver evidencia stale; conserva el hecho histórico de que un test pasó entonces, no lo reescribas como «nunca ejecutado». La aceptación presente exige evidencia vigente para el criterio y scope actuales.
- Semántica («¿entendimos intención?», «¿esta evidencia sostiene la recomendación?») requiere revisión del contenido/transcripción. Schema validation, resource link test o checks offline no prueban comprensión, calidad de diálogo, identidad del usuario ni conducta live.

Al cerrar, explica qué próximo paso tiene claridad suficiente, la evidencia relevante y la decisión residual si existe. Una petición plan-only espera aprobación antes de implementar; una implementación ya autorizada continúa sin pedir «continúa» entre tareas. No uses un sello global «ready» ni mantengas research abierto para agotar preguntas futuras.

El readiness de una tarea considera sus decisiones/fuentes y dependencias transitivas: acota preguntas, supuestos y decisiones con taskIds/criterionIds reales. Sin alcance explícito, el bloqueo se considera global y requiere aclaración. Esto no relaja aceptación global: cerrar el Work sigue requiriendo todos los criterios aplicables y evidencia vigente.
