# T13: Conservar los cumpleaños con la entrega programada nueva

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/15

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Seguir enviando los cumpleaños existentes en el canal acordado, usando el mecanismo recuperable de avisos y la zona horaria del grupo.

## Acceptance criteria

- [ ] Conservar la fuente y contenido funcional de cumpleaños; evaluar la fecha con America/Lima y enviar en el canal configurado.
- [ ] Usar la reclamación y entrega recuperable de avisos; reinicio o dos ejecuciones del mismo día no producen felicitaciones duplicadas evitables.
- [ ] Revalidar destino/permisos y permitir solamente la mención individual correspondiente; fallos transitorios y permanentes siguen las reglas de avisos.
- [ ] Pruebas del evento programado hasta la publicación verifican límites de día/zona horaria, fuente vacía o caída, reinicio y concurrencia con persistencia real donde corresponda.

## Blocked by

- [T12 / #14: Crear y entregar recordatorios propios de forma recuperable](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/14)
