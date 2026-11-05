# T09: Responder sobre imágenes adjuntas a una invocación

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/11

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Conservar la capacidad de adjuntar una imagen al mencionar al bot y obtener una respuesta que utilice ese adjunto con controles de acceso y tamaño.

## Acceptance criteria

- [ ] El adjunto de la invocación llega al adaptador multimodal y se asocia al mensaje y autor correctos sin cargar automáticamente imágenes de otros canales.
- [ ] Reutilizar el lector externo limitado para obtener bytes o contenido validado antes de enviarlo al proveedor; no delegar al proveedor una URL arbitraria sin aplicar esos controles.
- [ ] Comprobar tipo, tamaño, destino y cancelación; adjuntos caducados, inválidos o no admitidos producen una explicación útil.
- [ ] Las pruebas de invocación verifican el contenido recibido por el modelo simulado, los rechazos y la ausencia de herramientas o escrituras autorizadas por instrucciones dentro del adjunto.

## Blocked by

- [T08 / #10: Leer páginas públicas con acceso de red limitado](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/10)
