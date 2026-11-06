# T11: Consultar los recuerdos existentes tras migrarlos al esquema nuevo

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/13

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Reestructurar e importar los recuerdos antiguos y demostrar que una invocación en GNOMOS_CHANNEL_ID los recupera mediante la ruta nueva, con procedencia honesta y sin acceso desde otros canales.

## Acceptance criteria

- [ ] Simulación previa, copia recuperable e importación repetible conservan IDs, contenido y fechas; mantener embeddings compatibles y regenerar solo los necesarios.
- [ ] Asignar el servidor configurado y GNOMOS_CHANNEL_ID como nuevo destino validado; no presentarlo como origen histórico ni reasignar silenciosamente datos de otro servidor.
- [ ] Marcar legacy_import y dejar autor y fuente desconocidos cuando no existan; solo el propietario gestiona importaciones de autor desconocido.
- [ ] Claves repetidas, registros sin servidor, conflictos de identidad y fallos parciales se manejan sin pérdida o duplicación silenciosa.
- [ ] Comprobar con PostgreSQL real consulta desde el canal aprobado, denegación desde otro, conservación de conteos/datos y segunda importación sin duplicados; simular sin escrituras.
- [ ] La migración no se ejecuta automáticamente al arrancar. Documentar aplicación y vuelta atrás compatibles; los recuerdos no quedan pendientes de una revisión manual indefinida.

## Blocked by

- [T10 / #12: Guardar, consultar, corregir y borrar recuerdos del canal](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/12)

## Implementación

CLI explícita, configuración, contrato del backup/olvido y recuperación:
[11-migration-operations.md](11-migration-operations.md).
