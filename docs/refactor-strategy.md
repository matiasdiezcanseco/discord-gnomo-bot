# Estrategia de modularización de Gnomo

Estado: diseño aprobado por el propietario, incluida la asignación de recuerdos antiguos a GNOMOS_CHANNEL_ID. Se autoriza una refactorización completa y la reescritura de la implementación; el código existente sirve como guía funcional, no como estructura que deba preservarse. Todavía no se ha modificado el código de ejecución ni una base de datos.

## Objetivo confirmado

Mantener la interacción por mención al bot y prácticamente la funcionalidad actual. Habilitar selección de herramientas según la petición, consulta de Discord e internet y ampliación del catálogo, con una lista explícita de acciones permitidas.

## Decisiones confirmadas por el propietario

- Uso personal con amigos en un solo servidor. No construir soporte ni administración multiservidor.
- Lectura del historial limitada al canal de la petición; no realizar consultas entre canales. Tratar un hilo como un contexto separado, sin importar automáticamente mensajes del canal padre ni de otros hilos.
- Bot de conversación sin moderación: sin expulsar usuarios, borrar mensajes ni modificar roles. Conservar las funciones de contenido, recordatorios y cumpleaños aceptadas en la primera ronda.
- Guardado de recuerdos únicamente ante una petición explícita. Retirar el guardado automático de la ruta nueva.
- Internet de solo lectura: búsqueda, lectura de páginas públicas y noticias; sin formularios, sesiones autenticadas ni operaciones en cuentas externas.
- Conocer los miembros del servidor y su presencia actual en Discord. «Activo» significa conectado, no escribir recientemente ni estar en voz. La consulta de voz existente se conserva como capacidad distinta.
- Responder solo ante invocación, con contexto anterior compartido del canal e identificación de autores; sin respuestas espontáneas a mensajes ambientales.
- Recuerdos limitados al canal, consultables por quienes pueden leerlo. Modificación y borrado solo por quien guardó el recuerdo o por el propietario del bot; registrar por separado quién lo aportó y de quién trata.
- Contexto inicial de 30 mensajes recientes, consultas explícitas de hasta 200 mensajes, caché conversacional de 24 horas y sin archivo permanente de conversaciones. Los recuerdos explícitos persisten hasta borrado autorizado.
- Recordatorios propios en el canal de origen y cumpleaños existentes, zona horaria America/Lima, sin mensajes privados ni menciones masivas. Menciones individuales solo por petición o como parte de un aviso acordado.
- Cinco pasos y ocho llamadas como máximos por petición. Objetivo de respuesta inferior a tres segundos para tareas sencillas e inferior a quince segundos para tareas con herramientas; se rechaza el presupuesto previo de treinta segundos.
- Mantener NestJS, TypeScript, Redis y PostgreSQL, monolito modular y migración gradual con piloto en canal de prueba. Mantener AI SDK salvo que aparezca una ventaja concreta y justificada de otra opción.
- Mantener identidad y humor, brevedad por defecto y detalle cuando lo requiera la petición. Evitar truncar fuentes, enlaces o resultados arbitrariamente.
- Reestructurar y migrar los recuerdos existentes como parte del refactor; no dejar su adaptación para una revisión manual indefinida.
- Detener consultas externas cerca del segundo doce y entregar resultados parciales verificables o un aviso antes de quince; sin continuar silenciosamente en segundo plano.
- Ante identidades o modificaciones ambiguas, pedir aclaración. No sobrescribir recuerdos de otros autores; atribuir las discrepancias sin presentar afirmaciones contradictorias como hechos verificados.
- Destino de importación de recuerdos existentes: GNOMOS_CHANNEL_ID, con procedencia histórica desconocida cuando el esquema anterior no permita determinarla.
- Pruebas confirmadas por el propietario: frontera principal desde invocación normalizada hasta respuesta y efectos observables, con modelo/Discord/web simulados y persistencia real para migraciones y concurrencia.

Limitación de la plataforma: invisible se muestra como desconectado; no inferir la conexión real a partir de otros datos. Sin cobertura de presencias, responder desconocido/incompleto. Representación: `online`, `idle` y `dnd` como conectados, con el estado concreto visible; `offline` como «aparece desconectado».

