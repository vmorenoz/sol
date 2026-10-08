# Sol

Este repositorio reúne las dos generaciones del asistente personal Sol:

- **[V1](V1/)**: snapshot completo del proyecto Sol que existía localmente antes de esta reorganización.
- **[V2](V2/)**: evolución del asistente de desarrollo, adaptada a la identidad y uso personal de Sol. No incluye historiales Git ajenos ni skills o comandos de BBVA.

## V2

Sol V2 es un asistente de desarrollo para OpenCode v2. Coordina especialistas nativos, conserva contexto y trabajos en `.sol/` dentro del workspace y usa tools semánticas para las operaciones de coordinación. No es un asistente de banca ni incluye las skills de BBVA/APX/CELLS.

La revisión 2.1 mejora discovery conversacional, delegación nativa, comunicación Markdown y continuidad por frentes. No incorpora asistencia personal fuera del desarrollo.

Requisitos: Node.js 22+ y OpenCode v2. Para validar:

```sh
cd V2
npm run verify
```

Consulta [V2/README.md](V2/README.md) para instalación, uso y límites, y [V2/docs](V2/docs/) para arquitectura y operación.

## Conservación

V1 se conserva como snapshot independiente y V2 se mantiene en su propia carpeta para que ambas versiones puedan consultarse sin mezclar sus fuentes. Los directorios locales `node_modules/` y `dist/` pueden existir dentro de V1, pero están excluidos del control de versiones.
