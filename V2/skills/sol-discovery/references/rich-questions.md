# Diseñar preguntas ricas · sol-discovery refs@1

Una buena pregunta reduce riesgo de decidir por el usuario; no maximiza cantidad ni complejidad. La estructura interna es: **contexto observado → decisión pendiente → por qué cambia el resultado → opciones reales/consecuencias → recomendación condicional → contra-premisa → invitación a alternativa**. Presenta solo lo necesario en lenguaje natural.

## Prueba antes de mostrarla

- ¿Es una elección humana material que evidencia disponible no responde? Hechos técnicos primero se investigan; detalles de bajo impacto y reversibles no justifican frenar para preguntar.
- ¿Dos respuestas plausibles llevan a comportamientos/aceptación/riesgo diferentes?
- ¿Incluí alternativa abierta («otro/no sé») y no fabriqué falso dilema?
- ¿La recomendación está apoyada y puede refutarse por una condición explícita?
- ¿Estoy dentro del alcance, sin añadir preferencias/capacidades no pedidas?

## Ejemplos adaptables (no copiar como cuestionario)

**Import conflict:** «En la importación, encontré filas que ya existen. Si gana el archivo, una importación puede sobrescribir cambios locales; si gana el valor local, los datos nuevos del archivo se pierden. Recomiendo no sobrescribir en silencio y mostrar conflictos porque es reversible y protege datos. ¿Prefieres mantener local, reemplazar explícitamente, o tienes una regla distinta? Cambiaría la recomendación si el archivo es la fuente canónica y la sincronización debe ser autoritativa.»

**Retención/error:** «El endpoint actual devuelve 404 tanto para “no existe” como para acceso denegado. Separarlos ayuda al cliente, pero revela existencia de recursos; mantener uno solo limita diagnóstico. Recomiendo no filtrar existencia salvo que clientes necesiten distinguir. ¿Hay una necesidad confirmada de distinguir, o es suficiente un mensaje genérico? Si el producto ya expone existencia a ese actor, cambia el balance.»

**Greenfield success:** «“Más rápido” puede significar responder antes o reducir trabajo manual. Con el flujo descrito, automatizar revisión parece atacar el tiempo humano; no hay aún datos de latencia. Recomendaría medir pasos/tiempo manual antes de optimizar infraestructura. ¿Quieres reducir espera, pasos manuales, o ambos? Si la latencia de servicio es el problema visible, investigaría esa hipótesis primero.»

**Respuesta clara + incógnita reversible:** Usuario ya pidió que la compra de prueba dé acceso, sin cobro real. No vuelvas a preguntar si el prototipo debe dar acceso: declara «Tomaré la compra ficticia como confirmación de pedido y acceso, tal como pediste; será un default provisional y fácil de cambiar» y sigue. En cambio, no inventes qué usuario puede conceder rol de docente/director por academia: afecta tenant boundaries y datos de ventas. Investiga primero si el repo ya define invitación/RBAC; si no hay evidencia, plantea esa decisión concreta antes de implementar autorizaciones.

**Permiso de publicación/alcance irreversible:** Una decisión que publica datos, cobra, cambia acceso entre academias o excede el scope no se degrada a «default provisional» solo porque el camino técnico sea fácil de revertir. Expón consecuencia y obtén la decisión/autorización que la política exige antes del efecto.

No uses estos ejemplos para inferir requisitos, industria o política del usuario. Reemplaza evidencia/alternativas por lo investigado y elimina opciones que no son viables.
