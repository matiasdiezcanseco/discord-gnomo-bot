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

## Implementation resolutions — 2026-11-06

All five code findings are addressed locally. This is implementation evidence, not
an independent re-review or live runtime acceptance. PR18 remains draft/not ready;
live benchmark, human evaluation, pilot and production transition are UNPERFORMED.
Remote checks/reviews were not queried or changed.

### S1 — shared effective Discord access

`modules/discord/effective-channel-access.ts` owns only current requester/bot read
permissions, bot channel/thread send permission, archived/locked thread denial and
private-thread membership. Conversation keeps its tool/consent/runtime policy and
denies failed private membership lookups. Scheduled delivery keeps birthday source,
Lima date, configured destination and GuildText checks, and its permanent/transient
lookup error classification. It still fetches/revalidates again immediately before
sending; its durable 30-second lease is independent of human processing budgets.
Existing permission, birthday and scheduled-delivery behavioral tests pass.

### S2 — shared bounded stream consumption

`web/bounded-body.ts` consumes complete bodies, counts actual chunk bytes, cancels
on overflow/error/completion and on AbortSignal, and releases the reader. Collection
retains its 524288-byte limit and trusted bucket/JSON/photo policy; Discord history
retains its 1000000-byte page limit, schema, transport and context policy. Specialized
partial-page `safeReader` is unchanged. Adapter regressions cover oversized chunked
bodies for both sources and cancellation of a pending body even if fetch ignores
abort. The pending-body regression failed before extraction (reader did not cancel),
then passed. No helper-only tests were introduced.

### F1 — pg production image

The real baseline `docker build -t gnomo-review-a23f:broken .` failed at
`RUN npm run db:generate` with Missing script. Builder/runtime now use locked npm
installs without Prisma generation. Production entry remains `node dist/main.js`;
no startup migration is added. SQL, historical migrations/schema, compiled migration
CLI and operator source scripts are retained. TypeScript operator commands such as
`notices:transfer` run from a development/operator install with tsx, not the image's
production-only npm install. `.dockerignore` permits only reviewed source/package/
SQL/operator inputs and rejects dotenv, key and private measurement artifacts.
No real secrets were present or created. No dependency upgrades were performed.

Final build: `docker build -t gnomo-review-a23f:final .`, exit 0.
Image: `sha256:54b632faea1d5605f9e000279455cb8ac39f86ecee23f29bbc8ad264b662e187`.
`docker run -d --name gnomo-review-a23f-final -p 127.0.0.1:16655:3000 gnomo-review-a23f:final`
starts the compiled application with no credential/configuration flags. HTTP smoke:

- `GET http://127.0.0.1:16655/health/diagnostics`: 200, runtime paused,
  all seven credential/capability configuration flags false, explicit-operator-only migrations.
- `GET http://127.0.0.1:16655/health`: 503, Discord down as expected in paused mode;
  Redis and bucket unconfigured. This proves the HTTP health route responds, not
  that an intentionally disconnected bot is ready.
- Image filesystem check: dist/main.js, prisma/pilot-memory.sql,
  dist/memory-migration/cli.js and scripts/transfer-pilot-reminders.ts present;
  .env and node_modules/@prisma/client absent.

Build log: `%TEMP%/gnomo-a23f-docker-final.log`. Earlier fixed image and smoke container
remain named `gnomo-review-a23f:fixed` / `gnomo-review-a23f-app` (loopback port 16654).
The final image includes all production code fixes, not only the Dockerfile change.

### F2 — bounded fair notice scanning

Dispatch atomically reserves at most 50 due IDs using a durable rotating Redis rank
cursor. Repeated calls traverse beyond any excluded prefix, including equal scores;
modulo handles set shrinkage. Worker recreation keeps progress. The cursor changes
only scan metadata: excluded durable identities, payloads, due scores, states and
attempts are untouched. Existing atomic lease/token transitions still fence workers.
The regression failed before the fix (no send after six dispatches behind 125
excluded records), then passed. Tests also cover concurrent resume after admission
changes, all-equal scores across 160 notices and recreated workers, unchanged
excluded records and one attempt/send per newly admitted identity. This is eventual
bounded traversal, not a promise of fixed delivery latency under unbounded arrivals.

