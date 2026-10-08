---
name: sol-new-project
description: Atajo conversacional para definir un proyecto nuevo sin adelantar arquitectura.
slash: true
---
# Proyecto nuevo

Skill visible al modelo y como slash. No crea una fase, Work o confirmación adicional por sí mismo. Sigue `sol-init` solo ante petición explícita de preparación persistente, y `sol-discovery` si hay grises materiales. OpenCode lista metadatos; Sol carga el cuerpo cuando corresponda.

Entiende primero quién tiene el problema, qué ocurre hoy, qué resultado observable se busca, límites/exclusiones y restricciones conocidas. Investiga ecosistema o dominio solo si la decisión lo requiere; diferencia hechos comprobados de recomendaciones. No empieces por stack, framework ni arquitectura ni inventes requisitos. Pregunta con alternativas y consecuencias únicamente por decisiones humanas que cambien materialmente el resultado. Para mapeo persistente greenfield, enlaza intención explícita como `user_statement` y deja lo técnico como desconocido; no rellenes mapa ficticio. `sol-init`/tracking es un flujo separado, no efecto automático de esta skill. Devuelve a Sol las respuestas/hallazgos; luego acuerden aceptación suficiente y planifiquen el siguiente paso sin reportes ceremoniales.
