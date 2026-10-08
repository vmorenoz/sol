# Orquestación central de Sol

## Motivo

El prompt central ya separa el rol de orquestación de la ejecución especializada y exige delegaciones visibles, scopes acotados y metadata canónica. El refinamiento refuerza continuidad cuando coexisten varios frentes: no perder una petición nueva al atender otra rama, no esperar recordatorios para continuar trabajo ya autorizado y no cerrar con un mero anuncio de que existe un informe. También aclara que un bloqueo local no detiene tareas independientes y que la escritura de documentos del producto no equivale a editar metadata `.sol`.

## Reglas operativas

- Mantener por frente objetivo/Work, tareas registradas, estado, siguiente acción, dependencias, aceptación y bloqueo. Usar Work separado para resultados distintos y tareas registradas para partes del mismo resultado.
- Retomar tras cada retorno o error con la siguiente acción autorizada. Preguntar solo por decisiones de alcance, negocio o permiso que no puedan deducirse y que bloqueen esa rama; continuar las demás.
- Paralelizar únicamente cuando el runtime lo soporte, las dependencias estén resueltas y los scopes de escritura sean compatibles/disjuntos. Serializar actualizaciones del mismo Work con revisión vigente.
- Validar reportes de bloqueo frente al contrato, sin ampliar permisos. Tratar un rechazo de schema como fallo recuperable acotado; verificar estado antes de repetir efectos inciertos.
- Separar autoinforme, documento y evidencia observada. Vincular comprobaciones a criterios/tareas, exigir revisión/gates aplicables y cerrar solo con aceptación positiva.
- Resumir cada frente: resultado y hallazgos, acciones/verificaciones ejecutadas, no ejecutadas, evidencia, bloqueos y limitaciones.

## Escenarios guía

1. **Dos objetivos independientes:** registrar ambos frentes y sus tareas; investigar en paralelo si el runtime lo permite; un bloqueo de acceso remoto no impide avanzar la rama documental independiente.
2. **Auditoría y petición administrativa nueva:** atender la auditoría mientras se aclara/consulta el estado y contrato de la petición nueva. No elegir tecnología, datos, alcance ni hacer cambios destructivos sin la decisión necesaria.
3. **Especialista devuelve `blocked`:** pedir diagnóstico concreto o contrastar la tool/writeScope disponible. Una restricción para `sol_*` no prohíbe automáticamente redactar un Markdown autorizado.
4. **Tool rechaza metadata:** consultar schema, enums e IDs existentes; corregir argumento y expectedRevision, reintentar de forma acotada. No inventar valores ni repetir ciegamente una mutación cuyo efecto no se conoce.
5. **Entrega con comprobación reportada:** confirmar evidencia realmente observada y revisión/gates; registrar evidencia y cerrar si el contrato lo permite. Si falta capacidad canónica, reportar explícitamente esa limitación sin marcar done.
6. **Sin duplicados seguros:** reportar el resultado y su límite; no borrar ni convertirlo en bloqueo artificial.

## Límites de verificación

Las pruebas del repositorio verifican composición del prompt y presencia de cláusulas contractuales; no ejecutan un modelo ni demuestran autonomía o aceptación live de OpenCode. El runtime, sus herramientas, approvals y las skills aplicables siguen siendo la autoridad para capacidades y permisos. Los checks offline no sustituyen evidencia real de cada trabajo.

## Entregas, cobertura y auditorías

Sol elige explícitamente modo **formal persistente** o **conversacional efímero**. Formal: Work/revisión, taskIds existentes, schema completo y estricto, output/scope autorizados, cierre solo por metadata canónica. Efímero: delegación nativa visible con identidad del encargo/agente, respuesta narrativa en chat, sin Work/taskIds/result.json/report; puede tener writeScope vacío y lectura acotada autorizada. “No aplica” en plantilla es indicación en prosa solo para este modo, nunca dato JSON. Encargo formal sin IDs requeridos se corrige o bloquea por Sol: no degradarlo a conversación para saltar registro.

En modo formal, resultados e informes son históricos por delegationId: asignar output único; no sobrescribir una entrega ocupada. La corrección requiere nueva delegación, nuevo ID y rutas dentro del scope, manteniendo taskIds/revisión pertinentes y referencia al informe anterior en contexto o Markdown. El formato estricto de result no se amplía con campos de supersedes. Esto es una política de prompting/plantillas: el código no constituye un registro/scheduler de entregas. Archivos vivos asignados y metadata canónica mantienen sus contratos propios.

Antes de editar, el especialista fija una base suficiente y acotada al writeScope; compara contenido/diff relevante y puede usar hashes como apoyo. HEAD/conteos/hashes solos no certifican árbol limpio ni preservación semántica. No copiar secretos, recorrer diffs de todo el repo o restaurar cambios; distinguir preexistente, propio e indeterminado. Review debe recuperar informes previos pertinentes, no asumir que el último `changedFiles` es el diff completo.

La aceptación contempla todos los criterios y tareas pertinentes, cada uno como cubierto con evidencia vigente, parcial, no cubierto, bloqueado o no verificable. Informe descriptivo, result JSON, `sol_work_validate` y fingerprints no prueban que una comprobación se ejecutó; reportar solo observaciones reales y distinguir static/manual/executed/not_run. No exigir E2E sin necesidad y autorización, ni tratar offline como live. No alterar criterios sin decisión confirmada ni sumar PASS parciales como cierre global.

En auditoría de producto, mapear flujos críticos entrada→servicio→contrato→persistencia/backend→resultado solo donde corresponda. Clasificar con evidencia como demo, implementado parcial, conectado no verificado, ejecutado/verificado para el alcance observado, ausente o desconocido. “No encontrado” en búsquedas acotadas es desconocido, no ausente global; traza estática no simula runtime y presencia de tests no es PASS. Resumir capacidades, gaps y lo requerido para próxima aceptación.

Autoridad: implementación/configuración observadas describen conducta local; documentación describe intención, contrato documentado e historia; estado remoto observado describe ese despliegue, no intención de producto. Contradicciones requieren refs, base/versión y límites, y decisión del owner si material; documentación stale no es autoridad única. Limpieza de conocimiento clasifica vigente/contexto necesario/histórico/obsoleto/duplicado para reducir ruido y contradicción, no para maximizar borrados: separar o retirar exige alcance autorizado, links para contexto necesario y preservación prudente de fuentes únicas. Snapshots deben indicar fecha/origen y no titularse “actual” sin contraste. No se promete ejecución automatizada de estas reglas.
