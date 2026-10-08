# Sol 2.1 para OpenCode v2

Sol es un asistente de desarrollo que convierte encargos en trabajo coordinado y recuperable. Usa las herramientas de OpenCode para delegar a especialistas y conserva por workspace el objetivo, tareas, decisiones, bloqueos, evidencia y cierres. El código del proyecto sigue siendo la fuente de verdad: Sol organiza el trabajo y ayuda a verificarlo; no sustituye el juicio del usuario ni certifica automáticamente que un cambio sea correcto.

Consulta los [cambios 2.1 y prueba recomendada](docs/HARDENING-2.1.md).

## Empieza aquí

Requisitos para instalar: Node.js 22 o posterior y OpenCode v2 accesible como `opencode` en `PATH`. Desde esta carpeta:

```sh
node install.mjs --help
node install.mjs --dry-run
node install.mjs
```

Para instalar con el perfil fijo equilibrado, añade `--profile balanced`; sin esa opción se conservan tus preferencias existentes, incluidos los modelos de Sol. En una primera instalación sin preferencias se hereda OpenCode; `--profile inherited` solicita explícitamente retirar las asignaciones Sol reconocidas. Tras instalar, `/sol-config` permite consultar o cambiar preferencias globales de modelos de los agentes Sol mediante asistente de tres pasos: perfil, tracking Local/Versionado del workspace actual y vista previa/confirmación. Para el modelo principal de OpenCode usa `/models`; `/sol-config` no cambia el modelo ya seleccionado en la sesión ni hace escalado/cambio automático de modelos.

La vista previa no escribe archivos ni crea respaldos. La instalación actual es global para el usuario; revisa primero [Instalación y retirada](docs/INSTALLATION.md), en especial qué casos legacy reconoce y qué conserva. Al aplicar cambios, las versiones de recursos gestionados que se reemplazan/eliminan y las configuraciones legacy que se editan se respaldan bajo `.sol/backups/`. Tras instalar, reinicia OpenCode, elige `sol` como agente principal y ejecuta `/sol-version`: distingue el build del plugin cargado del que está instalado en disco. `node install.mjs --version` consulta esta distribución; `node version.mjs` no demuestra qué plugin mantiene cargado otra sesión. Para quitar la instalación administrada, ejecuta `node install.mjs uninstall --dry-run` y, tras revisar el plan, `node install.mjs uninstall`.

Las pruebas automatizadas usan perfiles y repositorios Git temporales; no se instaló Sol en el HOME real, no se cambió metadata Git real ni se probó una sesión real de OpenCode en este pase. Comprueba los [límites de validación](docs/VALIDATION.md).

## Úsalo conversando

Describe el resultado que quieres, no una secuencia de herramientas. Por ejemplo:

- «Añade exportación CSV al listado de facturas. Primero inspecciona cómo se generan las exportaciones; propone tareas y criterios verificables, y espera mi aprobación del plan.»
- «¿Qué trabajos están abiertos y cuál es el siguiente paso?»
- «Retoma `work-export-csv`: comprueba el estado actual del repositorio y dime qué quedó pendiente.»
- «Resume los trabajos cerrados entre el 1 y el 30 de septiembre de 2026 y compáralos con los abiertos.»
- «Audita los cambios de accesibilidad del formulario; señala evidencia, límites y cualquier verificación que no se haya ejecutado.»

Comandos nativos: `/sol-version` identifica la versión cargada; `/sol-status` consulta el índice; `/sol-recap` resume cierres y trabajos abiertos; `/sol-resume` retoma un Work; `/sol-init` solicita el mapeo inicial y respeta el tracking existente (no configura modelos); `/sol-config` configura preferencias de modelos Sol y tracking Local/Versionado. `/sol-init` solo elige tracking, no modelos. Las skills `sol-new-project`, `sol-onboard`, `sol-discuss`, `sol-plan`, `sol-execute`, `sol-verify` y `sol-ship` son guías a demanda, no fases ni autorizaciones. `sol-discovery` incluye referencias de apoyo que se leen selectivamente. Véase [Descubrimiento](docs/DISCOVERY.md) y el [catálogo de plantillas](templates/README.md). Para nombres de herramientas, campos, límites y catálogo de especialistas, consulta [Inventario](docs/INVENTORY.md).

Un saludo, consulta de estado, onboarding readonly o encargo ordinario no prepara ni modifica `.sol/`. Solo una petición explícita de inicialización/preparación persistente o `/sol-init` activa tracking y preparación. Si no hay elección previa, propone Local predeterminado y ofrece Versionado; el estado permanece `unconfigured` hasta preview, confirmación y aprobación host, y sugerir no significa que `.sol/` esté excluido. Sin Git, informa bloqueo y no crea `.sol/` ni inicializa Git. Si el contexto existente basta, no remapees; el mapeo persistente usa ledger Discovery tipado y anclas en `project.md` ([contrato](skills/sol-discovery/references/context-map.md)); `current` solo es validación estructural, y legacy puede quedar `legacy_unverified`.

