import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MessageFlags } from 'discord.js'
import { createConversation, type ModelInput, type Reply } from '../src/conversation/harness'
import { composeCapabilities } from '../src/conversation/capabilities'
import {
  MAX_SPEECH_CHARS,
  openaiRealtimeSpeech,
  SpeechRejected,
  type SpeechGenerator,
} from '../src/conversation/speech-generation'
import {
  describeOggOpus,
  InvalidVoiceAudio,
  pcmVoiceMetadata,
} from '../src/conversation/voice-message'
import { encodeOggOpus } from '../src/conversation/ogg-opus'
import type { RequesterCooldown } from '../src/conversation/paid-generation'
import type { Invocation } from '../src/core/conversation/invocation'
import { voiceFile, voiceMessageBody } from '../src/modules/discord/voice-reply'

// 1.5 s of a 440 Hz tone followed by 1.5 s of silence, encoded by ffmpeg/libopus.
const fixture = readFileSync(join(__dirname, 'fixtures', 'tone-then-silence.ogg'))

const base: Invocation = {
  messageId: 'm1',
  guildId: 'g',
  channelId: 'c',
  requester: { id: 'u', username: 'Ana' },
  content: 'mándame un audio saludando',
  createdAt: Date.parse('2026-11-09T15:00:00Z'),
  attachments: [],
}

function model(text = 'Ahí va.', speech = 'Habla causa, ¿qué fue?') {
  return {
    generate: async ({ results }: ModelInput) =>
      results.length
        ? { text: results[0].status === 'success' ? text : 'falló', calls: [] }
        : {
            text: '',
            calls: [
              {
                id: 's',
                name: 'speech_generate',
                input: { text: speech, style: 'emocionado' },
              },
            ],
          },
  }
}

function fakeGenerator(behaviour: () => Promise<void> = async () => {}) {
  const calls: { text: string; style?: string }[] = []
  const generator: SpeechGenerator = {
    async generate(text, style) {
      calls.push({ text, style })
      await behaviour()
      return { data: fixture, voice: describeOggOpus(fixture) }
    },
  }
  return { generator, calls }
}

function memoryQuota() {
  const taken = new Set<string>()
  const quota: RequesterCooldown = {
    async reserve(invocation) {
      const key = invocation.requester.id
      if (taken.has(key)) return { granted: false, retryInMs: 7 * 60_000 }
      taken.add(key)
      return { granted: true, release: async () => void taken.delete(key) }
    },
  }
  return quota
}

function app(
  generator: SpeechGenerator,
  quota: RequesterCooldown,
  reply = 'Ahí va.',
  speech?: string,
) {
  const replies: Reply[] = []
  const conversation = createConversation({
    catalog: composeCapabilities({ speech: { generator, cooldown: quota, cooldownMinutes: 10 } }),
    authorize: async () => true,
    claim: async () => true,
    model: model(reply, speech),
    reply: async (_origin, message) => {
      replies.push(message)
    },
  })
  return {
    replies,
    handle: (invocation: Partial<Invocation> = {}) =>
      conversation.handle({ ...base, ...invocation }),
  }
}

test('Ogg/Opus metadata: duration from the granule and a waveform that follows loudness', () => {
  const { durationSecs, waveform } = describeOggOpus(fixture)
  assert.ok(Math.abs(durationSecs - 3) < 0.05, `duration ${durationSecs}`)
  const samples = [...Buffer.from(waveform, 'base64')]
  assert.equal(samples.length, 30, 'about ten samples per second')
  assert.ok(samples.every((value) => value >= 0 && value <= 255))
  const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
  // Skip the edges around the cut; the tone half must read clearly louder than the silence.
  assert.ok(average(samples.slice(2, 13)) > average(samples.slice(17, 28)) + 100)
})

test('anything that is not Ogg/Opus is refused rather than sent as a broken voice message', () => {
  assert.throws(() => describeOggOpus(Buffer.from('ID3 mp3 bytes')), InvalidVoiceAudio)
  assert.throws(() => describeOggOpus(fixture.subarray(0, 40)), InvalidVoiceAudio)
})

test('speech generation is a bounded, labelled write', () => {
  const [tool] = composeCapabilities({ speech: {} }).tools.filter(
    (t) => t.name === 'speech_generate',
  )
  assert.equal(tool.effect, 'write')
  assert.equal(tool.maxCalls, 1)
  assert.equal(tool.label, 'crear el audio')
})

test('the audio is delivered alone, after the text, as a voice-message file', async () => {
  const { generator, calls } = fakeGenerator()
  const { replies, handle } = app(generator, memoryQuota())
  await handle()
  assert.deepEqual(calls, [{ text: 'Habla causa, ¿qué fue?', style: 'emocionado' }])
  assert.equal(replies.length, 2)
  assert.equal(replies[0].content, 'Ahí va.')
  assert.equal(replies[0].files, undefined)
  assert.equal(replies[1].content, '', 'Discord rejects voice messages with text')
  assert.equal(replies[1].files?.length, 1)
  const [file] = replies[1].files!
  assert.equal(file.name, 'gnomo-m1.ogg')
  assert.ok(file.voice && file.voice.durationSecs > 2.9)
})

