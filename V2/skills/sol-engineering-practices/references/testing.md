# Pruebas proporcionales

Parte de la conducta/criterio y del runner realmente definido en repo/manifiestos/scripts. Elige la prueba más pequeña que detectaría la regresión: unidad para lógica aislada, contrato para productores/consumidores, integración para wiring/estado, UI/E2E solo si el comportamiento exige entorno real y está disponible/autorizado.

Para lógica nueva o bug reproducible, RED–GREEN puede ayudar: observa que la prueba específica falla por la razón esperada, implementa y observa que pasa; luego ejecuta regresiones pertinentes. No afirmes RED/GREEN si no observaste ambos. No es requisito para cambios de texto, fixtures o tareas cuyo riesgo no lo amerite. Usa datos sintéticos; controla aislamiento, reloj, orden y recursos compartidos. Prefiere comportamiento real en fronteras relevantes; mocks sirven para aislar, no prueban conectividad ni wiring sustituido.

Inspecciona qué aserción prueba qué resultado. Cubre errores y bordes que cambien riesgo/aceptación; no agregues capas o cobertura porcentual universal. Nunca desactives aserciones, rebajes umbrales o actualices snapshot para ocultar regresión. Registra comando/directorio, versión si importa, código de salida y skips/fallos. Un test verde no certifica producción, seguridad ni aceptación global.
