# Gnomo en Discord

Asistente del servidor con el que los miembros conversan mediante menciones y al que pueden pedir información y acciones concretas.

## Lenguaje

**Invocación**:
Mensaje de un miembro que menciona al bot para dirigirle una petición.
_Evitar_: Comando, cuando se trata de una petición en lenguaje natural.

**Historial del canal**:
Mensajes publicados en un canal de Discord, participara o no el bot en la conversación.
_Evitar_: Memoria, historial del bot.

**Historial de conversación con Gnomo**:
Intercambios de peticiones y respuestas entre los miembros y el bot.
_Evitar_: Historial del canal.

**Miembro del servidor**:
Usuario que pertenece a un servidor de Discord, identificado independientemente de sus nombres y apodos.
_Evitar_: Usuario activo, cuando solo se conoce su pertenencia al servidor.

**Miembro conectado**:
Miembro del servidor cuya presencia visible en Discord indica conexión. No implica que esté escribiendo ni participando en un canal de voz.
_Evitar_: Usuario activo, cuando se quiere expresar presencia en línea.

**Recuerdo de Gnomo**:
Información que un miembro pide explícitamente al bot que conserve para futuras conversaciones dentro del mismo canal.
_Evitar_: Historial, guardado automático.

**Autor del recuerdo**:
Miembro que pidió guardar una información. Puede ser una persona distinta de aquella sobre la que trata el recuerdo.
_Evitar_: Sujeto del recuerdo, dueño del dato.

**Sujeto del recuerdo**:
Persona o tema sobre el que trata una información conservada por Gnomo.
_Evitar_: Autor del recuerdo.

**Medio guardado**:
Imagen que un miembro pide explícitamente al bot que conserve, con una descripción para encontrarla y compartirla después dentro del mismo canal.
_Evitar_: Foto de la colección (las fotos aleatorias del Gnomo), adjunto.

**Generación con costo**:
Creación de un archivo (imagen, mensaje de voz) que gasta créditos del proveedor. Cada miembro tiene un turno por ventana de espera, que se toma antes de gastar; un rechazo del proveedor devuelve el turno y cualquier otra falla lo conserva.
_Evitar_: Cuota de imágenes, cuando la regla aplica también a audios.
