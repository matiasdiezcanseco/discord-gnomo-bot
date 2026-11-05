# T07: Buscar información y noticias con fuentes y fechas

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/9

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Preguntar sobre información actual o noticias de un tema y periodo, y recibir una respuesta basada en resultados públicos, con fuentes y fechas cuando existan.

## Acceptance criteria

- [ ] Búsqueda general y noticias son capacidades registradas; las noticias aceptan un periodo y entregan procedencia estructurada.
- [ ] Diferenciar fecha de publicación y fecha del hecho cuando se conozcan; no inventar fechas ni enlaces.
- [ ] Las búsquedas sin resultados, servicio opcional no configurado, rate limits y fallos transitorios se explican sin fabricar actualidad.
- [ ] Acotar resultados y tiempo, reutilizar consultas recientes de forma explícita y respetar el presupuesto global sin reintentos ilimitados.
- [ ] Los resultados externos no conceden permisos ni alteran las políticas; pruebas de invocación verifican fuentes, periodos, contenido malicioso y respuestas parciales al agotarse el tiempo.

## Blocked by

- [T02 / #4: Conversación por invocación mediante un harness autorizado](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/4)
