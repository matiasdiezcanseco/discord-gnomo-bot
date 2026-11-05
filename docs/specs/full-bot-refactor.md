## Problem Statement

Los miembros del servidor quieren seguir conversando con Gnomo mediante una invocación y obtener respuestas útiles, con su personalidad habitual, sobre conversaciones del canal, miembros conectados e información actual de internet. Hoy esas capacidades están incompletas: el historial solo guarda intercambios con el bot, no existe consulta de presencias ni lectura independiente de páginas y las herramientas carecen de una política central de ejecución.

La implementación también dificulta incorporar capacidades de manera ordenada: el núcleo conoce objetos de Discord, se exponen todas las herramientas sin un contrato suficiente de permisos y disponibilidad, y se consulta memoria semántica incluso cuando la petición no la necesita. Los recuerdos no registran autor ni canal y los recordatorios pueden perderse ante errores de envío o duplicarse si hay ejecuciones concurrentes.

Se necesita una refactorización completa, con libertad de reescritura, que preserve las capacidades aprobadas y establezca límites claros, herramientas ampliables y respuestas ágiles. El código actual es una guía funcional; su estructura no es una restricción de compatibilidad.

## Solution

Construir un monolito modular para un único servidor personal. Gnomo responde solo a una invocación, utiliza contexto anterior del mismo canal y elige las herramientas necesarias para cada petición. Puede consultar miembros y su presencia visible, participantes en voz, historial del canal, páginas públicas y noticias; conserva frases, fotos, comprensión de imágenes adjuntas, recuerdos explícitos, recordatorios y cumpleaños.

Un harness propio reúne contexto, catálogo, ejecutor de herramientas y presupuesto del agente. El modelo solicita herramientas, pero el código valida cada ejecución y cada efecto. No se conceden facultades administrativas, navegación autenticada ni envío arbitrario de mensajes.

Los recuerdos nuevos se guardan por petición explícita y se limitan al canal. Los existentes se reestructuran y migran al canal configurado como GNOMOS_CHANNEL_ID, conservando su contenido y diferenciando origen importado de procedencia histórica conocida.

El objetivo es responder en menos de tres segundos a tareas sencillas y en menos de quince a peticiones con herramientas. Se corta el procesamiento externo cerca del segundo doce y, si hace falta, se entregan resultados parciales verificables o un aviso útil dentro del margen restante.

## User Stories

