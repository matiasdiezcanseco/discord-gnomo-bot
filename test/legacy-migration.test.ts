import 'reflect-metadata'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { migrateLegacy } from '../src/memory-migration/service'
import { migrationCli } from '../src/memory-migration/cli'
import { ConfigService } from '@nestjs/config'
import type { Client } from 'discord.js'
import Redis from 'ioredis'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { composeConversation } from '../src/modules/discord/conversation-composition'

test(
  'legacy migration previews without writes, backs up and imports stable records',
  {
    skip: !process.env.T11_DATABASE_URL || !process.env.T02_REDIS_URL,
  },
  async () => {
    const pool = new Pool({ connectionString: process.env.T11_DATABASE_URL })
    try {
      assert.equal(new URL(process.env.T11_DATABASE_URL!).pathname, '/gnomo_t11')
      await pool.query(
        'DROP SCHEMA IF EXISTS memory_migration CASCADE; DROP TABLE IF EXISTS public.memories CASCADE; DROP TABLE IF EXISTS pilot_memory_operations; DROP TABLE IF EXISTS pilot_memories CASCADE',
      )
      await pool.query(await readFile('prisma/pilot-memory.sql', 'utf8'))
      await pool.query(`CREATE TABLE memories (id text PRIMARY KEY, key text, content text,
      embedding vector, category text, guild_id text, created_at timestamptz, updated_at timestamptz)`)
      await pool.query(`INSERT INTO memories VALUES ('a1111111-1111-4111-8111-111111111111',
      'bebida','Anita prefiere té','[1,0,0]','gustos',NULL,'2020-01-02Z','2021-02-03Z')`)
      const options = {
        pool,
        guildId: '123456789012345678',
        channelId: '223456789012345678',
        destination: async () => ({
          guildId: '123456789012345678',
          channelId: '223456789012345678',
        }),
        approveNullGuild: true,
        legacyModel: 'test-3d',
        model: 'test-3d',
        dimensions: 3,
      }
      assert.equal((await migrateLegacy(options, 'dry-run')).pending, 1)
      assert.equal(
        (await pool.query(`SELECT to_regclass('memory_migration.entries') AS name`)).rows[0].name,
        null,
      )
      await migrateLegacy(options, 'backup')
      assert.equal((await migrateLegacy(options, 'import')).imported, 1)
      assert.equal((await migrateLegacy(options, 'import')).imported, 0)
      const redis = new Redis(process.env.T02_REDIS_URL!)
      const client = {
        user: { id: 'bot' },
        guilds: {
          fetch: async () => ({
            channels: {
              fetch: async () => ({
                isTextBased: () => true,
                isThread: () => false,
                permissionsFor: () => ({ has: () => true }),
              }),
            },
            members: { fetch: async ({ user }: { user: string }) => ({ id: user }) },
          }),
        },
      } as unknown as Client
      const config = new ConfigService({
        GUILD_ID: options.guildId,
        GNOMOS_CHANNEL_ID: options.channelId,
        MEMORY_OWNER_ID: '323456789012345678',
        RUNTIME_MODE: 'pilot', RUNTIME_CHANNEL_IDS: `${options.channelId},other`,
      })
      const invoke = async (content: string, author = 'member', channelId = options.channelId) => {
        const replies: string[] = []
        const app = composeConversation({ client: client, config: config, redis: redis, model: { generate: async () => ({ text: 'hola', calls: [] }) }, memory: { pool, embedding: { model: 'test-3d', embed: async () => [1, 0, 0] } } }
        )
        await app.handle(
          {
            content,
            guildId: options.guildId,
            channelId,
            messageId: randomUUID(),
            requester: { id: author, username: author },
            createdAt: Date.now(),
            attachments: [],
          },
          async (_, reply) => {
            replies.push(reply.content)
          },
        )
        return replies.join('\n')
      }
      try {
        const recalled = JSON.parse(await invoke('busca recuerdos: otro término'))
        assert.equal(recalled.records.length, 1)
        assert.equal(recalled.records[0].id, 'a1111111-1111-4111-8111-111111111111')
        assert.equal(recalled.records[0].content, 'Anita prefiere té')
        assert.equal(recalled.records[0].created_at, '2020-01-02T00:00:00.000Z')
        assert.equal(recalled.records[0].updated_at, '2021-02-03T00:00:00.000Z')
        assert.equal(recalled.records[0].author_id, null)
        assert.equal(recalled.records[0].source_message_id, null)
        assert.equal(recalled.records[0].origin, 'legacy_import')
        assert.doesNotMatch(await invoke('busca recuerdos: Anita', 'member', 'other'), /Anita/)
        assert.match(await invoke('olvida recuerdo bebida'), /denied/)
        assert.equal((await migrateLegacy(options, 'rollback')).rolledBack, 1)
        assert.doesNotMatch(await invoke('busca recuerdos: Anita'), /Anita/)
        assert.equal((await migrateLegacy(options, 'rollback')).rolledBack, 0)
        assert.equal((await migrateLegacy(options, 'import')).imported, 1)
        const reports: string[] = []
        const cliEnv = {
          PILOT_MEMORY_DATABASE_URL: process.env.T11_DATABASE_URL,
          GUILD_ID: options.guildId,
          GNOMOS_CHANNEL_ID: options.channelId,
          BOT_TOKEN: 'synthetic-only',
          PILOT_MEMORY_EMBEDDING_MODEL: 'test-3d',
          MEMORY_MIGRATION_LEGACY_MODEL: 'test-3d',
          MEMORY_MIGRATION_DIMENSIONS: '3',
          MEMORY_MIGRATION_APPROVE_NULL_GUILD: 'true',
        }
        for (const action of ['rollback', 'dry-run', 'backup', 'import', 'import'])
          await migrationCli(
            [action],
            cliEnv,
            async (url, init) => {
              assert.equal(url, `https://discord.com/api/v10/channels/${options.channelId}`)
              assert.equal(
                (init?.headers as Record<string, string>).Authorization,
                'Bot synthetic-only',
              )
              return Response.json({ id: options.channelId, guild_id: options.guildId, type: 0 })
            },
            (text) => reports.push(text),
          )
        assert.equal(JSON.parse(reports[0]).rolledBack, 1)
        assert.equal(JSON.parse(reports[1]).pending, 1)
        assert.equal(JSON.parse(reports[3]).imported, 1)
        assert.equal(JSON.parse(reports[4]).imported, 0)
        // Launch the actual executable, substituting only the Discord HTTP boundary.
        const preload = `globalThis.fetch=async()=>Response.json(${JSON.stringify({ id: options.channelId, guild_id: options.guildId, type: 0 })})`
        const processResult = await promisify(execFile)(
          process.execPath,
          [
            '--import',
            `data:text/javascript,${encodeURIComponent(preload)}`,
            '--import',
            'tsx',
            'src/memory-migration/cli.ts',
            'dry-run',
          ],
          { env: { ...process.env, ...cliEnv, OPENAI_API_KEY: '' } },
        )
        assert.equal(JSON.parse(processResult.stdout).pending, 0)
        assert.match(await invoke('olvida recuerdo bebida', '323456789012345678'), /forgotten/)
        assert.equal((await migrateLegacy(options, 'import')).imported, 0)
        assert.equal((await migrateLegacy(options, 'rollback')).rolledBack, 0)
        assert.doesNotMatch(await invoke('busca recuerdos: Anita'), /Anita/)
        assert.equal((await pool.query('SELECT count(*) FROM memories')).rows[0].count, '0')
        assert.equal(
          (await pool.query('SELECT payload FROM memory_migration.entries')).rows[0].payload,
          null,
        )
        await assert.rejects(
          pool.query(`INSERT INTO memories VALUES ('a1111111-1111-4111-8111-111111111111',
        'bebida','Anita prefiere té',NULL,'gustos',NULL,now(),now())`),
          /retired/,
        )
        await assert.rejects(
          migrateLegacy(
            {
              ...options,
              destination: async () => ({ guildId: null, channelId: options.channelId }),
            },
            'dry-run',
          ),
          /Destination/,
        )
        await assert.rejects(
          migrateLegacy(
            {
              ...options,
              destination: async () => ({ guildId: 'foreign', channelId: options.channelId }),
            },
            'backup',
          ),
          /Destination/,
        )
        const seed = async (id: string, key: string, guild: string | null = options.guildId) =>
          pool.query(
            `INSERT INTO memories VALUES ($1,$2,'Recuerdo sintético','[1,0,0]','general',$3,'2020-01-02T12:34:56.123456Z','2021-02-03Z')`,
            [id, key, guild],
          )
        const first = 'b1111111-1111-4111-8111-111111111111'
        const second = 'c1111111-1111-4111-8111-111111111111'
        await seed(first, 'primero', 'foreign')
        await assert.rejects(migrateLegacy(options, 'import'), /Foreign/)
        await pool.query('UPDATE memories SET guild_id=NULL')
        await assert.rejects(
          migrateLegacy({ ...options, approveNullGuild: false }, 'backup'),
          /unapproved/,
        )
        await seed(second, 'primero')
        await assert.rejects(migrateLegacy(options, 'dry-run'), /Duplicate/)
        await pool.query('UPDATE memories SET key=$1 WHERE id=$2', ['segundo', second])
        await assert.rejects(
          migrateLegacy({ ...options, legacyModel: 'unknown' }, 'dry-run'),
          /regeneration/,
        )
        await assert.rejects(migrateLegacy(options, 'import'), /backup required/)
        await migrateLegacy(options, 'backup')
        // Failure occurs after the first INSERT, exercising transaction rollback, not just preflight.
        let generated = 0
        await assert.rejects(
          migrateLegacy(
            {
              ...options,
              legacyModel: 'incompatible',
              embedding: {
                model: 'test-3d',
                embed: async () => {
                  if (++generated === 2) throw new Error('Synthetic embedding failure')
                  return [0, 1, 0]
                },
              },
            },
            'import',
          ),
          /Embedding regeneration failed/,
        )
        assert.equal(generated, 2)
        assert.doesNotMatch(await invoke('busca recuerdos: sintético'), /Recuerdo/)
        assert.equal((await pool.query('SELECT count(*) FROM memories')).rows[0].count, '2')
        assert.equal((await migrateLegacy(options, 'import')).imported, 2)
        assert.equal(
          (
            await pool.query(
              `SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS date FROM pilot_memories WHERE id=$1`,
              [first],
            )
          ).rows[0].date,
          '2020-01-02 12:34:56.123456',
        )
        assert.equal((await migrateLegacy(options, 'rollback')).rolledBack, 2)
        await pool.query('UPDATE memories SET content=$1 WHERE id=$2', [
          'cambio posterior al backup',
          first,
        ])
        await assert.rejects(migrateLegacy(options, 'import'), /matching backup required/)
        await assert.rejects(migrateLegacy(options, 'backup'), /changed since backup/)
        await pool.query('UPDATE memories SET content=$1 WHERE id=$2', [
          'Recuerdo sintético',
          first,
        ])
        // Physical text column variant matching Prisma's historical declaration.
        await pool.query(
          'ALTER TABLE memories ALTER COLUMN embedding TYPE text USING embedding::text',
        )
        assert.equal((await migrateLegacy(options, 'import')).imported, 2)
        assert.match(
          await invoke(`corrige recuerdo ${first}: Contenido corregido`, '323456789012345678'),
          /updated/,
        )
        await assert.rejects(migrateLegacy(options, 'rollback'), /changed or missing/)
        assert.match(await invoke('busca recuerdos: corregido'), /Contenido corregido/)
        await invoke(`olvida recuerdo ${first}`, '323456789012345678')
        await invoke(`olvida recuerdo ${second}`, '323456789012345678')
        assert.equal((await migrateLegacy(options, 'rollback')).rolledBack, 0)
        const explicit = JSON.parse(
          await invoke('guarda recuerdo: Identidad nueva', '323456789012345678'),
        )
        await seed(explicit.id, 'colisión')
        await assert.rejects(migrateLegacy(options, 'dry-run'), /collision/)
        await pool.query('DELETE FROM memories WHERE id=$1', [explicit.id])
        await invoke(`olvida recuerdo ${explicit.id}`, '323456789012345678')
        await seed(first.replace('b111', 'd111'), 'texto inválido')
        await pool.query(`UPDATE memories SET embedding='not a vector'`)
        await migrateLegacy(options, 'backup')
        let regenerated = 0
        const repaired = {
          ...options,
          embedding: {
            model: 'test-3d',
            embed: async () => {
              regenerated++
              return [1, 0, 0]
            },
          },
        }
        assert.equal((await migrateLegacy(repaired, 'import')).imported, 1)
        assert.equal(regenerated, 1)
        assert.match(await invoke('busca recuerdos: distinto'), /Recuerdo sintético/)
        await invoke(`olvida recuerdo ${first.replace('b111', 'd111')}`, '323456789012345678')
      } finally {
        await redis.quit()
      }
    } finally {
      await pool.end()
    }
  },
)
