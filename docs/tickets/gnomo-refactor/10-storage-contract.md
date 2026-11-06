# T10: contrato público y almacenamiento

Actualización T14: `recuerda que ...` también autoriza guardado; `memory_search`
acepta `{query?: string}` para recall pertinente elegido por el modelo. Los esquemas
de escritura siguen vacíos y el texto actual fija contenido/autor/ámbito.
Ver [contrato actual](../../compound-conversations.md).

La ruta nueva usa NestJS → `PilotMemory` → `composePilot` → catálogo/ejecutor
reales → PostgreSQL/pgvector. Redis conserva exclusivamente reclamaciones sin
contenido. No se llama al servicio legado ni se importa nada al arrancar.

## Peticiones y consentimiento

Se admiten peticiones completas de una línea (sin comillas exteriores):

```text
guarda recuerdo: Anita prefiere té
guarda recuerdo [clave=bebida;categoria=gustos;sujeto=Anita]: Anita prefiere té
busca recuerdos: bebida
corrige recuerdo <ID o clave>: Anita prefiere café
olvida recuerdo <ID o clave>
```

Guardar también admite el prefijo `por favor `. La sintaxis es deliberadamente
conservadora: otras formulaciones deben repetirse con esta forma. Las claves,
categorías y sujetos opcionales tienen hasta 100 caracteres; contenido hasta
1200; consultas hasta 200. Categoría por defecto `general`, sujeto desconocido
NULL. El sujeto es una etiqueta declarada, no una identidad Discord verificada.

El código analiza **solo** `invocation.content`, procedente del receptor
autenticado. Saludos, conversación casual, negaciones, órdenes citadas,
multilínea, contenido histórico/web y llamadas del modelo no conceden permiso.
Los cuatro esquemas de herramienta son objetos estrictos vacíos: el modelo no
puede elegir contenido alternativo, clave, autor, propietario, canal o destino.
Una petición directa pasa por el mismo ejecutor y responde con el resultado
persistido, sin generación del modelo. No se guarda ni consulta memoria como
enriquecimiento automático, y los saludos no llaman a embeddings.

`memory_save`, `memory_search`, `memory_update`, `memory_forget` se registran y
autorizan explícitamente con efectos read/write. `pilotCatalog` conserva los
argumentos collection, members, history y search. Tras integrar T06/T08 conserva
también live y web en quinto/sexto lugar; memory se añade en séptimo.
`composePilot` conserva fetch Discord en sexto y lector web en séptimo; las
dependencias de memoria se añaden en octavo. La composición Nest proporciona
el pool real y el adaptador opcional. El bucle del harness no cambia.

## Configuración y esquema

- `PILOT_MEMORY_DATABASE_URL`: conexión del almacenamiento nuevo; ninguna caída
  recurre al almacenamiento legado ni rompe la conversación ordinaria.
- `MEMORY_OWNER_ID`: ID Discord confiable, decimal de 17–20 dígitos. Ausente o
  inválido deshabilita toda memoria nueva y la petición directa lo explica.
- `PILOT_MEMORY_EMBEDDING_MODEL`: opcional, opt-in explícito. Nest usa AI SDK /
  OpenAI con AbortSignal y cero reintentos. Ausente no usa credenciales/modelos.
  Un fallo del embedding degrada a recuperación léxica, indicada en la respuesta.

Aplicar **explícitamente** `prisma/pilot-memory.sql` con psql a la base elegida.
Es transaccional, repetible y funciona en una base vacía con pgvector instalado.
El arranque no ejecuta DDL. Este SQL es el contrato de almacenamiento nuevo,
administrado con pg; no usar `prisma db push` como instalador de estas tablas.
El antiguo SQL `20240101000000_init_vector_extension` presupone `memories` y
no inicializa una base vacía. `Memory.embedding String?` sigue describiendo la
ruta histórica: no se modifica ese modelo ni la tabla vieja en T10. No encadenar
la instalación nueva a ese SQL antiguo ni afirmar que Prisma crea un vector.

`pilot_memories` guarda UUID estable, servidor/canal, autor y sujeto separados,
clave/categoría/contenido, mensaje fuente autenticado, último mensaje/editor,
origen y fechas. `embedding` es un **vector físico pgvector**, no texto; su modelo
versionado se guarda junto a él. Se comparan solo modelos y dimensiones iguales.
Recuperación: subcadena literal/clave y, opcionalmente, coseno >= 0.65; cinco
resultados, indicador de recorte, sin garantía de exhaustividad. La consulta
vectorial exacta usa el índice de ámbito y no un índice ANN. No requiere dimensión
fija ni entrenamiento. No se afirma relevancia semántica de un proveedor real.