## Lo que existe

- NestJS con módulos, registro de herramientas y bucle de llamadas al modelo limitado a tres pasos: `src/core/orchestrator/orchestrator.service.ts`, `src/core/tools/tool-registry.service.ts` y `src/modules/config/constants.ts`.
- Diez herramientas registradas: búsqueda de miembros, lista de miembros, participantes en voz, frases, imágenes, búsqueda web, recordatorios y tres herramientas de memoria. Ver `src/core/tools/tools.module.ts`.
- Recepción por mención dentro de un único `GUILD_ID`: `src/modules/discord/message-handler.service.ts`. El README describe también prefijos, pero este receptor exige mención.
- Historial de intercambios con el bot en Redis; no hay herramienta de consulta del historial real de Discord.
- Búsqueda Tavily que devuelve fragmentos y enlaces; no hay lector independiente de páginas ni consulta específica de noticias por periodo.
- Estados de voz disponibles; el cliente no solicita `GuildPresences`. Ver `src/modules/discord/discord.service.ts`.
- Memoria persistente y recuperación semántica, con guardado explícito y automático; cumpleaños programados y recordatorios en Redis.
- No hay script de pruebas en `package.json` ni archivos de pruebas en el árbol de fuentes inspeccionado.

## Problemas que debe resolver el diseño

1. El núcleo recibe un `Guild` de Discord mediante `BotContext`; cambiar transporte o simular herramientas requiere conocer Discord.
2. El registro une todas las herramientas sin una política de autorización central ni detección de nombres duplicados.
3. Restricciones como no mencionar a todos dependen del prompt. Deben cumplirse también al enviar mensajes.
4. El historial se lee y se modifica en paralelo; invocaciones simultáneas pueden mezclar el contexto. Faltan orden y deduplicación por mensaje.
5. El límite de pasos no limita por sí solo el número de herramientas, el gasto ni la duración total. Un paso puede incluir varias llamadas.
6. Recordatorios: lectura de pendientes y envío sin adquisición exclusiva; varias réplicas podrían duplicar avisos. Se eliminan incluso ante fallo de envío.
7. Memoria compartida por servidor sin un modelo suficiente de procedencia y visibilidad para respetar el aislamiento acordado entre canales.

## Arquitectura propuesta

Un monolito modular sobre la base actual. Mantener inicialmente NestJS, TypeScript, AI SDK, Redis y PostgreSQL; evitar cambiar infraestructura al mismo tiempo que los límites del sistema. Configurar un único servidor permitido, sin un sistema de tenants ni configuración multiservidor.

Flujo: mención → adaptador Discord → caso de uso de conversación → catálogo filtrado por permisos → bucle del agente → ejecutor autorizado de herramientas → respuesta Discord.

Módulos sugeridos:

- `discord`: eventos, normalización de identidades, permisos efectivos, lectura de mensajes, presencia, voz y envío. Implementa interfaces del núcleo; el núcleo no importa discord.js.
- `conversation`: invocaciones, identidad del solicitante, contexto por servidor/canal/hilo, orden, deduplicación e historial conversacional.
- `agent`: preparación del contexto, selección de herramientas, ciclo modelo/herramientas y presupuestos por turno.
- `tools`: definiciones y catálogo; ejecutor común para autorización, validación, límites y trazas.
- `capabilities`: implementaciones agrupadas por Discord, web, contenido, memoria y recordatorios.
- `memory`: hechos persistentes con sujeto, fuente, ámbito de visibilidad, fechas y operaciones de corrección/borrado según política acordada.
- `jobs`: entrega de recordatorios y cumpleaños; adquisición exclusiva, estado de entrega y reintentos acotados. No prometer entrega exactamente una vez a través de Discord.
- `infrastructure`: clientes externos, repositorios, configuración y observabilidad.

El harness sería la combinación de catálogo, ejecutor, contexto y control del bucle. Reutilizar el bucle del SDK y personalizar nuestras políticas. No es necesario crear un framework ni un servicio separado.

### Evaluación del SDK

Recomendación: conservar AI SDK. El repositorio ya utiliza herramientas tipadas y un bucle limitado; el SDK admite control del bucle y cancelación. OpenAI Agents SDK es una alternativa válida con bucle, herramientas, handoffs, guardrails y trazas integradas, pero no se necesita coordinación entre agentes para el alcance acordado. Cambiar de biblioteca no constituye evidencia de una mejora de latencia.