1. Como miembro del servidor, quiero invocar a Gnomo mediante una mención, para conversar como lo hago actualmente.
2. Como miembro del servidor, quiero que Gnomo no responda a mensajes sin invocación, para que no interrumpa las conversaciones.
3. Como miembro del servidor, quiero que Gnomo utilice mensajes anteriores del canal, para no repetir el contexto en cada petición.
4. Como miembro del servidor, quiero que Gnomo distinga a los autores de los mensajes, para que no atribuya a una persona lo que dijo otra.
5. Como participante de un hilo, quiero que su contexto permanezca separado, para que no se mezclen conversaciones del canal padre u otros hilos.
6. Como miembro del servidor, quiero consultar hasta 200 mensajes del canal mediante una petición concreta, para recuperar conversaciones más allá del contexto reciente.
7. Como miembro del servidor, quiero que el bot respete los permisos de lectura e historial, para que no revele información inaccesible para mí.
8. Como miembro del servidor, quiero que las consultas de un canal no utilicen mensajes ni recuerdos de otro, para mantener las conversaciones en su ámbito.
9. Como miembro del servidor, quiero que mis invocaciones se procesen sin duplicar el mensaje actual en el contexto, para obtener respuestas coherentes.
10. Como miembro del servidor, quiero que invocaciones simultáneas mantengan autores y respuestas correctamente asociados, para que no se mezclen peticiones.
11. Como miembro del servidor, quiero que repetir la entrega de un evento no duplique acciones del bot, para evitar avisos o escrituras repetidas.
12. Como miembro del servidor, quiero pedir una frase de Gnomo, para conservar el contenido habitual del grupo.
13. Como miembro del servidor, quiero pedir una foto de la colección existente, para conservar esa función sin confundirla con generación de imágenes.
14. Como miembro del servidor, quiero adjuntar una imagen a mi invocación, para que Gnomo pueda utilizarla al responder.
15. Como miembro del servidor, quiero que Gnomo mantenga su identidad y humor, para que siga sintiéndose como el mismo bot del grupo.
16. Como miembro del servidor, quiero respuestas breves por defecto y más detalle cuando lo solicite, para recibir información con una extensión adecuada.
17. Como miembro del servidor, quiero que respuestas extensas conserven fuentes y enlaces completos, para poder verificar sus afirmaciones.
18. Como miembro del servidor, quiero buscar miembros por nombre o apodo, para identificar a la persona a la que me refiero.
19. Como miembro del servidor, quiero consultar quién pertenece al servidor, para conocer sus miembros aunque no estén conectados.
20. Como miembro del servidor, quiero consultar quién está conectado en ese momento, para saber quién aparece disponible en Discord.
21. Como miembro del servidor, quiero distinguir en línea, ausente y no molestar, para entender la presencia visible de cada miembro.
22. Como miembro del servidor, quiero que el bot diferencie aparece desconectado de presencia desconocida, para no recibir conclusiones que los datos no sostienen.
23. Como miembro del servidor, quiero consultar participantes en voz como una capacidad independiente, para saber quién está en llamada sin confundirlo con presencia en línea.
24. Como miembro del servidor, quiero que los listados incompletos se identifiquen como tales, para no creer que faltan miembros cuando faltan datos.
25. Como miembro del servidor, quiero que Gnomo aclare nombres ambiguos antes de mencionar a alguien, para evitar etiquetar a la persona equivocada.
26. Como miembro del servidor, quiero pedir una mención individual de forma explícita, para dirigirme a un amigo a través de la respuesta del bot.
27. Como miembro del servidor, quiero que el bot no emita menciones masivas ni de roles, para evitar notificaciones no solicitadas.
28. Como miembro del servidor, quiero buscar información pública actual en internet, para obtener respuestas que no dependan solo del conocimiento del modelo.
29. Como miembro del servidor, quiero pedir la lectura de una página pública, para consultar su contenido dentro de la conversación.
30. Como miembro del servidor, quiero consultar noticias por tema y periodo, para recibir información reciente pertinente.
31. Como miembro del servidor, quiero fuentes y fechas en respuestas de actualidad, para distinguir información publicada recientemente de hechos antiguos.
32. Como miembro del servidor, quiero que Gnomo reconozca una fuente inaccesible o una búsqueda sin resultados, para no recibir información inventada.
33. Como miembro del servidor, quiero que el contenido de una página o mensaje histórico no pueda autorizar acciones nuevas, para mantener los límites del bot.
34. Como miembro del servidor, quiero que leer una URL no permita acceder a redes privadas o servicios internos, para que la navegación permanezca limitada a internet público.
35. Como miembro del servidor, quiero pedir explícitamente que Gnomo recuerde una información, para reutilizarla en futuras conversaciones del canal.
36. Como miembro del servidor, quiero que una conversación casual no cree recuerdos permanentes, para decidir qué información conservar.
37. Como miembro del servidor, quiero consultar recuerdos del canal al que tengo acceso, para recuperar información que el grupo pidió guardar allí.
38. Como autor del recuerdo, quiero corregir o borrar lo que pedí guardar, para mantener esa información actualizada.
39. Como propietario del bot, quiero administrar recuerdos del canal, para resolver correcciones y solicitudes de borrado cuando corresponda.
40. Como miembro del servidor, quiero que otro usuario no sobrescriba mis recuerdos, para conservar la atribución y el control acordados.
41. Como miembro del servidor, quiero distinguir el autor del recuerdo de su sujeto, para saber quién aportó una afirmación sobre otra persona.
42. Como miembro del servidor, quiero que recuerdos contradictorios se presenten con atribución, para no confundir una afirmación del grupo con un hecho verificado.
43. Como miembro del servidor, quiero que Gnomo aclare qué recuerdo modificar cuando hay varias coincidencias, para evitar cambios accidentales.
44. Como miembro del servidor, quiero que borrar un recuerdo lo retire también de la recuperación y las cachés, para que el bot no siga reutilizándolo.
45. Como propietario del bot, quiero migrar los recuerdos existentes al nuevo esquema durante el refactor, para conservarlos sin mantener indefinidamente una ruta de memoria antigua.
46. Como propietario del bot, quiero que esos recuerdos se consulten en GNOMOS_CHANNEL_ID, para darles un destino explícito compatible con el aislamiento por canal.
47. Como miembro del servidor, quiero que un recuerdo importado no invente su autor ni su mensaje de origen, para conocer los límites de su procedencia.
48. Como propietario del bot, quiero simular y repetir la migración sin duplicar ni perder recuerdos, para comprobar la transición antes de aplicarla a datos reales.
49. Como miembro del servidor, quiero crear un recordatorio propio con lenguaje natural, para recibir un aviso en el canal donde lo pedí.
50. Como miembro del servidor, quiero que Gnomo use America/Lima y aclare tiempos ambiguos, para que el aviso tenga una fecha comprensible.
51. Como miembro del servidor, quiero que el bot confirme un recordatorio solo cuando esté guardado, para no confiar en una acción que falló.
52. Como miembro del servidor, quiero que recordatorios sobrevivan a reinicios y tengan reintentos acotados, para no perder avisos ante fallos transitorios.
53. Como miembro del servidor, quiero que ejecuciones concurrentes no envíen avisos duplicados evitables, para que los recordatorios no generen ruido.
54. Como miembro del servidor, quiero seguir recibiendo los cumpleaños existentes en el canal acordado, para conservar esa costumbre del grupo.
55. Como miembro del servidor, quiero que avisos diferidos respeten los permisos al enviarse, para que no se publiquen donde ya no corresponda.
56. Como miembro del servidor, quiero que Gnomo no envíe mensajes privados ni mensajes a canales arbitrarios, para mantener la interacción dentro del alcance acordado.
57. Como miembro del servidor, quiero respuestas sencillas en menos de tres segundos, para que conversar resulte ágil.
58. Como miembro del servidor, quiero respuestas a consultas con herramientas en menos de quince segundos, para no quedar esperando indefinidamente.
59. Como miembro del servidor, quiero resultados parciales verificables o una explicación cuando se agote el tiempo, para conocer lo que pudo y no pudo completarse.
60. Como miembro del servidor, quiero que el indicador de escritura no sustituya la respuesta, para que el objetivo de rapidez se mida sobre información visible.
61. Como miembro del servidor, quiero que el bot explique cuando no dispone de una herramienta, para saber por qué una capacidad no está disponible.
62. Como miembro del servidor, quiero que las tareas sencillas no disparen búsquedas o consultas de memoria innecesarias, para reducir espera y consumo.
63. Como propietario del bot, quiero una lista explícita de capacidades autorizadas, para controlar qué puede ejecutar Gnomo.
64. Como propietario del bot, quiero que todas las herramientas pasen por el mismo ejecutor, para que sus permisos no dependan del prompt ni de la buena elección del modelo.
65. Como mantenedor, quiero incorporar herramientas mediante módulos con contratos claros, para ampliar el bot sin modificar su bucle de conversación.
66. Como mantenedor, quiero que el núcleo no dependa de objetos de Discord ni de un SDK concreto, para poder probarlo y sustituir adaptadores.
67. Como propietario del bot, quiero presupuestos de pasos, llamadas y tiempo por invocación, para evitar bucles y consumo descontrolados.
68. Como mantenedor, quiero trazas de decisiones, duración, herramientas y errores sin copiar conversaciones completas por defecto, para diagnosticar problemas con datos mínimos.
69. Como propietario del bot, quiero comprobar el comportamiento nuevo en un canal de prueba y disponer de una vuelta atrás, para sustituir la aplicación sin perder funciones acordadas.
70. Como mantenedor, quiero pruebas sobre respuestas y efectos externos con persistencia real donde sea necesaria, para que la validación sobreviva a una reescritura interna.

