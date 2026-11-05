# T02: Conversación por invocación mediante un harness autorizado

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/4

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Una invocación obtiene una respuesta de Gnomo mediante el núcleo nuevo y un catálogo/ejecutor de herramientas autorizado. Construir una ruta completa de conversación y probar una capacidad controlada de extremo a extremo, dejando las capacidades todavía no migradas en la ruta anterior hasta el piloto final.

## Acceptance criteria

- [ ] La ruta nueva responde solo ante invocación y mantiene personalidad, brevedad, errores comprensibles y asociación entre mensaje y respuesta, sin importar objetos vivos de Discord al núcleo.
- [ ] El modelo se consume a través de un adaptador; conservar AI SDK inicialmente. El catálogo valida nombres únicos, esquemas, disponibilidad, capacidades, efectos y límites.
- [ ] Un intento de herramienta atraviesa validación y autorización por solicitante/servidor/canal y termina en un efecto permitido o una denegación verificable; los argumentos del modelo no pueden cambiar la identidad autenticada.
- [ ] Registrar una capacidad de prueba no exige editar el bucle; un nombre duplicado se rechaza y una capacidad no disponible se explica sin fingir éxito.
- [ ] Aplicar desde esta entrega presupuestos compartidos de cinco pasos, ocho llamadas y tiempo total, corte externo cerca de doce segundos y respuesta parcial o aviso dentro del objetivo de quince; no continuar silenciosamente en segundo plano.
- [ ] El envío impide menciones masivas y de roles y permite solamente menciones individuales autorizadas. Dividir respuestas extensas sin cortar fuentes o enlaces.
- [ ] Deduplicar eventos, asociar correctamente peticiones simultáneas y contabilizar colas y reintentos en el mismo presupuesto; probarlo desde la frontera principal con reloj controlado y Redis real para las garantías persistentes.
- [ ] Trazas mínimas identifican invocación, autorización, llamadas, tiempos y errores sin copiar conversaciones o secretos por defecto; el piloto no habilita herramientas todavía no migradas ni escrituras administrativas.

## Blocked by

- [T01 / #3: Invocación comprobable e independiente de Discord](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/3)
