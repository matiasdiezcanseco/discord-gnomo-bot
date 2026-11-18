# Reproducción en voz

Al pedir «@Gnomo únete y di X», Gnomo genera el audio con su proveedor habitual y consulta el canal de voz actual de quien lo pidió. Si la persona está en un canal de voz normal, tiene permiso para verlo y entrar y el bot puede conectarse y hablar, Gnomo entra, reproduce el Ogg/Opus generado y sale. Al empezar, confirma en el chat «Reproduciendo en General.» El audio se entrega una sola vez. Los mensajes de voz pedidos para el chat siguen saliendo allí.

Si la persona está fuera de una llamada, el modelo recibe `delivered: 'chat'` y Gnomo envía un mensaje de voz. Si falla la conexión antes de reproducir, el bot avisa y envía el mismo archivo al chat. Si se corta una reproducción ya iniciada, el bot deja el canal y registra el fallo.

Solo se puede reproducir el audio generado para la invocación actual. Se mantienen el costo, el límite de 30 segundos y la espera por persona de la generación de voz. La etapa de voz admite una reproducción a la vez por servidor. La reproducción usa `@discordjs/voice` con DAVE y lee los paquetes Opus del Ogg sin transcodificar.

`VOICE_PLAYBACK` en el resumen de arranque indica si el proceso tiene una etapa de voz. En Discord se desactiva si la dependencia de voz o su biblioteca nativa DAVE no carga. La conexión tiene un límite de 10 segundos, configurable mediante `VOICE_CONNECT_TIMEOUT_MS` entre 1 000 y 15 000 ms. La consola simula que la persona está en **Sala de prueba** y muestra el ID del canal y la duración del audio.

## Verificación en un servidor de prueba

- [ ] Entrar a un canal de voz normal y pedir «@Gnomo únete y di que Juan perdió». Verificar que todos oyen el audio, que aparece una confirmación en el chat, que no se duplica el audio y que Gnomo sale al terminar.
- [ ] Salir de la llamada y repetir la petición con una cuenta que pueda generar otro audio. Verificar que llega un mensaje de voz al chat y que Gnomo no entra en voz.
- [ ] Desde una llamada, pedir una nota de voz por el chat. Verificar que llega solo al chat.
- [ ] Quitar el permiso de hablar al bot y comprobar que explica qué permiso falta. Interrumpir la conexión antes de que empiece el audio y comprobar que llega el audio al chat.
- [ ] Desconectar a Gnomo mientras habla. Verificar que la reproducción termina, que queda un registro del fallo y que otra petición puede abrir una conexión nueva.
- [ ] Medir memoria de la máquina de Fly en reposo y durante una reproducción, incluyendo el pico al conectar. Registrar los resultados en el PR y comprobar si caben en 256 MB.