## Implementation Decisions

- **Libertad de reescritura:** se autoriza sustituir por completo la implementación. Preservar los comportamientos aprobados, no los nombres, interfaces, directorios o dependencias internas del código anterior. Las diferencias intencionadas incluyen memoria solo explícita, aislamiento por canal, controles de ejecución y nueva política de latencia.
- **Arquitectura:** monolito modular, un proceso inicial y un único servidor permitido. Mantener NestJS, TypeScript, Redis y PostgreSQL. Conservar AI SDK inicialmente; encapsularlo mediante un adaptador de modelo para que pueda sustituirse sin cambiar las políticas del bot. No cambiar de SDK ni de versión mayor solo por presumir mejoras de latencia.
- **Responsabilidades:** separar adaptador Discord; conversación e invocaciones; agente y presupuestos; catálogo y ejecutor; capacidades de Discord, web y contenido; memoria; trabajos programados; e infraestructura. Los contratos del núcleo usan datos normalizados, no objetos vivos del cliente Discord.
- **Contrato de invocación:** identidad del mensaje, servidor, canal o hilo, solicitante, contenido, fecha y adjuntos. Los ámbitos e identidades se obtienen del evento autenticado, nunca de argumentos elegidos por el modelo. Ignorar eventos de otros bots y de servidores no configurados. Una respuesta sin mención explícita no activa otra conversación.
- **Contexto:** obtener hasta 30 mensajes recientes accesibles del canal o hilo, con autores e IDs conservados, además de la invocación actual una sola vez. Permitir consultas explícitas hasta 200 mensajes con paginación acotada. Mantener también un límite de tamaño de contexto; señalar recortes o cobertura parcial. Los hilos son contextos independientes.
- **Historial y caché:** no crear un archivo permanente de mensajes ambientales. La caché conversacional tiene una retención máxima de 24 horas por mensaje y un número acotado de entradas; no prolongar indefinidamente mensajes antiguos solo porque el canal siga activo. Volver a comprobar permisos antes de reutilizar información almacenada.
- **Concurrencia:** deduplicar por identidad de evento, ordenar las actualizaciones de contexto por canal y asociar cada salida a su invocación. La espera en cola y los reintentos consumen el mismo presupuesto temporal. Una escritura usa una clave idempotente; un segundo procesamiento no debe duplicar sus efectos evitables.
- **Catálogo:** cada herramienta declara nombre único, descripción, esquemas de entrada y salida, capacidad requerida, alcance, disponibilidad, lectura o escritura y límites. Rechazar nombres duplicados. Registrar herramientas mediante módulos sin editar el bucle del agente.
- **Ejecutor:** comprobar habilitación, pertenencia al servidor, permisos efectivos del bot y solicitante, canal de destino, parámetros, presupuesto y política de efectos antes de cada llamada. Ocultar una herramienta no sustituye su autorización. Las rutas rápidas usan el mismo ejecutor para cualquier capacidad o efecto equivalente.
- **Resultados de herramientas:** distinguir éxito, ausencia de resultados, permiso denegado, indisponibilidad, cobertura parcial, tiempo agotado y error transitorio. Incluir procedencia y momento de consulta cuando sea relevante. No convertir una lista incompleta en una lista total ni una escritura de estado incierto en una confirmación.
- **Selección eficiente:** el modelo puede encadenar herramientas cuando la petición lo necesita. No introducir un clasificador LLM adicional en cada turno. Para el catálogo pequeño, exponer las capacidades autorizadas y disponibles; añadir descubrimiento por familias cuando su tamaño lo justifique, sin filtros rígidos que impidan resolver peticiones válidas.
- **Capacidades Discord:** búsqueda y detalle de miembros, lista paginada de miembros, consulta de presencia actual y participantes en voz, y consulta del historial actual. Resolver identidades por ID y pedir aclaración ante nombres ambiguos. No exponer presencia como lista de actividad de escritura ni voz como prueba de conexión visible. Filtrar datos de canales de voz según permisos del solicitante.
- **Presencias:** habilitar y comprobar los intents necesarios para miembros, presencias y lectura de contenido. Contar online, idle y dnd como conectados y devolver el estado concreto. Offline significa aparece desconectado; invisible no se puede distinguir. Sin cobertura de presencias, devolver desconocido o incompleto, no inferir desconexión por ausencia de caché.
- **Web y noticias:** búsqueda pública, lectura de URL pública y búsqueda de noticias con periodo. Entregar título, URL, contenido relevante, fecha de publicación y fecha del hecho cuando se conozca; distinguirlas sin inventarlas. Validar protocolos, resolución de destino y cada redirección; impedir acceso a redes privadas, loopback, link-local y servicios de metadatos. Acotar bytes, tiempo y tipos de contenido. Sin sesiones autenticadas, formularios ni operaciones sobre cuentas.
- **Contenido externo:** mensajes históricos, recuerdos y páginas son datos, no instrucciones privilegiadas. Una instrucción embebida en ellos no autoriza escrituras, cambio de alcance ni nuevas herramientas.
- **Contenido del grupo:** mantener frases y fotos existentes. La foto aleatoria no se presenta como imagen generada. Mantener comprensión de imágenes adjuntas a la invocación; acceso a URLs y adjuntos con controles de tamaño, tipo y destino equivalentes a la política de lectura externa.
- **Personalidad y entrega:** mantener identidad y humor de Gnomo con respuestas breves por defecto y detalle cuando haga falta. Si el contenido excede la capacidad de un mensaje de Discord, dividirlo en entregas legibles sin cortar enlaces o fuentes ni exceder límites de la plataforma. Respuestas y errores informativos sustituyen el fallo genérico de confusión cuando se conoce el motivo.
- **Menciones:** aplicar la política en el envío, no solo mediante sanitización textual. Desactivar menciones masivas y de roles; permitir únicamente IDs individuales resueltos y solicitados explícitamente o asociados a un aviso acordado. Nombres encontrados o texto generado por el modelo no conceden por sí solos permiso de notificar.
- **Memoria nueva:** guardar únicamente ante una petición explícita actual. Registrar ID estable, contenido, clave opcional, categoría, servidor, canal, autor del recuerdo, sujeto cuando se conozca, mensaje fuente, origen y fechas. La petición explícita debe ser del solicitante actual, no una orden citada en un mensaje histórico o página. Separar autor de sujeto.
- **Permisos de memoria:** consultas solo dentro del canal actual y con permisos vigentes. Actualizaciones y borrados por autor del recuerdo o propietario del bot; obtener el identificador del propietario de una configuración confiable validada, no del nombre visible ni del modelo. Resolver ambigüedades antes de modificar; impedir que una clave repetida permita sobrescribir recuerdos ajenos.
- **Conflictos y borrado:** atribuir afirmaciones contradictorias. Las actualizaciones autorizadas conservan procedencia sin inventar verificación. El borrado elimina el contenido recuperable, su índice derivado y sus copias en cachés de aplicación; no conservar una versión histórica accesible al agente. Los registros de diagnóstico no deben reintroducir ese contenido.
- **Esquema y migración de memoria:** reestructurar esquema y datos dentro del refactor, mediante migración aditiva, simulación previa y operación repetible. Conservar IDs, contenido y fechas; reutilizar embeddings compatibles y regenerar solo los que lo requieran. Marcar los registros antiguos como legacy_import, con autor y fuente desconocidos cuando falten, y asignarlos al servidor configurado y GNOMOS_CHANNEL_ID. Este canal es su nuevo destino de consulta, no un origen histórico reconstruido. Solo el propietario gestiona importaciones de autor desconocido.
- **Validación de migración:** comprobar pertenencia del canal al servidor, registros sin servidor y conflictos con un servidor distinto, colisiones, conteos y recuperación. No reasignar silenciosamente datos que pertenecen a un servidor diferente. Mantener una copia recuperable para la transición, no eliminar el almacenamiento anterior antes de verificar el nuevo y no ejecutar cambios de datos reales como efecto implícito del arranque.
- **Recordatorios y cumpleaños:** conservar recordatorios propios en el canal de origen y cumpleaños existentes, con America/Lima como zona horaria. Pedir aclaración cuando el tiempo no sea inequívoco; persistir antes de confirmar. No crear un mecanismo de envío arbitrario o privado. Preservar los avisos pendientes al cambiar de implementación.
- **Entrega diferida:** adquisición exclusiva o equivalente para reclamar avisos, estado de entrega, idempotencia y reintentos acotados para errores transitorios. Revalidar permisos y destino al enviar, también en hilos compatibles con la política de origen. Un fallo transitorio no borra silenciosamente el aviso; un fallo permanente queda registrado de forma diagnosticable. No prometer entrega exactamente una vez a través de Discord ni retrasos inferiores a un plazo no acordado.
- **Latencia y presupuestos:** medir desde la recepción de una invocación hasta la respuesta visible enviada, incluyendo colas, subllamadas y reintentos. Objetivos: menos de tres segundos para tareas sencillas y menos de quince para consultas con herramientas. Máximos de cinco pasos y ocho llamadas totales; un paso puede contener varias herramientas. Añadir límites configurables de tokens, resultados y concurrencia sin tratarlos como cantidades que deban consumirse.
- **Ruta rápida:** resolver peticiones inequívocas de frases o fotos sin modelo; evitar búsqueda de memoria semántica automática para un saludo. La conversación sencilla requiere como máximo una generación normal; los límites de tiempo se comprueban con servicios reales, no se deducen del número de llamadas.
- **Agotamiento del tiempo:** propagar cancelación y detener trabajo externo cerca del segundo doce; reservar el resto para respuesta parcial verificable con fuentes ya obtenidas o aviso claro. No continuar silenciosamente en segundo plano ni iniciar escrituras nuevas fuera de presupuesto. Cancelar no revierte un efecto externo ya confirmado; distinguir resultado confirmado, fallido o incierto y no reintentar a ciegas.
- **Observabilidad y configuración:** trazas por invocación con capacidades solicitadas y ejecutadas, autorización, duración, consumo, cobertura y errores. No guardar cuerpos completos de mensajes ni credenciales por defecto. Documentar configuración mínima, permisos e intents, capacidades opcionales y diagnóstico de dependencias caídas. Respetar rate limits externos y no consumir el presupuesto en reintentos repetidos.
- **Transición:** construir la implementación nueva por capacidades detrás de un punto de entrada controlado, sin obligar a conservar módulos internos antiguos. Caracterizar primero, migrar y probar, activar el piloto y comparar antes de sustituir la ruta anterior. Habilitar un único receptor/ejecutor activo por evento para evitar doble respuesta. Diseñar la vuelta atrás con compatibilidad de datos; no convertir la retirada de código antiguo en una razón para perder datos o avisos pendientes.

