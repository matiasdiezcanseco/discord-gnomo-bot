# T05: Identificar miembros y mencionar sin ambigüedad

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/7

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Consultar quién pertenece al servidor, encontrar miembros por nombre/apodo y producir una mención individual solo cuando fue solicitada y la identidad es inequívoca.

## Acceptance criteria

- [ ] Búsqueda, detalle y listado paginado funcionan mediante invocación y herramientas registradas, limitados al servidor configurado.
- [ ] Resolver por ID y distinguir apodo de identidad estable; ante homónimos pedir aclaración antes de notificar a alguien.
- [ ] Miembros fuera de caché, fallos de consulta e intents no disponibles producen resultados desconocidos o incompletos, nunca un censo supuestamente completo.
- [ ] La lista de IDs permitidos en el envío se deriva de la petición y de identidades resueltas; el texto del modelo no autoriza menciones individuales, de roles o masivas.
- [ ] Pruebas desde invocación verifican paginación, homónimos, miembros ausentes de caché, intent faltante e intentos de cambiar el servidor mediante argumentos.

## Blocked by

- [T02 / #4: Conversación por invocación mediante un harness autorizado](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/4)
