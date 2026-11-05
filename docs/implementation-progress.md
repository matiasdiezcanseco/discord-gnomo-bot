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
| T03 / #5 | Integrado | 0829860; 40 pruebas con Redis real, tipos, build y lint aprobados en integración |
| T04 / #6 | Integrado | 4987e72; 65 pruebas combinadas, Redis real, tipos, build y lint aprobados |
| T05 / #7 | Integrado | cfbfa2d; miembros/menciones conservados al integrar historial |
| T06 / #8 | Implementador en ejecución | Presencia y voz |
| T07 / #9 | Integrado | ff762ac; 84 pruebas combinadas, Redis real, tipos, build y lint aprobados |
| T08 / #10 | Implementador en ejecución | Lectura pública de páginas |
| T09 / #11 | Pendiente de T08 | Adjuntos visuales |
| T10 / #12 | Próximo implementador | Recuerdos explícitos |
| T11 / #13 | Pendiente de T10 | Migración de recuerdos |
| T12 / #14 | Frontera disponible | Recordatorios recuperables |
| T13 / #15 | Pendiente de T12 | Cumpleaños |
| T14 / #16 | Pendiente de capacidades | Integración y latencia |
| T15 / #17 | Pendiente de T14 | Piloto y transición |

Frontera de pruebas confirmada: invocación normalizada hasta respuesta/efectos, modelo/Discord/web controlados y persistencia real aislada para migraciones/concurrencia. Docker Desktop ya está disponible (motor 27.4.0). Las dependencias del checkout de integración y el cliente Prisma local están preparados; no se han ejecutado servicios de producción, migraciones reales, piloto ni mediciones reales de latencia.

Worktrees a limpiar después de la integración y revisión completas: implementador T01 en `t3-98d57475`, rama `feat/t01-invocation`; T02 en `t3-7364b802`, rama `feat/conversation-harness`; T03 en `t3-d71d5f54`, rama `feat/fast-phrase-photo`. Preservar cualquier edición no integrada antes de limpiar mediante herramientas de T3.

También conservar hasta la limpieza final: T04 en `t3-52eab9dc`, rama `feat/recent-channel-context`; T05 en `t3-eb4c3e3e`, rama `feat/member-search-mentions`; T07 en ejecución en `t3-47fe69fd`, rama `feat/t07-news-search`.
