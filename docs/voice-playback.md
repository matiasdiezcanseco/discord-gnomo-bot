# Catálogo de audios del canal

- **Guardar** (`audio_save`). «@Gnomo di que ganamos y guarda el audio» genera un mensaje de
  voz y lo guarda en el canal. El modelo redacta el título, la descripción y las etiquetas.
  La transcripción conserva el texto enviado al generador de voz en esa misma invocación.
  Hace falta una petición explícita para guardar el audio. [ADR 0002](adr/0002-explicit-memory-only.md).
- **Buscar** (`audio_search`). «@Gnomo ¿qué audios tienes de la victoria?» devuelve IDs,
  títulos, descripciones y duración. Busca entre los 500 audios más recientes del canal.
  Ignora acentos, da doble peso a coincidencias en título y etiquetas e incluye descripción
  y transcripción. Con `PILOT_MEMORY_EMBEDDING_MODEL` se añade similitud vectorial.
- **Compartir** (`audio_share`). «@Gnomo manda el audio de la victoria por el chat» envía
  la mejor coincidencia por descripción o ID como un mensaje de voz con duración y forma de onda.

Cada canal o hilo tiene su propio catálogo. [ADR 0003](adr/0003-channel-memory-ownership.md).
Postgres guarda la metadata y la clave del objeto en `channel_audio`. Los bytes Ogg/Opus quedan
en el bucket público compartido con la biblioteca de medios, bajo `<guild>/<canal>/<uuid>.ogg`.
Una copia idéntica en el mismo canal devuelve `already_saved` sin volver a subirla. Si falla
el registro de un audio nuevo, el bot elimina el objeto que subió. Cualquiera con la URL puede
descargarlo. [ADR 0006](adr/0006-media-on-tigris.md).

## Configuración

El catálogo usa [la base de datos existente](drizzle.md) y
[el bucket de la biblioteca de medios](media-library.md#configuración). Requiere
`BUCKET_NAME`, `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY`.
`MEDIA_PUBLIC_URL` permite indicar una URL pública HTTPS distinta de la predeterminada de
Tigris. `AWS_REGION` toma el valor `auto` por defecto.

El resumen de arranque muestra `AUDIO_CATALOG` como booleano. Con la base de datos o el
bucket sin configurar, las herramientas del catálogo quedan ocultas. La creación de un
audio sigue usando la configuración y el límite de `speech_generate`. Buscar y compartir
usan el audio existente.
