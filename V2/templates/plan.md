# Plan · {{work-id}} · {{nombre}}
<!-- template: plan@1.0 -->
Tipo: {{maestro/subplan}} · padre: {{ruta o ninguno}} · base: {{revisión de work y repositorio}}
## Objetivo y alcance
{{Criterios que cubre y exclusiones.}}
## Realidad comprobada
{{Archivos, patrones, comandos y contratos inspeccionados; supuestos por separado.}}
## Estrategia y decisiones
{{Enfoque mínimo suficiente, alternativas importantes y por qué se descartan.}}
## Trazabilidad e integración
| Objetivo/AC | Resultado/verdad esperada | Tarea(s) | Comprobación observable |
|---|---|---|---|
| {{AC-ID}} | {{efecto verificable}} | {{T-ID}} | {{test/observación/comando y límite}} |
{{Para cambio conectado: primer tracer vertical productor→contrato→consumidor→resultado; marcar interfaces y riesgos de integración.}}
## Trabajo propuesto
| ID propuesto/canónico | Tipo de tarea | Entregable | Especialista | Dependencias | Escritura/recursos | Aceptación |
|---|---|---|---|---|---|---|
| {{T-ID}} | {{research/exploration/specification/planning/implementation/verification/delivery/shipping}} | {{resultado}} | {{agente}} | {{IDs}} | {{rutas, puertos, fixtures}} | {{AC-ID/check}} |
Las tareas son propuestas hasta que Sol las incorpore a work.json; su estado vive allí.
## Paralelismo y puntos de integración
{{Qué puede coexistir y por qué; qué exige orden; quién integra cada contrato compartido.}}
## Verificación prevista
{{Tipo de proyecto, escenarios, comandos confirmados, tests a crear, limitaciones del entorno.}}
## Riesgos y reversión
{{Riesgo concreto, señal observable y mitigación. Reversión solo cuando aplique.}}
## Incertidumbres, vigencia y siguiente decisión
{{Preguntas materiales, evidencia faltante y decisiones confirmadas vs propuestas. Indicar qué tareas resuelven incógnitas y qué acción depende de ellas; no convertir cada duda en fase ni declarar stale/actual sin contrastar.}}
