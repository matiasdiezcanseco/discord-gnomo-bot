> T15 current runtime/setup/rollout supersedes positional composition, legacy routing and Prisma setup below: see [runtime-transition.md](../../runtime-transition.md). Historical implementation evidence remains below.

# T11: operación explícita y recuperación

`npm run memory:migrate -- dry-run|backup|import|rollback` es una herramienta del
operador, ejecutada desde la raíz del repositorio. Nest no la importa ni ejecuta
DDL al arrancar. Reutiliza `pilot_memories`, su modelo de permisos y su recuperación
T10: no modifica el parser ni permite al modelo pedir una migración.

## Preparación y configuración

Instalar dependencias y generar Prisma como en T10. Aplicar explícitamente
`prisma/pilot-memory.sql` antes de migrar. La conexión `PILOT_MEMORY_DATABASE_URL`
debe contener **ambas** tablas, `public.memories` y `public.pilot_memories`: no se
admite una copia entre bases porque no permitiría confirmar borrado, importación
y tombstone juntos. La tabla histórica real tiene ID text/UUID, key, content,
embedding, category, guild_id, created_at y updated_at. Se lee con pg y JSONB,
no mediante Prisma: tanto el vector físico como la variante text se admiten.

Configurar explícitamente, sin cargar automáticamente archivos .env:

- `GUILD_ID`, `GNOMOS_CHANNEL_ID`: destino aprobado; IDs Discord de 17–20 cifras.
- `BOT_TOKEN`: mismo nombre usado por la aplicación. Solo para GET autenticado a
  Discord `/api/v10/channels/<GNOMOS_CHANNEL_ID>`; cero reintentos/redirecciones,
  timeout de cinco segundos. Se comprueban ID, tipo de canal de texto y guild_id
  antes de abrir la transacción y antes de confirmar. DM/guild nulo o ajeno falla.
- `MEMORY_MIGRATION_APPROVE_NULL_GUILD=true`: aprobación explícita de asignar las
  filas históricas sin servidor a este destino. Por defecto se rechazan. Cualquier
  servidor histórico ajeno aborta el lote completo; nunca se reasigna.
- `MEMORY_MIGRATION_LEGACY_MODEL`: identidad versionada **verificada por el
  operador** del modelo histórico. No puede inferirse del vector o del default
  actual del código antiguo.
- `PILOT_MEMORY_EMBEDDING_MODEL` y `MEMORY_MIGRATION_DIMENSIONS`: modelo objetivo
  y dimensión entera 1–4096. Un vector finito no nulo se reutiliza solo si coinciden
  modelo y dimensión. `embedding_model` y la dimensión física `vector_dims` son
  los metadatos T10; no se comparan vectores incompatibles. Solo los faltantes,
  inválidos o incompatibles se regeneran mediante el adaptador AI SDK real, sin
  reintentos y con señal de diez segundos. Requiere credenciales autorizadas del
  proveedor cuando se elija esa opción.
- Alternativa explícita sin proveedor: `MEMORY_MIGRATION_LEXICAL_ONLY=true`
  permite importar sin los vectores incompatibles, conservando contenido y
  recuperación léxica. Los compatibles se conservan. La simulación nunca llama
  a embeddings: comprueba que existe un plan y cuenta vectores compatibles.
- La aplicación necesita también `MEMORY_OWNER_ID` y el canal destino en
  `CONVERSATION_PILOT_CHANNEL_IDS` para consultar/gestionar por la ruta T10.

## Secuencia y garantías

1. `dry-run`: transacción PostgreSQL READ ONLY con snapshot repetible; no DDL,
   archivos de backup, filas ni embeddings. Reporta conteos, no contenido.
2. `backup`: crea explícitamente `memory_migration.entries` y triggers desde
   `prisma/legacy-memory-migration.sql`, dentro de la misma transacción. Conserva
   una copia JSONB recuperable de cada fila, vector y fechas de precisión SQL.
   El original sigue intacto. Un backup repetido debe coincidir exactamente.
3. `import`: exige backup coincidente, IDs UUID y contenido válido para T10.
   Rechaza claves repetidas de autor desconocido y colisiones de ID/legacy_id o
   clave de destino; no hace upsert. Conserva clave, categoría, contenido, ID y
   ambas fechas, asigna `legacy_import` y deja autor/sujeto/fuente desconocidos.
   El destino no se presenta como origen histórico. Solo el propietario gestiona
   estos recuerdos. Inserta, verifica contenido/fechas, registra identidad y
   elimina la copia antigua accesible al servicio legado **atómicamente**. No
   hay cola de revisión: los recuerdos aprobados quedan consultables en el canal.
4. Comprobar `busca recuerdos: <contenido o clave>` por una invocación auténtica
   en el canal destino; otro canal no accede a esos recuerdos. Repetir import
   añade cero filas. No resetea correcciones posteriores ni identidades olvidadas.

Locks de ámbito compatibles con T10 y locks de tablas excluyen escrituras
concurrentes del legado durante cada operación. Cualquier fallo antes de commit
revierte el lote entero; el backup previamente confirmado permanece recuperable.
Si se pierde la conexión durante COMMIT se informa resultado incierto: inspeccionar
y repetir la misma operación, nunca asumir que no hubo commit. Los errores SQL
solo exponen SQLSTATE, sin filas, consultas ni secretos.

