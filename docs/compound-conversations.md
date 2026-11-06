# T14: conversación integrada y medición

Implementación en `feat/conversation-flows`, worktree `t3-58cc2b81`. Antes de editar,
`git merge-base --is-ancestor 3c646aa4250faeb7d839be2385886d56861455a1 HEAD`
terminó con 0. No se crearon checkouts, delegados ni recursos de producción.

## Contratos actuales (sustituyen las restricciones técnicas previas)

- Cinco generaciones y ocho intentos de herramientas/subllamadas son contadores
  independientes. Contexto, adjuntos, resolución de menciones y reintentos explícitos
  comparten el contador externo y el plazo original. Una síntesis sin herramientas
  sigue siendo posible con ocho llamadas consumidas.
- Hasta cuatro lecturas contiguas de un mismo turno pueden ejecutarse juntas.
  Se esperan antes de las escrituras; estas son barreras y se ejecutan en serie.
  Las dependencias entre herramientas se solicitan en turnos posteriores.
  Se conserva cada resultado al terminar para no perder evidencia si otro vence.
- `ConversationPorts.discover?` es política confiable de despliegue para el catálogo,
  tras autorizar la invocación. `composePilot` no hace REST por herramienta durante
  descubrimiento. Esto no cachea autorizaciones de ejecución o entrega: siguen frescas.
- `recuerda que Juan juega Valorant` guarda desde el texto actual, sin que el modelo
  pueda cambiar contenido/autor/canal. Las formas técnicas siguen disponibles.
  `memory_search` acepta `{query?: string}` para lecturas pertinentes elegidas por
  el modelo, por ejemplo `quién juega Valorant`. Nunca hay enriquecimiento semántico
  automático en saludos. Correcciones/borrados conservan sus reglas de autor/owner,
  IDs y aclaración. T11, ledger, triggers e infraestructura de migración se conservan.
- `dile a David que se una` autoriza solo al individuo inequívoco, tras resolver el
  nombre con cobertura completa y revalidar membresía por ID. Homónimos o cobertura
  incompleta aclaran. Las palabras de páginas, imágenes, historial o modelo no autorizan
  notificaciones. La lista de envío sigue bloqueando roles, everyone/here y repliedUser.
- Recordatorios aceptan mañana/fecha explícita con `9am`, `12:30pm`, `12am`, etc.,
  además de HH:mm y tiempos relativos. Se conserva America/Lima, validación de fecha,
  persistencia antes de confirmar e incertidumbre. `mañana a las 9` sigue ambiguo.
- `ExecutionContext.discoveredUrls?` es una instantánea de URLs estructuradas de
  búsquedas autorizadas y terminadas en esta invocación. Solo el ejecutor la llena
  después de validar salida. `web_read` acepta esas fuentes o URLs del texto actual;
  no extrae autoridad de fragmentos, páginas o historial. No hay concesión transitiva
  a enlaces dentro de la página. DNS/IP/TLS/redirecciones/bytes permanecen validados.
- Los adjuntos validados pueden acompañar herramientas. Una imagen no da consentimiento
  de escritura ni añade destinos autorizados. Se conservan bytes verificados, permisos
  antes de enviar imágenes al proveedor, límites y cancelación.
- `gnomoPersona` comparte identidad/humor. El adaptador nuevo ya no importa las políticas
  del orquestador viejo (autosave, nombres antiguos, una herramienta, 700 caracteres).
  T15 retirará la ruta vieja y simplificará composición; no se activa/corta aquí.
- Las trazas agregan queued/admitted, model_started/model_finished y visible_send.
  IDs, herramienta, estado, tiempo, pasos y llamadas explican el recorrido sin cuerpos,
  argumentos, resultados ni errores crudos. Un envío visible requiere await confirmado.

## TDD y pruebas controladas

Seam confirmado: invocación normalizada → respuesta visible/efectos. Modelo,
Discord y web son fronteras controladas; catálogo, ejecutor, lectores, persistencia
y políticas son reales. El modelo decide llamadas y sintetiza resultados que recibió;
no devuelve resultados de herramientas inventados para sustituir funcionalidad.

