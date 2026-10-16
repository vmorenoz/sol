# Triage de evidencia · sol-discovery refs@1

## Clasificar antes de sintetizar

| Clase | Qué permite afirmar | No permite afirmar |
|---|---|---|
| Hecho observado | Una fuente concreta muestra esa propiedad en una base/fecha determinada. | Que sea intención vigente, aceptación del usuario o conducta en producción. |
| Hipótesis | Explicación plausible marcada como tal, con forma de contrastarla. | Tratarla como requisito o evidencia. |
| Recomendación | Opción sugerida con condiciones, trade-offs y base. | Atribuírsela al usuario como decisión confirmada. |
| Decisión humana | Preferencia/alcance/autorización expresados por la persona pertinente; conservar texto, quién lo reporta y cuándo. | Identidad autenticada ni permiso del runtime. |

Registra como mínimo: afirmación concreta, class, source (ruta+s símbolo/línea o URL+sección), fecha/versión/base, estado de inspección, confianza justificada, unknown/residuo. Una fecha actual no vuelve actual una fuente: declara su versión/base real.

## Estado de fuente

- **found**: se encontró el path o resultado; contenido todavía no leído.
- **read**: contenido inspeccionado.
- **contrasted**: comparado con fuente independiente (p. ej. ADR contra implementación).
- **stale/superseded**: evidencia concreta de base o sustitución posterior; conservar la referencia histórica.
- **partial/truncated**: búsqueda/acceso incompletos; no generalizar fuera de cobertura.
- **not inspected/unknown**: no observado. No convertir en ausencia.

## Procedimiento

1. Identifica la afirmación que realmente cambiaría la opción.
2. Prefiere evidencia local/directa para estado del repo; documentación oficial versionada para APIs externas; respuesta del usuario para intención/preferencia.
3. Lee la porción fuente necesaria. Comprueba fecha/versión/commit si existe. Contrasta solo si una discordancia puede cambiar la decisión.
4. Registra en el informe/artefacto pertinente sin duplicar work/state. Una evidencia estática describe el checkout; no es ejecución.
5. Si falta fuente/acceso, di qué intentaste, alcance de la búsqueda y qué permanece desconocido; propone una próxima investigación concreta.

**Ejemplo:** «En `config.yml` leído en commit A, timeout=4s [hecho estático]; el README describe 10s pero no indica versión [fuente leída, vigencia indeterminada]; desconozco el timeout de producción [no observado]. Recomiendo conservar compatibilidad con clientes que esperan 4s, salvo que el owner quiera cambiar contrato». No escribir “producción tiene 4s” ni “10s está obsoleto” sin evidencia.