## Testing Decisions

- **Frontera principal confirmada por el propietario:** una invocación o evento normalizado entra al caso de uso y se observan respuesta, notificaciones y efectos persistidos. Usar esta frontera de aplicación para la mayor parte de la suite, sin probar métodos privados, prompts exactos, nombres de clases o el árbol interno de módulos.
- **Aprovechar lo existente:** la recepción actual de mensajes y su orquestación proporcionan el punto de partida para caracterización. El contrato normalizado sustituye el acoplamiento a objetos de Discord; la reescritura no debe preservar ese acoplamiento para conservar una prueba. No se encontraron pruebas previas ni un script de pruebas: no hay una suite equivalente que reutilizar ni un historial de pruebas aprobadas que pueda darse por hecho.
- **Dependencias controladas:** modelo programable, cliente Discord simulado y respuestas web simuladas. Inyectar reloj y cancelación para observar vencimientos sin esperas reales. Las simulaciones controlan entradas y fallos, pero no reemplazan la validación de consultas o transacciones reales.
- **Persistencia real donde importa:** usar PostgreSQL con la extensión vectorial requerida y Redis aislados para pruebas de migración, consultas por ámbito, caducidad, idempotencia y reclamación concurrente de avisos. Incluir reinicios y dos reclamadores simultáneos. No ejecutar estos casos contra producción.
- **Activación:** mensajes ambientales, otras aplicaciones y otros servidores no generan respuestas ni acciones. Una invocación válida sí lo hace. La recepción de un mensaje ambiental no impide que forme parte del historial accesible de una invocación posterior.
- **Contexto:** incluir autores correctos, invocación una sola vez, 30 mensajes por defecto, tope de 200 en consulta explícita, paginación parcial, límites de tamaño, separación de hilos y cambios de permisos. Probar ausencia de filtraciones con dos canales y datos deliberadamente parecidos.
- **Herramientas y seguridad:** permitir y denegar acciones por sus efectos observables, incluidas rutas rápidas y trabajos diferidos. Probar argumentos maliciosos que intentan cambiar servidor, canal, solicitante o propietario. Introducir órdenes falsas en web, recuerdos e historial y comprobar que no conceden autoridad.
- **Presencias e identidad:** miembros presentes y ausentes de caché, estados online/idle/dnd/offline, datos incompletos, intent no disponible, homónimos y consultas de voz con canales no visibles. No afirmar desconexión cuando solo faltan datos.
- **Web:** fuentes con fechas distintas, búsqueda sin resultados, URL inaccesible, tipos o tamaños no permitidos y timeout. Verificar rechazo de destinos privados y redirecciones hacia ellos en el adaptador real mediante un transporte de prueba controlado; no hacer peticiones a servicios internos reales para demostrar el bloqueo.
- **Memoria:** una petición explícita guarda y una afirmación casual no; un mensaje histórico que dice recuerda no activa guardado por sí solo. Consultas limitadas al canal, autor frente a sujeto, permisos de corrección/borrado, conflictos entre autores, referencias ambiguas y eliminación de cachés/índices.
- **Migración:** partir de registros representativos del esquema anterior, incluidos autor/canal ausentes, claves repetidas y embeddings compatibles. Verificar conservación de IDs/contenido/fechas, destino aprobado, origen importado, gestión exclusiva del propietario cuando corresponda y consultas imposibles desde otro canal. Repetir la migración sin duplicados; probar simulación sin escrituras, fallos parciales y rollback de transición.
- **Avisos:** persistencia antes de confirmación, zona horaria, fechas ambiguas, conservación de pendientes, reinicio, fallo transitorio, permisos revocados y dos ejecuciones simultáneas. Verificar que no se borra un aviso por un fallo transitorio ni se envía dos veces cuando la reclamación puede impedirlo; cubrir estado incierto de entrega sin prometer exactamente una vez.
- **Entrega:** personalidad y brevedad mediante escenarios y evaluación humana, no igualdad literal de texto generado. Comprobar fuentes completas, partición en mensajes válidos, menciones individuales autorizadas y bloqueo efectivo de everyone, here y roles.
- **Tiempo con reloj controlado:** cinco pasos y ocho llamadas como máximos independientes, cancelación cerca del segundo doce, respuesta parcial o aviso dentro del presupuesto, ausencia de trabajo implícito posterior y manejo de escrituras inciertas. Incluir cola y subllamadas en el cómputo.
- **Rendimiento real:** separar tareas sencillas de consultas con herramientas y medir tiempos hasta respuesta visible, p50/p95, proporción fuera de los objetivos y proporción de respuestas útiles frente a fallos. Incluir frases/fotos directas, saludo, miembros/presencia, consulta de recuerdos y búsqueda/lectura de actualidad. Un aviso de timeout no cuenta como resolución funcional exitosa y un mock rápido no demuestra latencia real.
- **Revisión final:** completar comprobaciones de tipos, compilación, lint y suite de comportamiento, más piloto con servicios reales antes de aceptar la transición. Documentar límites de red y servicios y los resultados medidos; no afirmar que los objetivos de latencia están cumplidos sin evidencia.

