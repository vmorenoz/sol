# Contexto del proyecto
<!-- template: project@1.0 -->
Última revisión: {{fecha observada}} · autor: {{Explorador}} · integración: {{Sol}} · base: {{commit/archivos realmente revisados; si desconocida, indicar desconocida}}

Este documento es una vista narrativa; las afirmaciones con anclas `<!-- claim:ID -->` y fuentes `<!-- source:ID -->` deben corresponder a registros Discovery del Work. No inventar IDs, hashes ni cobertura completa. El validador comprueba anclas/texto/procedencia estructurada y huellas locales; no certifica verdad semántica ni quién realizó/autorizó una lectura.

## Negocio y límites
{{Qué resuelve, para quién y qué no pertenece al producto. No inferir información corporativa. Cada afirmación factual lleva al final del párrafo sus IDs exactos, p. ej. `<!-- claim:C-1 --> <!-- source:S-1 -->`. En greenfield puede ser intención enlazada a user_statement; marcar lo técnico desconocido.}}
## Stack observado
| Componente | Versión observada | Fuente | Vigencia |
|---|---|---|---|
| {{componente}} | {{versión o pendiente}} | {{archivo:línea}} | {{fecha}} |
## Arquitectura, integraciones y mapa de flujos
{{Solo áreas relevantes inspeccionadas: módulos, límites, entradas→contratos→consumidores/persistencia→resultado; referencias exactas. Cada afirmación lleva anclas exactas, p. ej. `<!-- claim:C-2 --> <!-- source:S-2 -->`. Contrastar por tema, no inventariar todo el repo.}}
## Comandos del proyecto
| Propósito | Directorio | Comando observado | Ejecutado y resultado | Prerrequisitos |
|---|---|---|---|---|
| {{test/build/lint}} | {{ruta}} | {{comando}} | {{no ejecutado o evidencia}} | {{entorno}} |
## Convenciones y skills
{{Instrucciones existentes prioritarias, patrones confirmados y skills pertinentes.}}
## Restricciones y datos
{{Entornos autorizados, datos sintéticos, servicios no accesibles, acciones que exigen aprobación.}}
## Acuerdos y decisiones
{{Referencias a decisions.md o decisiones del trabajo, sin duplicar su contenido.}}
## Procedencia y vigencia del contexto
| Tema | Estado: found/read/contrasted/stale/unknown/absent | Fuentes/base | Confianza y límite |
|---|---|---|---|
| {{tema}} | {{estado}} | {{rutas, símbolos, docs/versiones}} | {{por qué y qué no cubre}} |
## Hechos, supuestos e incertidumbres
{{Separar hechos, hipótesis y desconocidos; un documento hallado no equivale a contenido leído o vigente. Cada supuesto material tiene cómo contrastarse. No marques como actualizado lo que no revisaste.}}

Para que el core pueda comprobar la trazabilidad estructural del mapeo, cada afirmación enlazada al ledger Discovery debe incluir su statement exacto y el marcador `<!-- claim:ID -->`; acompaña las citas con `<!-- source:ID -->`. Registra fuentes y afirmaciones con `sol_work_apply` antes de completar el mapeo. Estos marcadores solo enlazan registros: no verifican semánticamente una afirmación ni autentican quién leyó o revisó el material.
