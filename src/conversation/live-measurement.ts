import 'reflect-metadata'
import { config as loadEnv } from 'dotenv'
import { writeFile, readFile } from 'node:fs/promises'
import { Client, GatewayIntentBits } from 'discord.js'
import Redis from 'ioredis'
import { ConfigService } from '@nestjs/config'
import { composePilot } from '../modules/discord/pilot-conversation'
import { normalizeInvocation } from '../modules/discord/normalize-invocation'
import { PilotMemory } from '../modules/discord/pilot-memory'
import type { Trace } from './harness'

type Kind = 'simple' | 'tool' | 'compound'
type Outcome = 'useful' | 'partial' | 'failure'
interface Sample {
  id: string
  kind: Kind
  firstVisibleMs?: number
  finalVisibleMs?: number
  outcome?: Outcome
  traces: Trace[]
}

/** No latency claim is made for missing sends or human-unrated responses. */
export function measurementReport(samples: Sample[]) {
  return Object.fromEntries(
    (['simple', 'tool', 'compound'] as const).map((kind) => {
      const group = samples.filter((s) => s.kind === kind)
      const times = group
        .flatMap((s) => (s.finalVisibleMs === undefined ? [] : [s.finalVisibleMs]))
        .sort((a, b) => a - b)
      const percentile = (p: number) =>
        times.length ? times[Math.ceil(times.length * p) - 1] : null
      const fraction = (predicate: (s: Sample) => boolean) =>
        group.length ? group.filter(predicate).length / group.length : null
      return [
        kind,
        {
          count: group.length,
          visible: times.length,
          p50Ms: percentile(0.5),
          p95Ms: percentile(0.95),
          over3Seconds: fraction((s) => s.finalVisibleMs === undefined || s.finalVisibleMs > 3000),
          over15Seconds: fraction(
            (s) => s.finalVisibleMs === undefined || s.finalVisibleMs > 15000,
          ),
          useful: fraction((s) => s.outcome === 'useful'),
          partial: fraction((s) => s.outcome === 'partial'),
          failure: fraction((s) => s.outcome === 'failure'),
          unrated: fraction((s) => !s.outcome),
        },
      ]
    }),
  )
}

async function main() {
  // Explicit file only; never read a private dotenv during ordinary tests.
  if (process.argv[2] === 'report') {
    const file = JSON.parse(await readFile(process.argv[3], 'utf8'))
    console.log(JSON.stringify({ ...file, summary: measurementReport(file.samples) }, null, 2))
    return
  }
  if (!process.env.T14_ENV_FILE)
    throw Error('Set T14_ENV_FILE to the root-supplied private configuration')
  loadEnv({ path: process.env.T14_ENV_FILE, quiet: true })
  for (const key of [
    'BOT_TOKEN',
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'GUILD_ID',
    'T14_REDIS_URL',
    'T14_CHANNEL_ID',
    'T14_REQUESTER_ID',
  ])
    if (!process.env[key]) throw Error(`Missing ${key}`)
  if (process.env.T14_EXCLUSIVE_RECEIVER !== 'yes')
    throw Error('Stop other receivers in the measurement channel; set T14_EXCLUSIVE_RECEIVER=yes')
  const channel = process.env.T14_CHANNEL_ID!
  const count = Number(process.env.T14_MAX_SAMPLES ?? 12)
  const seconds = Number(process.env.T14_MAX_SECONDS ?? 300)
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 30 ||
    !Number.isInteger(seconds) ||
    seconds < 15 ||
    seconds > 600
  )
    throw Error('Bounds: 1–30 samples, 15–600 seconds')
  const client = new Client({
    rest: { retries: 0, timeout: 10000, rejectOnRateLimit: () => true },
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildVoiceStates,
    ],
  })
  const redis = new Redis(process.env.T14_REDIS_URL!, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  })
  redis.on('error', () => undefined)
  const config = new ConfigService({
    ...process.env,
    CONVERSATION_CONCURRENCY: Number(process.env.CONVERSATION_CONCURRENCY ?? 4),
    CONVERSATION_PILOT_CHANNEL_IDS: channel,
  })
  const memory = new PilotMemory(config)
  const samples: Sample[] = []
  const pending = new Set<Promise<void>>()
  const app = composePilot(
    client,
    config,
    redis,
    (trace) => samples.find((s) => s.id === trace.invocationId)?.traces.push(trace),
    undefined,
    undefined,
    undefined,
    memory.dependencies,
  )
  let finish!: () => void
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })
  let accepting = true
  const timer = setTimeout(() => {
    accepting = false
    finish()
  }, seconds * 1000)
  try {
    await Promise.race([
      client.login(process.env.BOT_TOKEN),
      done.then(() => {
        throw Error('Startup deadline')
      }),
    ])
    console.log(
      'Ready. In the isolated channel, send a bot mention followed by [simple], [tool], or [compound] and the task. Response bodies are not recorded. Rate each sample in the JSON afterward.',
    )
    client.on('messageCreate', (message) => {
      const receivedAt = Date.now()
      if (
        !accepting ||
        samples.length >= count ||
        message.channelId !== channel ||
        message.author.id !== process.env.T14_REQUESTER_ID
      )
        return
      const invocation = normalizeInvocation(message, process.env.GUILD_ID, client.user?.id)
      const tagged = invocation && /^\[(simple|tool|compound)\]\s+(.+)$/su.exec(invocation.content)
      if (!invocation || !tagged) return
      invocation.content = tagged[2]
      const sample: Sample = { id: invocation.messageId, kind: tagged[1] as Kind, traces: [] }
      samples.push(sample)
      const task = app
        .handle(invocation, async (_, reply) => {
          await message.reply(reply)
          sample.firstVisibleMs ??= Date.now() - receivedAt
          sample.finalVisibleMs = Date.now() - receivedAt
        })
        .catch(() => {
          sample.outcome = 'failure'
        })
        .finally(() => {
          if (
            sample.finalVisibleMs === undefined ||
            sample.traces.some(
              (t) => t.event === 'stopped' || (t.event === 'delivery' && t.status === 'uncertain'),
            )
          )
            sample.outcome = 'failure'
          pending.delete(task)
          if (samples.length >= count) {
            accepting = false
            finish()
          }
        })
      pending.add(task)
    })
    await done
    accepting = false
    await Promise.allSettled([...pending])
  } finally {
    clearTimeout(timer)
    await client.destroy()
    redis.disconnect()
    await memory.onModuleDestroy()
    await writeFile(
      process.env.T14_OUTPUT ?? 't14-live-measurement.json',
      JSON.stringify(
        {
          provider: 'openai',
          model: process.env.OPENAI_MODEL,
          sdk: `ai ${JSON.parse(await readFile('node_modules/ai/package.json', 'utf8')).version}; @ai-sdk/openai ${JSON.parse(await readFile('node_modules/@ai-sdk/openai/package.json', 'utf8')).version}`,
          measuredAt: new Date().toISOString(),
          timing: 'gateway receipt to awaited Discord reply; final visible includes all chunks',
          samples,
          summary: measurementReport(samples),
        },
        null,
        2,
      ),
    )
  }
}

if (require.main === module)
  main().catch(() => {
    console.error(
      'Measurement stopped; verify configuration and provider availability. No success is inferred.',
    )
    process.exitCode = 1
  })
