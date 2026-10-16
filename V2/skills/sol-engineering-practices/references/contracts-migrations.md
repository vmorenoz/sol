# Interfaces, contratos y migraciones

Antes de cambiar una frontera, localiza productor, consumidores, serialización, validación, errores y comportamiento observable; busca usos además de la declaración. Prefiere una interfaz explícita difícil de usar mal, con nombres/unidades/estados coherentes y errores previsibles. Preserva compatibilidad existente salvo cambio autorizado; documenta las semánticas observables de las que consumidores dependan.

En cambios cross-component contrasta tipos/schema, versiones, defaults, null/ausencia, orden, errores, autorización y persistencia a ambos lados; prueba el recorrido integrado. No cambies unilateralmente contratos compartidos ni derives un API de un mock.

## Efectos, reintentos e idempotencia (solo cuando la operación puede producir efectos)

Traza el ciclo desde la petición hasta el efecto durable y la respuesta. Un retry del cliente no crea idempotencia del servidor: localiza y verifica el contrato real de deduplicación. Si existe clave idempotente, comprueba que la misma clave + misma carga devuelve/reproduce el resultado definido; misma clave + carga distinta debe rechazarse o resolverse según contrato, nunca confundirse silenciosamente. Comprueba retención de clave y ventana de replay, colisiones/alcance por actor o recurso, y qué pasa al expirar.

Analiza concurrencia: dos requests simultáneas con la misma clave deben competir mediante claim/registro atómico y el efecto no duplicarse; inspecciona si hay transacción/unique constraint o mecanismo equivalente, no infieras atomicidad por pseudocódigo. Considera efecto aceptado pero respuesta perdida/timeout: el consumidor puede no saber si se aplicó, así que consulta estado/resultado durable antes de repetir si el protocolo lo permite. Distingue retry seguro, retry condicionado y operación no repetible; cubre timeout, cancelación, error transitorio y respuesta ambigua. Nunca declares “exactly once” solo por usar una cola, retry o key en cliente.

Ejemplo de prueba en sandbox autorizado: enviar clave K/carga A dos veces y verificar un solo efecto observable y respuesta contractual; enviar K/carga B y verificar conflicto/rechazo; disparar dos K/A concurrentes y verificar un efecto; simular respuesta perdida tras aceptar y comprobar recuperación por K sin duplicar. Omitir casos que la semántica del endpoint no permita, y no provocar efectos reales sin autorización.

Si se solicita retirar/migrar capacidad: inventaría consumidores y datos afectados, reversibilidad, compatibilidad/versiones y plan de recuperación; distingue despliegues/accesos observados de supuestos. Para cambios con consumidores/datasets en uso, evalúa una transición **expand → migrate/backfill → verify → contract**:

1. Expand: añadir representación/lectura compatible sin retirar la anterior; verificar consumidores y despliegue mixto old/new.
2. Migrate/backfill: avanzar de forma reanudable e idempotente, con cursor/progreso durable cuando aplique; explicar qué puede repetirse tras fallo y cómo detectar filas omitidas/duplicadas.
3. Verify: comparar conteos/invariantes/casos representativos, comprobar consumidores activos y observar errores antes de cortar lectura/escritura antigua.
4. Contract: retirar formato/columna/API vieja solo después de demostrar que no quedan consumidores y que la recuperación ya no depende de ella.

Adapta o salta pasos si no hay datos persistentes, despliegue simultáneo o consumidores externos. Documenta rollback frente a roll-forward: tras backfill/escrituras nuevas, revertir binario puede no revertir datos; define recuperación según reversibilidad real. No infieras qué versiones están vivas por el repo. No ejecutes migraciones/destructivos sin permiso específico ni impongas ceremonia a cambios simples.