Encapsular la interacción con el modelo detrás de una interfaz propia y hacer que todas las herramientas pasen por el ejecutor de la aplicación. Así será posible sustituir el SDK sin redefinir permisos, memoria ni capacidades. No se ha realizado un benchmark y no se promete que una alternativa sea más rápida.

## Contrato de herramientas

Cada herramienta declara nombre único, descripción, esquema de entrada/salida, capacidad requerida, alcance, efecto de lectura/escritura, límites y ejecutor. El catálogo rechaza duplicados y permite agregar una herramienta mediante su módulo sin modificar el bucle.

El ejecutor obtiene identidad y ámbito desde la invocación autenticada, no de parámetros elegidos por el modelo. Antes de cada ejecución comprueba habilitación, permisos efectivos del bot y del solicitante y visibilidad del resultado en el canal de respuesta. Revalida los permisos al entregar trabajos diferidos. Ocultar una herramienta del catálogo no sustituye estas comprobaciones.

Resultados estructurados distinguen éxito, permiso denegado, indisponibilidad, datos incompletos y error transitorio. Nunca presentar una lista parcial como completa o una presencia desconocida como desconexión.

## Catálogo inicial propuesto

| Capacidad | Herramientas | Restricción propuesta |
| --- | --- | --- |
| Miembros | `members.search`, `members.list`, `members.get` | Servidor actual, paginación, desambiguar por ID |
| Presencia y voz | `presence.list`, `voice.list` | Presencia actual de miembros; voz como consulta distinta; señalar cobertura incompleta |
| Mensajes | `messages.history` | Solo canal/hilo actual, límites de páginas y permisos efectivos |
| Web | `web.search`, `web.read` | Lectura pública; validar URL, redirecciones y destino de red para impedir acceso a redes privadas |
| Noticias | `news.search` | Periodo explícito, fuentes, fecha de publicación y fecha del hecho cuando se conozca |
| Contenido | `content.phrase`, `content.image` | Recursos existentes; preservar comportamiento |
| Memoria | `memory.search`, `memory.save`, `memory.forget` | Guardado explícito, ámbito de canal, modificación/borrado por autor o propietario; añadir operación de actualización bajo la misma política |
| Recordatorios | `reminders.create` | Del solicitante, con destino y zona horaria validados |

Responder en el canal y enviar avisos ya programados son operaciones explícitas del sistema. No ofrecer envío arbitrario de mensajes como herramienta genérica. Límite confirmado: sin expulsiones, borrado de mensajes ni gestión de roles. Tampoco se propone ejecución de código ni acceso genérico a archivos. El bot necesita permisos técnicos mínimos para leer y responder; «sin privilegios» significa sin facultades administrativas o de moderación.

## Eficiencia y fiabilidad

- Exponer las herramientas autorizadas y disponibles. Con el catálogo pequeño, evitar un clasificador adicional en cada petición; introducir descubrimiento por familias cuando el crecimiento lo justifique, sin ocultar capacidades necesarias por un filtro rígido de intención.
- Saludos y conversación casual sin consultas externas. Dependencias secuenciales; lecturas independientes en paralelo. Escrituras con claves de idempotencia.
- Presupuestos independientes de pasos, llamadas, tokens, duración y resultados. Cinco pasos y ocho llamadas son techos, no objetivos que consumir. Incluir subllamadas, colas y reintentos en el presupuesto de tiempo, sin reiniciarlo por paso.
- Cachés breves para miembros, búsquedas y presencia, con fecha de consulta. Límites de peticiones por usuario y servidor; respetar rate limits de Discord.
- Fuentes web y mensajes históricos son datos no confiables: no conceden permisos ni modifican instrucciones. La autorización se aplica aunque el modelo solicite una acción inducida por esos textos.
- Trazas por invocación con herramientas, decisiones de autorización, duración, consumo y errores; evitar guardar cuerpos completos de mensajes por defecto.
- Respuestas con fuentes para actualidad y motivos útiles cuando falten permisos o servicios. Evitar sustituir todos los fallos por una frase de confusión.

