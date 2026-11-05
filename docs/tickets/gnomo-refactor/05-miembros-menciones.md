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

## Implementación y contratos para agentes posteriores

T05 agrega `members_search`, `members_detail` y `members_list` al `pilotCatalog(members?)`; el argumento es opcional y conserva el catálogo diagnóstico anterior por defecto. `composePilot` compone el adaptador REST y autoriza explícitamente `discord.members` como lectura. No modifica el registro legado ni la selección de canales piloto.

`MemberDirectory` (`src/conversation/member-directory.ts`) expone `list(context, limit, after?)` y `detail(context, id)` con datos normalizados. T06 puede reutilizarlo sin incorporar presencias ni voz a T05. El adaptador no usa la caché: cada solicitud HTTP consume `context.external` y lleva `context.signal`, sin reintentos automáticos. El servidor procede únicamente de la invocación autenticada. Las respuestas tienen fuente y fecha; búsqueda/listado incluyen `fromAfter`, `nextAfter` y cobertura. `complete` significa que se llegó al final desde ese cursor, no que una página de continuación contenga el censo entero. Una página llena es parcial, incluso si coincide exactamente con el tamaño del servidor; continuar puede devolver una página vacía completa. Búsqueda filtra cada página por username, nombre visible o apodo, por lo que una página sin coincidencias todavía puede tener continuación. No es una instantánea transaccional del servidor: altas y bajas entre páginas pueden cambiar el conjunto.

Sin GuildMembers no se lista ni se busca: cobertura desconocida. REST fallido (incluidos 403/429) o respuesta inválida también devuelve desconocido, sin convertir caché en censo. El detalle individual usa el endpoint por ID, que no requiere el intent de listado; 404 representa ausencia confirmada y otros fallos desconocimiento.

Extensión compatible de `allowedUserMentions`: callbacks anteriores de un argumento que devuelven `string[]` siguen siendo válidos; ahora reciben además `ExecutionContext` y pueden devolver `{ users, clarification? }`. Se ejecutan después del modelo y dentro del presupuesto externo original de doce segundos/ocho llamadas, antes de cerrar ese presupuesto; ya no se hace I/O de resolución en el margen reservado al envío. Sin callback permanece `[]`. Una aclaración confiable reemplaza la salida del modelo. No se agregó enrutamiento por nombres de herramientas al bucle.

La política reconoce peticiones directas completas como `menciona a Anita`, `etiqueta a 111`, `menciona a <@111>` (también `mention`/`tag`, prefijo opcional `por favor`). Es deliberadamente conservadora: peticiones compuestas, citas, negaciones o formatos de modelo no conceden permiso. Para otras formulaciones debe repetirse una petición simple. Por nombre exige igualdad sin distinguir mayúsculas, cobertura completa desde el inicio y exactamente un ID; recorre como máximo tres páginas de cien miembros y luego revalida por ID. Homónimos o cobertura incompleta piden aclaración por ID y no notifican. Una petición por ID también comprueba pertenencia actual. No se habilitan roles, everyone/here ni notificación implícita al autor. Un listado nunca autoriza sus resultados.

## Notas de pruebas

Frontera confirmada: invocación normalizada → `composePilot` → `createConversation.handle` → respuesta/`allowedMentions` y solicitudes a Discord simulado. El modelo y HTTP de Discord son controlados; las capacidades, catálogo, ejecutor, autorización y composición son reales. La suite T05 permite Redis simulado para las ejecuciones ordinarias; al definir `T02_REDIS_URL` usa Redis real con IDs aleatorios por invocación. No utiliza FLUSHDB.

Ciclos rojo → verde observados, uno por comportamiento: listado denegado → página parcial con cursor y sin notificaciones; búsqueda denegada → coincidencias por apodo y continuación; detalle denegado → identidad fuera de caché consultada por ID; IDs permitidos vacíos → solo el ID pedido y resuelto; homónimos con respuesta afirmativa del modelo → aclaración confiable sin mención; ID ausente con texto engañoso del modelo → aviso de pertenencia no confirmada; continuación sin procedencia → `fromAfter` explícito. Casos adicionales cubren intent ausente, fallo REST, cobertura limitada a tres páginas, argumentos de otro servidor/canal/solicitante, citas/negaciones/sintaxis oculta y nombre inequívoco revalidado. Dos pruebas en la frontera del harness verifican que la resolución confiable se cancela a doce segundos y comparte las ocho llamadas con el modelo.

Preparación y ejecución aislada (sin credenciales ni datos de producción):

```powershell
npm ci --ignore-scripts
npm run db:generate
docker run --detach --name gnomo-t05-redis --publish 127.0.0.1:16385:6379 redis:7-alpine
$env:T02_REDIS_URL='redis://127.0.0.1:16385'
npm run verify
docker rm --force gnomo-t05-redis
```

No hay nuevas operaciones persistentes ni migraciones en T05. Redis real ejercita también las pruebas heredadas de deduplicación concurrente, reconexión y expiración; no se afirma persistencia SQL ni reinicio del servidor Redis. Discord/modelo reales, evaluación humana y latencia de red quedan pendientes de piloto por el propietario. No se activó el piloto, desplegó, usaron credenciales ni modificó el PR raíz.
