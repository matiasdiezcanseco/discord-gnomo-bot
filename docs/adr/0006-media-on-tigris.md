# Medios guardados en Tigris, públicos por URL, metadata en Postgres

Las imágenes que los miembros piden guardar se almacenan en un bucket Tigris creado desde Fly
(`gnomo-media`), y su descripción y metadata en la tabla `channel_media` de Neon Postgres. Se
comparó con Neon Object Storage: precios de almacenamiento parecidos y 5 GB gratis en ambos,
pero en Neon el egress comparte la cuota de transferencia del proyecto con Postgres (5 GB/mes
en Free, que al agotarse suspende el cómputo y con ello los recuerdos), mientras que Tigris no
cobra egress, se factura en Fly y se aprovisiona con un comando que fija los secretos. El
código usa el SDK S3 estándar con `AWS_*`, así que cambiar de proveedor es solo configuración.

El bucket es de lectura pública: compartir es enviar la URL sola y Discord la previsualiza,
igual que las fotos de la colección. Se acepta que cualquiera con el enlace vea el archivo
(claves con UUID) a cambio de no reimplementar la entrega como adjunto de Discord. La
biblioteca es por canal, como los recuerdos (ADR 0003).
