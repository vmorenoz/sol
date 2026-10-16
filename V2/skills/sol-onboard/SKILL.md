---
name: sol-onboard
description: Guía para entender un proyecto existente y sus restricciones antes de proponer cambios.
slash: false
---
# Incorporación a proyecto existente

Skill disponible al modelo, sin comando de workflow. Respeta `sol-init` para preparación/contexto inicial; no repitas el mapeo si el contexto existente sigue siendo suficiente. Para el encargo actual, lee selectivamente código y documentos relevantes (ADR, PRD/SPEC, decisiones, README, tests), contrasta intención con implementación y reporta fuentes, versiones/frescura, rutas y límites. Mapea stack, arquitectura, entradas→contratos→consumidores/resultados, integraciones, convenciones y pruebas pertinentes según el riesgo; no impongas leer siete documentos ni recorrer todo el repo. Onboarding readonly no autoriza mutar Work ni escribir `.sol/project.md`; si se pidió mapeo persistente, sigue el contrato [context-map](../sol-discovery/references/context-map.md), usando fuentes/claims tipados en `sol_work_apply` y anclas literales en el documento, no edición directa de metadata. Cargar esta skill no carga automáticamente recursos vecinos.

Separa encontrado/leído/contrastado/stale/no inspeccionado. Distingue observación de propuesta y falta de evidencia de ausencia. Actualiza contexto compartido solo si la tarea lo autoriza y el cambio es selectivo; no declares actualizadas áreas que no inspeccionaste. Devuelve a Sol riesgos, contradicciones, deuda confirmada y preguntas realmente decisivas.
