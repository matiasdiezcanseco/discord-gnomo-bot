# T02 — Conversación y contratos de extensión

## Composición y piloto

El único receptor sigue siendo `MessageHandlerService`. Después de normalizar, selecciona la nueva conversación exclusivamente para IDs de canal/hilo en `CONVERSATION_PILOT_CHANNEL_IDS` (lista separada por comas, vacía por defecto). Los demás eventos conservan la ruta anterior. No existe fallback del piloto hacia herramientas antiguas ni un segundo listener. Quitar un ID revierte la selección sin migrar datos. El piloto requiere Redis; sin él falla cerrado y registra el fallo, sin efectos ni respuesta potencialmente duplicada.

`DiscordModule` compone `composePilot`: modelo AI SDK, catálogo nuevo, Redis y autorización Discord. Solo registra `pilot_status`, una lectura de diagnóstico sin acceso a datos externos ni escrituras. No importa el registro de herramientas legado. Los permisos se consultan con IDs autenticados de servidor, canal y miembro; se comprueban ViewChannel del solicitante y ViewChannel/SendMessages (SendMessagesInThreads en hilos) del bot, membresía explícita en hilos privados y estado del hilo. Se revalidan antes de ejecutar herramientas y antes de cada envío. No se habilitan otras capacidades ni facultades administrativas.

## Contratos públicos

- `createConversation(ports).handle(invocation, reply?)` es la frontera de aplicación: datos normalizados entran, respuestas y efectos salen. El transporte opcional por llamada mantiene la asociación con el mensaje original sin estado global de mensajes. `claim`, `authorize`, `model`, reloj y transporte son fronteras externas, no implementaciones de capacidades.
- Una capacidad se exporta desde su módulo con `defineCapability`: nombre, descripción, identificador de capacidad, alcance `channel`, efecto `read`/`write`, esquemas Zod de entrada/salida, disponibilidad y límites. Agregar su definición a `pilotCatalog()` es el punto único de registro; ampliar la política de `composePilot` es una decisión explícita separada. No editar el agente. Nombres duplicados, esquemas no representables y límites inválidos se rechazan al componer.
- Usar objetos Zod estrictos: ningún argumento concede identidad, destino o autorización. El contexto autenticado es una copia congelada y contiene `signal`, clave idempotente de evento/llamada y `external(work)`. Toda subllamada o reintento de una capacidad debe usar ese presupuesto y pasar `signal` al cliente externo; no lanzar trabajo desvinculado ni reintentar escrituras de resultado desconocido. La disponibilidad es diagnóstica y no reemplaza la autorización.
- `execute` devuelve el payload declarado; `null` validado representa ausencia. `partialResult(payload)` conserva cobertura parcial y sigue validando esquema/tamaño. Incluir procedencia, fecha y cobertura en el esquema cuando corresponda. El ejecutor distingue éxito, vacío, parcial, denegado, indisponible, entrada inválida, límite, timeout, fallo transitorio y escritura incierta. Un fallo de escritura bloquea nuevas escrituras de esa invocación. Las capacidades futuras deben hacer idempotentes sus escrituras usando la clave suministrada y confirmar solo tras persistir.
- `model.generate` realiza un paso y devuelve texto/intentos, nunca ejecuta herramientas. AI SDK mantiene la personalidad existente, pide brevedad y trata resultados como datos sin autoridad. Desactiva reintentos automáticos y limita salida a 1500 tokens (configurable al crear el adaptador). Los adjuntos se entregan como metadatos normalizados; este ticket no añade lectores de URLs o adjuntos externos.
- `allowedUserMentions` es una frontera confiable opcional: solo devuelve IDs resueltos y explícitamente solicitados en la invocación actual. El piloto no habilita menciones individuales por defecto. `allowedMentions` bloquea everyone/here/roles y la notificación implícita al autor, también cuando el modelo escribe su sintaxis.

## Presupuesto y garantías

El reloj comienza al entrar a `handle`, antes de Redis y de la cola. Máximos conservadores: cinco generaciones/pasos y ocho llamadas compartidas entre generaciones, intentos de herramientas (incluso denegados) y subllamadas/reintentos declarados. Autorización y Redis también consumen el plazo temporal. Concurrencia local configurable con `CONVERSATION_CONCURRENCY` (1–16, defecto 4), cola máxima 100. No se mantiene contexto de conversación mutable: invocaciones concurrentes no comparten autores ni resultados.

