import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { z } from 'zod'
import { defineCapability, type ExecutionContext } from './catalog'
import type { Invocation } from '../core/conversation/invocation'

export interface MemoryEmbedding {
  /** Versioned model identity; never compare vectors from different models. */
  model: string
  embed(text: string, signal: AbortSignal): Promise<number[]>
}
export interface MemoryDependencies {
  pool: Pool
  embedding?: MemoryEmbedding
}
type Request = {
  operation: string
  content?: string
  selector?: string
  key?: string
  category?: string
  subject?: string
}

/** Entire current request must match. Quoted, multiline, conditional and historic commands fail closed. */
function request(invocation: Invocation): Request | undefined {
  const text = invocation.content.trim()
  if (/[\r\n]/.test(text)) return
  const save = /^(?:por favor,? )?guarda recuerdo(?: \[([^\]]+)\])?: (.{1,1200})$/iu.exec(text)
  if (save) {
    const metadata: Record<string, string> = {}
    for (const field of save[1]?.split(';') ?? []) {
      const match = /^(clave|categoria|sujeto)=([^=;]{1,100})$/u.exec(field.trim())
      if (!match || metadata[match[1]]) return
      metadata[match[1]] = match[2]
    }
    return {
      operation: 'save',
      content: save[2],
      key: metadata.clave,
      category: metadata.categoria ?? 'general',
      subject: metadata.sujeto,
    }
  }
  const query = /^busca recuerdos: (.{1,200})$/iu.exec(text)
  if (query) return { operation: 'search', selector: query[1] }
  const update = /^corrige recuerdo ([^:\r\n]{1,100}): (.{1,1200})$/iu.exec(text)
  if (update) return { operation: 'update', selector: update[1], content: update[2] }
  const forget = /^olvida recuerdo ([^:\r\n]{1,100})$/iu.exec(text)
  if (forget) return { operation: 'forget', selector: forget[1] }
  return
}

const recordColumns = `id, guild_id, channel_id, author_id, subject, key, category, content,
  source_message_id, last_message_id, last_editor_id, origin, created_at, updated_at`

export function memoryCapabilities(
  dependencies?: MemoryDependencies,
  ownerId?: string,
  reauthorize: (invocation: Invocation) => Promise<boolean> = async () => false,
) {
  // Owner is deployment configuration only; invalid/missing config disables all new memory.
  const configured = dependencies && /^\d{17,20}$/.test(ownerId ?? '')
  return ['save', 'search', 'update', 'forget'].map((operation) =>
    defineCapability({
      name: `memory_${operation}`,
      capability: `memory.${operation}`,
      scope: 'channel',
      effect: operation === 'search' ? 'read' : 'write',
      description:
        'Recuerdos explícitos del canal. Petición directa: guarda recuerdo: texto; busca recuerdos: consulta. Sin argumentos del modelo.',
      input: z.strictObject({}),
      output: z.string().max(15000),
      maxCalls: 1,
      maxResultChars: 16000,
      available: async () => true,
      direct: {
        matches: (invocation) => request(invocation)?.operation === operation,
        input: {},
        render: (result) =>
          typeof result.value === 'string'
            ? result.value
            : `Memoria: ${result.status}. No se ha confirmado la operación.`,
      },
      execute: async (_, context) => {
        const intent = request(context.invocation)
        if (!intent || intent.operation !== operation)
          return 'denied: falta petición explícita actual.'
        if (!configured)
          return 'unavailable: memoria deshabilitada; faltan almacenamiento o MEMORY_OWNER_ID válido.'
        return context.external(() =>
          execute(dependencies!, intent, context, reauthorize, ownerId!),
        )
      },
    }),
  )
}

