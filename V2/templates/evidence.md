# Evidencia · {{work-id}} · {{evidence-id}}
<!-- template: evidence@1.0 -->
## Afirmación y clase epistemológica
{{AC-ID/tarea si existe; tipo: fact/hypothesis/recommendation/user-reported; qué permite concluir y qué no. Un informe no reemplaza claim fuente/canónico.}}
## Base comprobada
{{Commit/base si existe, cambios locales pertinentes, paths realmente leídos/ejecutados y hashes gestionados por Sol. No asumir checkout limpio por HEAD/conteos.}}
## Método y entorno
{{executed/manual/static/not_run; directorio, comando exacto, versiones y prerrequisitos. Fecha de ejecución reportada solo si observada; fuente externa incluye fecha/versión y URL/sección.}}
{{Solo checks observados. Un reporte no equivale a registro de evidencia estructurada; fingerprints/sol_work_validate no demuestran ejecución. Static/manual no son executed, mock solo prueba bajo ese mock, smoke offline no es aceptación live ni E2E. Ejecutar capas solo con necesidad y autorización.}}
## Resultado observado
{{pass/fail/blocked/not_run; exit real u observación reproducible. Mantener resultado histórico si luego queda stale; nueva edición invalida aceptación vigente pertinente, no convierte PASS histórico en “nunca se ejecutó”. Nunca PASS requerido cuando está not_run/sin evidencia actual.}}
## Cobertura
{{Positivo, vacío, error, integración y demás escenarios según proyecto.}}
## Omitido o bloqueado
{{Pruebas no ejecutadas, skips, servicios inaccesibles y consecuencias.}}
## Vigencia
{{Base del criterio/Work revision y eventos que invalidan vigencia (bytes relevantes, config/entorno, contrato/decision). Fingerprint ayuda a detectar cambio, no demuestra calidad ni semántica. Separar histórico PASS de current acceptance.}}
{{No borrar/regenerar fingerprints ni reutilizar un PASS tras cambio material. Corrección se documenta en nueva entrega con delegationId/output únicos y referencia a la original; no sobrescribir el informe histórico.}}
## Referencias
{{Informes o salidas saneadas, sin logs indiscriminados.}}
