# T09: Responder sobre imágenes adjuntas a una invocación

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/11

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Conservar la capacidad de adjuntar una imagen al mencionar al bot y obtener una respuesta que utilice ese adjunto con controles de acceso y tamaño.

## Acceptance criteria

- [x] El adjunto de la invocación llega al adaptador multimodal y se asocia al mensaje y autor correctos sin cargar automáticamente imágenes de otros canales.
- [x] Reutilizar el lector externo limitado para obtener bytes o contenido validado antes de enviarlo al proveedor; no delegar al proveedor una URL arbitraria sin aplicar esos controles.
- [x] Comprobar tipo, tamaño, destino y cancelación; adjuntos caducados, inválidos o no admitidos producen una explicación útil.
- [x] Las pruebas de invocación verifican el contenido recibido por el modelo simulado, los rechazos y la ausencia de herramientas o escrituras autorizadas por instrucciones dentro del adjunto.

## Blocked by

- [T08 / #10: Leer páginas públicas con acceso de red limitado](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/10)

## Implementación y contrato T09

`composePilot` compone `attachedImages(web)` usando el mismo `SafeReader` de T08;
no hay segundo cliente HTTP ni descarga del proveedor. El hook opcional
`ConversationPorts.loadImages(context)` y `ModelInput.images?` mantienen compatibles
los llamadores sin adjuntos. Sin hook, una invocación con adjuntos falla con aviso;
no se entregan URLs de imagen como sustituto. La ruta directa de colección sin
adjuntos conserva su ejecución sin modelo, contexto ni carga de imágenes.

Solo se itera la copia congelada de los adjuntos de la invocación autenticada.
Ni historial, texto web, URLs del modelo ni otros canales aportan imágenes. Se
revalidan permisos antes de cada subllamada de red, antes de enviar bytes al modelo
y antes de entregar la respuesta. No se guardan imágenes ni URLs firmadas en caché
ni persistencia. La procedencia multimodal conserva ID de adjunto, mensaje,
solicitante y canal, dimensiones y fecha de consulta; el mensaje conserva además
nombre del solicitante y fecha de invocación. El orden de las partes de imagen
coincide con el de su procedencia.

Límites: dos imágenes; 2 500 000 bytes por imagen y 5 000 000 en total; PNG, JPEG o
WebP estáticos con MIME declarado. El tamaño real debe coincidir con el metadato.
Se exige descarga completa, firma reconocida y coincidencia entre firma, MIME
Discord, MIME HTTP y formato decodificado. Sharp realiza decodificación completa
con `failOn: warning`, cuatro megapíxeles, 4096 por lado y timeout de operación de
un segundo. PNG exige chunks completos e IEND terminal y rechaza APNG. Se rechazan
animaciones reconocidas por el decodificador. Metadatos de cabecera por sí solos no
constituyen validación. T08 ahora clasifica HTTP 206/Content-Range como parcial.

Descargas comparten las ocho llamadas/doce segundos existentes, sin reintentos;
DNS y cada petición/redirect pasan por `context.external`. Las restricciones
DNS/IP/TLS/redirecciones de T08 permanecen. La señal cancela red y destruye el
pipeline local; los píxeles y el tiempo del decodificador están acotados y se
comprueba cancelación antes de entregar bytes. Un fallo impide enviar cualquier
subconjunto al modelo: caducidad/inaccesibilidad, MIME/formato, tamaño, parcialidad,
contenido dañado y cancelación producen aviso. El SDK recibe partes `image` con
`Uint8Array` y MIME explícito, nunca una URL de descarga; el modelo programable
observa partes de proveedor `file` con los mismos bytes.

Política conservadora: una invocación con adjuntos permite interpretación visual,
sin herramientas del modelo, incluso si intenta llamar una herramienta registrada.
Para ejecutar una acción o combinar herramientas se necesita otra invocación de
texto sin adjuntos. Esto evita que instrucciones dibujadas concedan lecturas
arbitrarias o escrituras; no se confía solo en el prompt. Las capacidades migradas,
incluidos recuerdos T10 y recordatorios T12 incorporados desde integración,
permanecen disponibles en invocaciones sin adjuntos. Las menciones siguen
requiriendo petición textual explícita y resolución confiable.

## TDD y evidencia

Frontera confirmada por el encargo: invocación normalizada →
`createConversation.handle`/piloto → respuesta y efectos. `test/attached-images.test.ts`
usa el adaptador AI SDK real con `MockLanguageModelV3`, composición piloto real y
lector real con HTTP, DNS UDP y TLS controlados. Los dobles se limitan a fronteras
externas; no se afirma persistencia a partir de las reclamaciones simuladas de los
casos visuales. Las garantías heredadas se comprueban con Redis/PostgreSQL reales
propios y aislados.

Rojos funcionales observados antes de corregir: ausencia de parte de imagen en el
proveedor; HTTP 206 aceptado como completo; PNG con píxeles completos pero sin IEND
aceptado por el decodificador. Cada ciclo terminó verde. El primer intento de
prueba tenía un error de sintaxis y hubo una instalación pendiente; no se cuentan
como rojos funcionales. Una fixture PNG inicial estaba dañada y fue sustituida por
una válida al comprobar la decodificación real. Las demás pruebas caracterizan
rechazos/garantías, sin atribuirles rojos que no se observaron.

Cobertura: bytes PNG/JPEG/WebP, procedencia de dos imágenes, exclusión del historial,
MIME contradictorio/ausente, firma falsa, tamaño declarado/real, límite de descarga,
contenedor incompleto, corrupción de píxeles, dimensiones y megapíxeles, caducidad,
permisos iniciales/revocados, TLS con hostname correcto/incorrecto, DNS real,
cancelación HTTP/DNS a doce segundos y presupuesto compartido. La fixture visual
con instrucciones dibujadas y modelo adversarial intenta lectura y escritura;
el ejecutor las deniega. No demuestra resistencia semántica universal de un modelo
real.

Fuentes primarias consultadas: [AI SDK, partes multimodales](https://ai-sdk.dev/docs/foundations/prompts)
y [Sharp, constructor y límites](https://sharp.pixelplumbing.com/api-constructor/),
contrastadas con los tipos/código de AI SDK 6 instalado. Se añadió Sharp 0.35.5
con lockfile para decodificación, manteniendo la versión mayor del SDK.

Reproducción en recursos propios desechables (credenciales exclusivamente de test):

```powershell
npm ci --ignore-scripts
npm run db:generate
docker run --detach --name gnomo-t09-redis --publish 127.0.0.1:16409:6379 redis:7-alpine
docker run --detach --name gnomo-t09-restart --publish 127.0.0.1:16429:6379 redis:7-alpine redis-server --appendonly yes --appendfsync always
docker run --detach --name gnomo-t09-postgres --env POSTGRES_PASSWORD=gnomo-test-only --env POSTGRES_DB=gnomo_test --publish 127.0.0.1:16419:5432 pgvector/pgvector:pg17
$env:T02_REDIS_URL='redis://127.0.0.1:16409'
$env:T12_REDIS_RESTART_URL='redis://127.0.0.1:16429'
$env:T12_REDIS_CONTAINER='gnomo-t09-restart'
$env:T10_DATABASE_URL='postgresql://postgres:gnomo-test-only@127.0.0.1:16419/gnomo_test'
npm run verify
```

No se configura `T10_RESTART_CONTAINER`: su prueba heredada exige otro nombre fijo;
no se reinicia PostgreSQL ajeno. Sí se ejercita recuperación con nuevos clientes y
pilotos, y reinicio AOF real del Redis propio de T12. No hay migración de datos de
producción ni nueva persistencia T09. Sin claves no se han probado modelo/Discord
reales, resistencia semántica, latencia de internet o piloto visible. Sin subagentes,
push, despliegue, cambios de PR o cierre de issue.

## Cierre del implementador

Base `df0e5f45c6c8ab9ae41b9f179ff417037839c4ce` verificada como ancestro antes de
editar. Se incorporaron T10 y T12 conservando sus familias del catálogo y la
composición real; último tip local incorporado
`6678cb5105adc05d63abaadc7c484eaadc786be9`, merge `a0baab2`. Rama
`feat/attached-image-inputs`, worktree `t3-1243cee0`.

Suite completa: **166/166 pruebas, cero omitidas**, incluidas 28 visuales T09;
`ts:check`, build y lint aprobados. Redis 7 real en 16409, PostgreSQL/pgvector 17
en 16419 y reinicio AOF real de Redis en 16429. El reinicio emite transitoriamente
ECONNREFUSED del cliente de prueba y luego recupera; no es un fallo de la suite.
ESLint conserva el aviso previo MODULE_TYPELESS_PACKAGE_JSON. Los logs locales se
conservan en `plans/t09-verify-integration-164.log`, `plans/t09-verify.log` y
`plans/t09-verify-final.log`; `plans` está ignorado por el repositorio. Se conservan
los contenedores propios `gnomo-t09-redis`, `gnomo-t09-postgres` y
`gnomo-t09-restart`, sin detener recursos ajenos. No se comprobaron checks ni
revisiones remotas del PR.