La clave es única por autor y ámbito; guardar nunca hace upsert. Dos autores
pueden declarar valores contradictorios con la misma clave. Se devuelven como
afirmaciones atribuidas y no como una verdad resuelta. Corregir/borrar una clave
con varias coincidencias exige ID, incluso para el propietario. Solo autor o
propietario puede modificar; nunca se confunde sujeto con autor. Las correcciones
conservan fuente/autor originales, actualizan editor/mensaje/fecha y sustituyen
el vector; no conservan el contenido anterior.

Cada acceso revalida permisos efectivos de solicitante y bot, membresía y canal
con datos Discord actuales, también después del embedding y antes del acceso SQL;
la entrega vuelve a comprobarlos. Las consultas SQL siempre llevan servidor y
canal autenticados. Los hilos usan su ID propio.

Transacciones y lock por ámbito serializan colisiones y mutaciones entre procesos.
`pilot_memory_operations` identifica el evento por servidor/canal/mensaje, sin
depender del ID de llamada elegido por el modelo. Registro y cambio se confirman
juntos. Redis deduplica entregas concurrentes, pero su expiración no permite
duplicar el efecto SQL. El registro durable no conserva argumentos, contenido,
embedding ni versiones: solo identificadores, operación y referencia anulable.

Borrar hace DELETE físico de la fila y vector; PostgreSQL actualiza sus índices y
anula las referencias del registro de idempotencia. No hay caché de recuerdos,
copias en Redis, versiones ni logs de contenido. Repetir un evento aplicado cuyo
recuerdo fue borrado devuelve `already_applied` con ID nulo y no lo resucita.
Los mensajes originales de Discord y respuestas ya enviadas son fuentes externas,
no recuerdos administrados; este contrato no borra mensajes Discord ni backups/WAL
del operador. No se promete borrado forense de bloques del servidor.

Los límites de conexión/SQL/lock son acotados y no hay reintentos implícitos. Se
comprueba cancelación antes de mutar y confirmar; un fallo de escritura con posible
commit se comunica como incierto por el ejecutor, nunca como éxito inventado.

## Extensiones T11

`origin=legacy_import`, `legacy_id` único, autor/sujeto/fuente anulables y fechas
explícitas permiten importación repetible posterior. T11 debe preservar IDs y
fechas, validar servidor y canal destino, gestionar colisiones y autor desconocido
(solo propietario), verificar compatibilidad de embeddings, simular, comparar y
planificar rollback. No inferir un origen histórico desde el canal de destino.
T10 no ejecuta importaciones ni elimina datos antiguos. Las futuras copias de
migración deberán integrarse con la política de borrado antes de exponerse al bot.

## Verificación reproducible aislada

```powershell
npm ci --ignore-scripts
npm run db:generate
docker run --detach --name gnomo-t10-postgres --publish 127.0.0.1:16410:5432 --env POSTGRES_PASSWORD=t10-only --env POSTGRES_DB=gnomo_t10 pgvector/pgvector:pg17
docker run --detach --name gnomo-t10-redis --publish 127.0.0.1:16411:6379 redis:7-alpine
$env:T10_DATABASE_URL='postgresql://postgres:t10-only@127.0.0.1:16410/gnomo_t10'
$env:T02_REDIS_URL='redis://127.0.0.1:16411'
$env:T10_RESTART_CONTAINER='gnomo-t10-postgres'
npm run verify
docker rm --force gnomo-t10-postgres gnomo-t10-redis
```

La suite instala SQL solo en la URL de pruebas explícita. El reinicio Docker
opcional se permite exclusivamente para ese nombre, host, puerto y base. Nunca
configurar estas variables con producción. IDs de servidor/eventos aleatorios;
limpieza limitada al servidor del caso; no FLUSHDB. Modelo/Discord/embeddings son
controlados; catálogo, ejecutor, composición, permisos, SQL vectorial y Redis son
reales. La prueba observa invocación → respuesta/efectos consultables, no métodos
privados. Sin URLs las pruebas de persistencia aparecen **omitidas**, no sustituidas
por fakes. El caso sin configuración es una prueba distinta de disponibilidad.

Rojos observados por slice: guardar denegado → persistencia/consulta; corrección
sin registrar → contenido sustituido; borrado sin registrar → ausencia recuperable;
sin vector usado → consulta por término diferente recuperada mediante coseno SQL.
Se amplió después la cobertura de permisos, concurrencia, autoría, ambigüedad,
idempotencia y reinicio. La suite no prueba servicios externos reales, resistencia
semántica universal del modelo, latencia p50/p95 ni recuperación ante un crash del
servidor en el instante exacto del commit.

Cuando se proporcionan dependencias de memoria, `composePilot` deshabilita la
caché de páginas Discord para no retener copias de respuestas antiguas. El lector
conserva su firma anterior y añade un cuarto booleano opcional, true por defecto;
el historial sigue disponible y se lee con permisos actuales. La memoria nunca
usa esas páginas como fuente de consentimiento ni como índice de recuperación.
