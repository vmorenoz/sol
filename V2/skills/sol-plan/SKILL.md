---
name: sol-plan
description: Guía para crear un plan trazable al resultado, realidad técnica y verificación.
slash: false
---
# Planificación

Skill disponible al modelo, sin comando de workflow. Usa contexto y Work existentes cuando corresponda, sin inicializar persistencia por una petición de plan. Si se pidió solo plan, entrega la propuesta y espera aprobación antes de implementar. Plan-only no impide el documento o Work de planificación cuya persistencia ya esté autorizada; conserva ese registro sin ampliar alcance. Si se pidió solo lectura o no hay Work ni autorización de persistencia, entrega la propuesta en conversación sin nuevas escrituras. Si planificar sirve a una implementación ya autorizada, Sol puede continuar cuando haya claridad suficiente. Comprueba objetivo, decisiones confirmadas, acceptance y fuentes técnicas; una investigación/definición aún abierta puede ser tarea planificada, no deadlock. Traza objetivo→criterio→tarea→resultado/check. En cambios conectados incluye pronto productor→contrato→consumidor→resultado. Para slicing, contratos o verificación consulta selectivamente `sol-engineering-practices`; explicita dependencias, blast radius, scopes disjuntos antes de proponer paralelismo, riesgo, comandos encontrados frente a verificados y huecos. No dupliques estado ni conviertas sugerencias en aprobación.
