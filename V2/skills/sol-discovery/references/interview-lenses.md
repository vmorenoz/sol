# Lentes de descubrimiento · sol-discovery refs@1

Usa una o dos lentes por decisión que importaría al resultado. Son hipótesis de dónde puede haber una ambigüedad, no encabezados de un interrogatorio. Pregunta al usuario solo cuando después de mirar evidencia la respuesta siga siendo humana/material.

| Lente | Señales para investigar | Pregunta que puede ser material (solo si evidencia no responde) |
|---|---|---|
| Intención y resultado | «mejor», «rápido», tarea del usuario, medida de éxito | «¿Qué cambiaría para la persona que hoy hace X: menos pasos, menos errores o menor tiempo? ¿Cuál de esos resultados importa primero?» |
| Flujos y estados | entrada, actor, transición, estados vacíos/duplicados | «Si se recibe el mismo envío dos veces, ¿debe actualizar, rechazar o ser idempotente? El sistema actual parece permitir X; ¿ese comportamiento es deliberado?» |
| Reglas y datos | ownership, fuente de verdad, retención, import/export, conflictos | «Al importar un registro que ya existe, ¿prevalece el valor local o el archivo? Eso cambia si la importación puede sobrescribir datos.» |
| Identidad y permisos | quién actúa, rol, tenant, delegación | «¿El acceso se concede por usuario o por organización? El segundo requiere impedir acceso cruzado; no es solo otro botón.» |
| API/CLI/integraciones | productor, consumidores, contrato/error/versionado | «El consumidor actual interpreta 404 como ausencia. ¿Queremos mantener ese contrato o diferenciar “sin resultado” de “sin permiso”?» |
| Operación y fallo | retry, timeout, degradación, rollback, observabilidad | «Cuando el proveedor externo no responde, ¿se bloquea el flujo o se acepta y sincroniza luego? Cambia consistencia y UX.» |
| Compatibilidad y alcance | clientes/versiones, migración, exclusiones | «¿Hay que mantener los clientes v1 en este cambio? Si sí, el campo nuevo debe ser compatible; si no, se puede simplificar.» |
| Seguridad y privacidad | datos sensibles, trust boundary, abuso, auditoría | «¿Este dato puede salir del workspace para consultar documentación externa? Si no, investigo solo con términos genéricos/localmente.» |

**Términos vagos:** reemplaza «seguro» por amenaza/actor/daño; «rápido» por operación/latencia y tolerancia; «automático» por disparador y posibilidad de deshacer; «compatible» por consumidores/versiones; «sin perder datos» por fuente de verdad y conflictos. No propongas una definición en nombre del usuario: muestra la interpretación y pide corregir solo si cambia el resultado.

**Prueba de pertinencia:** antes de una pregunta, termina esta frase: «La respuesta cambiaría ___ porque ___». Si no puedes completar ambas partes con algo material, no preguntes todavía. Comprueba si código, fuente oficial, documento o respuesta previa ya la resuelve.