## Out of Scope

- Convertir Gnomo en un producto multiservidor, con tenants o administración de instalaciones.
- Respuestas espontáneas a mensajes ambientales; las únicas publicaciones sin invocación son los avisos programados acordados.
- Historial, recuerdos o resúmenes que mezclen canales o hilos.
- Expulsiones, bans, borrado o edición de mensajes ajenos, gestión de roles, permisos o facultades administrativas.
- Mensajes privados, mensajes a canales elegidos arbitrariamente y menciones masivas o de roles.
- Navegación con login, formularios, operaciones en cuentas externas o acceso a servicios privados.
- Ejecución de código o comandos del usuario, acceso genérico a archivos y herramientas ilimitadas.
- Guardado automático de recuerdos a partir de conversación casual, archivo permanente del canal o atribución inventada para datos importados.
- Generación nueva de imágenes, escucha/transcripción de voz y reproducción de audio; mantener fotos existentes y consulta de participantes no implica esas capacidades.
- Microservicios, un framework de agentes genérico, coordinación entre varios agentes, MCP obligatorio o cambio de SDK sin una necesidad justificada.
- Continuación silenciosa de consultas en segundo plano, garantías absolutas de latencia durante caídas de red o entrega exactamente una vez mediante Discord.
- Despliegue de producción o ejecución automática de migraciones sobre datos reales como parte de publicar esta especificación.

