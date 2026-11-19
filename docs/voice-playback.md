# Reproducción en voz y catálogo de audios

Al pedir «@Gnomo únete y di X», Gnomo genera el audio con su proveedor habitual y consulta el canal de voz actual de quien lo pidió. Si la persona está en un canal de voz normal, tiene permiso para verlo y entrar y el bot puede conectarse y hablar, Gnomo entra, reproduce el Ogg/Opus generado y sale. Al empezar, confirma en el chat «Reproduciendo en General.» El audio se entrega una sola vez. Los mensajes de voz pedidos para el chat siguen saliendo allí.

Si la persona está fuera de una llamada, el modelo recibe `delivered: 'chat'` y Gnomo envía un mensaje de voz. Si falla la conexión antes de reproducir, el bot avisa y envía el mismo archivo al chat. Si se corta una reproducción ya iniciada, el bot deja el canal y registra el fallo.

Para elegir otro canal de voz del servidor, pide «@Gnomo ve a General y di X» o indica el ID del canal. Si hay varios canales de voz con el mismo nombre, usa el ID. Quien lo pide necesita `ViewChannel` y `Connect`. Gnomo indica si le falta `ViewChannel`, `Connect` o `Speak`. Si ya está reproduciendo en el servidor, avisa y envía al chat el audio recién generado mientras continúa la reproducción.

Para reproducir un audio recién generado, tiene que haberse creado en esa invocación. Se mantienen el costo, el límite de 30 segundos y la espera por persona de la generación de voz. La etapa de voz admite una reproducción a la vez por servidor. La reproducción usa `@discordjs/voice` con DAVE y lee los paquetes Opus del Ogg sin transcodificar.

`VOICE_PLAYBACK` en el resumen de arranque indica si el proceso tiene una etapa de voz. En Discord se desactiva si la dependencia de voz o su biblioteca nativa DAVE no carga. La conexión tiene un límite de 10 segundos, configurable mediante `VOICE_CONNECT_TIMEOUT_MS` entre 1 000 y 15 000 ms. La consola simula que la persona está en **Sala de prueba** y muestra el ID del canal y la duración del audio.

## Verificación en un servidor de prueba

- [ ] Entrar a un canal de voz normal y pedir «@Gnomo únete y di que Juan perdió». Verificar que todos oyen el audio, que aparece una confirmación en el chat, que no se duplica el audio y que Gnomo sale al terminar.
- [ ] Salir de la llamada y repetir la petición con una cuenta que pueda generar otro audio. Verificar que llega un mensaje de voz al chat y que Gnomo no entra en voz.
- [ ] Desde una llamada, pedir una nota de voz por el chat. Verificar que llega solo al chat.
- [ ] Desde otro canal o fuera de la llamada, pedir que vaya a General por nombre y por ID. Probar también un canal al que la persona no tenga acceso y un canal de texto.
- [ ] Pedir otro audio desde una segunda cuenta mientras Gnomo habla. Comprobar que avisa que está ocupado y que la reproducción en curso sigue.
- [ ] Quitar el permiso de hablar al bot y comprobar que explica qué permiso falta. Interrumpir la conexión antes de que empiece el audio y comprobar que llega el audio al chat.
- [ ] Desconectar a Gnomo mientras habla. Verificar que la reproducción termina, que queda un registro del fallo y que otra petición puede abrir una conexión nueva.
- [ ] Reiniciar Gnomo mientras aparece conectado a voz. Comprobar que sale al iniciar y que puede reproducir en la siguiente petición.
- [ ] Medir memoria de la máquina de Fly en reposo y durante una reproducción, incluyendo el pico al conectar. Registrar los resultados en el PR y comprobar si caben en 256 MB.

## Catálogo de audios del canal

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
- **Reproducir** (`voice_play`). «@Gnomo pon el audio de la victoria» busca por descripción
  o ID en el catálogo del canal de texto. Gnomo lo reproduce en voz o lo envía al chat si
  quien lo pidió está fuera de la llamada. Con «@Gnomo di que ganamos en el canal de voz
  y guarda el audio», el archivo generado se reproduce y se guarda en la misma invocación.
- **Olvidar** (`audio_forget`). «@Gnomo olvida el audio <ID>» borra el audio de este canal
  o hilo. Solo puede hacerlo quien lo guardó o el propietario indicado en `MEMORY_OWNER_ID`,
  con permisos vigentes en el canal. Gnomo elimina primero la entrada del catálogo y después
  el archivo del bucket. Tras borrar el archivo, la URL pública puede seguir sirviendo una
  copia en caché durante hasta una hora. Si el bucket falla, Gnomo avisa y el audio queda
  fuera del catálogo.

Cada canal o hilo tiene su propio catálogo. [ADR 0003](adr/0003-channel-memory-ownership.md).
Postgres guarda la metadata y la clave del objeto en `channel_audio`. Los bytes Ogg/Opus quedan
en el bucket público compartido con la biblioteca de medios, bajo `<guild>/<canal>/<uuid>.ogg`.
Una copia idéntica en el mismo canal devuelve `already_saved` sin volver a subirla. Si falla
el registro de un audio nuevo, el bot elimina el objeto que subió. Cualquiera con la URL puede
descargarlo. [ADR 0006](adr/0006-media-on-tigris.md).

### Configuración del catálogo

El catálogo usa [la base de datos existente](drizzle.md) y
[el bucket de la biblioteca de medios](media-library.md#configuración). Requiere
`BUCKET_NAME`, `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY`.
`MEDIA_PUBLIC_URL` permite indicar una URL pública HTTPS distinta de la predeterminada de
Tigris. `AWS_REGION` toma el valor `auto` por defecto.

El resumen de arranque muestra `AUDIO_CATALOG` como booleano. Con la base de datos o el
bucket sin configurar, las herramientas del catálogo quedan ocultas. La creación de un
audio sigue usando la configuración y el límite de `speech_generate`. Buscar y compartir
usan el audio existente.

`SAVED_AUDIO_COOLDOWN_SECONDS` controla la espera entre reproducciones de audios guardados
en voz para cada persona en cada servidor. El valor predeterminado es 60 segundos y acepta
enteros de 1 a 3600. Enviar el audio al chat cuando la persona está fuera de una llamada
no usa esta espera. Para un audio recién generado solo se aplica el límite de `speech_generate`.

### Guardar audios adjuntos

Adjunta un MP3, Ogg, WAV, M4A o WebM y pide «@Gnomo guarda este audio como el grito de
Pedro». También puedes responder a un audio del mismo canal, incluidos los mensajes de
voz de Gnomo. Indica cómo quieres encontrar el audio después. Gnomo usa esa descripción
para catalogarlo y pide una si falta.

La imagen de producción incluye ffmpeg para convertir los adjuntos a Ogg/Opus.
[ADR 0007](adr/0007-normalize-saved-audio.md). Los adjuntos con tipo de audio declarado
pueden pesar hasta 8 MiB y durar hasta 60 segundos. Los límites se pueden cambiar con
`AUDIO_UPLOAD_MAX_BYTES` (de 1 byte a 16 MiB, en bytes) y `AUDIO_UPLOAD_MAX_SECONDS` (de 1 a
120 segundos). Un archivo que no se puede decodificar o excede algún límite se rechaza.
Sin ffmpeg, los adjuntos quedan indisponibles y se puede seguir guardando el audio generado.
