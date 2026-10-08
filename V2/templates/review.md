# Revisión · {{rol}} · {{work-id}}
<!-- template: review@1.0 -->
## Alcance y base revisada
{{Qué artefactos/código, revisión y criterios; qué queda fuera.}}
## Método y evidencia
{{Qué se inspeccionó o ejecutó y con qué limitaciones.}}
## Hallazgos
| ID | Severidad | Hallazgo e impacto | Referencia reproducible | Corrección sugerida |
|---|---|---|---|---|
| {{F-ID}} | {{critical/high/medium/low/info}} | {{defecto}} | {{archivo:línea/escenario}} | {{acción}} |
Si no hay hallazgos, declararlo sin inventar una tabla ni certificar ausencia total de defectos.
## Cobertura frente a aceptación
{{Matriz de todos los criterios y tareas relevantes: covered con evidencia vigente / partial / uncovered / blocked / unverifiable, con referencias. No cambiar criterio sin decisión confirmada ni sumar PASS parciales como aceptación global. Condicional si la auditoría cubre flujos: traza entrada→servicio→contrato→persistencia/backend→resultado y estado demo / implementado parcial / conectado no verificado / ejecutado-verificado (solo alcance observado) / ausente / desconocido; no encontrado en búsqueda acotada = desconocido.}}
## Conclusión
{{Sin bloqueos observados / requiere correcciones / no verificable, con razones.}}
## Límites y decisiones pendientes
{{Recomendaciones no obligatorias por separado; no fingir aprobación institucional.}}
{{Separar código/config local (conducta local), documentación (intención/contrato/historia) y despliegue observado (solo ese entorno). Si discrepan, investigar y registrar fuente/base/version/límite; escalar decisión material, no tratar doc stale como autoridad única. Informe narrativo, result nativo o fingerprints no prueban ejecución.}}
