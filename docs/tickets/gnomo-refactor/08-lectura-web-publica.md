# T08: Leer páginas públicas con acceso de red limitado

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/10

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Invocar a Gnomo con una URL pública para que consulte su contenido y responda con una fuente verificable, mediante un lector reutilizable para otras entradas externas autorizadas.

## Acceptance criteria

- [ ] Leer una URL explícita y devolver contenido relevante y procedencia mediante el ejecutor; no requiere que la herramienta de búsqueda ya esté implementada.
- [ ] Validar protocolos, resolución efectiva del destino y cada redirección, incluidos cambios de dirección entre validación y conexión; impedir loopback, redes privadas, link-local y servicios de metadatos.
- [ ] Acotar bytes, tiempo y tipos de contenido; no iniciar sesión, completar formularios ni interactuar con cuentas.
- [ ] Propagar cancelación y distinguir inaccesibilidad, contenido no compatible, resultado parcial y timeout.
- [ ] Un texto de página no autoriza herramientas o escrituras; verificarlo desde invocación con el modelo controlado.
- [ ] Probar el adaptador real con transporte controlado frente a URLs maliciosas, resolución y redirecciones; no contactar servicios internos reales para demostrar el bloqueo.

## Blocked by

- [T02 / #4: Conversación por invocación mediante un harness autorizado](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/4)
