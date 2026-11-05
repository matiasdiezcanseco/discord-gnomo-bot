# T10: Guardar, consultar, corregir y borrar recuerdos del canal

Estado: aprobado y publicado con ready-for-agent. Issue: https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/12

## Parent

https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/2

## What to build

Un miembro pide guardar un recuerdo, puede recuperarlo en el mismo canal y su autor o el propietario pueden corregirlo o borrarlo. Entregar el ciclo funcional completo sobre el almacenamiento nuevo, expandiendo el esquema sin destruir la compatibilidad anterior.

## Acceptance criteria

- [ ] Guardar solo ante petición explícita del solicitante actual; conversación casual e instrucciones citadas en mensajes, páginas o recuerdos no activan guardado.
- [ ] Persistir identidad estable, contenido, categoría, clave opcional, servidor/canal, autor del recuerdo, sujeto, fuente, origen y fechas; separar autor de sujeto.
- [ ] Consultas siempre limitadas al canal actual con permisos vigentes; no hacer búsqueda semántica automática en cada saludo.
- [ ] Autor o propietario configurado de forma confiable pueden modificar/borrar; impedir sobrescritura por otra persona mediante claves repetidas y pedir aclaración ante coincidencias ambiguas.
- [ ] Presentar contradicciones con atribución; borrar también índices y cachés recuperables sin conservar una versión accesible al bot.
- [ ] El esquema nuevo se añade de forma compatible con la ruta anterior y con importaciones posteriores; no eliminar aún los datos antiguos.
- [ ] Pruebas desde invocación y PostgreSQL/Redis reales verifican persistencia, aislamiento, cambios de permisos, autoría, correcciones, borrado y repetición idempotente de una petición.

## Blocked by

- [T02 / #4: Conversación por invocación mediante un harness autorizado](https://github.com/matiasdiezcanseco/discord-gnomo-bot/issues/4)

## Implementación y verificación

Implementado en `feat/explicit-memory`. Contratos públicos, sintaxis explícita,
configuración Nest, instalación nueva reproducible e interfaces de extensión T11:
[10-storage-contract.md](10-storage-contract.md). No se importaron recuerdos
anteriores ni se modificó producción.

Frontera aprobada: invocación → `composePilot`/catálogo/ejecutor → respuesta y
efectos recuperables. PostgreSQL 17 con pgvector y Redis 7 reales en contenedores
`gnomo-t10-postgres` y `gnomo-t10-redis`, puertos locales 16410/16411. Modelo,
Discord y embeddings controlados. Incluye reinicio real de PostgreSQL, creación de
nuevos pilotos, persistencia vectorial, corrección/borrado, pérdida de reclamación
Redis sin duplicación/resurrección, claves concurrentes, permisos revocados,
aislamiento, autor frente a sujeto, propietario y coincidencias ambiguas.

Se conserva la ruta y datos anteriores para T11. No se activó el piloto ni se
desplegó, empujó, creó PR o cerró issue. La ausencia de URLs de pruebas omite de
forma explícita el caso de persistencia; no lo reemplaza por almacenamiento fake.

Verificación final del implementador (2026-11-05): ascendencia de
`91c60192421aca6158af7f97572f832253d2bc2a` verificada antes de editar. Integración
local `df0e5f45c6c8ab9ae41b9f179ff417037839c4ce` incorporada en merge `47960a6`.
`npm run verify` posterior al merge, con las tres variables de prueba descritas
en el contrato, pasó **129/129 pruebas, cero omitidas**, tipos, build y lint;
`git diff --check` correcto. Incluye reinicio Docker real de PostgreSQL y nueva
conexión tras esperar disponibilidad. Lint conserva únicamente el aviso previo
MODULE_TYPELESS_PACKAGE_JSON. Sin revisión delegada ni comprobación de checks
remotos del PR. No se afirma relevancia de embeddings/proveedores externos ni
latencia real. Rama `feat/explicit-memory`, worktree `t3-b7b28ee9`.
