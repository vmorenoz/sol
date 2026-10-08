# Diálogo adaptativo · sol-discovery refs@1

No hay número de rondas. El siguiente turno depende de qué contestó la persona y de si la respuesta requiere comprobación.

1. **Respuesta concreta:** incorpórala y sigue; no vuelvas a preguntar por un requisito explícito solo para ratificar tu paráfrasis. Revisa si cambia aceptación, decisión previa o plan. Parafrasea si ayuda a avanzar, no cierres cada turno con «¿confirmas?».
2. **Parcial o vaga:** identifica únicamente el término/pieza que deja dos resultados posibles. Da un ejemplo concreto del comportamiento divergente y pregunta por esa diferencia, no reinicies la entrevista.
3. **«No sé»/delegación:** no fuerces una preferencia. Separa una opción reversible de la que requiere decisión; investiga hechos, ofrece default seguro/condicional si el usuario delegó esa decisión y declara quién autorizó qué. Permisos/acciones externas no se infieren de «haz lo que veas» si la política exige consentimiento específico.
4. **Respuesta que revela hecho comprobable:** detén el cierre de esa afirmación; comprueba código/config/documentación oficial pertinente y regresa con evidencia, discrepancy y solo pregunta la intención que siga desconocida.
5. **Contradice evidencia local:** presenta ambas bases (p. ej. afirmación humana vs manifiesto), pregunta cuál regla de producto es intención si el archivo no puede resolverlo. No contradigas con arrogancia ni sobrescribas implementación automáticamente.
6. **Contradice decisión previa:** señala la decisión anterior y la consecuencia de cambiarla; pregunta si la nueva respuesta la sustituye cuando eso no sea inequívoco. Conserva historia/supersession; no borres respuesta previa. Si inequívoca, registra reemplazo y razón sin confirmación repetida.
7. **Abre una segunda incertidumbre:** si verificable, investiga primero. Si humana pero independiente, pregunta después de la decisión actual solo si cambiaría trabajo; no agrupar por comodidad.
8. **Distingue riesgo de detalle provisional:** incertidumbre con impacto material en dinero, seguridad, privacidad, límites tenant, permisos, alcance o efecto externo requiere evidencia y, si sigue irresuelta, decisión explícita antes de implementar/actuar. Un default reversible, de bajo impacto y alineado con la intención explícita puede avanzar si Sol lo etiqueta claramente como hipótesis provisional/corregible (no «confirmada») e invita corrección sin exigir respuesta. No elijas defaults silenciosos para cambios irreversibles ni uses provisionalidad para saltar un permiso.

Cada turno debería acabar con un estado legible: qué quedó acordado, qué evidencia lo respalda, qué permanece abierto y qué puede avanzar. No conviertas un «sí» a alcance en aceptación de plan o autorización de push.
