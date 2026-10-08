# Entrega · {{work-id}}
<!-- template: delivery@1.0 -->
## Qué cambió y por qué
{{Resumen para la revisión humana/PR; alcance real.}}
## Criterios satisfechos
{{Todos los criterios/tareas relevantes: covered con evidencia vigente / partial / uncovered / blocked / unverifiable → refs. No inferir desde la última subtask, no cambiar criterios sin decisión confirmada ni sumar PASS parciales como aceptación global.}}
## Verificación
{{Comandos y resultados, skips y validaciones no ejecutadas explícitos.}}
## Snapshot de intención de entrega — condicional
{{Referencia Work/revisión; branch/base/remote/destino; paths y commits incluidos/excluidos; PR base/título/body; acciones nativas previstas. No pegar payload metadata inventado. `sol_ship_preflight` produce preview/snapshot; `shipping.intent.record` no autoriza operaciones.}}
## Autorización — condicional
{{Consentimiento explícito para snapshot/destino/acciones. Tras recibirlo, `sol_ship_authorize` es la única entrada pública que registra autorización. `shipping.approval.record` no autoriza por sí mismo; no llamar vía `sol_work_apply`. Registro user-reported, no autenticación, credencial ni permiso runtime; host gates son independientes. Cualquier delta invalida intent/approval (`shipping.intent.invalidate`) y exige nuevo preview/consentimiento.}}
## Recibos — condicional
{{Solo resultado observado por operación: commit hash, push target/status, PR URL/ID; fallos/no ejecutado. `shipping.receipt.record` no demuestra por sí solo autorización ni añade merge/release/deploy. Añadir receipt al Work solo por tool/API compatible con su estado/revisión; no falsificar reopen/close.}}
## Riesgos e integración
{{Contratos, migraciones, entornos y pendientes relevantes.}}
{{Condicional en auditorías: matriz de flujo crítico entrada→servicio→contrato→persistencia/backend→resultado, capacidad/gap y madurez evidenciada; “no encontrado” acotadamente = desconocido. Diferenciar estático de runtime y local de despliegue observado.}}
## Despliegue/reversión — condicional
{{Instrucciones solo si aplican y están autorizadas; no ejecutar despliegues automáticamente.}}
## Decisiones y seguimiento
{{Aceptaciones humanas reales; trabajo adicional que no se hizo.}}
{{Distinguir preexistente/propio/indeterminado con baseline acotado; hash/HEAD/conteos no prueban preservación semántica. Reportar checks ejecutados y no ejecutados; documento/result/fingerprint no demuestra ejecución por sí mismo.}}
