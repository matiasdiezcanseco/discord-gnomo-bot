# T01 — Invocación comprobable

## Ejecutar sin credenciales

Requiere Node 24 (validado con 24.13.1) y npm. Desde la raíz de un checkout limpio:

```sh
npm ci --ignore-scripts
npm run db:generate
npm run verify
```

`--ignore-scripts` evita compilar los módulos nativos de voz, que no usa esta suite. La generación explícita de Prisma solo crea el cliente local: no conecta ni migra una base. No copiar `.env`, arrancar Nest ni ejecutar `db:push`/`db:migrate` para estas pruebas.

Comandos independientes:

```sh
npm test
npm run ts:check
npm run build
npm run lint:check
```

`test` usa el runner de Node con tsx y el tsconfig de Nest (decoradores de parámetros). `ts:check` incluye también los tests; la compilación de Nest incluye solo `src`. `lint:check` no modifica archivos.

## Frontera y transición

`normalizeInvocation` adapta los campos autenticados del evento Discord a datos sin objetos vivos: identidad del mensaje, servidor, canal/hilo, solicitante, contenido, fecha y todos los adjuntos, incluidos los que no son imágenes. Solo una mención explícita de un miembro en `GUILD_ID` activa la ruta. Una respuesta de Discord que incluye al bot en sus metadatos pero no lo menciona en el contenido no activa Gnomo.

`respondToInvocation` conserva la invocación junto a su entrega. El receptor actual la usa para entrar a la orquestación existente y responder al mensaje original. Solo `MessageHandlerService.onModuleInit` registra `messageCreate`; no se incorpora un receptor paralelo ni se activa otra implementación. El puente temporal aún adapta a `BotContext` y a sus herramientas Discord; T01 no afirma haber desacoplado todo el núcleo antiguo.

La suite entra por invocación normalizada o por evento de mensaje y observa respuestas/efectos. El montaje del legado queda concentrado en `test/conversation.test.ts`. Se ejecutan los constructores y herramientas reales con un modelo programable de AI SDK, datos Discord simulados y transporte HTTP controlado para la colección y Tavily. No se comprueban métodos privados, orden de llamadas internas ni igualdad del prompt. La personalidad generada requiere evaluación humana; la respuesta literal del modelo falso solo verifica el transporte de la respuesta.

## Caracterización y cambios intencionados

| Escenario cubierto | Comportamiento conservado | Cambio aprobado para tickets posteriores |
| --- | --- | --- |
| Conversación | Respuesta del modelo al mensaje invocador, imagen adjunta disponible para el modelo | Historial ambiental accesible, presupuestos y entrega extensa |
| Frase/foto | Contenido de las colecciones; la foto es una URL existente | Ruta rápida sin modelo y ejecutor común |
| Miembros | Resolución por apodo con datos de Discord | Ambigüedad, permisos, cobertura, presencias y voz independientes |
| Web | Información de búsqueda con enlace fuente | Lectura de URL, noticias, controles de red y presupuesto |
| Memoria | Guardado/consulta sin servicio disponible devuelven indisponibilidad | Memoria solo explícita, autoría, canal, migración y persistencia real |
| Recordatorios | Sin Redis no se confirma una escritura; un pendiente se envía al solicitante/canal guardados y deja la lista de pendientes | Reclamación concurrente, reintentos, permisos, zona America/Lima y estado incierto |
| Cumpleaños | La fecha coincidente publica en `GNOMOS_CHANNEL_ID`, sin publicar la de otro día | Zona horaria y política de entrega comunes |
| Activación | Bots, mensajes sin mención y otros servidores no generan respuestas ni llaman al modelo | El historial ambiental se añadirá por separado |

El legado aún permite autoguardado y recuperación automática de memoria, ámbito por servidor, tres pasos, truncado de respuestas y cron de cumpleaños sin zona explícita. Se documentan como diferencias intencionadas, no como requisitos que futuras pruebas deban congelar. No se ha migrado, retirado ni reescrito esa funcionalidad en T01.

## Evidencia y límites

Los ciclos nuevos se ejecutaron rojo → verde: contrato normalizado ausente → respuesta con procedencia; normalizador ausente → filtros y adaptación; conversación sin modelo inyectable → respuesta visible controlada; mensaje ambiental que provocaba respuesta con metadatos de mención → silencio mediante mención explícita. Después se añadieron caracterizaciones de capacidades que ya existían.

El Redis de caracterización de avisos simula el protocolo externo y solo comprueba el recorrido de un pendiente. No demuestra persistencia tras reinicios, consultas SQL, migraciones ni exclusión concurrente. Los tickets que cambien esas operaciones deben usar PostgreSQL/vector y Redis reales y aislados, como exige la especificación. La memoria se caracteriza aquí en indisponibilidad; no se certifican sus escrituras ni recuperación reales.

Los dobles rápidos no demuestran los objetivos de latencia de 3/15 segundos. No hubo conexiones reales a Discord, OpenAI, Tavily, Redis ni PostgreSQL; tampoco piloto, despliegue o modificaciones de datos de producción.