## Rollback y olvido

`rollback` devuelve las filas importadas intactas a la tabla antigua y las retira
del piloto, todo en una transacción. Es repetible. Se niega a sobrescribir una
fila antigua existente o a descartar una corrección posterior: cualquier recuerdo
modificado aborta el rollback entero. No es una función para deshacer cambios de
usuarios. Corregir la causa del fallo y repetir; no borrar el ledger para forzarlo.
Se puede volver a importar desde el backup original después de rollback.

Un `memory_forget` autorizado elimina físicamente fila/vector T10 y, mediante el
trigger, purga el payload del backup y cualquier copia histórica de esa identidad.
Solo permanece un tombstone sin contenido/vector para impedir resurrección.
Import/rollback omiten identidades olvidadas; un INSERT/UPDATE histórico del mismo
ID se rechaza incluso con distinta capitalización UUID. No eliminar estos triggers
ni restaurar backups antiguos sin preservar tombstones. No hay copias en Redis.
Backups/WAL externos del operador y mensajes Discord son fuentes externas como
en T10; no se promete borrado forense.

El schema del backup revoca acceso PUBLIC. Ejecutar operaciones con un rol de
migración propietario separado; el rol del bot solo requiere permisos T10 y no
debe recibir acceso a `memory_migration`. Los triggers SECURITY DEFINER tienen
search_path fijo y referencias calificadas para que el olvido purgue el backup
sin conceder al bot su lectura. El ledger y el backup son infraestructura
administrada persistente, no una tabla que deba eliminarse como limpieza.

## Verificación aislada

Seam confirmado: invocación normalizada → respuesta/efectos, más CLI/servicio de
operación explícita. PostgreSQL/pgvector y Redis reales; Discord/modelo/embeddings
controlados en la frontera externa. Nunca usar URLs de producción.

```powershell
docker run --detach --name gnomo-t11-postgres --publish 127.0.0.1:16421:5432 --env POSTGRES_PASSWORD=t11-only --env POSTGRES_DB=gnomo_t11 pgvector/pgvector:pg17
docker run --detach --name gnomo-t11-redis --publish 127.0.0.1:16422:6379 redis:7-alpine
$env:T11_DATABASE_URL='postgresql://postgres:t11-only@127.0.0.1:16421/gnomo_t11'
docker exec gnomo-t11-postgres psql -U postgres -c 'CREATE DATABASE gnomo_t10_isolated'
$env:T10_DATABASE_URL='postgresql://postgres:t11-only@127.0.0.1:16421/gnomo_t10_isolated'
$env:T02_REDIS_URL='redis://127.0.0.1:16422'
Remove-Item Env:T10_RESTART_CONTAINER -ErrorAction SilentlyContinue
npm run verify
docker rm --force gnomo-t11-postgres gnomo-t11-redis
```

La prueba T11 exige la base `/gnomo_t11` y reconstruye exclusivamente sus tablas
sintéticas. No compartir esa base con datos o pruebas concurrentes. Cubre tipos
físicos vector/text, IDs/conteos/contenido/fechas y microsegundos, segunda ejecución,
dry-run sin instalación, CLI compartida y proceso ejecutable, recall semántico SQL,
aislamiento, autor desconocido, borrado y antiresurrección, null/foreign guild,
colisiones, backup divergente, fallo tras el primer INSERT y recuperación,
regeneración selectiva y rollback protegido ante correcciones. Sin URLs estos
casos aparecen omitidos explícitamente.

Rojos observados: módulo ausente; incompatibilidad UUID/text durante importación;
preview aceptaba vectores incompatibles sin plan (assertion Missing expected
rejection). Los ciclos terminaron verdes. La prueba inicial de módulo ausente se
repitió una vez instaladas las dependencias, pues el primer intento no tenía tsx.
El guard de reinicio T10 solo permite gnomo-t10-postgres/16410/gnomo_t10; no se
modificó ni se volvió a ejecutar ese reinicio opcional (ya verificado por root).
No se verifican credenciales, Discord/proveedor reales, relevancia semántica
externa ni un crash en el instante del commit. No se ejecutó producción.

Verificación final del implementador (2026-11-05): ascendencia requerida
`7631af3137dbce9d9cec48ad5ad1126570236d4a` comprobada antes de editar; integración
local `6678cb5105adc05d63abaadc7c484eaadc786be9` incorporada por merge `4490412`.
`npm run verify` posterior al merge terminó con exit 0: **138/139 pruebas pasan,
una omitida**, tipos, build y lint correctos. La omisión es el reinicio opcional
del servidor Redis de T12 (no se configuraron sus variables); T10 y T11 usaron
PostgreSQL/pgvector real en bases distintas del contenedor T11 y Redis real T11.
No se repitió el reinicio opcional de PostgreSQL T10. Único aviso lint previo:
MODULE_TYPELESS_PACKAGE_JSON. Log conservado en
`C:/Users/matia/AppData/Local/Temp/gnomo-t11-verify.log`. `git diff --check` correcto.
Rama `feat/migrate-legacy-memories`, worktree `t3-6699debc`. Recursos propios
`gnomo-t11-postgres` (16421) y `gnomo-t11-redis` (16422) conservados; no se tocaron
contenedores de otros agentes. Sin delegación, producción, push, despliegue,
creación/modificación del PR ni cierre de issue; checks/reviews remotos no consultados.
