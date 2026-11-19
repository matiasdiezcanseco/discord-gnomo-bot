import { getCiphers } from 'node:crypto'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import {
  ChannelType,
  Events,
  GatewayOpcodes,
  PermissionFlagsBits,
  type Client,
  type PermissionsBitField,
  type VoiceState,
} from 'discord.js'
import type { AudioPlayer, VoiceConnection } from '@discordjs/voice'
import type { ExecutionContext } from '../../conversation/catalog'
import type { VoiceLocation, VoiceStage, VoiceStageResult } from '../../conversation/voice-playback'

function botVoicePermissionMessage(permissions: Readonly<PermissionsBitField>): string | undefined {
  const missing = permissions.missing(['ViewChannel', 'Connect', 'Speak'])
  if (missing.length === 1) return `Me falta este permiso en el canal de voz: ${missing[0]}.`
  if (missing.length) return `Me faltan estos permisos en el canal de voz: ${missing.join(', ')}.`
}

function canRequesterJoin(permissions: Readonly<PermissionsBitField> | null) {
  return permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])
}

const requesterForbidden = 'Necesitas permiso para ver y entrar en el canal de voz.'

export function discordVoiceLocation(client: Client) {
  return async (context: ExecutionContext, target?: string): Promise<VoiceLocation> => {
    const { invocation, signal } = context
    const guild = client.guilds.cache.get(invocation.guildId)
    if (!client.isReady() || !guild?.available || !client.user)
      return { status: 'unavailable', message: 'No pude consultar tu canal de voz.' }
    let channel
    if (target) {
      if (/^\d{17,20}$/.test(target)) {
        channel = guild.channels.cache.get(target)
      } else {
        const name = target.toLowerCase()
        const matches = guild.channels.cache.filter(
          (channel) =>
            channel.type === ChannelType.GuildVoice && channel.name.toLowerCase() === name,
        )
        if (matches.size > 1)
          return { status: 'invalid', message: 'Hay varios canales con ese nombre. Indica el ID.' }
        channel = matches.first()
      }
      if (!channel)
        return { status: 'invalid', message: 'No encontré ese canal de voz en este servidor.' }
    } else {
      const channelId = guild.voiceStates.cache.get(invocation.requester.id)?.channelId
      if (!channelId) return { status: 'absent' }
      channel = guild.channels.cache.get(channelId)
    }
    signal.throwIfAborted()
    if (channel?.type !== ChannelType.GuildVoice)
      return { status: 'invalid', message: 'Solo puedo reproducir en canales de voz normales.' }
    const requester = guild.members.cache.get(invocation.requester.id)
    if (!requester || !canRequesterJoin(channel.permissionsFor(requester)))
      return {
        status: 'forbidden',
        message: requesterForbidden,
      }
    const bot = guild.members.me
    const permissions = bot && channel.permissionsFor(bot)
    if (!permissions)
      return { status: 'unavailable', message: 'No pude consultar mis permisos en ese canal.' }
    const message = botVoicePermissionMessage(permissions)
    if (message) return { status: 'forbidden', message }
    return { status: 'found', channelId: channel.id, channelName: channel.name }
  }
}

type StageFailure = Extract<VoiceStageResult, { status: 'failed' }>

export function clearStaleVoiceConnections(client: Client<true>) {
  for (const guild of client.guilds.cache.values()) {
    if (!guild.voiceStates.cache.get(client.user.id)?.channelId) continue
    client.ws.shards.get(guild.shardId)?.send({
      op: GatewayOpcodes.VoiceStateUpdate,
      d: { guild_id: guild.id, channel_id: null, self_mute: false, self_deaf: true },
    })
  }
}

/** Milestones of one playback, in ms since play() was called, to locate join-to-speech delays. */
export interface VoicePlaybackTimings {
  guildId: string
  channelId: string
  result: string
  totalMs: number
  events: { ms: number; event: string }[]
}

