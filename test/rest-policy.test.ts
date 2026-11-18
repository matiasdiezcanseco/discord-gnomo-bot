import assert from 'node:assert/strict'
import { test } from 'node:test'
import { REST, RateLimitError } from 'discord.js'
import { DISCORD_REST } from '../src/modules/discord/rest-policy'

function jsonResponse(value: unknown, init: Parameters<typeof Response.json>[1]) {
  const response = Response.json(value, init)
  return {
    arrayBuffer: () => response.arrayBuffer(),
    body: null,
    get bodyUsed() {
      return response.bodyUsed
    },
    headers: response.headers,
    json: () => response.json(),
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    text: () => response.text(),
  }
}

function rest(retryAfterSeconds: number, global = false) {
  let calls = 0
  const client = new REST({
    ...DISCORD_REST,
    makeRequest: async () => {
      calls++
      if (calls > 1) return jsonResponse({ user: { id: '1' } }, { status: 200 })
      return jsonResponse({ retry_after: retryAfterSeconds, global }, {
        status: 429,
        headers: {
          'retry-after': String(retryAfterSeconds),
          'x-ratelimit-scope': global ? 'global' : 'user',
          ...(global ? { 'x-ratelimit-global': 'true' } : {}),
        },
      })
    },
  }).setToken('test-token')
  return { client, calls: () => calls }
}

test('a short member-route rate limit is waited out instead of failing the conversation', async () => {
  const { client, calls } = rest(0.05)
  assert.deepEqual(await client.get('/guilds/1/members/1'), { user: { id: '1' } })
  assert.equal(calls(), 2)
})

test('long or global rate limits still fail fast', async () => {
  await assert.rejects(rest(5).client.get('/guilds/1/members/1'), RateLimitError)
  await assert.rejects(rest(0.05, true).client.get('/guilds/1/members/1'), RateLimitError)
})
