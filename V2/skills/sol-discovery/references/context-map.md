# Mapeo de contexto por capas · sol-discovery refs@1

Una vista selectiva de proyecto existente debe distinguir realidad observada de snapshot metadatado. Para un cambio local basta el slice afectado; proyecto entero solo cuando encargo/mapping lo pida. Registrar base revisada para que otra sesión sepa qué podría estar stale.

## Mapeo persistente de proyecto (contrato V2)

No conviertas cada encargo en un mapeo global ni exijas siete capas: mapea cuando se solicite/sea necesario y con profundidad proporcional al objetivo. `sol-init` formaliza tracking según su flujo; una lectura selectiva/onboarding no autoriza mutaciones de Work o escritura en `.sol/`. Reutiliza el Work de mapeo reservado/existente cuando corresponda; no inventes IDs ni revisiones. Antes de delegar, registra con task.add una tarea real de kind exploration, vinculada al criterio vigente y con writeScope para .sol/project.md, y déjala in_progress. No crees tareas retrospectivas al aceptar el mapa.

El Work conserva el ledger canónico. Con `sol_work_apply` registra acciones tipadas existentes: `discovery.context.set` con `contextLane` (`existing-project`, `project-in-existing-repo`, `greenfield` o `unknown`); `discovery.source.add` con `source:{id,kind,ref,observedAt,version?,path?,inspection?}`; y `discovery.claim.add` con `claim:{id,kind,statement,sourceIds}`. Claim kind es `fact`, `hypothesis` o `recommendation`; source kind es `user_statement`, `repository`, `official_documentation`, `existing_document`, `runtime_observation`, `test_observation` u `other`; inspection es `found`, `read`, `contrasted`, `stale`, `unknown` o `absent`. `observedAt` es fecha-hora ISO; no inventes `version` si se desconoce. Para paths locales el core calcula `fileSha256`; no envíes hashes ni provenance calculada. `inspection` es estado reportado por caller, no prueba de que Sol/una persona leyó o contrastó el contenido. Path ausente solo cuando se observó que falta; `found` no significa leído. Trata los registros como append-only: refrescar evidencia implica IDs nuevos, no falsificar o sobrescribir la fuente vieja.

En `.sol/project.md` (formato narrativo `project@1.0`), cada claim incluido debe mostrar literalmente su `statement` y anclas exactas `<!-- claim:C-1 --> <!-- source:S-1 -->` para cada fuente usada. Ejemplo ilustrativo (IDs de ejemplo, no hechos ni payload):

```md
## Negocio y límites
El usuario quiere que un alumno consulte el curso que acaba de comprar. <!-- claim:C-1 --> <!-- source:S-1 -->
```

El ledger define la procedencia; no dupliques en project.md un estado paralelo que compita con él. `completeProjectMap` requiere contexto, sources y claims canónicos, documento enlazado y exactamente una tarea exploration previamente persistida e in_progress, con criterio vigente y writeScope que cubra .sol/project.md. Conserva esa identidad/contrato al registrar evidencia estructural y cerrar la tarea; no fabrica un T-1 retroactivo. El Work debe ser exclusivo de mapeo; no es el camino para cerrar un Work ya consolidado. `inspectContextMap` informa `current`, `stale`, `legacy_unverified` o `not_mapped`: `current` acredita coincidencia de anclas/texto y coherencia/frescura de huellas locales, no verdad semántica, cobertura, revisión independiente ni autorización autenticada. Una edición en fuente enlazada vuelve stale el mapeo; refresca solo claims/temas afectados con nuevos registros/IDs y anclas, no reescribas automáticamente un Work cerrado ni declares áreas no reexaminadas actualizadas. Si se pide refrescar un mapeo cerrado, usa el flujo nativo de reopen/resume y mutaciones admitidas para un ciclo nuevo; preserva cierre/evidencia histórica y no simules `completeProjectMap` ni reescribas aceptación anterior. Documentos legacy pueden conservarse como `legacy_unverified`; no fuerces migración total.

Greenfield: enlaza intención reportada por usuario con `user_statement`; no inventes stack, archivos o ausencia no comprobada. Brownfield: enlaza afirmaciones a fuentes locales relevantes y lee/contrasta contenido antes de elevarlas a claims; metadata de ruta o `found` no equivale a análisis. Registra base/versión solo si se observó; no fabriques timestamp/versión desconocida ni generalices una inspección de slice a todo el proyecto.

| Vista | Fuentes a contrastar si son relevantes | Salida probatoria |
|---|---|---|
| Intención/producto | petición actual, PRD/spec, ADR, decisions y docs de comportamiento | objetivo, usuarios, AC/exclusiones; conflicto y fecha/base |
| Stack y módulos | manifests/lockfiles, estructura, instrucciones repo | versiones/rutas leídas; inferencia etiquetada |
| Flujo/runtime | entrypoints, rutas/callbacks/CLI, UI/API | entrada→validación→servicio→resultado/error con símbolo/ruta |
| Contratos y datos | DTO/schema, modelo, serialización, storage/eventos | producer/consumer, ownership, versioning, null/error |
| Integraciones/trust | clientes/servidores/SDK, auth, env/config sin secretos | frontera, dirección de datos, permisos observados, unknowns |
| Pruebas/operación | test configs/sources, scripts/CI, observability/deploy docs | checks existentes vs realmente ejecutados; limitación/env |
| Trabajo local/frescura | diff/status/hashes autorizados, timestamps/version refs | cambios ajenos, archivos contrastados, áreas no inspeccionadas |

## Refresh incremental

1. Lee `project.md` como mapa antiguo, no autoridad inmutable; registra su fecha/base.
2. Para el encargo, elige temas afectados; inspecciona fuentes primarias y los consumidores relevantes. Un documento candidato solo «found» hasta que leas contenido.
3. Contrasta cada claim que importe; etiqueta `read/contrasted/stale/unknown` con cita/base. No repitas una conclusión de memoria si checkout avanzó.
4. Actualiza solamente las secciones autorizadas y sustentadas. Retira/etiqueta stale afirmaciones afectadas, no declares fresco el resto.
5. Señala divergencia observed vs proposed; recomendación de deuda/refactor no expande alcance sin owner decision.

**Límite:** un inventory/find de nombres, mapa estático, existence de tests, `git status` o package script no demuestra arquitectura efectiva, test pass, deployed state ni absence. Cobertura parcial debe ser legible.
