# Biblioteca de medios del canal

Gnomo guarda imágenes que un miembro le pide explícitamente conservar («@Gnomo guarda este
meme») y las vuelve a compartir cuando se le pide («@Gnomo manda el meme del gato»).

## Flujo

1. **Guardar** (`media_save`, escritura). La imagen viene adjunta a la invocación o, si la
   invocación es una respuesta sin adjuntos, del mensaje respondido (mismo canal; solo PNG,
   JPEG o WebP estáticos de hasta 2,5 MB, como cualquier adjunto). El modelo ve la imagen y
   redacta `title`, `description` (qué se ve, texto transcrito, tono, contexto) y `tags`.
   El código vuelve a verificar los bytes, calcula su SHA-256 y:
   - si el canal ya tiene esos bytes, responde `already_saved` sin subir nada;
   - si no, sube el objeto a `<guild>/<canal>/<uuid>.<ext>` y registra la metadata en
     `channel_media` (Postgres). Si el registro falla, borra el objeto subido.
2. **Buscar** (`media_search`, lectura). Coincidencia de palabras sin acentos en título y
   etiquetas (peso doble) y descripción, más similitud vectorial si
   `PILOT_MEMORY_EMBEDDING_MODEL` está configurado. Devuelve descripciones, nunca URLs.
3. **Compartir** (`media_share`, lectura, textual y `standalone`). Recibe un ID o una
   descripción y envía la URL pública de la mejor coincidencia sola en su mensaje, para que
   Discord muestre la imagen (igual que `collection_photo`, [ADR 0005](adr/0005-collection-by-intent.md)).
4. **Olvidar** (`media_forget`, escritura). Por ID; solo quien la guardó o `MEMORY_OWNER_ID`.
   Borra la fila y luego el objeto.

Frontera igual que los recuerdos ([ADR 0003](adr/0003-channel-memory-ownership.md)): cada canal
o hilo tiene su propia biblioteca. Las escrituras solo ocurren por la petición actual y
revalidan permisos justo antes de escribir.

## Configuración

Requiere la base de datos (la misma de los recuerdos), `MEMORY_OWNER_ID` y un bucket S3
compatible **público de lectura** ([ADR 0006](adr/0006-media-on-tigris.md)):

| Variable | Valor en producción |
|---|---|
| `BUCKET_NAME` | `gnomo-media` |
| `AWS_ENDPOINT_URL_S3` | `https://fly.storage.tigris.dev` |
| `AWS_REGION` | `auto` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | secretos de Fly |
| `MEDIA_PUBLIC_URL` | opcional; por defecto `https://<BUCKET_NAME>.t3.tigrisfiles.io/` |

El bucket se creó con `fly storage create --public -n gnomo-media -a <app>`, que fija esas
variables como secretos de la app. Sin alguna de ellas, `media_save`/`media_search`/`media_forget`
responden `unavailable` y `media_share` no se ofrece al modelo. La línea de resumen del
arranque informa `MEDIA_BUCKET` (solo presencia, nunca valores).

El sandbox de consola usa el bucket si las variables están en `.env`: los objetos quedan bajo
el guild del sandbox, pero conviene un bucket de desarrollo aparte
(`fly storage create --public -n gnomo-media-dev`) o dejar `BUCKET_NAME=` vacío en `.env.sandbox`.

## Límites actuales

- Solo imágenes estáticas PNG/JPEG/WebP (≤ 2,5 MB, ≤ 4 MP). GIF y videos quedan fuera.
- Imágenes enlazadas (embeds de Tenor/Imgur) no se leen; solo adjuntos.
- La búsqueda considera los 500 medios más recientes del canal.
- Cualquiera con la URL puede ver el archivo; las claves llevan un UUID no adivinable.
- Tras `media_forget`, la URL pública puede seguir sirviendo la copia en caché de Tigris hasta
  1 hora (`Cache-Control: max-age=3600`), y Discord puede conservar su propia copia en mensajes
  ya enviados.