### F3 — invocation authorization cancellation and phase distinction

Authorization receives the per-call AbortSignal from admission, executor, history,
images and memory revalidation. Checks precede guild, channel, every parallel member
lookup and every private-thread membership lookup, and follow awaited results.
Three clock-controlled composed-invocation regressions delay guild/channel/member
queries past 12 seconds: no subsequent query starts when the late result arrives,
the timeout reply is delivered, and another invocation remains functional.
Processing keeps its original 12-second signal; response authorization receives a
fresh signal bounded by the original 15-second deadline, not the closed processing
signal. Scheduled delivery does not inherit either human-invocation signal.

Limitation: discord.js 14.25 manager fetch methods used for authorization do not
accept AbortSignal; an already started SDK request cannot be forcibly cancelled by
this adapter. No client/REST singleton is mutated. Late completions cannot chain
new adapter queries. Native-fetch history/member/image/bucket transports retain
signal forwarding; history regression verifies signal identity through both
reauthorization and fetch. Controlled tests do not establish actual Discord latency.

### Reproduction, scope and final checks

Prepared worktree: `C:/Users/matia/.t3/worktrees/discord-gnomo-bot/t3-a23f2b76`.
Branch: `fix/final-review-fixes`. Supplied `atd875...` is not a Git object; the actual
base/LOCAL integration ref is `d875ea593b592225e86fcae9793e1d2e85c0f9f5`.
`git merge-base --is-ancestor d875ea593b592225e86fcae9793e1d2e85c0f9f5 HEAD`
passes. `git merge integration/gnomo-harness` before final verification reports
Already up to date. No shell checkout/worktree setup or merge into integration was made.

Owned isolated Docker resources (all host bindings are loopback):

- `gnomo-review-a23f-pg`, 16650, pgvector/pgvector:pg17, synthetic test password
  `isolated-test`, separate gnomo_t10 and gnomo_t11 databases.
- `gnomo-review-a23f-redis`, 16651, redis:7-alpine.
- `gnomo-review-a23f-t12`, 16652, and `gnomo-review-a23f-t13`, 16653,
  redis:7-alpine with `redis-server --appendonly yes`; both actually restarted by tests.

```powershell
npm ci --ignore-scripts
$env:T10_DATABASE_URL='postgresql://postgres:isolated-test@127.0.0.1:16650/gnomo_t10'
$env:T11_DATABASE_URL='postgresql://postgres:isolated-test@127.0.0.1:16650/gnomo_t11'
$env:T02_REDIS_URL='redis://127.0.0.1:16651'
$env:T12_REDIS_RESTART_URL='redis://127.0.0.1:16652'
$env:T12_REDIS_CONTAINER='gnomo-review-a23f-t12'
$env:T13_REDIS_RESTART_URL='redis://127.0.0.1:16653'
$env:T13_REDIS_CONTAINER='gnomo-review-a23f-t13'
npm run verify
git diff --check
```

Final source verification at `4400018adf1fd70fef49052560bb4946377388cb`:
**182/182 tests pass, zero skipped**, types/build/lint pass, diff check clean.
Log: `%TEMP%/gnomo-a23f-final-verify.log`. Subsequent changes are documentation only.
The compiled Nest smoke is part of the suite; real Docker build/HTTP smoke above
is separate. Optional PostgreSQL server restart branch was not enabled; SQL clients,
real vector queries, T11 migrations/rollback/ledger/tombstones and separate Redis
AOF restart cases ran. Existing ESLint module-type warning and brief Redis reconnect
ECONNREFUSED during owned restarts remain. npm reports 35 existing dependency audit
findings; no unrelated dependency remediation was attempted.

No unaddressed code finding. No real API credentials, live provider benchmark,
Discord pilot, production migration/deployment, subagents, push, PR edit/watch,
issue closure or merge into integration. Owned containers are retained for inspection;
no other implementer's resources were used or stopped.