async function execute(
  dependencies: MemoryDependencies,
  intent: Request,
  context: ExecutionContext,
  reauthorize: (invocation: Invocation) => Promise<boolean>,
  ownerId: string,
): Promise<string> {
  const { invocation, signal } = context
  signal.throwIfAborted()
  let vector: string | null = null
  let embeddingModel: string | null = null
  if (dependencies.embedding && intent.operation !== 'forget') {
    try {
      const values = await context.external(() =>
        dependencies.embedding!.embed(intent.content ?? intent.selector!, signal),
      )
      if (
        !values.length ||
        values.length > 4096 ||
        !values.every(Number.isFinite) ||
        !values.some((value) => value !== 0)
      )
        throw new Error('Invalid embedding')
      vector = JSON.stringify(values)
      embeddingModel = dependencies.embedding.model
    } catch {
      signal.throwIfAborted()
      // Optional embedding failure never prevents lexical persistence/recall.
    }
  }
  signal.throwIfAborted()
  const db = await dependencies.pool.connect()
  try {
    await db.query('BEGIN')
    await db.query("SET LOCAL statement_timeout='2000ms'")
    await db.query("SET LOCAL lock_timeout='1500ms'")
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      JSON.stringify([invocation.guildId, invocation.channelId]),
    ])
    if (!(await reauthorize(invocation))) return 'denied: permisos actuales insuficientes.'
    signal.throwIfAborted()
    const scope = [invocation.guildId, invocation.channelId]
    if (intent.operation === 'search') {
      const found = await db.query(
        `WITH scoped AS (
        SELECT *, CASE WHEN embedding_model=$5 AND vector_dims(embedding)=vector_dims($4::vector)
          THEN 1-(embedding <=> $4::vector) ELSE NULL END AS similarity
        FROM pilot_memories WHERE guild_id=$1 AND channel_id=$2)
        SELECT ${recordColumns} FROM scoped
        WHERE strpos(lower(content),lower($3))>0 OR key=$3 OR similarity>=0.65
        ORDER BY similarity DESC NULLS LAST, created_at, id LIMIT 6`,
        [...scope, intent.selector, vector, embeddingModel],
      )
      return JSON.stringify({
        outcome: 'found',
        records: found.rows.slice(0, 5),
        limited: found.rows.length > 5,
        retrieval: vector ? 'lexical+vector' : 'lexical (embedding no configurado o no disponible)',
        attribution:
          'Afirmaciones de sus autores; pueden contradecirse, no son hechos verificados.',
      })
    }
    const prior = await db.query(
      `SELECT memory_id FROM pilot_memory_operations
      WHERE guild_id=$1 AND channel_id=$2 AND message_id=$3`,
      [...scope, invocation.messageId],
    )
    if (prior.rowCount)
      return JSON.stringify({ outcome: 'already_applied', id: prior.rows[0].memory_id })
    let id = randomUUID()
    if (intent.operation === 'update' || intent.operation === 'forget') {
      const matches = await db.query(
        `SELECT id, author_id FROM pilot_memories
        WHERE guild_id=$1 AND channel_id=$2 AND (id::text=$3 OR key=$3) LIMIT 2`,
        [...scope, intent.selector],
      )
      if (!matches.rowCount) return 'not_found: no hay coincidencias en este canal.'
      if (matches.rows.length !== 1)
        return 'ambiguous: hay varias coincidencias; usa el ID estable.'
      const record = matches.rows[0]
      if (record.author_id !== invocation.requester.id && ownerId !== invocation.requester.id)
        return 'denied: solo autor o propietario puede modificar este recuerdo.'
      id = record.id
      if (intent.operation === 'forget') {
        await db.query('DELETE FROM pilot_memories WHERE guild_id=$1 AND channel_id=$2 AND id=$3', [
          ...scope,
          id,
        ])
      } else
        await db.query(
          `UPDATE pilot_memories SET content=$4, embedding=$7::vector, embedding_model=$8,
        last_message_id=$5, last_editor_id=$6, updated_at=now()
        WHERE guild_id=$1 AND channel_id=$2 AND id=$3`,
          [
            ...scope,
            id,
            intent.content,
            invocation.messageId,
            invocation.requester.id,
            vector,
            embeddingModel,
          ],
        )
    } else {
      const duplicate =
        intent.key &&
        (await db.query(
          `SELECT id FROM pilot_memories
        WHERE guild_id=$1 AND channel_id=$2 AND author_id=$3 AND key=$4`,
          [...scope, invocation.requester.id, intent.key],
        ))
      if (duplicate && duplicate.rowCount)
        return 'conflict: tu clave ya existe; corrige usando su ID.'
      await db.query(
        `INSERT INTO pilot_memories (id,guild_id,channel_id,author_id,subject,key,category,
      content,source_message_id,last_message_id,last_editor_id,origin,embedding,embedding_model)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$4,'explicit_request',$10::vector,$11)`,
        [
          id,
          ...scope,
          invocation.requester.id,
          intent.subject,
          intent.key,
          intent.category,
          intent.content,
          invocation.messageId,
          vector,
          embeddingModel,
        ],
      )
    }
    await db.query(`INSERT INTO pilot_memory_operations VALUES ($1,$2,$3,$4,$5,$6)`, [
      ...scope,
      invocation.messageId,
      invocation.requester.id,
      intent.operation,
      intent.operation === 'forget' ? null : id,
    ])
    signal.throwIfAborted()
    await db.query('COMMIT')
    return JSON.stringify({
      outcome:
        intent.operation === 'save'
          ? 'saved'
          : intent.operation === 'forget'
            ? 'forgotten'
            : 'updated',
      id,
      editor: invocation.requester.id,
    })
  } finally {
    await db.query('ROLLBACK').catch(() => undefined)
    db.release()
  }
}
