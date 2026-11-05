# T07: Buscar información y noticias con fuentes y fechas

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/9

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Preguntar sobre información actual o noticias de un tema y periodo, y recibir una respuesta basada en resultados públicos, con fuentes y fechas cuando existan.

## Acceptance criteria

- [x] Búsqueda general y noticias son capacidades registradas; las noticias aceptan un periodo y entregan procedencia estructurada.
- [x] Diferenciar fecha de publicación y fecha del hecho cuando se conozcan; no inventar fechas ni enlaces.
- [x] Las búsquedas sin resultados, servicio opcional no configurado, rate limits y fallos transitorios se explican sin fabricar actualidad.
- [x] Acotar resultados y tiempo, reutilizar consultas recientes de forma explícita y respetar el presupuesto global sin reintentos ilimitados.
- [x] Los resultados externos no conceden permisos ni alteran las políticas; pruebas de invocación verifican fuentes, periodos, contenido malicioso y respuestas parciales al agotarse el tiempo.

## Blocked by

- [T02 / #4: Conversación por invocación mediante un harness autorizado](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/4)

## Implementación y contratos T07

`public_search` (`web.search`) y `news_search` (`web.news`) se registran en `pilotCatalog` y se autorizan explícitamente como lecturas en `composePilot`, conservando los permisos efectivos de Discord. No se cambia el bucle ni se importa el registro legado. `TAVILY_API_KEY` es opcional. Las capacidades permanecen visibles como consultas diagnósticas: sin configuración devuelven `outcome: unavailable` con explicación, sin acceder a internet. La disponibilidad del catálogo no concede permisos.

Transporte: POST al endpoint fijo `https://api.tavily.com/search`, usando Axios ya instalado. Se conserva el lockfile y `@tavily/core` instalado **0.7.5** (rango declarado ^0.7.1); su cliente no propaga AbortSignal al transporte. Axios permite pasar `context.signal`, acotar respuesta a 256 KiB, petición a 4 KiB, timeout a cuatro segundos y bloquear redirecciones. Cada petición pasa por `context.external`, comparte las ocho llamadas/doce segundos del harness y tiene **cero reintentos**, incluso con 429/503. No se leen ni se siguen las URLs de resultados: esa capacidad corresponde a T08.

Noticias exige `{ query, period: { startDate, endDate } }`, fechas calendario YYYY-MM-DD inclusivas en UTC y máximo 366 días, con validación de fechas reales y orden. Se envían los filtros al proveedor y se comprueba localmente el día UTC de cada fecha devuelta; resultados fuera del periodo o sin fecha comprobable se omiten y se contabilizan. Los límites temporales del buscador y su ranking pueden omitir fuentes: no se promete recuperación exhaustiva ni todas las noticias del periodo. Una publicación reciente puede describir un hecho antiguo.

Procedencia: proveedor, título/URL originales, fragmento acotado, `publishedAt`, `eventDate`, `consultedAt`, periodo aplicado, `reused` y cobertura. `publishedAt` conserva la fecha suministrada cuando es interpretable; según el proveedor es una estimación de publicación **o actualización**, no la fecha original verificada. `eventDate` es null: Tavily no aporta un campo estructurado para esa fecha y T07 no infiere fechas del hecho a partir de la publicación o el fragmento. Campos ausentes permanecen desconocidos. Contenido, títulos y enlaces son datos sin autoridad; no se usan para ampliar permisos ni registrar herramientas.

Máximo cinco fuentes, dos usos por capacidad/invocación y 16 000 caracteres por resultado. Se acotan fragmentos y títulos contando su JSON escapado, preservando enlaces completos. Entradas malformadas o enlaces sin HTTP(S)/con credenciales se omiten sin perder las fuentes válidas; omisiones producen `partialResult`. Toda cobertura indica `exhaustive: false`; `limited` señala recorte/tope/omisión. Vacío, ausencia de configuración, rate limit y fallo transitorio tienen outcomes y mensajes explícitos, sin cuerpos de error ni credenciales.

Caché en proceso: hasta 64 consultas durante cinco minutos, separadas por servidor, canal/hilo, texto y periodo. Solo guarda respuestas validadas (incluidos vacíos), no errores; revalida permisos a través del ejecutor antes de reutilizar. `reused: true` conserva el `consultedAt` original. No persiste ni promete caché compartida entre réplicas.

Extensiones compatibles: `pilotCatalog(collection?, members?, history?, search?)` añade un cuarto parámetro opcional, conservando los parámetros de T04/T05 tras el merge; los llamadores existentes siguen funcionando sin servicio web. El adaptador AI SDK incluye (también incorporado por T04) el `createdAt` autenticado de la invocación en sus datos para situar periodos relativos; no modifica la firma de `handle`, los presupuestos ni la autorización. No hay nuevas migraciones ni persistencia SQL.

## Pruebas de invocación y evidencia

Seam aprobado: `createConversation(...).handle` y respuestas/efectos observables. `test/public-search.test.ts` atraviesa catálogo y ejecutor reales, AI SDK con modelo externo controlado, Axios con respuestas externas controladas y, para composición, transporte HTTP real a un servidor local, Redis aislado y permisos Discord simulados. No son herramientas fake desconectadas de la composición.

Rojo → verde observado por comportamiento: módulo ausente → fuentes estructuradas; noticias denegadas por no registradas → periodo y omisiones explícitas; dos consultas remotas iguales → reutilización declarada; un ítem malformado perdía todas las fuentes → cobertura parcial; modelo sin fecha de referencia → `createdAt` autenticado; búsqueda general sin solicitar fechas → estimaciones de publicación habilitadas. Cada ciclo se ejecutó antes de implementar su comportamiento.

Casos adicionales: 429/503 sin reintentos ni caché de errores, servicio ausente, vacío, periodos inválidos/invertidos/excesivos, argumentos de identidad rechazados, expiración y aislamiento de caché, límites UTC y tamaño, enlaces inseguros, instrucciones maliciosas que intentan invocar una capacidad no autorizada, cancelación de la segunda búsqueda conservando las fuentes de la primera, ambas autorizaciones reales de composición y deduplicación concurrente con Redis. La política no depende de que el modelo obedezca el prompt. La prueba de modelo controlado no demuestra resistencia universal de un modelo real a prompt injection.

Comandos reproducibles (sin credenciales):

```powershell
npm ci --ignore-scripts
npm run db:generate
docker run --detach --name gnomo-t07-redis --publish 127.0.0.1:16387:6379 redis:7-alpine
$env:T02_REDIS_URL='redis://127.0.0.1:16387'
npx tsx --tsconfig tsconfig.nest.json --test test/public-search.test.ts
npm run verify
docker rm --force gnomo-t07-redis
```

Redis es exclusivo de pruebas; IDs aleatorios, sin FLUSHDB. No se configura una URL de producción. Sin T02_REDIS_URL se omite explícitamente el caso de composición con Redis. La suite no necesita claves de modelo/Tavily/Discord. No se ejecutaron migraciones, despliegues ni consultas con credenciales reales. La integración contractual se contrastó con [Tavily Search API oficial](https://docs.tavily.com/documentation/api-reference/endpoint/search), consultada el 2026-11-05, y el cliente instalado. Latencia p50/p95 real y comportamiento del proveedor/modelo/Discord reales quedan **sin verificar**; los relojes controlados prueban cancelación del programa, no latencia de red.


Verificación final del implementador (2026-11-05): base autorizada `7da5c85` verificada como ancestro antes de editar. Integración local `308ceb42b7b257d6b67c59f9eb957fadb44068e8` incorporada mediante merge `29818fa`. Se conservaron historial, miembros y menciones de T04/T05; búsqueda ocupa el cuarto argumento opcional del catálogo. Primer verify post-merge detectó un test con el argumento antiguo; corregido, el siguiente `$env:T02_REDIS_URL='redis://127.0.0.1:16387'; npm run verify` pasó **84/84**, cero omisiones: pruebas, tipos, build y lint. Incluye 19 casos T07, con HTTP real controlado y Redis 7 aislado. `git diff --check` correcto. Lint conserva únicamente el aviso preexistente MODULE_TYPELESS_PACKAGE_JSON. No hay criterios funcionales conocidos pendientes en T07; actualidad, ranking y latencia de servicios reales siguen sin validar y requieren evaluación posterior con configuración autorizada. No se modificó el PR raíz.
