import { createInterface, type Interface } from 'node:readline'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { resolve } from 'node:path'
import { ConfigService } from '@nestjs/config'
import { LoggerService } from './modules/services/logger/logger.service'
import { logFile } from './modules/services/logger/logger.module'
import { runtimeSummary } from './modules/config/runtime-summary'
import { ConsoleSession, type ConsoleEvent } from './modules/console/console-session'
import { ConsoleReceiver } from './modules/console/console-transport'
import { loadConsoleEnvironment, LocalEnvironmentError } from './modules/console/local-environment'
import type { Invocation } from './core/conversation/invocation'

const color = (code: number) => (text: string) =>
  process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text
const dim = color(2),
  green = color(32),
  yellow = color(33),
  red = color(31),
  cyan = color(36)

const HELP = `Cada línea es un mensaje que menciona al bot en el canal actual.
  /say <texto>         Mensaje en el canal SIN mencionar al bot (solo contexto/historial)
  /image <ruta>        Adjunta una imagen local (png/jpg/webp) al próximo mensaje
  /as <id> [nombre]    Cambia el usuario que escribe (ID de 17–20 dígitos)
  /channel <id>        Cambia de canal (cada canal tiene su propio historial)
  /history             Muestra el historial local del canal
  /reset               Borra el historial local del canal (no toca la base ni Redis)
  /whoami              Muestra servidor, canal y usuario actuales
  /help, /quit`

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

async function main() {
  loadConsoleEnvironment()
  // Imported only now: ConfigModule.forRoot reads and validates the environment at import time.
  const { ConsoleAppModule } = await import('./app.module')
  // Same bootstrap as main.ts, minus the HTTP listener: init() runs migrations, Redis,
  // schedulers and every lifecycle hook exactly as in production.
  const app = await NestFactory.create(ConsoleAppModule, { bufferLogs: true })
  const logger = app.get(LoggerService)
  app.useLogger(logger)
  app.enableShutdownHooks()
  await app.init()
  logger
    .createLogger('startup')
    .info(runtimeSummary(app.get(ConfigService)), 'Runtime configuration')
  const logs = logFile(app.get(ConfigService))

  const session = app.get(ConsoleSession)
  const receiver = app.get(ConsoleReceiver)
  let input: Interface | undefined
  // Piped stdin may end while a reply is pending; never prompt on a closed interface.
  let interactive = false
  const name = (id: string) => session.identity(id)?.username ?? id
  const prompt = () => `${cyan(`${session.requester.username}@#${session.channelId}`)}> `
  const ask = () => {
    if (!input || !interactive) return
    input.setPrompt(prompt())
    input.prompt(true)
  }
  const print = (text: string) => {
    if (interactive) process.stdout.write('\r\x1b[K')
    console.log(text)
    ask()
  }
  const render = (content: string) =>
    content.replace(/<@!?(\d+)>/g, (mention, id) => `${mention}${dim(`(@${name(id)})`)}`)
  session.output = (event: ConsoleEvent) => {
    switch (event.type) {
      case 'typing':
        return print(dim(`${session.bot.username} está escribiendo…`))
      case 'reply':
        return print(
          `${green(`${session.bot.username}>`)} ${render(event.content)}${(event.files ?? [])
            .map(
              (file) => `
${dim(`[imagen adjunta: ${file}]`)}`,
            )
            .join('')}`,
        )
      case 'scheduled':
        return print(
          `${green(`${session.bot.username} [${event.kind === 'birthday' ? 'cumpleaños' : 'recordatorio'} → #${event.channelId}]>`)} ${render(event.content)}`,
        )
      case 'ignored':
        return print(yellow(`[ignorado] ${event.reason}`))
      case 'error':
        return print(red(`[error] ${event.message}`))
    }
  }

  let pending: Invocation['attachments'] = []
  const handle = async (line: string): Promise<boolean> => {
    const text = line.trim()
    if (!text) return true
    const [command, ...rest] = text.split(/\s+/)
    const argument = text.slice(command.length).trim()
    switch (command) {
      case '/quit':
      case '/exit':
        return false
      case '/help':
        print(HELP)
        return true
      case '/whoami':
        print(
          `servidor ${session.guildId} · canal #${session.channelId} · usuario ${session.requester.username} (${session.requester.id}) · bot ${session.bot.username} (${session.bot.id})`,
        )
        return true
      case '/as': {
        const [id, ...username] = rest
        session.setRequester({ id, username: username.join(' ') || name(id) })
        print(dim(`Ahora escribes como ${session.requester.username} (${session.requester.id}).`))
        return true
      }
      case '/channel':
        if (!/^\d{17,20}$/.test(argument))
          throw new Error('El ID de canal debe tener 17–20 dígitos')
        session.channelId = argument
        print(dim(`Canal actual: #${argument}`))
        return true
      case '/say':
        session.post(session.requester, argument)
        return true
      case '/history':
        print(
          session
            .transcript()
            .map(
              (m) =>
                `${dim(new Date(m.createdAt).toLocaleTimeString())} ${m.author.username}: ${m.content}`,
            )
            .join('\n') || dim('(historial vacío)'),
        )
        return true
      case '/reset':
        session.reset()
        print(dim('Historial local del canal borrado.'))
        return true
      case '/image': {
        const type = IMAGE_TYPES[extname(argument).toLowerCase()]
        if (!type) throw new Error('Solo imágenes .png, .jpg, .jpeg o .webp')
        if ((await stat(argument)).size > 2_500_000) throw new Error('Imagen mayor a 2,5 MB')
        pending.push(session.attach(basename(argument), await readFile(argument), type))
        print(dim(`Imagen adjunta al próximo mensaje (${pending.length}).`))
        return true
      }
      default: {
        if (command.startsWith('/') && !command.startsWith('//'))
          throw new Error(`Comando desconocido ${command}; usa /help`)
        const attachments = pending
        pending = []
        await receiver.send(text.replace(/^\/\//, '/'), attachments)
        return true
      }
    }
  }

  console.log(
    `${green('Gnomo sandbox')} · runtime de producción con transporte de consola · ${dim('/help para comandos')}`,
  )
  // Same rule as memoryCapabilities: without a valid owner every memory tool answers "unavailable".
  if (!/^\d{17,20}$/.test(app.get(ConfigService).get<string>('MEMORY_OWNER_ID') ?? ''))
    console.log(
      yellow(
        'Memoria deshabilitada: falta MEMORY_OWNER_ID (tu ID de Discord, 17–20 dígitos) en .env.sandbox o .env.',
      ),
    )
  if (logs)
    console.log(
      dim(
        `Logs en ${resolve(logs)} — síguelos en otra terminal con: Get-Content "${resolve(logs)}" -Wait -Tail 50`,
      ),
    )
  input = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  })
  interactive = !!process.stdin.isTTY && !!process.stdout.isTTY
  input.on('close', () => {
    interactive = false
  })
  ask()
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    input?.close()
    await app.close()
  }
  input.on('SIGINT', () => void close())
  try {
    for await (const line of input) {
      try {
        if (!(await handle(line))) break
      } catch (error) {
        print(red(`[error] ${error instanceof Error ? error.message : String(error)}`))
      }
      ask()
    }
  } finally {
    await close()
  }
}

main().catch((error) => {
  // Local configuration problems are explained in one line; anything else keeps its stack.
  console.error(error instanceof LocalEnvironmentError ? error.message : error)
  process.exit(1)
})