Rojos observados antes de sus cambios: síntesis tras cuatro lecturas/subllamadas
agotaba el contador; dos lecturas independientes se bloqueaban hasta timeout;
`recuerda que` devolvía denegación; recall natural era entrada inválida; `dile a`
no autorizaba usuario; `9am` pedía formato; fuente recuperada quedaba bloqueada;
imagen+historial no podía usar la herramienta; descubrimiento repetía 156 lookups.
Cada ciclo se ejecutó verde después de su cambio. El primer intento de ejecución
carecía de dependencias; los rojos funcionales se repitieron tras `npm ci --ignore-scripts`.

La prueba compuesta conversación+noticias usa el lector Discord real con HTTP
controlado y cancela una búsqueda externa pendiente a 12 s, conservando autor y
texto del canal actual, excluyendo otro canal. Search→read usa lector HTTP real
controlado y bloquea un URL incrustado en la página. Memoria natural atraviesa
PostgreSQL/pgvector real; imágenes atraviesan AI SDK y validación real de bytes.
Las pruebas heredadas cubren colas vencidas, 429/503 sin reintentos, escritura
incierta, permisos revocados, idempotencia, borrado/antirresurrección y reinicios.
Actualizar expectativas de contadores heredados no cambia sus garantías: las
generaciones dejaron de gastar llamadas externas conforme a la especificación.

Reproducción en recursos exclusivamente propios (Docker, Node 24):

```powershell
npm ci --ignore-scripts
npm run db:generate
docker run --detach --name gnomo-t14-postgres --env POSTGRES_PASSWORD=t14-only --env POSTGRES_DB=gnomo_t11 --publish 127.0.0.1:16434:5432 pgvector/pgvector:pg17
docker exec gnomo-t14-postgres psql -U postgres -c 'CREATE DATABASE gnomo_t10'
docker run --detach --name gnomo-t14-redis --publish 127.0.0.1:16435:6379 redis:7-alpine
docker run --detach --name gnomo-t14-t12 --publish 127.0.0.1:16436:6379 redis:7-alpine redis-server --appendonly yes
docker run --detach --name gnomo-t14-t13 --publish 127.0.0.1:16437:6379 redis:7-alpine redis-server --appendonly yes
$env:T10_DATABASE_URL='postgresql://postgres:t14-only@127.0.0.1:16434/gnomo_t10'
$env:T11_DATABASE_URL='postgresql://postgres:t14-only@127.0.0.1:16434/gnomo_t11'
$env:T02_REDIS_URL='redis://127.0.0.1:16435'
$env:T12_REDIS_RESTART_URL='redis://127.0.0.1:16436'
$env:T12_REDIS_CONTAINER='gnomo-t14-t12'
$env:T13_REDIS_RESTART_URL='redis://127.0.0.1:16437'
$env:T13_REDIS_CONTAINER='gnomo-t14-t13'
npm run verify
git diff --check
```

No se configura T10_RESTART_CONTAINER: su guard exige otro nombre/puerto fijo.
Se verifican clientes nuevos/recuperación SQL, no otro reinicio PostgreSQL.
T12/T13 sí reinician servidores Redis distintos, con AOF. Sus reconexiones pueden
emitir ECONNREFUSED transitorio; el resultado de cada prueba verifica recuperación.

Verificación final local 2026-11-05: `git merge --no-edit integration/gnomo-harness`
confirmó Already up to date con tip `3c646aa4250faeb7d839be2385886d56861455a1`
antes de los checks finales. `npm run verify` posterior terminó con exit 0:
**181/181 pruebas, cero omitidas**, tipos, build y lint aprobados. `git diff --check`
correcto. Log reproducible local: `%TEMP%/gnomo-t14-final-verify.log`.
Se conserva únicamente el aviso previo MODULE_TYPELESS_PACKAGE_JSON de ESLint.
`npm run measure:live -- report docs/t14-measurement-template.json` verificó el
formato vacío con métricas null; no ejecutó proveedores ni Discord. Contenedores
propios `gnomo-t14-postgres`, `gnomo-t14-redis`, `gnomo-t14-t12`, `gnomo-t14-t13`
conservados para inspección. No se tocaron recursos ajenos. No hubo push, cambios
de PR, cierre de issue, migración de producción, piloto ni despliegue.

