# Comprobaciones de integración antes de la transición

Estas comprobaciones concretan el comportamiento conversacional ya aprobado; no introducen nuevas decisiones de producto. La base integrada tiene 175 pruebas aprobadas con persistencia aislada real, pero los casos controlados no certifican comportamiento ni latencia de servicios reales.

## Lenguaje natural y composición

- Comprobar guardado con «recuerda que Juan juega Valorant» y recuperación con «quién juega Valorant». La forma técnica actual «guarda recuerdo: ...» puede mantenerse como atajo, pero no debe ser obligatoria. Las escrituras siguen requiriendo consentimiento explícito actual comprobado en código; una búsqueda de memoria pertinente puede elegirse como lectura sin enriquecimiento automático en cada saludo.
- Comprobar menciones solicitadas en lenguaje natural, incluido «dile a David que se una», conservando resolución inequívoca, pertenencia al servidor y bloqueo de notificaciones no solicitadas.
- Conservar expresiones temporales inequívocas como «mañana a las 9am». Pedir aclaración para horas realmente ambiguas, no por exigir formato técnico nuevo.
- Probar búsqueda seguida de lectura de una fuente recuperada en la misma petición. El contenido de una página no concede autoridad para efectos ni acceso a destinos privados; una fuente estructurada de una búsqueda autorizada no equivale a una orden arbitraria de esa página.
- Probar imágenes junto con consultas de lectura cuando la petición lo necesite; la restricción actual que elimina todas las herramientas al haber imágenes debe contrastarse con el alcance aprobado. Mantener validación de bytes, identidad, permisos y consentimiento explícito para escrituras.

## Eficiencia y presupuestos

- Evitar repetir llamadas REST de permisos por cada herramienta al descubrir el catálogo. Conservar comprobación efectiva actual antes de ejecutar efectos y entregar respuestas.
- Los presupuestos de pasos del modelo y llamadas a herramientas/subllamadas son independientes. No perder la síntesis final solo porque las generaciones hayan consumido el contador de herramientas.
- Ejecutar lecturas independientes en paralelo, ordenar dependencias reales y no paralelizar escrituras de estado incierto. Mantener plazo común, cancelación y respuestas parciales verificables.
- Eliminar contradicciones heredadas del prompt sobre autoguardado, una sola herramienta y límite rígido de 700 caracteres. Conservar la personalidad de Gnomo y separar persona de políticas actuales.

## Evidencia, transición y límites pendientes

- Preparar un runner reproducible y acotado para medir respuestas visibles, p50/p95, proporción fuera de tres/quince segundos y utilidad/fallos, usando el modelo configurado sin sustituciones silenciosas.
- La configuración privada real no se recibió: no existe un archivo de credenciales disponible para ejecutar el piloto. No usar producción como sustituto de pruebas aisladas ni contar un aviso de timeout como resolución exitosa.
- En la transición final, retirar consumidores y módulos antiguos, simplificar los contratos posicionales de composición y verificar arranque/composición Nest con fronteras externas controladas.
- Mantener el ledger, triggers y protección contra resurrección de recuerdos de T11. No eliminar infraestructura de migración como si fuera un artefacto temporal.
- Verificación completa: bases PostgreSQL separadas para T10/T11, Redis principal y Redis AOF independientes para reinicios T12/T13. Documentar cualquier omisión; no presentar mocks como persistencia o latencia reales.
