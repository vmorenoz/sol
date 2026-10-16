---
name: sol-engineering-practices
description: Métodos de ingeniería selectivos para implementar, depurar, probar, revisar y operar cambios según su riesgo.
slash: false
---
# Prácticas de ingeniería (Sol)

Guía bajo demanda; no es un workflow, permiso ni agente. Carga **solo** la referencia necesaria y omítela para saludos, status, respuestas simples o tareas que no toquen el tema. Si el tema coincide con una responsabilidad existente, úsala como refuerzo, no como nueva fase.

| Necesidad | Referencia | Roles primarios |
|---|---|---|
| Cortar e implementar cambios con seguridad, simplificar sin alterar conducta | `references/implementation.md` | Executor, Planner |
| Diagnosticar fallos y corregir su causa | `references/debugging.md` | Executor, QA, Explorer |
| Elegir, diseñar y ejecutar pruebas | `references/testing.md` | QA, Executor |
| Contratos, APIs y compatibilidad | `references/contracts-migrations.md` | Planner, Explorer, Executor, Reviewer |
| Revisar calidad y contraevidencia | `references/review.md` | Code Reviewer, Plan Auditor |
| Amenazas y mitigaciones | `references/security.md` | Security Auditor, Executor |
| UI, accesibilidad, pruebas de navegador | `references/frontend.md` | UI Auditor, Executor, QA |
| Medir rendimiento o definir observabilidad útil | `references/operations.md` | Executor, QA, Reviewer |
| CI, calidad automatizada, documentación y rationale | `references/automation-docs.md` | Planner, Executor, QA, Reviewer |
| Límites de alcance Git y entrega | `references/delivery.md` | Sol, Executor |
| Procedencia, SHA y aviso MIT íntegro | `references/UPSTREAM-NOTICE.md`; decisiones de las 25 skills: `references/upstream-map.json` | Mantenedores |

Sol es el único coordinador. Respeta el encargo, Work, roles, herramientas instaladas y permisos del host; nada aquí ordena delegar, instalar, cambiar configuración, ejecutar comandos no autorizados, crear commits ni publicar. Las prácticas upstream se adaptaron y las prescripciones incompatibles se excluyeron según `references/upstream-map.json`.
