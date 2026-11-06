import 'reflect-metadata'
import test from 'node:test'
import assert from 'node:assert/strict'
import { ConfigService } from '@nestjs/config'
import { RuntimeMemory } from '../src/modules/discord/runtime-memory'
import { databasePoolConfig } from '../src/database/configuration'

const direct =
  'postgresql://owner:fixture@ep-fixture.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
const pooled = direct.replace('ep-fixture.', 'ep-fixture-pooler.')

test('runtime memory uses the Neon pooled URL with verified TLS and channel binding enabled', async () => {
  const memory = new RuntimeMemory(
    new ConfigService({
      DATABASE_URL: direct,
      DATABASE_URL_POOLED: pooled,
      PILOT_MEMORY_DATABASE_URL: 'postgresql://localhost/old',
    }),
  )
  try {
    assert.ok(memory.dependencies)
    const options = memory.dependencies.pool.options
    assert.match(options.connectionString!, /ep-fixture-pooler/)
    assert.equal(new URL(options.connectionString!).searchParams.get('sslmode'), 'verify-full')
    assert.equal('enableChannelBinding' in options && options.enableChannelBinding, true)
    assert.equal(options.statement_timeout, undefined)
    assert.equal(options.max, 4)
  } finally {
    await memory.onModuleDestroy()
  }
})

test('migration configuration uses direct URL and refuses a pooled-only Neon deployment', () => {
  assert.match(
    databasePoolConfig({ DATABASE_URL: direct, DATABASE_URL_POOLED: pooled }, 'migration')!
      .connectionString!,
    /ep-fixture\./,
  )
  assert.throws(
    () => databasePoolConfig({ DATABASE_URL_POOLED: pooled }, 'migration'),
    /DATABASE_URL.*direct/,
  )
  assert.throws(
    () =>
      databasePoolConfig(
        { DATABASE_URL_POOLED: pooled, PILOT_MEMORY_DATABASE_URL: 'postgresql://localhost/old' },
        'migration',
      ),
    /DATABASE_URL.*direct/,
  )
  assert.throws(() => databasePoolConfig({ DATABASE_URL: pooled }, 'migration'), /direct/)
  assert.throws(
    () =>
      databasePoolConfig(
        { DATABASE_URL: direct.replace('sslmode=require', 'sslmode=disable') },
        'runtime',
      ),
    /verified TLS/,
  )
})

test('local and legacy PostgreSQL configurations remain supported without forced TLS', () => {
  const local = 'postgresql://gnomo:local@127.0.0.1:5432/gnomo'
  assert.equal(databasePoolConfig({ DATABASE_URL: local }, 'runtime')!.connectionString, local)
  assert.equal(
    databasePoolConfig({ PILOT_MEMORY_DATABASE_URL: local }, 'migration')!.connectionString,
    local,
  )
  assert.equal(databasePoolConfig({}, 'runtime'), undefined)
})
