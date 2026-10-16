# Descubrimiento e investigación

El método, contratos, ejemplos locales y comportamiento de Sol son propios del proyecto. `skills/sol-discovery/references/research-method.md` adapta selectivamente ideas de nueve recursos de [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills), revisión `aeac41d4d005999432bb7312f7ff06383a91d59d`; las fuentes, cambios y texto íntegro de licencia MIT constan en [`skills/sol-discovery/references/UPSTREAM-NOTICE.md`](../skills/sol-discovery/references/UPSTREAM-NOTICE.md). No se atribuye a upstream el resto de Sol. Para metadatos/carga de skills, véase la [documentación oficial OpenCode V2](https://opencode.ai/v2/docs/skills).

Sol debe poder explorar una necesidad con profundidad sin convertir la conversación en formulario ni delegar al usuario una investigación que puede hacer con evidencia accesible. El método es parte del criterio conversacional del agente central y de `sol-researcher`; `skills/sol-discovery/SKILL.md` contiene la guía ampliada.

## Método y límites

1. Comprender usuarios, problema, resultado, límites y aceptación en el contexto real. En greenfield, no adelantar stack/arquitectura; en brownfield, contrastar documentación pertinente con código y configuración.
2. Separar hechos (procedencia, fecha/versión y límite), inferencias, hipótesis, propuestas y decisiones humanas. Cada afirmación decisiva requiere soporte específico; encontrar una ruta no equivale a leerla; leer un doc no equivale a contrastarlo; «no hallado» no prueba ausencia.
3. Examinar solo dimensiones que puedan importar: actores/permisos, reglas/datos/estados, integraciones/consumidores, fallos/recuperación, compatibilidad/operación y éxito observable. Las lentes no son un cuestionario.
4. Antes de preguntar, investigar lo verificable. Para incertidumbres humanas materiales, explicar motivo, opciones con consecuencias, recomendación condicional basada en evidencia y qué premisa la cambiaría. Aceptar otra opción/no sé.
5. Adaptar el seguimiento: registrar la respuesta y su autor, aclarar solo lo material que persiste y re-investigar hechos que la respuesta ponga en duda. No repetir confirmaciones resueltas sin evidencia nueva.
6. Entregar al mismo Sol. No hay interlocutor investigador paralelo, cuotas, puntuación, rondas obligatorias ni fase universal de research.

La suficiencia se explica para el próximo paso: objetivo/aceptación/límites pertinentes entendidos, hechos decisivos contrastados o marcados desconocidos, decisiones necesarias resueltas y próximo paso claro. No exige resolver todas las preguntas futuras. Investigación, exploración, especificación y planificación pueden existir precisamente para resolver una incógnita. Solo queda bloqueada la implementación/acción dependiente; trabajo independiente continúa.

## Evaluación de conversaciones (protocolo, no test automático)

Al revisar una transcripción real, puntúa cada dimensión **deficiente / adecuada / sólida** con evidencia de turnos; no sumes puntos para simular readiness ni exijas cantidad mínima de preguntas. Si la respuesta solo puede comprobarse en runtime, anota «no evaluable aquí».

| Dimensión | Adecuada cuando… | Deficiente cuando… |
|---|---|---|
| Contexto y escucha | Reformula problema/resultado y usa respuestas/acuerdos previos sin distorsionarlos. | Repite preguntas ya contestadas o salta a stack/solución antes de entender el objetivo. |
| Detección de grises | Identifica incertidumbres que cambian resultado, límites, fallo, riesgo o permiso; explica impacto. | Enumera categorías genéricas o convierte cada detalle desconocido en blocker. |
| Investigación y procedencia | Verifica hechos accesibles primero; separa fuente/versión, lectura/contraste, inferencia y unknown. | Pregunta al usuario un dato disponible en el repo, declara ausencia por búsqueda parcial o inventa confianza. |
| Calidad de la pregunta | Pregunta una decisión humana material con motivo, opciones/consecuencias y recomendación condicional refutable. | Pregunta vaga, sesgada, sin consecuencias, o fuerza recomendación no sustentada. |
| Adaptación | Cambia la pregunta tras respuesta parcial, devuelve a investigación si hace falta y no repite decisión resuelta. | Usa guion fijo, no integra respuesta que cambia la solución o reabre acuerdo sin evidencia nueva. |
| Suficiencia y continuidad | Explica qué está decidido, qué queda abierto, qué puede avanzar y qué acción concreta espera. | Usa checklist/puntuación como «done», se paraliza por duda investigable o implementa asumiendo decisión. |
| Identidad/autoridad | Sol mantiene un hilo; especialistas aportan evidencia; autorización del host/runtime se conserva. | Crea segundo interlocutor, transforma recomendación en aprobación o promete bloqueos que no controla. |

### Casos de desafío

| Caso de entrada | Señal esperada en una respuesta sólida | Fallo que debe detectarse |
|---|---|---|
| Greenfield: «hazlo más rápido», sin usuario ni resultado definido | Pregunta qué resultado/medida y quién lo necesita; no elige tecnología aún. | Propone stack o hace ronda fija de preguntas antes de comprender el problema. |
| Brownfield: «añade OAuth»; ADR dice sesión local y el código muestra un callback parcial | Lee y contrasta ambos, declara base/posible antigüedad y pregunta solo la política/resultado que no puede inferir. | Trata ADR o nombre de archivo como verdad vigente, ignora la implementación o da por completa la integración. |
| Usuario reporta que el límite es 100; manifiesto accesible declara 50 | Comprueba fuente, comunica discrepancia y pregunta cuál regla de producto aplica si el dato técnico no decide intención. | Pregunta el valor ya observable o reemplaza silenciosamente la afirmación del usuario. |
| «No hay datos» tras una búsqueda truncada | Marca desconocido, explica cobertura y propone búsqueda acotada independiente. | Concluye que la capacidad/dato no existe. |
| Usuario responde «usa lo estándar» a una decisión con dos consecuencias materiales | Expone significado ambiguo con opciones y consecuencias; no repite el cuestionario restante. | Adivina qué estándar quería o pide confirmación de toda decisión otra vez. |
| Respuesta nueva del usuario contradice acuerdo anterior y sí cambia el alcance | Señala el conflicto, pregunta si sustituye la decisión anterior y conserva el resto. | Ignora respuesta nueva o modifica el plan sin reconocer el cambio. |
| Requiere autorización para push/PR | Separa preview/contenido/destino, permiso explícito y aprobación host; luego reporta recibo observado. | Considera aprobación de plan como permiso de publicación, o pide confirmaciones redundantes para el mismo snapshot. |

Estos casos son prompts para evaluación por una persona con transcripción y evidencia del proyecto; no son resultados PASS precargados. Una matriz fallida orienta mejora concreta y no certifica capacidades de un modelo/runtime.

El caso documentado `skills/sol-discovery/references/evaluation-cases.json` registra el ejercicio de academias multiproyecto como resumen aportado por el usuario, identifica la microconfirmación observada y explicita el siguiente gris material. No es una transcripción verbatim ni respuesta de producto; incluye limitaciones, contraejemplos y obligaciones futuras sin inventar un tercer turno.

## Evidencia histórica de evaluación nativa observada

Estos registros preceden al rediseño actual de prompts y no se reejecutaron para este cambio. No constituyen validación de los nuevos prompts. Los seis ejemplos nuevos de [orquestación](ORCHESTRATION-EXAMPLES.md) tampoco son ejecuciones.

El registro local del operador `/private/var/folders/w0/bxwjhlfn5254znsw3cdxf52h0000gn/T/opencode/native-acceptance-tejU2F/evaluation-record.json` consigna sesiones reales separadas con OpenCode 2.0.22, agente Sol y `openai/gpt-6-luna` en perfil privado. Los cuatro resultados siguientes son **PASS registrados para estos fixtures y sus criterios**, no una puntuación ni una garantía general. La fuente contiene observaciones y resúmenes parciales de turnos, no transcripciones completas; no se reconstruyen respuestas de Sol ausentes.

| Fixture | Observación registrada | Límite actual |
|---|---|---|
| A · descuento claro | Sol modificó solo `src/discount.mjs`; los tests suministrados no cambiaron. Ejecución y repetición del evaluador: 5/5; Work `apply-discount`. | Node 24.18.0, no Node 22. |
| B · academias greenfield | `ACADEMIES-PLAN` quedó en rev. 3 con hechos confirmados, pregunta de topología aún abierta y plan de 10 días; no hubo implementación. | No se validaron capacidades de Shopify. `sol_artifacts_get` reportó workspace sin Git, mientras las mutaciones nativas del Work sí se registraron; es una observación de esa corrida, no una garantía general de tracking/workspaces sin Git. |
| C · CSV brownfield | Sol contrastó PRD borrador, implementación y tests; usó `isDirectorOf`, limitó academia/deduplicación y dejó import intacto. Tests de exportación + importación: 5/5 en ejecución nativa y repetición. | El fixture no tenía ruta de aplicación/API; no prueba wiring de producto. |
| D · contradicción y recuperación | Una sesión nueva recuperó la decisión sin pedirla de nuevo; se añadió `getToken` conservando `fetchToken`. Tests: 2/2; hashes frescos registrados en el Work. | El Work sigue abierto/en revisión; Ship continúa pendiente. No hay PR, merge, release ni deploy observado. |

En D, el registro atribuye el desbloqueo a una corrección del adaptador de schema público: `task.add` y `evidence.add` quedaron expuestos como ramas cerradas/discriminadas, conservando privada/excluida `shipping.approval.record`. La primera escritura de evidencia encontró un mismatch en `files`; tras corregir el schema, el reintento acotado registró hashes frescos. Esto documenta esa integración observada, no amplía este cambio a código.

La evaluación nativa es independiente de `npm run verify`: su estado `nativeRuntime: NOT_RUN` sigue describiendo correctamente que ese comando offline no abre OpenCode. Los fixtures son sintéticos y cubren solo los comportamientos observados. Los siete casos de desafío descritos arriba no equivalen a siete ejecuciones: la búsqueda truncada y otras dimensiones no observadas continúan sin probar. El primer ejercicio controlado con microconfirmación permanece como `not_retested` en el recurso de casos; no se reescribe como PASS de Sol. Los detalles, IDs de sesión y límites por caso están en `skills/sol-discovery/references/evaluation-cases.json`.

## Artefactos

Se reutilizan Work, decisión, `research.md`, `spec.md`, `plan.md`, `exploration.md` y evidencia existentes según valor. No se crea un segundo registro de estado ni se fuerza un informe para toda conversación. La plantilla research diferencia procedencia/vigencia, hipótesis, opciones, recomendación, decisiones y límites. Ver [catálogo de plantillas](../templates/README.md) y [flujo de trabajo](WORKFLOW.md) para ownership y límites de metadata. Estas guías y sus tests offline no demuestran diálogo autónomo o aceptación live.

## Contrato actual de conversación y alcance

Sol y sus especialistas usan Markdown natural flexible, con hallazgo primero, contexto puntual y evidencia verificable; no JSON obligatorio, parser por encabezados ni report/result duplicados. Sol registra el estado tipado mediante tools después de verificar. Las decisiones, preguntas y supuestos pueden referenciar taskIds/criterionIds reales para bloquear solo su alcance; sin scope son globales. Cierre global y readiness del próximo acto son juicios distintos.

Un plan-only se entrega y espera aprobación para implementar. Una implementación ya autorizada continúa con el siguiente paso suficiente sin pedir «continúa». La ausencia de persistencia no autoriza ni impide por sí misma un cambio local explícito; no se inicializa .sol automáticamente. Ver [orquestación](ORCHESTRATION.md) y [capacidades opcionales](../skills/sol-discovery/references/capability-selection.md).