## Further Notes

- El propietario aprobó el diseño y el canal común de importación y recalcó que la reescritura completa está autorizada. La arquitectura debe ser limpia y ampliable; no limitar el trabajo a reorganizar directorios alrededor de las mismas dependencias.
- La frontera principal de pruebas fue confirmada expresamente después de presentar su alcance. No queda pendiente otra entrevista de producto para comenzar a implementar esta especificación.
- Aplican las decisiones de bot personal con historial por canal, recuerdos solo explícitos, memoria compartida por canal con autoría y monolito modular. El glosario distingue invocación, historial del canal, historial de conversación con Gnomo, miembro del servidor, miembro conectado, recuerdo de Gnomo, autor del recuerdo y sujeto del recuerdo.
- El destino común aprobado para recuerdos importados es GNOMOS_CHANNEL_ID; el identificador del propietario del bot debe suministrarse por configuración confiable durante la preparación de la implementación, no inferirse de apodos ni contenido de mensajes.
- La migración de datos y las comprobaciones de permisos son parte de la definición de terminado. No entregar solo un esquema nuevo ni dejar los recuerdos antiguos sin una ruta de consulta funcional en su destino.
- Los objetivos de latencia son requisitos a validar. Si el modelo o los servicios reales no los alcanzan, registrar los resultados y ajustar rutas y configuración dentro del alcance, sin convertir un mensaje de espera en cumplimiento ni cambiar de modelo silenciosamente.
- Publicar esta especificación prepara el trabajo de implementación; no significa que el refactor o sus pruebas ya se hayan ejecutado.