test('with no model text, only the voice message is sent', async () => {
  const { generator } = fakeGenerator()
  const { replies, handle } = app(generator, memoryQuota(), '')
  await handle()
  assert.equal(replies.length, 1)
  assert.ok(replies[0].files?.[0].voice)
})

test('each requester waits out the cooldown; a refusal gives the slot back', async () => {
  let fail: Error | undefined = new SpeechRejected('policy')
  const { generator, calls } = fakeGenerator(async () => {
    if (fail) throw fail
  })
  const { replies, handle } = app(generator, memoryQuota())
  await handle({ messageId: 'a' })
  assert.equal(replies.at(-1)!.files, undefined)
  fail = undefined
  await handle({ messageId: 'b' })
  assert.equal(calls.length, 2, 'the refusal did not consume the slot')
  assert.ok(replies.at(-1)!.files?.[0].voice)
  await handle({ messageId: 'c' })
  assert.equal(calls.length, 2, 'second audio within the cooldown spends no credit')
  assert.equal(replies.at(-1)!.files, undefined)
})

test('text over the safe length is refused before the quota or any credit is touched', async () => {
  const { generator, calls } = fakeGenerator()
  let reserved = 0
  const quota: RequesterCooldown = {
    async reserve() {
      reserved++
      return { granted: true, release: async () => {} }
    },
  }
  const { replies, handle } = app(generator, quota, 'Ahí va.', 'a'.repeat(MAX_SPEECH_CHARS + 1))
  await handle()
  assert.equal(calls.length, 0)
  assert.equal(reserved, 0)
  assert.ok(replies.every((reply) => !reply.files))
})

test('Discord payload: voice flag, no content, attachment metadata bound to the upload', () => {
  const voice = describeOggOpus(fixture)
  const file = voiceFile({
    content: '',
    allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    files: [{ name: 'gnomo-m1.ogg', attachment: fixture, voice }],
  })
  assert.ok(file)
  const body = voiceMessageBody('123', file)
  assert.equal(body.flags, MessageFlags.IsVoiceMessage)
  assert.equal('content' in body, false)
  assert.deepEqual(body.message_reference, { message_id: '123', fail_if_not_exists: false })
  assert.deepEqual(body.attachments, [
    {
      id: 0,
      filename: 'gnomo-m1.ogg',
      duration_secs: voice.durationSecs,
      waveform: voice.waveform,
    },
  ])
  assert.equal(
    voiceFile({
      content: 'x',
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
      files: [{ name: 'a.jpg', attachment: Buffer.from('') }],
    }),
    undefined,
  )
})

/** 16-bit mono PCM at 24 kHz: `toneSecs` of a 440 Hz sine, then `silenceSecs` of silence. */
function pcm(toneSecs: number, silenceSecs: number, rate = 24000) {
  const tone = Math.round(toneSecs * rate)
  const total = tone + Math.round(silenceSecs * rate)
  const buffer = Buffer.alloc(total * 2)
  for (let i = 0; i < tone; i++)
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), i * 2)
  return buffer
}

test('PCM is encoded into a valid Ogg/Opus whose end granule trims to the exact length', () => {
  const audio = encodeOggOpus(pcm(1.5, 1.5))
  assert.equal(audio.toString('latin1', 0, 4), 'OggS')
  const { durationSecs } = describeOggOpus(audio)
  assert.equal(durationSecs, 3)
  // A length that is not a whole number of 20 ms frames still reports its real duration.
  assert.equal(describeOggOpus(encodeOggOpus(pcm(0.333, 0))).durationSecs, 0.33)
  // Long audio spans several pages and stays readable.
  assert.equal(describeOggOpus(encodeOggOpus(pcm(30, 5))).durationSecs, 35)
})

test('the waveform comes from the real PCM loudness', () => {
  const { durationSecs, waveform } = pcmVoiceMetadata(pcm(1.5, 1.5), 24000)
  assert.equal(durationSecs, 3)
  const samples = [...Buffer.from(waveform, 'base64')]
  assert.equal(samples.length, 30)
  assert.ok(samples.slice(0, 15).every((value) => value > 240))
  assert.ok(samples.slice(15).every((value) => value === 0))
  assert.equal(Buffer.from(pcmVoiceMetadata(pcm(600, 0), 24000).waveform, 'base64').length, 256)
  assert.throws(() => pcmVoiceMetadata(Buffer.alloc(0), 24000), InvalidVoiceAudio)
})

