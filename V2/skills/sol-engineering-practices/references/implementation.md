# Implementación incremental y simplificación

1. Confirma resultado, criterios, decisiones y límites autorizados; lee el patrón/contrato local que toca. No inventes spec o estado duplicado.
2. Divide solo cuando reduzca riesgo o permita una comprobación útil: cada corte debe conservar el comportamiento integrado y tener un resultado observable. No hay cuota de líneas ni commits por corte.
3. Cambia la causa o capacidad necesaria con la menor complejidad sostenible. Reutiliza convenciones; evita abstracciones, dependencias y refactors ajenos sin beneficio comprobable.
4. Prueba en el punto de feedback más rápido pertinente; conserva el error útil. Tras el cambio, inspecciona el diff completo, compatibilidad y alcance. Si un corte rompe integración, corrige antes de ampliar.

Ejemplo: en una corrección de parsing, reproduce primero la entrada que falla, añade el caso al test pertinente, ajusta parser y errores, luego comprueba consumidor real; no reorganices módulos no relacionados. Si la petición es de plan solamente, no implementes.
