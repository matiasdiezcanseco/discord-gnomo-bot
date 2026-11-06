# T12: Crear y entregar recordatorios propios de forma recuperable

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/14

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Pedir un recordatorio en lenguaje natural, recibir confirmación solo tras guardarlo y obtener el aviso en el canal de origen, incluso si el proceso reinicia o falla temporalmente un envío.

## Acceptance criteria

- [x] Recordatorios propios, destino derivado de la invocación y America/Lima; pedir aclaración cuando el tiempo sea ambiguo y no confirmar un estado incierto.
- [x] Guardar antes de confirmar y deduplicar reintentos de la misma petición; conservar avisos pendientes de la implementación anterior durante la transición.
- [x] Reclamar avisos de forma exclusiva, registrar estado y realizar reintentos acotados; fallos transitorios no borran el aviso y fallos permanentes quedan diagnosticables.
- [x] Revalidar permisos al enviar, también en hilos compatibles; permitir solo la mención del destinatario acordado, sin privados ni envío arbitrario.
- [x] No prometer exactamente una vez en Discord; distinguir una entrega incierta y evitar reenvíos ciegos. Exponer el mecanismo de entrega acordado para otros avisos programados.
- [x] Pruebas desde invocación hasta aviso con Redis real y reloj controlado cubren reinicio, dos reclamadores, permisos revocados, timeout de escritura y fallo de envío.

## Blocked by

- [T02 / #4: Conversación por invocación mediante un harness autorizado](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/4)

## Implementación y evidencia local

Contratos, esquema Redis, máquina de estados, transición explícita y comandos:
[reliable-reminders.md](../../reliable-reminders.md). La transición preserva los
payloads originales e incluye huérfanos del SET/ZADD legado. El cron anterior
excluye canales piloto; fuera del piloto conserva su ruta hasta T15. El operador
debe detener ejecuciones de versiones viejas antes de activar canales/transferir.
No se ejecuta migración al arrancar. T13 dispone del contrato de entrega diferida;
no se migran cumpleaños aquí.

Se aplicó TDD en el seam ya confirmado invocación → respuesta/efectos. Rojos
observados de comportamiento incluyen mañana con hora de 24 horas (aclaraba en
vez de guardar) y recuperación del payload legado sin índice (un envío en vez de
dos), ambos verdes después de implementar. Discord/modelo son controlados;
persistencia Redis y PostgreSQL/pgvector es real y aislada. El reloj de despacho
se controla con timestamps explícitos; CLIENT PAUSE ejercita timeout real de
escritura. Se recrean clientes y se reinicia realmente el servidor Redis AOF.
La suite heredada de retención Redis de `42e3193` queda intacta.

Verificación final (2026-11-05): ascendencia de
`42e3193c5b2ce1c7fda5753a9566d904d1f1d571` comprobada antes de editar; integración
local `7631af3137dbce9d9cec48ad5ad1126570236d4a` incorporada antes de la verificación
final, preservando T08 y T10. `npm run verify`: **138/138 pruebas, cero omitidas**,
tipos, build y lint correctos; `git diff --check` correcto. Redis 7 AOF aislado en
16392/16393 y PostgreSQL 17/pgvector aislado en 16412. El test de reinicio puede
emitir ECONNREFUSED mientras Redis vuelve a escuchar; la reconexión y entrega
posterior se verifican. Lint conserva el aviso previo MODULE_TYPELESS_PACKAGE_JSON.

Rama `feat/reliable-reminders`, worktree `t3-b288b963`. Sin subagentes, push,
despliegue, activación del piloto, producción, nuevo PR ni cierre de issue.
Modelo/Discord reales y latencia de producción no se validaron; durabilidad de
disco requiere la configuración y volumen Redis documentados. PostgreSQL real
valida los contratos T10 integrados; este ticket no añade persistencia SQL.
