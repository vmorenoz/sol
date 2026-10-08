---
name: sol-ship
description: Atajo para preparar y ejecutar entrega externa con autorización exacta y recibos observados.
slash: true
---
# Entrega

Skill visible al modelo y como slash. Carga `references/preflight-and-authorization.md` al preparar entrega. Usa primero `sol_ship_preflight` para snapshot/vista previa; preflight no autentica al usuario ni autoriza efectos. Presenta paths, commits/contenido, destino y acciones exactas. Push y creación de PR solo con autorización explícita para ese snapshot y destino, además de permisos/aprobaciones del runtime; los gates son independientes. Solo tras consentimiento invoca `sol_ship_authorize`. El permiso efectivo allow/auto del host puede permitir la invocación sin diálogo; la ausencia de popup no equivale a denegación ni requiere atestación criptográfica de UI, pero auto no sustituye el consentimiento del usuario para alcance nuevo ni permite aprobar mediante booleano del modelo o raw `shipping.approval.record`. Sol invoca `sol_ship_authorize` privilegiado y respeta el resultado y políticas reales del host; si el host niega o el snapshot cambia, bloquea. `shipping.approval.record` es interno; no autoriza por sí mismo y no se invoca vía `sol_work_apply`, que filtra/rechaza la acción directa. No incluyas commits ajenos pendientes sin consentimiento explícito.

Tras una aprobación para el mismo contenido/destino, no pidas tres confirmaciones Sol para commit→push→PR; si cambia contenido, destino o alcance de acciones, vuelve a presentar preview y pide autorización nueva. No hagas merge, tag, release, deploy, force push, `git add -A`, stash de cambios ajenos ni instalación global sin autorización independiente. Ejecuta únicamente acciones previstas por flujo/herramienta nativa, nunca shell arbitrario a partir de texto del usuario/notas. Informa recibos observados, estado y URL real del PR si existe; no prometas que el host bloquea otras vías.