## Runner vivo acotado para root

**UNPERFORMED**: no se recibió dotenv privado; no existen mediciones reales de
proveedor/Discord, p50/p95, utilidad semántica ni piloto. T14 sigue condicionado
por el criterio de rendimiento real y evaluación humana. No se cuentan fixtures
rápidas, avisos de timeout ni typing como éxito funcional o latencia de servicios.

El runner es un receptor temporal explícito: root detiene otros receptores en su
canal aislado antes de arrancarlo. No ejecuta migraciones, DDL, transferencias ni
trabajos programados. Usa el mismo `composePilot`, AI SDK, OpenAI y modelo configurado,
sin sustitución silenciosa. Configurar dependencias opcionales para las tareas que
las necesitan; no aceptar `unavailable` como resolución útil.

En la configuración privada suministrada por root: BOT_TOKEN, OPENAI_API_KEY,
OPENAI_MODEL explícito, GUILD_ID, T14_REDIS_URL (aislado), T14_CHANNEL_ID,
T14_REQUESTER_ID, T14_EXCLUSIVE_RECEIVER=yes. Opcionales: TAVILY_API_KEY, BUCKET_URL,
PILOT_MEMORY_DATABASE_URL ya preparado, MEMORY_OWNER_ID y modelo de embeddings
aprobado. No almacenar la configuración ni reportes privados en git.

```powershell
$env:T14_ENV_FILE='<ruta privada suministrada por root>'
$env:T14_MAX_SAMPLES='12' # 1–30, defecto 12
$env:T14_MAX_SECONDS='300' # 15–600, defecto 300
$env:T14_OUTPUT='<ruta privada>/t14-live.json'
npm run measure:live
```

Desde la cuenta autorizada, enviar en Discord menciones reales al bot seguidas de
`[simple]`, `[tool]` o `[compound]` y la petición. Repetir cada escenario varias veces:
saludo/frase/foto; miembros/presencia/recall; conversación+noticias;
buscar+leer fuente; recuerdo+miembro; imagen+lectura. Probar además los ejemplos
naturales arriba, ambigüedad, revocación y servicio caído con control del operador.
Identificar escenario por ID del mensaje, sin copiar cuerpos al reporte.

El proceso acepta hasta el máximo de muestras/tiempo, deja terminar solo las
invocaciones ya admitidas bajo sus plazos 12/15 s y cierra conexiones. Registra
recepción Gateway → primer/final reply confirmado (incluye todas las partes, colas
y rate limits), no tiempo de renderizado del cliente Discord. No usa timestamp
del mensaje como reloj de inicio ni considera typing una respuesta. Fallo sin envío
queda sin duración visible y cuenta fuera del objetivo; se informa count/visible.

Revisar cada respuesta en Discord y editar `samples[].outcome` a `useful`, `partial`
o `failure`; respuestas no calificadas quedan `unrated`, nunca útiles por defecto.
Timeout puro es failure; una parcial solo cuenta partial si tiene evidencia útil.
El runner marca detenciones/no-envíos como failure conservadoramente, que el humano
puede reclasificar a partial con justificación de evidencia. No clasificar útil por
velocidad o por haber enviado texto. Después recalcular:

```powershell
npm run measure:live -- report '<ruta privada>/t14-live.json'
```

Formato: modelo y versiones SDK instaladas, fecha, definición del reloj, muestras
con IDs/trazas/tiempos/resultado, summary separado simple/tool/compound con p50/p95
(nearest rank entre envíos visibles), proporciones >3 y >15 segundos, useful,
partial, failure, unrated. Campos sin muestras son null, no ceros de rendimiento.
`docs/t14-measurement-template.json` es el reporte vacío UNPERFORMED, no evidencia viva.
Registrar junto al resultado tamaño de muestra y notas humanas de persona,
relevancia, fuentes y límites; comparar simples con 3 s y herramientas/compuestas
con 15 s. Root coordina ese paso; aquí no se solicitan secretos ni se despliega.
