# T04: Conversar y consultar el historial real del canal

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/6

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Responder a una invocación con contexto reciente del mismo canal y permitir consultar conversaciones anteriores aunque el bot no hubiera participado.

## Acceptance criteria

- [ ] Usar hasta 30 mensajes recientes, con autores e identidades, e incluir la invocación actual una sola vez; un mensaje ambiental puede aportar contexto pero nunca dispara una respuesta.
- [ ] La herramienta consulta hasta 200 mensajes mediante paginación acotada; comunica límites de tamaño y resultados parciales.
- [ ] No importar mensajes de otros canales, del padre de un hilo ni de otros hilos; comprobar permisos efectivos de lectura e historial del solicitante y bot, también al reutilizar cachés.
- [ ] La caché no es un archivo permanente: caducidad máxima de 24 horas por mensaje y tamaño limitado, incluso si continúa la actividad del canal.
- [ ] Instrucciones citadas en el historial se tratan como datos y no autorizan nuevas acciones.
- [ ] Pruebas de invocación cubren dos canales, hilos, permisos revocados, mensajes repetidos y concurrencia; probar caducidad con Redis real y reloj controlado cuando corresponda.

## Blocked by

- [T02 / #4: Conversación por invocación mediante un harness autorizado](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/4)
