# T06: Consultar miembros conectados y participantes en voz

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/8

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Preguntar quién está conectado en Discord o quién está en una llamada y recibir esas dos señales por separado, basadas en los miembros identificados del servidor.

## Acceptance criteria

- [ ] Configurar y comprobar recepción de presencias; online, idle y dnd cuentan como conectados y conservan su estado concreto.
- [ ] Offline se expresa como aparece desconectado; invisible no se intenta detectar. Datos faltantes o inicialización incompleta no se convierten en desconexión.
- [ ] Listar participantes en voz como una capacidad distinta, filtrando canales y datos no visibles al solicitante.
- [ ] Comunicar frescura y cobertura parcial; no inferir presencia por mensajes recientes ni por estar en voz.
- [ ] Pruebas desde invocación cubren los estados, ausencia de intents, caché parcial y canales de voz ocultos; validar con un escenario controlado del servidor sin publicar datos ajenos en logs.

## Blocked by

- [T05 / #7: Identificar miembros y mencionar sin ambigüedad](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/7)
