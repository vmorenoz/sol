# Exploración · {{work-id}} · {{alcance}}
<!-- template: exploration@1.0 -->
## Preguntas resueltas
{{Pregunta concreta y respuesta con evidencia.}}
{{Si es auditoría de aplicación, incluir solo flujos críticos pertinentes: entrada→servicio→contrato→persistencia/backend→resultado, fuente/base y madurez evidenciada (demo, implementado parcial, conectado no verificado, ejecutado/verificado para alcance observado, ausente o desconocido). Búsqueda acotada sin hallazgo = desconocido, no ausente global; traza estática no simula runtime. Resumir capacidades, gaps y qué falta para aceptación.}}
## Mapa del repositorio
| Área | Archivos/símbolos | Responsabilidad | Relación con el cambio |
|---|---|---|---|
| {{área}} | {{referencia}} | {{función}} | {{impacto}} |
## Contratos y dependencias
{{Productores, consumidores, persistencia, eventos y fronteras relevantes.}}
## Patrones, comandos y pruebas existentes
{{Lo observado, su fuente y qué se ejecutó realmente; no suponer comandos estándar.}}
## Impacto, limitaciones y siguiente paso
{{Cambios potenciales; incertidumbres que requieren otro rol o al usuario.}}
{{Distinguir comportamiento local observado en código/config, intención/contrato documentado e historia, y despliegue observado para ese entorno. Registrar contradicciones con refs/base/version y elevar decisión material al owner; docs stale no son autoridad única.}}
