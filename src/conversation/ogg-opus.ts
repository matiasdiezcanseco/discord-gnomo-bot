import OpusScript from 'opusscript'

/** Opus timestamps (granule positions, pre-skip) are always in 48 kHz units (RFC 7845 §4). */
const GRANULE_RATE = 48000
const FRAME_MS = 20

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index << 24
    for (let bit = 0; bit < 8; bit++)
      value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1
    table[index] = value >>> 0
  }
  return table
})()

/** Ogg's CRC-32: polynomial 0x04c11db7, unreflected, zero initial value (RFC 3533 §6). */
function oggCrc(data: Buffer) {
  let crc = 0
  for (const byte of data) crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ byte) & 0xff]) >>> 0
  return crc
}

function oggPage(
  packets: Buffer[],
  {
    serial,
    sequence,
    granule,
    flags,
  }: { serial: number; sequence: number; granule: bigint; flags: number },
) {
  const lacing: number[] = []
  for (const packet of packets) {
    let size = packet.length
    while (size >= 255) {
      lacing.push(255)
      size -= 255
    }
    lacing.push(size)
  }
  if (lacing.length > 255) throw new Error('Too many Ogg segments in one page')
  const header = Buffer.alloc(27 + lacing.length)
  header.write('OggS', 0, 'latin1')
  header[4] = 0
  header[5] = flags
  header.writeBigInt64LE(granule, 6)
  header.writeUInt32LE(serial, 14)
  header.writeUInt32LE(sequence, 18)
  header[26] = lacing.length
  Buffer.from(lacing).copy(header, 27)
  const page = Buffer.concat([header, ...packets])
  page.writeUInt32LE(oggCrc(page), 22)
  return page
}

function opusHead(rate: number, preSkip: number) {
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0, 'latin1')
  head[8] = 1 // version
  head[9] = 1 // mono
  head.writeUInt16LE(preSkip, 10)
  head.writeUInt32LE(rate, 12) // original input rate, informative only
  head.writeInt16LE(0, 16) // output gain
  head[18] = 0 // channel mapping family 0: mono/stereo
  return head
}

function opusTags() {
  const vendor = Buffer.from('gnomo', 'utf8')
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4)
  tags.write('OpusTags', 0, 'latin1')
  tags.writeUInt32LE(vendor.length, 8)
  vendor.copy(tags, 12)
  tags.writeUInt32LE(0, 12 + vendor.length)
  return tags
}

/**
 * Encodes 16-bit little-endian mono PCM into an Ogg/Opus file, the container Discord requires
 * for voice messages. Pure WebAssembly (opusscript): no native build, no ffmpeg in the image.
 */
export function encodeOggOpus(pcm: Buffer, rate: 24000 | 48000 = 24000, bitrate = 32000) {
  const frameSamples = (rate * FRAME_MS) / 1000
  const frameBytes = frameSamples * 2
  const scale = GRANULE_RATE / rate
  // libopus' encoder lookahead: 6.5 ms, i.e. 312 samples at 48 kHz, trimmed by the decoder.
  const preSkip = 312
  const encoder = new OpusScript(rate, 1, OpusScript.Application.VOIP)
  const serial = (Math.random() * 0xffffffff) >>> 0
  const pages: Buffer[] = []
  let sequence = 0
  try {
    encoder.setBitrate(bitrate)
    pages.push(
      oggPage([opusHead(rate, preSkip)], { serial, sequence: sequence++, granule: 0n, flags: 2 }),
    )
    pages.push(oggPage([opusTags()], { serial, sequence: sequence++, granule: 0n, flags: 0 }))
    const totalSamples = Math.floor(pcm.length / 2)
    const frames = Math.max(1, Math.ceil(totalSamples / frameSamples))
    // The final granule marks where real audio ends, so the padded tail is trimmed on playback.
    const endGranule = BigInt(preSkip + totalSamples * scale)
    let pending: Buffer[] = []
    for (let frame = 0; frame < frames; frame++) {
      const chunk = Buffer.alloc(frameBytes)
      pcm.copy(chunk, 0, frame * frameBytes, Math.min(pcm.length, (frame + 1) * frameBytes))
      // The encoder returns a view into WebAssembly memory: copy it before the next call.
      pending.push(Buffer.from(encoder.encode(chunk, frameSamples)))
      const last = frame === frames - 1
      // About one second of audio per page keeps pages well under the 255-segment limit.
      if (pending.length === 50 || last) {
        const granule = last ? endGranule : BigInt(preSkip + (frame + 1) * frameSamples * scale)
        pages.push(oggPage(pending, { serial, sequence: sequence++, granule, flags: last ? 4 : 0 }))
        pending = []
      }
    }
  } finally {
    encoder.delete()
  }
  return Buffer.concat(pages)
}
