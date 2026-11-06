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
| T06 / #8 | Integrado | 6da5ba3; 91 pruebas con Redis real tras separar reconexión y expiración |
| T07 / #9 | Integrado | ff762ac; 84 pruebas combinadas, Redis real, tipos, build y lint aprobados |
| T08 / #10 | Integrado | 712777f; 127 pruebas con Redis real, tipos, build y lint aprobados |
| T09 / #11 | Integrado | e316f6b; imágenes verificadas como bytes, 175 pruebas conjuntas sin omisiones |
| T10 / #12 | Integrado | 54cdf24; 129 pruebas sin omisiones, PostgreSQL/pgvector y Redis reales, reinicio PostgreSQL comprobado |
| T11 / #13 | Integrado | 5962a7e; 139 pruebas sin omisiones tras endurecer el timeout de escritura Redis, migración real y reinicio AOF aprobados |
| T12 / #14 | Integrado | efc7d37; 138 pruebas sin omisiones, PostgreSQL y Redis reales, reinicio AOF Redis comprobado |
| T13 / #15 | Integrado | e316f6b; avisos de cumpleaños compartidos y reinicio AOF propio aprobado |
| T14 / #16 | Siguiente frontera | Integración, lenguaje natural y latencia; configuración privada real aún no recibida |
| T15 / #17 | Pendiente de T14 | Piloto y transición |

Frontera de pruebas confirmada: invocación normalizada hasta respuesta/efectos, modelo/Discord/web controlados y persistencia real aislada para migraciones/concurrencia. Docker Desktop está disponible (motor 27.4.0). PostgreSQL 17/pgvector y Redis 7 aislados verifican el almacenamiento nuevo, incluida recuperación tras reinicio real de PostgreSQL. No se han ejecutado servicios de producción, migraciones sobre datos reales, piloto ni mediciones reales de latencia.

Worktrees a limpiar después de la integración y revisión completas: implementador T01 en `t3-98d57475`, rama `feat/t01-invocation`; T02 en `t3-7364b802`, rama `feat/conversation-harness`; T03 en `t3-d71d5f54`, rama `feat/fast-phrase-photo`. Preservar cualquier edición no integrada antes de limpiar mediante herramientas de T3.

También conservar hasta la limpieza final: T04 en `t3-52eab9dc`, rama `feat/recent-channel-context`; T05 en `t3-eb4c3e3e`, rama `feat/member-search-mentions`; T07 integrado desde `t3-47fe69fd`, rama `feat/t07-news-search`.

T06 integrado desde `t3-36f1523d`, rama `feat/presence-voice`. La integración reveló una carrera en la prueba de reconexión Redis con TTL de un segundo: reconexión y expiración se verifican ahora con eventos separados y un TTL holgado para la primera, manteniendo Redis real y la suite concurrente.

T08 integrado desde `t3-f9a8e2da`, rama `feat/public-web-reading`. Dependencias htmlparser2/ipaddr.js instaladas según lockfile; pruebas con HTTP/HTTPS/DNS controlados verifican el lector y las restricciones de red, sin certificar latencia de servicios reales.

T10 integrado desde `t3-b7b28ee9`, rama `feat/explicit-memory`. Contratos de almacenamiento e instalación aditiva: `docs/tickets/gnomo-refactor/10-storage-contract.md`. No se han importado todavía datos antiguos.

T12 integrado desde `t3-b288b963`, rama `feat/reliable-reminders`. Tras interrupción por límite, el merger conservó las 138 pruebas aprobadas y completó tipos/build/lint. Solo retiró sus recursos aislados; no tocó los recursos de imágenes o migración. Contratos y transición explícita de avisos: `docs/reliable-reminders.md`.

T11 integrado desde `t3-6699debc`, rama `feat/migrate-legacy-memories`. La suite inicial descubrió un timeout de 40 ms aplicado también al handshake de Redis en una prueba T12: se aplica ahora solo después de conectar, y CLIENT UNPAUSE coordina el fin de la pausa sin sleep arbitrario. La suite concurrente completa pasó 139/139, cero omisiones, con PostgreSQL/pgvector (bases T10/T11 separadas), Redis principal y Redis AOF reiniciado. Operación de migración validada con datos sintéticos, sin aplicar cambios a recuerdos reales.

Conservar para limpieza final: T09 en `t3-1243cee0`, rama `feat/attached-image-inputs`; T13 en `t3-795e221b`, rama `feat/scheduled-birthday-notices`. Los implementadores T09/T11 dejaron contenedores propios disponibles; no confundirlos con producción ni con recursos de tareas activas.

Integración T09/T13: e316f6b, 175/175 pruebas, cero omisiones, tipos/build/lint/diff correctos. PostgreSQL/vector y Redis reales; reinicios AOF T12/T13 separados. La tarjeta privada para configuración del piloto venció sin datos: no hay archivo privado ni mediciones de servicios reales. La implementación y pruebas aisladas continúan; no se certifica piloto/latencia.
