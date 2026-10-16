# Encargo para {{agente nativo exacto}}
<!-- template: delegation.md@1.0 -->

Contrato de mensaje de Sol al especialista, en Markdown normal. Usa estos encabezados y orden; completa solo el contenido pertinente y mantén breves los encargos simples. No es un archivo que haya que crear, parser, payload JSON ni wrapper XML. Instrucciones comunes y deberes del rol ya están en el prompt del especialista: no los copies aquí.

La sesión pertenece al encargo. Para cada encargo nuevo, llamar a subagent SIN sessionID, aunque coincidan especialista o Work, con handoff autosuficiente. Solo reutilizar el sessionID devuelto para aclarar/completar/corregir el mismo encargo aún no aceptado por Sol, con rol, scope y base compatibles. Un cambio de encargo o rol, o un scope/base incompatible, requiere sesión nueva. Toda auditoría independiente empieza limpia; el seguimiento compatible del mismo encargo auditor puede continuar hasta aceptación. Los reintentos técnicos/idempotentes del init conservan la identidad de su operación.

## Objetivo
{{Resultado concreto y por qué importa. Añade el próximo paso que habilita si ayuda a delimitarlo.}}

## Contexto y referencias
{{Base, decisiones pertinentes, rutas/fuentes que el especialista debe leer y hallazgos previos relevantes. Enlaza/identifica con precisión; no pegues transcripciones ni el Work entero. IDs/revisión/taskIds solo si existen y son útiles.}}

## Alcance y restricciones
{{Lecturas permitidas/relevantes y escrituras autorizadas por separado; exclusiones, recursos compartidos, preferencias aplicables con su origen conocido y decisiones materiales pendientes. `writeScope` orienta conducta, no amplía permisos ni es sandbox del host.}}

## Criterios de aceptación
{{Conducta observable que permitirá a Sol juzgar esta tarea; incluye criterios/tareas existentes cuando corresponda. No conviertas completed del host en aceptación ni inventes aprobación del usuario.}}

## Entrega esperada
{{Qué resultado, referencias y comprobaciones hacen falta para esta tarea. La respuesta usa el contrato Markdown de agents/common.md; precisa particularidades del rol. Asigna un único Markdown/ruta/writeScope solo si se solicita un artefacto o el Work requiere evidencia persistente. No exigir result.json, reporte duplicado ni archivo por tarea.}}

{{Al continuar el mismo encargo aún no aceptado, aporta solo el faltante y conserva la sesión nativa compatible; un encargo nuevo usa sesión nueva. Si se asigna un documento histórico, acuerda una ruta única; la corrección enlaza la anterior y no la sobrescribe. La entrega no cierra el Work: Sol verifica y registra metadata por tools. Los documentos persistentes siguen sus propias plantillas flexibles.}}