// Networking state codes in @discordjs/voice (VoiceNetworkingStatusCode).
const networkingStates = [
  'opening_ws',
  'identifying',
  'udp_handshaking',
  'selecting_protocol',
  'ready',
  'resuming',
  'closed',
]
const MAX_TIMING_EVENTS = 60

/** The registry is process-local. A single stage owns the guild lease until cleanup is complete. */
export function discordVoiceStage(
  client: Client,
  connectTimeoutMs: number,
  onUnavailable: (error: unknown) => void,
  onTimings?: (timings: VoicePlaybackTimings) => void,
): (VoiceStage & { close(): void }) | undefined {
  let voice: typeof import('@discordjs/voice')
  try {
    if (!getCiphers().includes('aes-256-gcm'))
      throw new Error('Native voice encryption unavailable')
    // Import also loads the platform-specific DAVE binding. Leave ordinary chat working if it fails.
    voice = createRequire(__filename)('@discordjs/voice')
  } catch (error) {
    onUnavailable(error)
    return undefined
  }
  const shutdown = new AbortController()
  const busy = new Set<string>()
  return {
    isBusy: (guildId) => busy.has(guildId),
    close() {
      shutdown.abort('aborted')
    },
    async play(playback, signal, onStarted) {
      const startedAt = Date.now()
      const events: VoicePlaybackTimings['events'] = []
      const mark = (event: string) => {
        if (events.length < MAX_TIMING_EVENTS) events.push({ ms: Date.now() - startedAt, event })
      }
      const result = await playOnce(playback, signal, onStarted, mark)
      try {
        onTimings?.({
          guildId: playback.guildId,
          channelId: playback.channelId,
          result: result.status === 'played' ? 'played' : result.reason,
          totalMs: Date.now() - startedAt,
          events,
        })
      } catch {
        // Diagnostics never change the playback outcome.
      }
      return result
    },
  }

  async function playOnce(
    { guildId, channelId, requesterId, file }: Parameters<VoiceStage['play']>[0],
    signal: AbortSignal,
    onStarted: (() => void) | undefined,
    mark: (event: string) => void,
  ): Promise<VoiceStageResult> {
    {
      let started = false
      const failed = (reason: StageFailure['reason']): StageFailure => ({
        status: 'failed',
        reason,
        started,
      })
      if (signal.aborted || shutdown.signal.aborted) return failed('aborted')
      if (busy.has(guildId)) return failed('busy')
      const guild = client.guilds.cache.get(guildId)
      if (!guild?.available || !client.isReady()) return failed('unavailable')

      busy.add(guildId)
      const disconnected = new AbortController()
      const playbackSignal = AbortSignal.any([signal, shutdown.signal, disconnected.signal])
      const disconnect = () => disconnected.abort('disconnected')
      const checkBotChannel = (oldState: VoiceState, state: VoiceState) => {
        // When members see Gnomo appear in the call.
        if (
          state.id === client.user?.id &&
          state.guild.id === guildId &&
          state.channelId === channelId &&
          oldState.channelId !== channelId
        )
          mark('gateway:in_channel')
        if (
          state.id === client.user?.id &&
          state.guild.id === guildId &&
          state.channelId !== channelId &&
          (oldState.channelId === channelId || state.channelId !== null)
        )
          disconnect()
      }
      let connection: VoiceConnection | undefined
      let player: AudioPlayer | undefined
      let source: Readable | undefined
      let checkStarted: ReturnType<typeof setInterval> | undefined
      let connectTimeout: AbortSignal | undefined
      try {
        const channel = await guild.channels.fetch(channelId, { force: true })
        mark('channel_fetched')
        playbackSignal.throwIfAborted()
        if (!guild.available || channel?.type !== ChannelType.GuildVoice || !client.isReady())
          return failed('unavailable')
        // Use current channel overwrites and gateway-maintained member roles just before joining.
        const requester = guild.members.cache.get(requesterId)
        if (!requester || !canRequesterJoin(channel.permissionsFor(requester)))
          return { ...failed('forbidden'), message: requesterForbidden }
        const bot = guild.members.me
        const permissions = bot && channel.permissionsFor(bot)
        if (!permissions) return failed('unavailable')
        const message = botVoicePermissionMessage(permissions)
        if (message) return { ...failed('forbidden'), message }
        if (!channel.joinable || !channel.speakable) return failed('forbidden')

        connectTimeout = AbortSignal.timeout(connectTimeoutMs)
        client.on(Events.VoiceStateUpdate, checkBotChannel)
        mark('join_requested')
        connection = voice.joinVoiceChannel({
          guildId,
          channelId,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: true,
          // Needed for DAVE handshake messages; only [DAVE] lines are kept, never WS payloads.
          debug: !!onTimings,
        })
        const observed = new WeakSet<object>()
        const observeNetworking = (networking: unknown) => {
          const emitter = networking as {
            on?(event: string, listener: (...args: never[]) => void): void
          } | null
          if (!emitter?.on || observed.has(emitter)) return
          observed.add(emitter)
          emitter.on('stateChange', ((_: unknown, next: { code: number }) =>
            mark(`networking:${networkingStates[next.code] ?? next.code}`)) as never)
          emitter.on('debug', ((message: string) => {
            if (message.startsWith('[DAVE]')) mark(message.slice(0, 120))
          }) as never)
        }
        connection.on('stateChange', (_, next) => {
          mark(`connection:${next.status}`)
          if ('networking' in next) observeNetworking(next.networking)
        })
        connection.on('error', disconnect)
        connection.on(voice.VoiceConnectionStatus.Disconnected, disconnect)
        connection.on(voice.VoiceConnectionStatus.Destroyed, disconnect)
        connection.on('stateChange', (previous, next) => {
          if (
            previous.status === voice.VoiceConnectionStatus.Ready &&
            next.status !== voice.VoiceConnectionStatus.Ready
          )
            disconnect()
        })
        if (connection.state.status === voice.VoiceConnectionStatus.Disconnected) disconnect()
        await voice.entersState(
          connection,
          voice.VoiceConnectionStatus.Ready,
          AbortSignal.any([playbackSignal, connectTimeout]),
        )
        playbackSignal.throwIfAborted()
        mark('ready')
        player = voice.createAudioPlayer()
        player.on('stateChange', (_, next) => mark(`player:${next.status}`))
        source = Readable.from([file.attachment])
        const resource = voice.createAudioResource(source, { inputType: voice.StreamType.OggOpus })
        if (!connection.subscribe(player)) return failed('disconnected')
        const observeStart = () => {
          if (!started && resource.playbackDuration > 0) {
            started = true
            mark('first_audio')
            onStarted?.()
          }
        }
        checkStarted = setInterval(observeStart, 20)
        try {
          await Promise.all([
            once(player, voice.AudioPlayerStatus.Idle, { signal: playbackSignal }),
            Promise.resolve().then(() => player!.play(resource)),
          ])
        } finally {
          observeStart()
        }
        return started ? { status: 'played' } : failed('audio')
      } catch {
        if (signal.aborted || shutdown.signal.aborted) return failed('aborted')
        if (disconnected.signal.aborted) return failed('disconnected')
        if (player) return failed('audio')
        return failed(connectTimeout?.aborted ? 'timeout' : 'unavailable')
      } finally {
        clearInterval(checkStarted)
        client.off(Events.VoiceStateUpdate, checkBotChannel)
        try {
          player?.stop(true)
        } finally {
          source?.destroy()
          try {
            if (connection && connection.state.status !== voice.VoiceConnectionStatus.Destroyed)
              connection.destroy()
          } finally {
            busy.delete(guildId)
          }
        }
      }
    }
  }
}