### Diseño para la latencia solicitada

Medir desde la recepción de la invocación hasta la respuesta visible enviada a Discord; el indicador de escritura no cuenta como respuesta. Objetivos acordados: menos de tres segundos para tareas sencillas y menos de quince para tareas con herramientas. Son requisitos que deben validarse con modelo y servicios reales, no garantías obtenidas por cambiar de SDK ni por usar pruebas simuladas.

- Ruta directa para peticiones inequívocas de frases/fotos y otras respuestas deterministas; no introducir una clasificación adicional mediante otro modelo.
- Una sola generación, contexto acotado por mensajes y tamaño y sin enriquecimiento semántico automático para conversación sencilla. Recuperar recuerdos cuando la petición o el contexto lo necesiten.
- Resolver miembros/presencias desde datos recientes cuando estén disponibles; señalar desconocido o cobertura parcial. Consultas externas independientes en paralelo; limitar cadenas de búsqueda/lectura/generación.
- Detener procesamiento externo cerca de los doce segundos y reservar el margen restante para una respuesta parcial o un aviso de fallo antes de quince. Propagar cancelación, no iniciar nuevas escrituras fuera de presupuesto y no confirmar escrituras cuyo estado sea incierto.
- Ningún SDK puede garantizar que Discord entregue un mensaje en ese plazo ante una caída de red. Registrar por separado tiempo interno, peticiones externas y envío; probar escenarios nominales y fallos.
- Evaluar escenarios sencillos y con herramientas por separado, medir p50/p95 y proporción que excede el objetivo. No considerar aprobada la latencia porque haya pasado una sola petición rápida.

## Reestructuración de la memoria existente

La migración de esquema y datos forma parte de la implementación. No basta con crear herramientas nuevas y dejar los recuerdos actuales inaccesibles indefinidamente.

Nuevo contrato de almacenamiento:

- Identificador estable, contenido, clave opcional y categoría.
- Servidor y canal de destino obligatorios para toda recuperación conversacional.
- Autor original, sujeto y mensaje fuente separados. Autor y mensaje pueden ser desconocidos en registros importados; no rellenarlos con identidades o mensajes inventados.
- Origen `explicit_request` o `legacy_import`, fechas originales, fecha de importación y procedencia de la operación de migración.
- Autor original o propietario como únicos modificadores autorizados. Cuando el autor antiguo sea desconocido, la gestión corresponde al propietario; no atribuirle por ello la autoría de la afirmación.
- Búsqueda y mutaciones siempre acotadas por servidor/canal. Identificadores para modificar/borrar; una clave compartida no permite sobrescribir datos de otro autor.
- Embedding y versión del modelo como datos derivados; conservar el vector existente si es compatible. El borrado autorizado incluye índices, cachés y cualquier copia histórica de aplicación, sin mantener una versión recuperable por el bot.

Procedimiento previsto:

1. Preparar migración aditiva y copia recuperable, sin eliminar la estructura anterior antes de comprobar la nueva.
2. Ejecutar una simulación con conteos, campos ausentes, colisiones y canales de destino. No imprimir contenido personal en logs de diagnóstico.
3. Importar de forma idempotente, manteniendo IDs, contenido y fechas. Marcar la procedencia como importada y el autor original como desconocido cuando no exista.
4. Asignar `GNOMOS_CHANNEL_ID` como destino común de importación, según aprobación del propietario. Esto define dónde se podrán consultar los recuerdos; no afirma que allí se publicaron originalmente. Validar que el canal pertenece al servidor configurado antes de aplicar la migración.
5. Verificar conservación de registros y aislamiento del canal, y comprobar que una segunda ejecución no duplica ni modifica la procedencia.
6. Activar el repositorio nuevo y retirar la recuperación global y el guardado automático. La migración se considera terminada cuando los recuerdos importados son consultables en su destino autorizado.

Una nueva petición de guardado será explícita; las importaciones antiguas se mostrarán como tales y no como prueba de consentimiento o autoría que el esquema previo no registra. No se ejecutará una migración contra datos reales como efecto de arrancar el bot.

## Migración por fases

