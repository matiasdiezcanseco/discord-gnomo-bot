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

## T03 — implementación y contratos de extensión

Implementado en la ruta nueva: `pilotCatalog` registra `collection_phrase` y `collection_photo`; `composePilot` autoriza explícitamente `collection.phrase` y `collection.photo`, solo lectura, con los mismos permisos efectivos de Discord. No se importa el registro ni el proveedor de herramientas legado. `BUCKET_URL` sigue siendo la configuración confiable de la colección existente: `phrases.json` contiene textos y `images.json` rutas a fotos. El adaptador nuevo lee esos archivos con `fetch`, AbortSignal, sin reintentos ni redirecciones, máximo 512 KiB y validación del array. Las URLs de fotos deben permanecer dentro del origen/ruta del bucket; no se descargan las fotos en el proceso del bot. Sin configuración la capacidad está indisponible; no se inventa contenido. No requiere PostgreSQL ni cambios/migraciones de datos.

Extensión pública compatible de `Capability`: `direct?: { matches(invocation): boolean; input: unknown; render(result: ToolResult): string }`. Las capacidades sin `direct` mantienen el recorrido anterior. `matches` es reconocimiento local puro, anclado a toda la petición, no autorización; `input` se valida por el ejecutor normal y `render` recibe únicamente su resultado validado/estado. Solo una coincidencia habilita esta ruta; cero o varias mantienen el bucle normal. La ruta usa la reclamación, admisión, autorización inicial y por herramienta, presupuesto compartido, cancelación, trazas y entrega/revalidación existentes. El bucle no conoce nombres de herramientas. Agentes posteriores deben registrar y autorizar capacidades en los puntos de composición, sin añadir enrutamiento por nombre al bucle.

Para frases/fotos directas no hay generación, clasificación LLM ni memoria semántica: dos unidades del presupuesto (intento del ejecutor + lectura del bucket), una sola petición HTTP. Se conservan literalmente el texto de frase o la URL de foto. Se admiten formas breves como `dame una frase`, `frase`, `mándame una foto aleatoria`, `envíame una imagen`, opcionalmente `del gnomo` y `por favor`, acentos/mayúsculas y puntuación final. Peticiones negadas, citadas, combinadas, con calificadores no reconocidos o adjuntos siguen por el modelo normal, que dispone de ambas herramientas con entrada estricta vacía y descripción de recursos existentes. No se altera la personalidad del adaptador de modelo ni se presentan fotos como imágenes generadas. La interpretación/redacción de variantes naturales por un modelo real requiere evaluación humana; la suite usa un modelo controlado.

## T03 — pruebas y evidencia reproducible

Frontera confirmada: invocación normalizada → `createConversation.handle` → respuesta y efectos observables. Nueve escenarios nuevos cubren frases/fotos, variante natural, composición real del piloto, duplicados concurrentes con dos clientes Redis, datos vacíos/inválidos y dependencias caídas, cancelación a 12 segundos, denegación/revocación, menciones bloqueadas, entrada ambigua y argumentos que intentan cambiar identidad/destino. Los dobles se limitan a modelo/Discord/transporte HTTP/reloj; el caso de composición usa servidor HTTP loopback y Redis reales aislados. No se usa persistencia simulada como prueba de exclusión concurrente.

Ciclos rojo → verde observados:

1. Invocación directa de frase: falta el módulo nuevo → recurso literal entregado sin modelo mediante catálogo/ejecutor. La primera ejecución previa a instalar dependencias falló por dependencias ausentes; el rojo funcional se repitió después y falló por módulo de colección ausente.
2. Invocación directa de foto: respuesta de conversación normal en lugar de la URL esperada → foto de `images.json`, sin generación.
3. Composición piloto con Redis real y HTTP local: denegación de la nueva capacidad → recurso entregado y duplicado concurrente excluido al registrar la fuente y autorizar explícitamente la lectura.

Los demás escenarios caracterizan las garantías compartidas ya presentes y la extensión recién implementada; no se atribuyen rojos artificiales a comportamientos que ya pasaban.

Comandos ejecutados sin credenciales ni datos reales:

```powershell
npm ci --ignore-scripts
npm run db:generate
docker run --detach --name gnomo-t03-redis --publish 127.0.0.1:16383:6379 redis:7-alpine
$env:T02_REDIS_URL='redis://127.0.0.1:16383'
npx tsx --tsconfig tsconfig.nest.json --test test/collection-content.test.ts
npm run verify
git diff --check
docker rm --force gnomo-t03-redis
```

`T02_REDIS_URL` debe señalar exclusivamente al Redis aislado. Las reclamaciones usan IDs únicos, sin FLUSHDB. `db:generate` solo genera cliente, no migra ni conecta con PostgreSQL. No se añadió persistencia SQL. La suite heredada también verifica expiración y recreación del consumidor Redis; no se afirma reinicio del servidor ni durabilidad en disco.

Medición reproducible incluida en el caso de composición: desde antes de `handle` hasta completar la respuesta capturada, 20 invocaciones secuenciales con Redis real, HTTP loopback y Discord simulado; informa p50, p95 y cuántas exceden 3000 ms. Ejecución de `npm run verify` del 2026-11-05: 40/40 pruebas, cero omitidas, tipos/compilación/lint correctos. Medición local: p50 7.1 ms, p95 16.4 ms, 0/20 por encima de 3000 ms; duplicado concurrente inicial 119.3 ms. Son medidas del entorno de prueba, NO latencia de red de producción ni cumplimiento del objetivo visible de tres segundos. Node 24.13.1, Docker Engine 27.4.0, Redis 7. El aviso previo de package.json sin type para eslint.config.js continúa sin ser un error.

Pendiente fuera de este entorno autorizado: medir con el bucket y Discord reales desde recepción hasta respuesta visible (al menos 20 frases y 20 fotos; p50/p95, fracción fuera de tres segundos y fracción de respuestas útiles), y evaluar personalidad/variantes naturales con el modelo real. Sin credenciales/datos de producción no se ha activado el piloto ni validado ese objetivo real. No se han ejecutado migraciones, despliegues ni operaciones en el PR raíz. Integración local `integration/gnomo-harness` en `623d60b` incorporada con `git merge integration/gnomo-harness --no-edit` (ya estaba al día) antes de las comprobaciones finales.
