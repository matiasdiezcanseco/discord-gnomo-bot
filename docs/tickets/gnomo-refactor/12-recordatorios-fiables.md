# T12: Crear y entregar recordatorios propios de forma recuperable

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/14

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Pedir un recordatorio en lenguaje natural, recibir confirmación solo tras guardarlo y obtener el aviso en el canal de origen, incluso si el proceso reinicia o falla temporalmente un envío.

## Acceptance criteria

- [ ] Recordatorios propios, destino derivado de la invocación y America/Lima; pedir aclaración cuando el tiempo sea ambiguo y no confirmar un estado incierto.
- [ ] Guardar antes de confirmar y deduplicar reintentos de la misma petición; conservar avisos pendientes de la implementación anterior durante la transición.
- [ ] Reclamar avisos de forma exclusiva, registrar estado y realizar reintentos acotados; fallos transitorios no borran el aviso y fallos permanentes quedan diagnosticables.
- [ ] Revalidar permisos al enviar, también en hilos compatibles; permitir solo la mención del destinatario acordado, sin privados ni envío arbitrario.
- [ ] No prometer exactamente una vez en Discord; distinguir una entrega incierta y evitar reenvíos ciegos. Exponer el mecanismo de entrega acordado para otros avisos programados.
- [ ] Pruebas desde invocación hasta aviso con Redis real y reloj controlado cubren reinicio, dos reclamadores, permisos revocados, timeout de escritura y fallo de envío.

## Blocked by

- [T02 / #4: Conversación por invocación mediante un harness autorizado](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/4)