A los doce segundos se aborta trabajo externo. Las promesas compiten con cancelación incluso si un proveedor no responde; el ejecutor comprueba el plazo antes de cualquier efecto nuevo. Los adaptadores deben cooperar con AbortSignal: JavaScript no puede deshacer un efecto remoto o detener un proveedor que lo ignore. La entrega dispone solo del margen hasta quince segundos e incluye revalidación de permisos. No hay reintentos ocultos. Un envío vencido se traza como incierto; no se promete entrega exactamente una vez ni latencia absoluta de Discord. Los resultados confirmados se conservan en la respuesta de agotamiento, con fuentes completas y aviso de escrituras inciertas.

Redis usa SET NX EX por servidor/canal/evento con retención de 24 horas, sin liberar reclamaciones tras fallo, timeout o envío incierto. Esto evita duplicaciones dentro de la retención, incluso entre procesos; una caída entre reclamar y enviar puede perder esa respuesta. No promete recuperación automática, deduplicación eterna ni durabilidad del servidor Redis si este pierde sus datos. La concurrencia se limita por proceso; ejecutar varias réplicas requiere un límite global futuro. No hay operaciones SQL nuevas en T02.

La entrega separa texto en mensajes de hasta 2000 unidades UTF-16 conservando URLs y enlaces Markdown completos. Si un enlace individual excede el límite de Discord, se envía un aviso explícito. Las trazas contienen ID de invocación, fase, autorización/estado, nombre registrado de herramienta, duración y contadores; no argumentos, resultados, prompts, cuerpos ni errores crudos.

## Pruebas reproducibles y evidencia

Preparación sin credenciales: `npm ci --ignore-scripts`, `npm run db:generate`. Redis aislado:

```powershell
docker run --detach --name gnomo-t02-redis --publish 127.0.0.1:16382:6379 redis:7-alpine
$env:T02_REDIS_URL='redis://127.0.0.1:16382'
npm run verify
docker rm --force gnomo-t02-redis
```

No apuntar T02_REDIS_URL a producción. Las pruebas usan prefijos aleatorios/IDs únicos, no FLUSHDB. Sin esa variable, los dos casos Redis se omiten explícitamente. La suite normal no requiere Docker ni credenciales. PostgreSQL no interviene en la ruta nueva y no se afirma haber probado persistencia SQL.

Ciclos rojo → verde observados: núcleo ausente → respuesta asociada; catálogo ausente → capacidad controlada; 50 efectos frente al tope → ocho llamadas compartidas; modelo colgado → cancelación a doce segundos; respuesta extensa única → división segura; módulo Redis ausente → exclusión real; segunda invocación ejecutada en cola vencida → cancelación de cola; escritura pendiente sin estado → aviso incierto y fuentes confirmadas; contenido enviado tras revocar permisos → revalidación; cuatro reintentos de escritura incierta → una ejecución; cobertura parcial tratada como fallo → resultado parcial; hilo privado sin membresía aceptado → denegación.

También se caracteriza el recorrido completo AI SDK → catálogo → ejecutor → respuesta, la selección exclusiva del piloto y permisos efectivos con Discord simulado. Redis real verifica dos clientes simultáneos, reconexión/recreación del consumidor y expiración. No se simula eso como evidencia de persistencia: tampoco se afirma haber reiniciado el servidor Redis ni validado su configuración de almacenamiento en disco.

No se usaron servicios reales de modelo/Discord ni se activó el piloto. Personalidad y brevedad necesitan evaluación humana; p50/p95 y objetivos de 3/15 segundos siguen sin medición real. La evidencia del reloj controlado demuestra los límites del programa, no latencia de red. No se ejecutaron migraciones, cambios de producción o despliegues.

Verificación final del implementador (2026-11-05): integración local `3b0d376` incorporada mediante merge `4ee7cb3`; `T02_REDIS_URL=redis://127.0.0.1:16382 npm run verify` pasó con 31/31 pruebas, cero omitidas, tipos, compilación y lint correctos. `git diff --check` pasó. Redis 7 aislado, Docker Engine 27.4.0, Node 24.13.1. El lint conserva el aviso previo de package.json sin type para eslint.config.js; no es un error. No se ha revisado ni actualizado el PR raíz desde esta rama.
