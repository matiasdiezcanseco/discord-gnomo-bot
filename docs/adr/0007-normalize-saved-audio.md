# Normalizar los audios guardados a Ogg/Opus

Los audios adjuntos pasan por ffmpeg para decodificar a PCM de 16 bits en mono. El
codificador que ya usa Gnomo para sus mensajes de voz genera el Ogg/Opus con cuadros de
20 ms y posiciones de gránulo a 48 kHz. La duración y la forma de onda se calculan a
partir del PCM. El catálogo conserva el archivo normalizado para que se pueda enviar
como mensaje de voz y reproducir en una llamada sin volver a convertirlo.

ffmpeg se instala en la imagen de producción. Solo recibe el adjunto descargado y
procesa los contenedores admitidos. El lector y el decodificador limitan los bytes
descargados y las muestras decodificadas. Se rechazan archivos que superan los límites,
para conservar la integridad del clip. Sin ffmpeg, guardar adjuntos devuelve
`unavailable`. El audio generado conserva su ruta existente y se puede seguir guardando.

Un audio adjunto se describe con las palabras de quien pide guardarlo. El catálogo
guarda su procedencia y deja vacía la transcripción.
