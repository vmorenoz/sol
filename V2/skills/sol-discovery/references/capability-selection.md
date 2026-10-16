# Selección de capacidades disponibles · sol-discovery refs@1

Selecciona herramientas a partir de la pregunta y de lo que OpenCode exponga realmente a ese agente. Este recurso no instala nada, no autoriza conectar servicios y no presupone que los especialistas hereden todas las tools/MCP del principal. Comprueba catálogo/permisos reales antes de delegar una dependencia técnica.

| Necesidad | Si ya está disponible y autorizado | Alternativa autorizada |
|---|---|---|
| API o comportamiento de una versión de librería | Context7 con la librería/versión verificada desde manifiesto/lockfile; comprobar procedencia y versión de la respuesta | Documentación oficial de esa versión o fuente primaria del proyecto; declarar diferencias o falta de acceso |
| Contrato, símbolos y consumidores locales | Herramientas de editor, búsqueda y lectura; índice si existe y está vigente | Búsqueda/lectura acotada en rutas relevantes; ausencia de índice no bloquea toda exploración |
| UI o recorrido de navegador | Navegador nativo o Playwright CLI ya disponible, con el entorno y acciones autorizados | Revisión estática útil más limitación explícita de lo visual/interactivo no ejecutado |
| Estado de repo, issue, PR o CI remoto | GitHub MCP conectado o gh ya autenticado y permitido, eligiendo lectura/campos específicos | Fuentes locales o públicas autorizadas cuando respondan la pregunta; identificar lo remoto no verificado |
| Metadata de Sol | Tools sol_* nativas de la sesión | Conservar resultado en conversación si falta capacidad; no editar metadata por otra vía |

No conviertas una herramienta opcional en requisito universal ni instales paquetes, navegadores, CLIs, plugins o índices automáticamente. No abras autenticación/configuración, cambies modelos o amplíes permisos para cumplir un encargo sin la autorización necesaria. Denegación de acceso significa respetar ese límite; indisponibilidad técnica permite una alternativa ya autorizada, no eludir la denegación.

Para documentación, confirma versión y vigencia antes de aplicar una respuesta a una API real. Una herramienta de recuperación no garantiza que la fuente sea actual. Para QA, registra entorno, método y resultado observado: tener Playwright o un navegador no demuestra que se haya probado. Para GitHub, una lectura no autoriza comentar, publicar, cambiar settings, push o PR; shipping conserva su flujo específico.

Devuelve solo el contexto que cambia la decisión: capacidades usadas, fuentes/resultados y el límite que afecte la conclusión. No adjuntes catálogos completos ni trazas extensas.
