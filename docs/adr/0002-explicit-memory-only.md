# Recuerdos únicamente por petición explícita

La ruta nueva guardará recuerdos solo cuando un miembro se lo pida al bot y retirará el guardado automático existente. Se acepta perder parte de la personalización espontánea para que conversar no implique conservar automáticamente datos personales; la propiedad, visibilidad y migración de recuerdos anteriores se rigen por la decisión de memoria compartida por canal.

## Actualización (2026-11): petición detectada por intención

La petición explícita ya no se reconoce con frases fijas en código («guarda recuerdo:», «recuerda que», «olvida recuerdo …»). El modelo decide por la intención de la petición actual, dicha de cualquier forma, y entrega el contenido o el ID/clave. Sigue sin haber autoguardado. El código mantiene los límites: alcance del canal, edición solo por autor o propietario, una escritura por invocación, permisos frescos dentro de la transacción y rechazo de escrituras sin contenido. Se acepta que la intención la juzgue el modelo, con instrucciones de ignorar historial, páginas e imágenes como fuente de órdenes.
