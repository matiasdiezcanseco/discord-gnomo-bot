# Implementación de Gnomo

Rama de integración: `integration/gnomo-harness`.
Base fija para la revisión final: `7c3364e40d1143e6cf7c1fbf109c02d8126d4f9c`.
PR en borrador: https://github.com/matiasdiezcanseco/discord-gnomo-bot/pull/18.
Especificación: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2.

Los tickets siguen abiertos hasta la resolución mediante el PR; integrado no significa cerrado ni desplegado.

| Ticket | Estado de implementación | Evidencia |
| --- | --- | --- |
| T01 / #3 | Integrado | b88a223; 15 pruebas, tipos, build y lint aprobados en worktree del implementador |
| T02 / #4 | Integrado | 68bb8a1; 31 pruebas, Redis real aislado, tipos, build y lint aprobados en integración |
| T03 / #5 | Frontera disponible | Frases y fotos rápidas |
| T04 / #6 | Frontera disponible | Historial real del canal |
| T05 / #7 | Frontera disponible | Miembros y menciones |
| T06 / #8 | Pendiente de T05 | Presencia y voz |
| T07 / #9 | Frontera disponible | Búsqueda y noticias |
| T08 / #10 | Frontera disponible | Lectura pública de páginas |
| T09 / #11 | Pendiente de T08 | Adjuntos visuales |
| T10 / #12 | Frontera disponible | Recuerdos explícitos |
| T11 / #13 | Pendiente de T10 | Migración de recuerdos |
| T12 / #14 | Frontera disponible | Recordatorios recuperables |
| T13 / #15 | Pendiente de T12 | Cumpleaños |
| T14 / #16 | Pendiente de capacidades | Integración y latencia |
| T15 / #17 | Pendiente de T14 | Piloto y transición |

Frontera de pruebas confirmada: invocación normalizada hasta respuesta/efectos, modelo/Discord/web controlados y persistencia real aislada para migraciones/concurrencia. Docker Desktop ya está disponible (motor 27.4.0). Las dependencias del checkout de integración y el cliente Prisma local están preparados; no se han ejecutado servicios de producción, migraciones reales, piloto ni mediciones reales de latencia.

Worktrees a limpiar después de la integración y revisión completas: implementador T01 en `t3-98d57475`, rama `feat/t01-invocation`; T02 en `t3-7364b802`, rama `feat/conversation-harness`. Preservar cualquier edición no integrada antes de limpiar mediante herramientas de T3.
