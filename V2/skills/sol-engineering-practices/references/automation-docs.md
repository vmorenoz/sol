# Automatización, calidad y documentación

**CI/automatización:** si el encargo toca pipeline, localiza la configuración y comando real de CI (workflow, script, versión/runner, triggers, condiciones y servicios). Determina si el job corre para esta rama/evento y si el paso es required, opcional, conditional, skipped o no disponible; un check definido en YAML no prueba que corra ni bloquee merge. Distingue ejecución local de job remoto y reporta fuente/ejecución observada. Ejemplo de falso verde: job verde porque el test job fue omitido por `if:` en pull_request; comprueba condición y artefactos, no el badge solamente.

Conserva checks existentes y su capacidad de detectar regresiones; ante cambio, prueba tanto la condición pertinente como que un fallo relevante produce fallo del comando/job, sin borrar diagnóstico. Cambia gates/pipeline solo si el encargo lo pide. No configures deploy, secretos, runners, quality gates universales ni servicios nuevos por iniciativa. Un check local no prueba CI ni live.

**Documentación:** actualiza la fuente canónica que el cambio vuelve falsa; explica rationale, alternativa y consecuencia solo cuando ayude a mantenimiento/uso. Conserva convenciones, enlaces y versiones; evita README/ADR duplicados y documentación ceremonial. Distingue conducta implementada, planeada y verificada.

**Restricciones de calidad:** aplica los criterios ya acordados y detecta si el diff debilita tests/controles. No inventes `CONSTRAINTS.md`, thresholds, porcentajes ni entrevista para fijarlos. Si la barra realmente falta y la decisión es humana/material, eleva la pregunta a Sol; no rebajes el bar para pasar.
