<!-- template: delegation.md@1.0 -->

<delegation version="1">
<mode>{{formal-persistent | conversational-ephemeral; Sol chooses explicitly.}}</mode>
<identity>{{Formal: delegation-id, work-id, work-revision, existing task-ids, exact-agent-name. Efímero: identidad del encargo y exact-agent-name; no fabricar Work/taskIds/revisión ni usar n/a/null para simularlos.}}</identity>
<objective>{{Resultado observable del encargo, no una instrucción vaga.}}</objective>
<context>{{Referencias mínimas, decisiones confirmadas, cambios previos y base.}}</context>
<applicable_preferences>{{Preferencias relevantes, origen/ruta si se conoce e impacto concreto en el encargo; si ninguna aplica, indícalo brevemente.}}</applicable_preferences>
<skills>{{Nombres y rutas de skills aplicables, cargadas bajo demanda.}}</skills>
<template>{{Formal: plantilla global y ruta. Efímero: no aplica —respuesta narrativa en chat, sin documento.}}</template>
<output>{{Formal: ruta única por delegationId, nunca overwrite. Efímero: respuesta en chat, sin report/result.json.}}</output>
<write_scope>{{Formal: rutas autorizadas. Efímero: vacío salvo lectura acotada autorizada; no crear archivos.}}</write_scope>
<acceptance>{{Formal: criterio comprobable. Efímero: responder la consulta autorizada sin persistencia.}}</acceptance>
<constraints>{{No delegar; no editar el índice del proyecto; permisos heredados; incertidumbres.}}</constraints>
<!-- Formal: schema delegation/result completo y estricto; IDs existentes obligatorios. Efímero: no Work/schema/result; texto narrativo por canal nativo. Output formal ocupado requiere que Sol corrija el encargo con nueva ruta/delegationId; una corrección conserva taskIds/revisión pertinentes y referencia informe previo en contexto/Markdown. Nunca ampliar schemas. Si faltan IDs de un encargo formal, Sol corrige o bloquea; no reclasificarlo como efímero. -->
<return>{{Formal: result.json completo correlacionado, no cierra Work. Efímero: respuesta narrativa en chat, sin JSON formal ni cierre de Work.}}</return>
</delegation>
