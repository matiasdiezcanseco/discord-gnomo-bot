# T01: Invocación comprobable e independiente de Discord

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/3

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Preparar primero la frontera de pruebas aprobada: un evento de Discord se convierte en una invocación normalizada y recorre una ruta funcional de respuesta verificable sin conectarse a Discord. Permitir sustituir la implementación completa sin anclar las pruebas a los objetos internos anteriores.

## Acceptance criteria

- [ ] Una invocación válida conserva servidor, canal/hilo, solicitante, mensaje, fecha y adjuntos hasta su respuesta; mensajes sin invocación, de otros bots o de otro servidor no producen respuestas.
- [ ] Las pruebas observan respuestas y efectos mediante dobles controlables de modelo, Discord y servicios externos, sin comprobar métodos privados ni texto exacto del prompt.
- [ ] Caracterizar escenarios representativos de conversación, frases/fotos, miembros, memoria y avisos existentes, separando comportamiento a conservar de cambios intencionados del diseño aprobado.
- [ ] La ruta existente sigue operativa durante esta preparación; no hay doble receptor activo ni migración de datos reales.
- [ ] Hay una ejecución reproducible de pruebas, tipos y compilación, sin necesitar credenciales ni servicios de producción.

## Blocked by

None (can start immediately).