1. Inventariar escenarios de compatibilidad: mención, conversación, imágenes adjuntas, frases, fotos, miembros, voz, búsqueda, memoria, recordatorios y cumpleaños. Registrar ejemplos y resultados esperados.
2. Crear pruebas de caracterización y límites de autorización con proveedores simulados. Mantener la ruta actual mientras se extraen interfaces y contexto independiente de Discord.
3. Introducir catálogo y ejecutor central; migrar las herramientas existentes sin cambiar su comportamiento visible salvo límites acordados.
4. Incorporar historial real, presencias, lectura web y noticias. Probar restricciones de canales/hilos, paginación, indisponibilidad y fuentes.
5. Reestructurar esquema y migrar los recuerdos existentes según el procedimiento anterior, con simulación, conservación de datos y comprobación del aislamiento; evolucionar trabajos programados con deduplicación y pruebas de reinicio/concurrencia.
6. Activar la ruta nueva en un canal de prueba mediante configuración. Comparar escenarios, latencia y consumo; extender con posibilidad de volver a la ruta anterior. Eliminar la anterior tras aceptar equivalencia.

Criterios de aceptación: una mención sigue funcionando; mensajes sin invocación no producen respuestas; añadir una herramienta no exige editar el bucle; un usuario no puede revelar mensajes o recuerdos fuera de su ámbito; ninguna escritura se ejecuta sin autorización; los límites detienen bucles; fallos externos no se convierten en afirmaciones inventadas; concurrencia y reintentos no crean acciones duplicadas evitables. La migración conserva recuerdos y restringe sus consultas al destino definido. Se comprueban casos sencillos y consultas con herramientas contra los objetivos de tres y quince segundos, separando respuestas útiles de respuestas de fallo para que un timeout no cuente como éxito funcional.

## Cierre de decisiones

Primera ronda resuelta: uso personal en un servidor, historial de canal, sin moderación, memoria explícita, web pública de lectura y actividad entendida como presencia.

Segunda ronda resuelta: invocación explícita, contexto compartido del canal, propiedad de recuerdos, límites de historial/retención, avisos, menciones y zona horaria, arquitectura gradual y personalidad. El propietario redujo el objetivo de treinta segundos a menos de quince, con menos de tres en tareas sencillas; no interpretar como aceptados los treinta segundos.

Tercera ronda resuelta: el propietario exige reestructurar la memoria antigua dentro del refactor y acepta la respuesta parcial al agotarse el tiempo y la aclaración de identidades/conflictos. Queda descartado dejar la migración pendiente de una revisión manual indefinida.

Confirmación final recibida: diseño aprobado, reescritura completa autorizada y `GNOMOS_CHANNEL_ID` aceptado como destino común de importación. La entrevista está cerrada. La especificación de implementación sintetiza estas decisiones sin reabrirlas.

## Fuentes oficiales consultadas

- [Discord: Gateway e intents](https://docs.discord.com/developers/events/gateway): miembros, contenido y presencias tienen requisitos distintos; algunos intents son privilegiados y requieren habilitación y, cuando corresponda, aprobación.
- [Discord: permisos](https://docs.discord.com/developers/topics/permissions): permisos por servidor, roles y sobrescrituras por canal; el acceso del bot no equivale al acceso del solicitante.
- [Discord: estados de conexión](https://support.discord.com/hc/en-us/articles/227779547-Changing-Online-Status): invisible aparece desconectado aunque la persona siga usando Discord.
- [AI SDK: control del bucle](https://ai-sdk.dev/docs/agents/loop-control): control de pasos y herramientas. La documentación publicada actualmente apunta a una versión mayor posterior a la dependencia 6.x del repositorio; verificar las APIs contra la versión instalada al implementar, sin actualizarla implícitamente.
- [AI SDK: configuración y cancelación](https://ai-sdk.dev/docs/ai-sdk-core/settings): señales de cancelación y control de reintentos; verificar compatibilidad con la dependencia instalada.
- [OpenAI: Agents SDK](https://developers.openai.com/api/docs/guides/agents/sdk) y [observabilidad](https://developers.openai.com/api/docs/guides/agents/integrations-observability): alternativa con bucle y trazas integradas. La recomendación de conservar el SDK actual es una decisión de diseño basada en el alcance del bot, no una afirmación de superioridad de rendimiento.
