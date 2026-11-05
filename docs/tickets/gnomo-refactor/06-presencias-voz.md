# T06: Consultar miembros conectados y participantes en voz

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/8

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Preguntar quién está conectado en Discord o quién está en una llamada y recibir esas dos señales por separado, basadas en los miembros identificados del servidor.

## Acceptance criteria

- [ ] Configurar y comprobar recepción de presencias; online, idle y dnd cuentan como conectados y conservan su estado concreto.
- [ ] Offline se expresa como aparece desconectado; invisible no se intenta detectar. Datos faltantes o inicialización incompleta no se convierten en desconexión.
- [ ] Listar participantes en voz como una capacidad distinta, filtrando canales y datos no visibles al solicitante.
- [ ] Comunicar frescura y cobertura parcial; no inferir presencia por mensajes recientes ni por estar en voz.
- [ ] Pruebas desde invocación cubren los estados, ausencia de intents, caché parcial y canales de voz ocultos; validar con un escenario controlado del servidor sin publicar datos ajenos en logs.

## Blocked by

- [T05 / #7: Identificar miembros y mencionar sin ambigüedad](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/7)

## Implementación y contratos de extensión

`pilotCatalog(collection?, members?, history?, live?)` conserva los tres argumentos
existentes. El cuarto registra `presence_list` (`discord.presence`) y `voice_list`
(`discord.voice`) independientemente. `composePilot` compone los adaptadores Discord
reales y autoriza ambas capacidades solo como lecturas. No se modifica el bucle ni
el registro legado, no se activa el piloto ni se conceden permisos administrativos.

Ambas herramientas reutilizan `MemberDirectory` de T05 para identificar miembros
actuales por REST, sin tratar la caché de miembros como un censo. Entrada estricta:
`limit` (25 por defecto, máximo 50) y `after` opcional. Identidades y servidor/canal/
solicitante proceden exclusivamente del contexto autenticado. `fromAfter`,
`nextAfter` y `memberCoverage` mantienen la semántica de página de T05: complete
desde un cursor no significa censo entero. Los participantes de voz se filtran
sobre esa página de miembros; una página vacía puede tener continuación.

Presencias y voz leen cachés Gateway distintas. Solo se usan con cliente listo,
servidor disponible e intent correspondiente. Presencia ausente siempre es unknown,
con `connected: null`; online/idle/dnd conservan su estado y connected true; offline
devuelve connected false y la etiqueta «aparece desconectado». Invisible no se
detecta. La cobertura de presencias es partial si hay observaciones y unknown si
no; nunca complete. No se consultan actividades ni dispositivos, ni se infiere de
mensajes o voz. `queriedAt` fecha la consulta local, no garantiza fecha del último
evento. La nota de salida explica expresamente esa limitación.

Voz consulta membresía fresca de solicitante y bot y canales frescos antes de
filtrar por ViewChannel efectivo de ambos. No devuelve canales ocultos, sus IDs,
nombres, participantes ni conteos. Solo devuelve identidad y canal visible; no
mezcla presencia, audio, mute u otros datos. La cobertura Gateway siempre es partial
o unknown; no se afirma ausencia de llamada por una caché vacía. Un fallo de lectura
o de comprobación de permisos falla cerrado. Las lecturas consumen `external` y
el plazo compartido. REST de MemberDirectory recibe AbortSignal; las lecturas SDK
de permisos compiten con cancelación mediante el presupuesto pero discord.js puede
terminar una petición ya iniciada; no se encadenan nuevas lecturas tras el aborto.
No se agrega persistencia ni archivo de estados.

Frontera de pruebas confirmada: invocación normalizada → `composePilot` →
`createConversation.handle` → respuesta/allowedMentions. Modelo y Discord controlados,
catálogo/ejecutor/autorización/adaptadores reales. Rojos observados antes de cada
slice: presence_list denegada → estados visibles con cobertura parcial; voice_list
denegada → participantes visibles, sin canales ocultos. Caracterizaciones adicionales
cubren caché parcial, intent faltante, inicialización, servidor no disponible,
errores de lectura, revocación de permisos, paginación y argumentos de ámbito falsos.
Las pruebas de T06 no agregan garantías persistentes; la suite heredada se ejecuta
con Redis real aislado para deduplicación, concurrencia, reconexión y expiración.

Preparación sin credenciales: `npm ci --ignore-scripts`, `npm run db:generate`.

```powershell
docker run --detach --name gnomo-t06-redis --publish 127.0.0.1:16386:6379 redis:7-alpine
$env:T02_REDIS_URL='redis://127.0.0.1:16386'
npm run verify
docker rm --force gnomo-t06-redis
```

No SQL, migraciones ni producción. Recepción Gateway real, evaluación del modelo,
escenario controlado del servidor y latencia real quedan pendientes del propietario;
no se presentan dobles como validación real. Configuración de intents y escenario
manual en [README](../../../README.md#presence-and-voice-in-the-new-conversation-pilot-t06).
