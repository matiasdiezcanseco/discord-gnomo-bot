/** What Discord needs, besides the audio itself, to render an attachment as a voice message. */
export interface VoiceMetadata {
  durationSecs: number
  /** Base64 byte array, one 0–255 amplitude per sample, at most 256 samples. */
  waveform: string
}

export class InvalidVoiceAudio extends Error {}

const OPUS_RATE = 48000
const MAX_SAMPLES = 256

/** About ten bars per second, like Discord's own recordings, capped at its 256-sample limit. */
function sampleCount(ms: number) {
  return Math.max(1, Math.min(MAX_SAMPLES, Math.round(ms / 100)))
}

/**
 * Voice-message metadata from the raw 16-bit mono PCM before encoding: exact duration, and a
 * waveform of the real loudness (RMS per stretch, scaled to the loudest one).
 */
export function pcmVoiceMetadata(pcm: Buffer, rate: number): VoiceMetadata {
  const total = Math.floor(pcm.length / 2)
  if (!total) throw new InvalidVoiceAudio('Empty PCM audio')
  const count = sampleCount((total / rate) * 1000)
  const rms = new Array<number>(count).fill(0)
  for (let bucket = 0; bucket < count; bucket++) {
    const start = Math.floor((bucket * total) / count)
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * total) / count))
    let sum = 0
    for (let index = start; index < end; index++) sum += pcm.readInt16LE(index * 2) ** 2
    rms[bucket] = Math.sqrt(sum / (end - start))
  }
  const peak = Math.max(...rms)
  return {
    durationSecs: Math.round((total / rate) * 100) / 100,
    waveform: Buffer.from(
      rms.map((value) => (peak ? Math.round((value / peak) * 255) : 0)),
    ).toString('base64'),
  }
}

/** Frame duration in ms from an Opus TOC configuration number (RFC 6716 §3.1). */
function frameMs(config: number) {
  if (config < 12) return [10, 20, 40, 60][config % 4]
  if (config < 16) return [10, 20][config % 2]
  return [2.5, 5, 10, 20][config % 4]
}

/** Duration in ms of one Opus packet: frame size times frame count (RFC 6716 §3.2). */
function packetMs(packet: Buffer) {
  if (!packet.length) return 0
  const toc = packet[0]
  const code = toc & 3
  const frames = code === 0 ? 1 : code < 3 ? 2 : packet.length > 1 ? packet[1] & 0x3f : 0
  return frameMs(toc >> 3) * frames
}

/** Splits an Ogg stream into its logical packets, joining those that span pages (RFC 3533). */
function oggPackets(data: Buffer) {
  const packets: Buffer[] = []
  let lastGranule = -1n
  let pending: Buffer[] = []
  let offset = 0
  while (offset < data.length) {
    if (offset + 27 > data.length || data.toString('latin1', offset, offset + 4) !== 'OggS')
      throw new InvalidVoiceAudio('Malformed Ogg page')
    const granule = data.readBigInt64LE(offset + 6)
    const segments = data[offset + 26]
    const table = offset + 27
    let body = table + segments
    if (body > data.length) throw new InvalidVoiceAudio('Truncated Ogg page')
    for (let index = 0; index < segments; index++) {
      const size = data[table + index]
      if (body + size > data.length) throw new InvalidVoiceAudio('Truncated Ogg segment')
      pending.push(data.subarray(body, body + size))
      body += size
      if (size < 255) {
        packets.push(Buffer.concat(pending))
        pending = []
      }
    }
    if (granule >= 0n) lastGranule = granule
    offset = body
  }
  return { packets, lastGranule }
}

/**
 * Reads an Ogg/Opus file (what OpenAI returns for `opus`) and derives the voice-message metadata
 * without decoding audio: duration from the final granule position, and a waveform from the
 * bytes per second of each stretch. Opus is VBR, so speech takes far more bytes than silence:
 * the shape matches the loudness envelope closely enough for Discord's preview bars.
 */
export function describeOggOpus(data: Buffer): VoiceMetadata {
  const { packets, lastGranule } = oggPackets(data)
  const [head, , ...audio] = packets
  if (!head || head.length < 19 || head.toString('latin1', 0, 8) !== 'OpusHead')
    throw new InvalidVoiceAudio('Not an Ogg/Opus stream')
  const preSkip = head.readUInt16LE(10)
  const timeline: { at: number; ms: number; bytes: number }[] = []
  let elapsed = 0
  for (const packet of audio) {
    const ms = packetMs(packet)
    timeline.push({ at: elapsed, ms, bytes: packet.length })
    elapsed += ms
  }
  const fromGranule = lastGranule > 0n ? Number(lastGranule - BigInt(preSkip)) / OPUS_RATE : 0
  const durationSecs = fromGranule > 0 ? fromGranule : elapsed / 1000
  if (!(durationSecs > 0) || !timeline.length) throw new InvalidVoiceAudio('Empty Opus audio')

  const count = sampleCount(elapsed)
  const bytes = new Array<number>(count).fill(0)
  const ms = new Array<number>(count).fill(0)
  for (const packet of timeline) {
    const index = Math.min(count - 1, Math.floor((packet.at / elapsed) * count))
    bytes[index] += packet.bytes
    ms[index] += packet.ms
  }
  const rates = bytes.map((value, index) => (ms[index] ? value / ms[index] : 0))
  const floor = Math.min(...rates)
  const peak = Math.max(...rates)
  const span = peak - floor
  const samples = rates.map((rate) => (span > 0 ? Math.round(((rate - floor) / span) * 255) : 128))
  return {
    durationSecs: Math.round(durationSecs * 100) / 100,
    waveform: Buffer.from(samples).toString('base64'),
  }
}
