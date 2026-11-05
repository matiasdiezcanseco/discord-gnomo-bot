# T14: Resolver peticiones combinadas dentro del presupuesto y medir latencia

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/16

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Una petición que combina capacidades ya migradas recibe resultados coherentes y verificables dentro del presupuesto común. Validar y ajustar el comportamiento integrado con servicios reales, sin posponer a esta entrega los límites y pruebas que cada capacidad ya debe cumplir.

## Acceptance criteria

- [ ] Resolver escenarios como consultar una conversación y buscar una noticia relacionada, o buscar un recuerdo para responder a una petición sobre un miembro; no mezclar canales ni conceder autoridad al contenido recuperado.
- [ ] Paralelizar lecturas independientes y secuenciar dependencias reales; ninguna cadena o subllamada reinicia el límite de tiempo ni excede cinco pasos u ocho herramientas totales.
- [ ] A los doce segundos, cancelar trabajo externo y preparar resultados parciales con fuentes o aviso antes de quince; no contar el indicador de escritura como respuesta ni continuar silenciosamente después.
- [ ] Probar colas, rate limits, servicios caídos y escritura incierta sin duplicar efectos ni confirmar resultados no persistidos.
- [ ] Medir con servicios reales tareas sencillas y con herramientas: p50/p95, proporción que excede tres/quince segundos y respuestas útiles frente a fallos. No dar un timeout por éxito funcional ni usar mocks como evidencia de rendimiento real.
- [ ] Optimizar dentro del alcance y publicar resultados y límites observados; no cambiar de modelo/SDK silenciosamente para aparentar cumplimiento.
- [ ] Las trazas permiten explicar el recorrido y consumo sin almacenar por defecto cuerpos completos ni secretos; ejecutar también pruebas de tipos, compilación, lint y comportamiento.

## Blocked by

- [T03 / #5: Frases y fotos por una ruta rápida autorizada](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/5)
- [T04 / #6: Conversar y consultar el historial real del canal](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/6)
- [T06 / #8: Consultar miembros conectados y participantes en voz](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/8)
- [T07 / #9: Buscar información y noticias con fuentes y fechas](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/9)
- [T09 / #11: Responder sobre imágenes adjuntas a una invocación](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/11)
- [T11 / #13: Consultar los recuerdos existentes tras migrarlos al esquema nuevo](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/13)
- [T13 / #15: Conservar los cumpleaños con la entrega programada nueva](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/15)
