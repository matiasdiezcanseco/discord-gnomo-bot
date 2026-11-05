# Memoria compartida por canal con autoría explícita

Los recuerdos nuevos serán consultables solo dentro del canal en que se guardaron y únicamente por miembros que pueden leerlo; su autor o el propietario del bot podrán modificarlos o borrarlos. Se sacrifica la personalización compartida entre canales para mantener la frontera acordada del historial, y se registrarán autor, sujeto y origen por separado.

Los recuerdos existentes se reestructurarán y migrarán dentro del refactor, conservando contenido, identificadores y fechas y marcando la procedencia como importada. Si el autor original es desconocido, solo el propietario podrá gestionarlos; GNOMOS_CHANNEL_ID será el destino común aprobado, sin fingir que es el origen histórico.
