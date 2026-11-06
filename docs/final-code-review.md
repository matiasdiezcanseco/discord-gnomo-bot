# Revisión independiente del refactor de Gnomo

Base: 7c3364e40d1143e6cf7c1fbf109c02d8126d4f9c.
Head revisado: 490459bac20bc4a1d76a08ddd7779020e566cb36.
Diff: `git diff 7c3364e40d1143e6cf7c1fbf109c02d8126d4f9c...490459bac20bc4a1d76a08ddd7779020e566cb36`.
Estado inicial: cinco hallazgos por corregir; no se despliega ni se afirma validación viva.

## Standards

No se encontraron incumplimientos demostrables de estándares documentados. Dos posibles **Duplicated Code**, como juicios de diseño:

1. **S1 — Autorización efectiva duplicada.** `conversation-composition.ts:46` y `scheduled-delivery.ts:51` repiten `const read = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]`, selección del permiso de envío, rechazo de hilos archivados/bloqueados y comprobación de membresía privada. Mantener ambas copias sincronizadas expone a permisos divergentes. Extraer la comprobación compartida dentro del adaptador Discord, conservando las restricciones específicas de cumpleaños y el tratamiento de errores de cada llamador. Es coherente con la frontera documentada: “keep Discord/storage/provider details behind their respective boundary interfaces”.
2. **S2 — Lectura HTTP acotada duplicada.** `collection-content.ts:29` y `channel-history.ts:70` repiten `getReader()`, chunks, `bytes += value.byteLength`, rechazo por tamaño y `finally { await reader.cancel() }`. Extraer únicamente la lectura acotada con límite parametrizado; transporte y validación de dominio permanecen en sus módulos.

Las fronteras catálogo/ejecutor/modelo respaldadas por la documentación no se consideran olores. No se repitieron pruebas durante la revisión estática.

## Spec

1. **F1 [P1] — La imagen no compila.** T15 exige “completar una transición verificable a la implementación nueva”. Se eliminaron db:generate y Prisma, pero Dockerfile sigue ejecutando ambos en builder/runtime. Actualizar ambas etapas para pg y verificar construcción/arranque de la imagen; el smoke Nest no cubre este empaquetado.
2. **F2 [P2] — Avisos excluidos bloquean los admitidos.** La especificación exige “Preservar los avisos pendientes al cambiar de implementación”. `scheduled-notices.ts:125` obtiene siempre los primeros 50 vencidos y después omite los rechazados por admits sin avanzar. Cincuenta pendientes antiguos de canales excluidos después de guild→pilot ocupan cada lote y bloquean recordatorios posteriores del piloto. Paginar o indexar por ámbito conservando estados e intentos de los excluidos.
3. **F3 [P2] — Autorización inicia consultas después del vencimiento.** La especificación exige “propagar cancelación y detener trabajo externo cerca del segundo doce” y “No continuar silenciosamente en segundo plano”. `conversation-composition.ts:42` encadena consultas Discord sin señal/comprobación de presupuesto. Una consulta iniciada antes del límite puede terminar después y aun iniciar consultas de miembros. Budget.wait solo abandona la espera con Promise.race. Propagar cancelación al transporte y verificar plazo antes de cada subconsulta.

La aceptación con Discord/proveedores reales, piloto, evaluación humana y latencia es un gate externo reconocido; no se cuenta como defecto de código ni como validación realizada.

Totales: Standards 0 infracciones y 2 juicios de duplicación (mayor riesgo interno: política de autorización duplicada); Spec 3 incumplimientos (mayor gravedad interna: imagen de despliegue rota, P1). Los ejes se mantienen separados.
