# T15: Validar el piloto y sustituir la ruta anterior sin perder datos

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/17

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

El propietario puede probar el bot completo en el canal de prueba y completar una transición verificable a la implementación nueva, con vuelta atrás de configuración y datos y sin doble respuesta ni pérdida de recuerdos o avisos.

## Acceptance criteria

- [ ] Disponer de un piloto controlado por configuración y un único receptor/ejecutor activo por evento; migrar capacidad por capacidad no habilita dos envíos para la misma invocación.
- [ ] Comprobar todas las capacidades acordadas, aislamiento, menciones, presupuesto, migración y avisos pendientes; preservar identidad y recursos del grupo.
- [ ] Documentar configuración mínima, ID confiable del propietario, intents/permisos, dependencias opcionales, diagnóstico, resultados medidos y procedimiento de transición/rollback compatible.
- [ ] Verificar la vuelta atrás en un entorno de prueba sin pérdida de datos ni reintroducción de lecturas globales o guardado automático de recuerdos.
- [ ] Tras verificar que no quedan consumidores de la ruta antigua, retirarla y eliminar compatibilidad temporal innecesaria; mantener verdes las comprobaciones en cada etapa de expansión y contracción.
- [ ] No aplicar migraciones a datos reales ni desplegar producción como efecto de ejecutar pruebas o publicar tickets; registrar claramente qué validaciones reales se completaron y cuáles requieren el entorno del propietario.

## Blocked by

- [T14 / #16: Resolver peticiones combinadas dentro del presupuesto y medir latencia](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/16)