/** Scripted stand-in for the Realtime WebSocket: replies to response.create with `events`. */
/** The client events the tests inspect, as sent over the socket. */
interface SentEvent {
  type: string
  session: { output_modalities: string[]; audio: { output: unknown }; instructions: string }
  item: { content: { text: string }[] }
}
function fakeRealtime(events: (sent: SentEvent[]) => object[]) {
  const sent: SentEvent[] = []
  const seen: { url: string; headers: Record<string, string> }[] = []
  let closed = false
  const connect = (url: string, headers: Record<string, string>) => {
    seen.push({ url, headers })
    const target = new EventTarget()
    const socket = Object.assign(target, {
      send(data: string) {
        sent.push(JSON.parse(data) as SentEvent)
        if (sent.at(-1)?.type === 'response.create')
          for (const event of events(sent))
            queueMicrotask(() =>
              target.dispatchEvent(
                Object.assign(new Event('message'), { data: JSON.stringify(event) }),
              ),
            )
      },
      close() {
        closed = true
      },
    })
    queueMicrotask(() => target.dispatchEvent(new Event('open')))
    return socket as unknown as WebSocket
  }
  return { connect, sent, seen, isClosed: () => closed }
}

test('Realtime speech: narrator session, PCM deltas encoded to a voice-message Ogg', async () => {
  const audio = pcm(1, 0)
  const realtime = fakeRealtime(() => [
    { type: 'response.output_audio.delta', delta: audio.subarray(0, 24000).toString('base64') },
    { type: 'response.output_audio.delta', delta: audio.subarray(24000).toString('base64') },
    { type: 'response.done', response: { status: 'completed' } },
  ])
  const generator = openaiRealtimeSpeech({
    apiKey: 'sk-test',
    model: 'gpt-realtime-2.1-mini',
    voice: 'cedar',
    connect: realtime.connect,
  })
  const speech = await generator.generate('Habla causa', 'susurrando', new AbortController().signal)
  assert.equal(realtime.seen[0].url, 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini')
  assert.deepEqual(realtime.seen[0].headers, { Authorization: 'Bearer sk-test' })
  const [session, item, response] = realtime.sent
  assert.equal(session.type, 'session.update')
  assert.deepEqual(session.session.output_modalities, ['audio'])
  assert.deepEqual(session.session.audio.output, {
    format: { type: 'audio/pcm', rate: 24000 },
    voice: 'cedar',
  })
  assert.match(session.session.instructions, /palabra por palabra/)
  assert.match(session.session.instructions, /susurrando/)
  assert.equal(item.item.content[0].text, '<<<\nHabla causa\n>>>')
  assert.equal(response.type, 'response.create')
  assert.equal(speech.data.toString('latin1', 0, 4), 'OggS')
  assert.equal(describeOggOpus(speech.data).durationSecs, 1)
  assert.equal(speech.voice.durationSecs, 1)
  assert.ok(realtime.isClosed(), 'one socket per audio, closed when done')
})

test('Realtime speech: audio past 30 s is cut there and the socket closed early', async () => {
  const second = pcm(1, 0)
  const realtime = fakeRealtime(() => [
    ...Array.from({ length: 45 }, () => ({
      type: 'response.output_audio.delta',
      delta: second.toString('base64'),
    })),
    { type: 'response.done', response: { status: 'completed' } },
  ])
  const speech = await openaiRealtimeSpeech({
    apiKey: 'k',
    model: 'm',
    voice: 'v',
    connect: realtime.connect,
  }).generate('x', undefined, new AbortController().signal)
  assert.equal(describeOggOpus(speech.data).durationSecs, 30)
  assert.equal(speech.voice.durationSecs, 30)
  assert.ok(realtime.isClosed())
})

test('Realtime speech: a content filter is a refusal; errors and empty audio are failures', async () => {
  const run = (events: object[]) =>
    openaiRealtimeSpeech({
      apiKey: 'k',
      model: 'm',
      voice: 'v',
      connect: fakeRealtime(() => events).connect,
    }).generate('x', undefined, new AbortController().signal)
  await assert.rejects(
    run([
      {
        type: 'response.done',
        response: { status: 'incomplete', status_details: { reason: 'content_filter' } },
      },
    ]),
    SpeechRejected,
  )
  await assert.rejects(
    run([{ type: 'error', error: { code: 'invalid_api_key' } }]),
    /invalid_api_key/,
  )
  await assert.rejects(
    run([{ type: 'response.done', response: { status: 'completed' } }]),
    /without audio/,
  )
  await assert.rejects(run([{ type: 'response.done', response: { status: 'failed' } }]), /failed/)
})

test('Realtime speech: aborting the invocation closes the socket and fails the call', async () => {
  const realtime = fakeRealtime(() => [])
  const controller = new AbortController()
  const pending = openaiRealtimeSpeech({
    apiKey: 'k',
    model: 'm',
    voice: 'v',
    connect: realtime.connect,
  }).generate('x', undefined, controller.signal)
  controller.abort(new Error('budget exhausted'))
  await assert.rejects(pending, /budget exhausted/)
  assert.ok(realtime.isClosed())
})
