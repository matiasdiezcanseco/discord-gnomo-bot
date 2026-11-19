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
  type VoiceState,
} from 'discord.js'
import type { AudioPlayer, VoiceConnection } from '@discordjs/voice'
import type { ExecutionContext } from '../../conversation/catalog'
import type { VoiceLocation, VoiceStage, VoiceStageResult } from '../../conversation/voice-playback'

export function discordVoiceLocation(client: Client) {
  return async (context: ExecutionContext): Promise<VoiceLocation> => {
    const { invocation, signal } = context
    const guild = client.guilds.cache.get(invocation.guildId)
    if (!client.isReady() || !guild?.available || !client.user)
      return { status: 'unavailable', message: 'No pude consultar tu canal de voz.' }
    const channelId = guild.voiceStates.cache.get(invocation.requester.id)?.channelId
    if (!channelId) return { status: 'absent' }
    const channel = await context.external(() => guild.channels.fetch(channelId, { force: true }))
    signal.throwIfAborted()
    if (guild.voiceStates.cache.get(invocation.requester.id)?.channelId !== channelId)
      return {
        status: 'unavailable',
        message: 'Tu canal de voz cambió mientras preparaba el audio.',
      }
    if (channel?.type !== ChannelType.GuildVoice)
      return { status: 'invalid', message: 'Solo puedo reproducir en canales de voz normales.' }
    const requester = guild.members.cache.get(invocation.requester.id)
    const bot = guild.members.me
    if (
      !requester ||
      !channel
        .permissionsFor(requester)
        .has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])
    )
      return {
        status: 'forbidden',
        message: 'Necesitas permiso para ver y entrar en el canal de voz.',
      }
    if (
      !bot ||
      !channel
        .permissionsFor(bot)
        .has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
        ])
    )
      return {
        status: 'forbidden',
        message: 'Necesito permiso para ver, conectar y hablar en el canal de voz.',
      }
    return { status: 'found', channelId, channelName: channel.name }
  }
}

type FailureReason = Extract<VoiceStageResult, { status: 'failed' }>['reason']

/** The registry is process-local. A single stage owns the guild lease until cleanup is complete. */
export function discordVoiceStage(
  client: Client,
  connectTimeoutMs: number,
  onUnavailable: (error: unknown) => void,
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
  const clearStaleConnections = () => {
    for (const guild of client.guilds.cache.values()) {
      if (!guild.voiceStates.cache.get(client.user!.id)?.channelId || busy.has(guild.id)) continue
      client.ws.shards.get(guild.shardId)?.send({
        op: GatewayOpcodes.VoiceStateUpdate,
        d: { guild_id: guild.id, channel_id: null, self_mute: false, self_deaf: true },
      })
    }
  }
  client.once(Events.ClientReady, clearStaleConnections)
  return {
    isBusy: (guildId) => busy.has(guildId),
    close() {
      client.off(Events.ClientReady, clearStaleConnections)
      shutdown.abort('aborted')
    },
    async play(guildId, channelId, audio, signal, onStarted) {
      let started = false
      const failed = (reason: FailureReason): VoiceStageResult => ({
        status: 'failed',
        reason,
        started,
      })
      if (signal.aborted || shutdown.signal.aborted) return failed('aborted')
      if (busy.has(guildId)) return failed('busy')
      const guild = client.guilds.cache.get(guildId)
      const channel = guild?.channels.cache.get(channelId)
      if (!guild?.available || channel?.type !== ChannelType.GuildVoice || !client.isReady())
        return failed('unavailable')
      if (!channel.joinable || !channel.speakable) return failed('forbidden')

      busy.add(guildId)
      const disconnected = new AbortController()
      const playbackSignal = AbortSignal.any([signal, shutdown.signal, disconnected.signal])
      const disconnect = () => disconnected.abort('disconnected')
      const checkBotChannel = (oldState: VoiceState, state: VoiceState) => {
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
      const connectTimeout = AbortSignal.timeout(connectTimeoutMs)
      try {
        client.on(Events.VoiceStateUpdate, checkBotChannel)
        connection = voice.joinVoiceChannel({
          guildId,
          channelId,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: true,
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
        player = voice.createAudioPlayer()
        source = Readable.from([audio.attachment])
        const resource = voice.createAudioResource(source, { inputType: voice.StreamType.OggOpus })
        if (!connection.subscribe(player)) return failed('disconnected')
        const observeStart = () => {
          if (!started && resource.playbackDuration > 0) {
            started = true
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
        return failed(connectTimeout.aborted ? 'timeout' : 'unavailable')
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
    },
  }
}
