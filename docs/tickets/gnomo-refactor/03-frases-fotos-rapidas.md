# T03: Frases y fotos por una ruta rápida autorizada

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/5

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Pedir una frase o foto de la colección existente y recibirla por la ruta nueva; las peticiones inequívocas se resuelven sin modelo y las variantes naturales siguen disponibles como herramientas.

## Acceptance criteria

- [ ] Frases y fotos existentes se obtienen y entregan desde una invocación válida; una foto aleatoria nunca se presenta como imagen generada.
- [ ] La ruta determinista usa las mismas políticas del ejecutor y no requiere generación, clasificación LLM ni búsqueda de recuerdos.
- [ ] Variantes naturales pueden resolverse mediante las herramientas registradas sin modificar el bucle y sin alterar personalidad ni formato de los recursos.
- [ ] Datos vacíos, dependencia caída y timeout producen respuestas útiles sin enlaces inventados.
- [ ] Pruebas desde invocación verifican resultados, llamadas externas mínimas y restricciones de menciones; registrar una medición reproducible contra el objetivo de tres segundos.

## Blocked by

- [T02 / #4: Conversación por invocación mediante un harness autorizado](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/4)
