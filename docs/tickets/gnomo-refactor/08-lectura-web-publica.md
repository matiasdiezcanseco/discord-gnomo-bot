# T08: Leer páginas públicas con acceso de red limitado

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/10

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Invocar a Gnomo con una URL pública para que consulte su contenido y responda con una fuente verificable, mediante un lector reutilizable para otras entradas externas autorizadas.

## Acceptance criteria

- [ ] Leer una URL explícita y devolver contenido relevante y procedencia mediante el ejecutor; no requiere que la herramienta de búsqueda ya esté implementada.
- [ ] Validar protocolos, resolución efectiva del destino y cada redirección, incluidos cambios de dirección entre validación y conexión; impedir loopback, redes privadas, link-local y servicios de metadatos.
- [ ] Acotar bytes, tiempo y tipos de contenido; no iniciar sesión, completar formularios ni interactuar con cuentas.
- [ ] Propagar cancelación y distinguir inaccesibilidad, contenido no compatible, resultado parcial y timeout.
- [ ] Un texto de página no autoriza herramientas o escrituras; verificarlo desde invocación con el modelo controlado.
- [ ] Probar el adaptador real con transporte controlado frente a URLs maliciosas, resolución y redirecciones; no contactar servicios internos reales para demostrar el bloqueo.

## Blocked by

- [T02 / #4: Conversación por invocación mediante un harness autorizado](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/4)

## Implementación y extensión para T09

`web_read` declara `web.read` como lectura y se registra en `pilotCatalog(collection?, members?, history?, search?, live?, web?)`. `composePilot` la autoriza explícitamente, conserva los seis argumentos anteriores y añade el lector como séptimo argumento opcional. No cambia el bucle del harness, los permisos de historial/miembros ni la ruta rápida T03. Solo acepta una URL presente en el contenido de la invocación autenticada; ni historial, resultados web ni argumentos del modelo pueden añadir destinos iniciales autorizados.

`src/web/safe-reader.ts` expone `safeReader().read(url, context, policy)`: bytes limitados, MIME, URL inicial/final y fecha de consulta, o estado `blocked`, `inaccessible`, `unsupported`, `timeout` o `cancelled`. El lector distingue `complete` de `partial`; el adaptador de página convierte también el recorte de texto en `partialResult` del ejecutor. T09 puede reutilizar este límite de red con una lista explícita de MIME y tamaño: deberá exigir resultado completo y validar firmas, dimensiones y formato de imagen antes del modelo. T08 no envía imágenes al modelo ni afirma validar imágenes por MIME.

HTTP/HTTPS únicamente, puertos 80/443, sin credenciales de URL, cookies, sesiones, formularios, proxy, descompresión ni reintentos de HTTP. Resolver DNS independiente por salto, consultas A/AAAA con un intento por nameserver y cancelación real (`Resolver.cancel`) al vencer señal/plazo. Se rechaza toda respuesta mixta que incluya una dirección no pública. Se rechazan redes especiales IPv4/IPv6, IPv4 numérica normalizada por WHATWG URL, IPv6 mapeada o de transición y el endpoint de plataforma Azure 168.63.129.16. IPv6 se limita a unicast global 2000::/3, excluyendo los rangos especiales conocidos por ipaddr.js.

La solicitud Node conecta directamente al literal validado, sin segundo lookup y sin pool compartido. Mantiene `Host`, SNI y `checkServerIdentity` del hostname original con `rejectUnauthorized: true`; también comprueba IP SAN al usar una URL literal. Cada redirección vuelve a validar URL y resolución; máximo tres saltos, cuatro solicitudes y sin fallback/reintentos de direcciones. DNS y solicitudes atraviesan `context.external` y comparten el presupuesto T02; ese presupuesto puede cortar antes del máximo local de redirecciones. Señal del harness más límite local total de cinco segundos, cabeceras de 16 KiB, máximo 256000 bytes para páginas, HTML/texto plano y 4000 caracteres útiles. El límite genérico de bytes para consumidores futuros es 5 MB.

Extracción HTML con htmlparser2, entidades decodificadas, preferencia por main/article y exclusión de scripts, estilos, navegación, formularios y elementos ocultos. No ejecuta JavaScript ni carga subrecursos. La extracción es conservadora; una página dinámica, comprimida o protegida puede ser incompatible o aportar poco texto. La fecha es de consulta, no una fecha de publicación inventada. El modelo recibe procedencia y estados como datos no confiables mediante el adaptador AI SDK existente.

## Pruebas y preparación aislada

Se aplicó la skill TDD en las fronteras confirmadas: invocación normalizada por `createConversation.handle` hasta respuesta/efectos y adaptador de red real. Rojos observados antes de implementar: lector inexistente, herramienta sin registrar, endpoint Azure permitido, IPv6 fuera de unicast global permitido y ausencia del adaptador DNS cancelable. Los ciclos terminaron verdes. Los servidores HTTP, HTTPS y DNS UDP pertenecen a los tests; la red controlada redirige solamente la conexión al servidor de prueba después de observar las opciones fijadas. No se contactan servicios internos para demostrar rechazos. Certificado y clave en `test/fixtures/web` son exclusivamente fixtures públicas de prueba; la CA se confía solo en ese transporte de test.

Se prueban procedencia, texto HTML, parcialidad, URLs maliciosas, DNS mixto, DNS cambiante entre saltos, pin de IP, IPv6, certificado TLS correcto e incorrecto, redirecciones relativas/maliciosas/bucles, tipos/codificaciones, bytes, timeout/cancelación, DNS real cancelado, presupuesto y órdenes de página que intentan escribir, ampliar destinos o mencionar. El piloto real se compone con modelo y Discord controlados. Las garantías persistentes heredadas se ejecutan con Redis real aislado; T08 no añade persistencia ni migraciones.

```powershell
npm ci --ignore-scripts
npm run db:generate
docker run --detach --name gnomo-t08-redis --publish 127.0.0.1:16408:6379 redis:7-alpine
$env:T02_REDIS_URL='redis://127.0.0.1:16408'
npm run verify
docker rm --force gnomo-t08-redis
```

Fuentes oficiales consultadas al elegir APIs: [Node HTTP](https://nodejs.org/api/http.html), [Node HTTPS y verificación TLS](https://nodejs.org/api/https.html), [Node 24 DNS y cancelación de Resolver](https://nodejs.org/docs/latest-v24.x/api/dns.html), [ipaddr.js](https://github.com/whitequark/ipaddr.js) y [htmlparser2](https://github.com/fb55/htmlparser2). No se usaron modelo/Discord reales, credenciales, navegador, producción ni despliegue. La resistencia semántica del modelo real y la latencia de internet/piloto siguen sin medirse.

Verificación final (2026-11-05): base requerida `308ceb42b7b257d6b67c59f9eb957fadb44068e8` verificada antes de editar; integración local `6da5ba365f104d12726294ad94d76f8c7cc7caef` incorporada mediante merge `0a464e0`. Se conservaron los argumentos de catálogo de T07/T06 (search cuarto, live quinto), añadiendo web sexto. `npm run verify` con Redis 7 aislado en 16408 aprobó 126/126 pruebas, cero omitidas, tipos, build y lint; 36 pruebas nuevas T08. `git diff --check` correcto. Node 24.13.1. El lint conserva el aviso previo de package.json sin type para eslint.config.js. No hay nuevas migraciones SQL; las pruebas persistentes heredadas de reclamación concurrente, reconexión y expiración se ejecutaron contra Redis real. Sin revisión delegada, push, activación de piloto, cierre de issue ni cambios remotos del PR.
