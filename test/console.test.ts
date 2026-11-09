import 'reflect-metadata'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfigService } from '@nestjs/config'
import {
  assertLocalStorage,
  loadConsoleEnvironment,
  LocalEnvironmentError,
} from '../src/modules/console/local-environment'
import { ConsoleSession } from '../src/modules/console/console-session'
import type { ExecutionContext } from '../src/conversation/catalog'
import type { Invocation } from '../src/core/conversation/invocation'

const local = 'redis://:gnomo123@127.0.0.1:6379/14'

test('console refuses non-local database and Redis URLs without echoing credentials', () => {
  assert.throws(() => assertLocalStorage({}), /REDIS_URL es obligatorio/)
  for (const key of ['DATABASE_URL', 'DATABASE_URL_POOLED', 'PILOT_MEMORY_DATABASE_URL']) {
    assert.throws(
      () =>
        assertLocalStorage({
          REDIS_URL: local,
          [key]: 'postgresql://owner:s3cret@ep-x-pooler.neon.tech/neondb',
        }),
      (error: Error) =>
        error instanceof LocalEnvironmentError &&
        error.message.includes(key) &&
        !error.message.includes('s3cret'),
    )
  }
  assert.throws(
    () => assertLocalStorage({ REDIS_URL: 'rediss://default:pw@fly-gnomo.upstash.io:6379' }),
    /REDIS_URL apunta a un host no local/,
  )
  assertLocalStorage({
    REDIS_URL: local,
    DATABASE_URL: 'postgresql://gnomo:gnomo-local@localhost:5432/gnomo',
    DATABASE_URL_POOLED: '',
  })
})

test('console environment selects the console transport and keeps explicit values', () => {
  const env: Record<string, string | undefined> = {
    SANDBOX_ENV_FILE: 'does-not-exist.env',
    REDIS_URL: local,
    RUNTIME_MODE: 'pilot',
  }
  loadConsoleEnvironment(env, 'C:/does/not/exist')
  assert.equal(env.GNOMO_TRANSPORT, 'console')
  assert.equal(env.RUNTIME_MODE, 'pilot')
  assert.match(env.GUILD_ID!, /^\d{17,20}$/)
})

test('console history follows the Discord reader contract: before the invocation, bot replies included', async () => {
  const session = new ConsoleSession(
    new ConfigService({ GUILD_ID: '100000000000000001', SANDBOX_USERNAME: 'ana' }),
  )
  session.post(session.requester, 'antes')
  session.post(session.bot, 'respuesta del bot')
  const current = session.post(session.requester, `<@${session.bot.id}> ahora`)
  session.post(session.requester, 'después')
  session.post(session.requester, 'x'.repeat(2500), '100000000000000099')
  const invocation = {
    messageId: current.messageId,
    guildId: session.guildId,
    channelId: session.channelId,
  } as Invocation
  const context = {
    invocation,
    signal: new AbortController().signal,
    external: (work: () => Promise<unknown>) => work(),
  } as unknown as ExecutionContext
  let authorized = 0
  const history = session.platform().history(async () => {
    authorized++
    return true
  }, false)
  const page = await history(context, 30)
  assert.equal(authorized, 1)
  assert.deepEqual(
    page.messages.map((m) => [m.author.username, m.content]),
    [
      ['ana', 'antes'],
      ['Gnomo', 'respuesta del bot'],
    ],
  )
  assert.equal(page.source, 'discord')
  assert.equal((await history(context, 1)).messages[0].content, 'respuesta del bot')
  const other = await history(
    {
      ...context,
      invocation: { ...invocation, channelId: '100000000000000099', messageId: session.nextId() },
    },
    30,
  )
  assert.equal(other.messages[0].content.length, 2000)
  assert.equal(other.partial, true)
  await assert.rejects(
    session.platform().history(async () => false, false)(context, 30),
    /permission denied/,
  )
})