## Modelo mental

- **Workspace**: directorio activo que OpenCode proporciona al plugin; cada proyecto mantiene sus propios datos en `.sol/`.
- **Work**: unidad de coordinación con objetivo y criterios, tareas, estado, bloqueos, documentos y evidencia; cambia mediante revisiones numeradas.
- **Delegación**: encargo visible a un especialista nativo de OpenCode con alcance y resultado esperados. El catálogo contiene nueve especialistas además del agente Sol.
- **Evidencia**: registro de verificaciones y huellas de archivos. Una huella identifica el contenido comprobado; no demuestra por sí sola la calidad ni que una sesión real haya ocurrido.
- **Recibo**: resumen de una mutación aplicada, no una auditoría ni un certificado.

La herramienta Sol obtiene la raíz del contexto de sesión, no de texto que aporte el modelo. Estado, trabajos e historial se modifican mediante tools Sol; una revisión obsoleta se rechaza para que Sol relea y concilie, no sobrescriba. Los detalles están en la [guía de flujo](docs/WORKFLOW.md).

## Qué hace y qué no

Sol registra y consulta trabajo, coordina investigación/planificación/implementación/revisión con especialistas, y conserva continuidad por proyecto. El core valida esquemas y consistencia local, y puede comprobar si la evidencia registrada sigue vigente.

Sol no es un runtime de agentes, daemon, scheduler, servidor MCP ni base de datos externa. No implementa el producto por sí mismo: la ejecución se delega a especialistas nativos según las instrucciones y permisos efectivos de OpenCode. `/sol-config` es la excepción administrativa explícita: solo cambia preferencias fijas de modelos de agentes Sol y tracking del workspace activo, con vista previa, confirmación interactiva nueva y aprobación del host. No cambia providers, credenciales, permisos, el modelo principal, overrides de sesión, ni aplica staging/commit/push. Las preferencias guardadas en `agents.<id>.model` de la configuración global OpenCode afectan asignaciones futuras; la selección de modelo ya activa en la sesión principal conserva precedencia. No hay escalado ni hot-switch automático. El instalador limpia selectivamente referencias legacy reconocidas y administra solo sus propias asignaciones obsoletas. No explora repositorios para descubrirlos ni migra formatos desconocidos. Una validación offline o un recibo no equivalen a aprobación live de OpenCode.

## Una implementación nativa

Sol usa exclusivamente OpenCode v2: agentes principales/secundarios, sesiones, permisos y skills del host. No hay adaptadores multiruntime ni motor de ejecución paralelo. El plugin mantiene las operaciones del estado `.sol/`; la comunicación entre Sol y especialistas es Markdown natural, no payloads JSON obligatorios. Los schemas JSON siguen validando llamadas de herramientas y estado interno.

Los especialistas reciben objetivo, contexto seleccionado, alcance y evidencia esperada; devuelven hallazgos y límites proporcionados al encargo. Research también incluye el diálogo con el usuario: alcanza suficiencia para el **siguiente paso**, registra la decisión pendiente y continúa lo independiente ya autorizado. Un plan solicitado para revisión nunca autoriza implementar.

No es necesario instalar otro catálogo de agentes ni todos los MCP disponibles. Las capacidades externas son opcionales y se seleccionan según el proyecto; su disponibilidad no concede permiso para usarlas.

## Workspace y distribución

```text
proyecto/
└── .sol/
    ├── state.json             # índice/snapshot y foco
    ├── history.jsonl          # cierres
    ├── project.md             # contexto mapeado, si se genera
    └── work/<id>/             # work.json y documentos/evidencia del trabajo

V2/                            # distribución y desarrollo de Sol
├── agents/                    # Sol y especialistas nativos
├── plugins/opencode-v2/       # tools del workspace activo
├── skills/                    # skills Sol
├── schemas/                   # contratos JSON
├── templates/                 # formatos de artefactos
├── lib/                       # core local
└── docs/                      # guías de esta distribución
```

La estructura concreta puede crecer; consulta los [contratos y plantillas](docs/INVENTORY.md). En instalación global se distribuyen recursos en el perfil del usuario y OpenCode; la información de trabajo permanece dentro de cada proyecto.

## Desarrollo local

Requiere Node.js 22+. Desde `V2/`:

```sh
npm run build
npm run verify
```

`build` compone los recursos nativos; `verify` ejecuta checks estáticos/offline y la suite de pruebas. [Validación](docs/VALIDATION.md) distingue esos resultados de una prueba live. No hace falta ni se debe ejecutar el instalador para correr esas verificaciones.

## Guías

- [Inventario: tools, agentes, skills, comandos, schemas y templates](docs/INVENTORY.md)
- [Flujo de trabajo, revisión y recuperación](docs/WORKFLOW.md)
- [Instalación, conflictos y retirada](docs/INSTALLATION.md)
- [Validación y límites de evidencia](docs/VALIDATION.md)
