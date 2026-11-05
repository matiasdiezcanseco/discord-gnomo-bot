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

## T04 — implementación y contratos de prueba

La composición del piloto incorpora historial Discord real anterior a la invocación, sin receptor ambiental nuevo. `messages_history` declara la capacidad `messages.history`, con entrada estricta `limit` (30 por defecto, máximo 200), sin destino ni identidad elegibles por el modelo. Registro en `pilotCatalog`, autorización explícita en `composePilot`; no se añade enrutamiento por nombres al agente.

Extensión compartida compatible: `ConversationPorts.loadContext?(ExecutionContext)` devuelve contexto normalizado opcional y `ModelInput.recentContext?` lo entrega al modelo. Sin hook no hay lectura ni contexto. El hook se ejecuta después de reclamar y autorizar la invocación, bajo el plazo y presupuesto común. Sus lecturas usan `external` y `signal`. El adaptador AI SDK conserva IDs, autores y procedencia y etiqueta el historial como datos sin autoridad; `request` contiene la única petición actual.

Lecturas por REST Discord con fetch nativo, sin reintentos automáticos, máximo dos páginas de 100, cuerpo por página limitado a 1 MB, contenido por mensaje a 2000 caracteres y resultado JSON a 14000. Se conserva identidad e ID de mensajes, se excluye el actual y se deduplican IDs. Se informa cobertura parcial al recortar o fallar una página posterior. El canal/hilo procede exclusivamente de la invocación; nunca se consulta el padre. Se comprueban permisos efectivos ViewChannel/ReadMessageHistory de solicitante y bot, envío del bot y membresía privada, antes de lecturas, reutilización y entrega. El piloto requiere ahora permiso de historial; sin él falla cerrado.

La caché es local al proceso, no Redis: máximo 16 resultados de hasta 14000 caracteres, retención fija de diez segundos con eliminación automática y comprobación al leer, sin renovar por aciertos o actividad. Por tanto cada mensaje cacheado queda muy por debajo de 24 horas y no se mantiene archivo ambiental. Se clonan los valores para no compartir estado mutable entre invocaciones. Redis solo conserva reclamaciones de eventos, nunca cuerpos del historial. La caducidad del caché se prueba con reloj controlado; Redis real corresponde a deduplicación concurrente y caducidad de reclamaciones, no a almacenamiento de mensajes.

Frontera confirmada: invocación normalizada por `createConversation.handle` hasta respuesta/efectos, componiendo `composePilot`, catálogo, ejecutor y adaptadores reales con Discord/modelo controlados. Rojos observados: contexto ausente (`recentContext.messages` indefinido); herramienta sin registrar/autorización (`denied` en lugar de parcial); caché ausente (dos lecturas en lugar de una). Cada caso pasó tras su implementación mínima. Caracterizaciones adicionales cubren SDK, cursores y límites, entradas excesivas o destino falsificado, caducidad, capacidad de caché, fallo de página, permisos revocados para ambos actores, dos canales/hilos concurrentes, duplicados y reclamaciones con Redis real. El receptor existente también prueba que mensajes ambientales del piloto no activan respuesta.

Preparación y persistencia aislada, sin credenciales:

```powershell
npm ci --ignore-scripts
npm run db:generate
docker run --detach --name gnomo-t04-redis --publish 127.0.0.1:16384:6379 redis:7-alpine
$env:T02_REDIS_URL='redis://127.0.0.1:16384'
npm run verify
docker rm --force gnomo-t04-redis
```

No SQL, migraciones, datos de producción, modelo/Discord real ni despliegue. No se afirma medir latencia de red ni resistencia semántica de un modelo real frente a instrucciones históricas. Verificación final tras merge de integración: pendiente de registrar.
