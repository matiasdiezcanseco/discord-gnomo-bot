import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { createOpenAI } from '@ai-sdk/openai'
import { aiSdkModel } from '../conversation/ai-sdk-model'
import { tavilySearch } from '../conversation/public-search'
import { openSandboxStorage } from './storage'
import { createSandbox } from './sandbox'
import { sandboxEnvironment } from './configuration'
import { sandboxChannels, sandboxUsers, type SandboxChannel, type SandboxUser } from './fixtures'

async function main() {
  const { values } = parseArgs({
    options: {
      'live-model': { type: 'boolean', default: false },
      'live-web': { type: 'boolean', default: false },
      memoryless: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      ask: { type: 'string' },
      session: { type: 'string', default: 'default' },
      image: { type: 'string' },
    },
  })
  // No automatic dotenv loading, ConfigModule, AppModule, Client or Gateway login.
  const env = await sandboxEnvironment()
  if (values['live-model'] && (!env.OPENAI_API_KEY || !env.OPENAI_MODEL))
    throw new Error('Live model requires OPENAI_API_KEY and explicit OPENAI_MODEL')
  const provider = values['live-model']
    ? createOpenAI({
        apiKey: env.OPENAI_API_KEY,
        baseURL: 'https://api.openai.com/v1',
        fetch: (url, init) => {
          if (
            new URL(url instanceof Request ? url.url : String(url)).origin !==
            'https://api.openai.com'
          )
            throw new Error('Model destination blocked')
          return fetch(url, { ...init, redirect: 'error' })
        },
      })
    : undefined
  const storage = values.memoryless ? undefined : await openSandboxStorage(env)
  try {
    const sandbox = createSandbox({
      session: values.session,
      ...storage,
      model: provider ? aiSdkModel(provider(env.OPENAI_MODEL!)) : undefined,
      liveWeb: values['live-web'],
      search: values['live-web'] ? tavilySearch(env.TAVILY_API_KEY) : undefined,
    })
    const emit = (type: string, data: unknown) => {
      console.log(
        values.json
          ? JSON.stringify({ type, data })
          : typeof data === 'string'
            ? data
            : JSON.stringify(data, null, 2),
      )
    }
    emit('ready', {
      environment: 'sandbox',
      discord: 'disconnected',
      model: provider ? env.OPENAI_MODEL : 'fixture',
      web: values['live-web'] ? 'live-public-read' : 'fixture',
      storage: storage ? 'local-sandbox' : 'memoryless',
      session: values.session,
    })
    let user: SandboxUser = 'tester',
      channel: SandboxChannel = 'general'
    let imagePath = values.image
    const handle = async (line: string) => {
      const text = line.trim()
      if (!text) return true
      if (text === '/quit' || text === '/exit') return false
      if (text === '/help') {
        emit(
          'help',
          '/as tester|ana|bruno; /channel general|juegos; /permit yes|no; /image path; /birthdays; /tick seconds; /quit. Every other line is a local invocation.',
        )
        return true
      }
      if (text === '/birthdays') {
        emit('birthdays', await sandbox.birthdays())
        return true
      }
      if (text.startsWith('/as ')) {
        const selected = text.slice(4)
        if (!Object.hasOwn(sandboxUsers, selected)) throw new Error('Unknown fixture user')
        user = selected as SandboxUser
        emit('user', user)
      } else if (text.startsWith('/channel ')) {
        const selected = text.slice(9)
        if (!Object.hasOwn(sandboxChannels, selected)) throw new Error('Unknown fixture channel')
        channel = selected as SandboxChannel
        emit('channel', channel)
      } else if (text.startsWith('/permit ')) {
        const selected = text.slice(8)
        if (!['yes', 'no'].includes(selected)) throw new Error('Use /permit yes|no')
        sandbox.setPermission(selected === 'yes')
        emit('permission', selected)
      } else if (text.startsWith('/tick ')) {
        emit('scheduled-delivery', await sandbox.advance(Number(text.slice(6))))
      } else if (text.startsWith('/image ')) {
        imagePath = text.slice(7)
        emit('attachment', 'Image selected for the next invocation.')
      } else {
        const path = imagePath
        imagePath = undefined
        let images
        if (path) {
          if ((await stat(path)).size > 2_500_000) throw new Error('Image too large')
          const type = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
          }[extname(path).toLowerCase()]
          if (!type) throw new Error('Unsupported image type')
          images = [{ name: 'local-image', bytes: await readFile(path), contentType: type }]
        }
        const result = await sandbox.ask(text, { user, channel, images })
        emit(
          'response',
          values.json
            ? result
            : result.replies.map((r) => r.content).join('\n') ||
                '[no response: denied or duplicate]',
        )
      }
      return true
    }
    if (values.ask !== undefined) {
      await handle(values.ask)
      return
    }
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
    try {
      if (process.stdin.isTTY && !values.json) process.stdout.write('you> ')
      for await (const line of input) {
        try {
          if (!(await handle(line))) break
        } catch {
          emit(
            'error',
            'Sandbox request failed; verify command, storage and provider availability.',
          )
        }
        if (process.stdin.isTTY && !values.json) process.stdout.write('you> ')
      }
    } finally {
      input.close()
    }
  } finally {
    await storage?.close()
  }
}

if (require.main === module)
  main().catch((error) => {
    // URLs/SDK exceptions may contain credentials. Only known local validation messages are shown.
    console.error(
      error instanceof Error &&
        /^(Live model requires|Invalid sandbox session|Local sandbox storage unavailable|Sandbox requires)/.test(
          error.message,
        )
        ? error.message
        : 'Sandbox stopped; verify options and local configuration.',
    )
    process.exitCode = 1
  })
