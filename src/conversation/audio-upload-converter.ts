import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { encodeOggOpus } from './ogg-opus'
import { pcmVoiceMetadata, type VoiceMetadata } from './voice-message'

type Conversion =
  | { outcome: 'converted'; bytes: Buffer; voice: VoiceMetadata }
  | { outcome: 'too_long' | 'invalid' | 'unavailable' }

export type AudioUploadConverter = (
  bytes: Buffer,
  maxSeconds: number,
  signal: AbortSignal,
) => Promise<Conversion>

const run = promisify(execFile)
const rate = 24000
const bytesPerSecond = rate * 2

export function ffmpegAudioConverter(executable = 'ffmpeg'): AudioUploadConverter {
  return async (bytes, maxSeconds, signal) => {
    signal.throwIfAborted()
    // Seekable input supports M4A with the track index at the end of the file.
    const directory = await mkdtemp(join(tmpdir(), 'gnomo-audio-'))
    try {
      const input = join(directory, 'upload')
      await writeFile(input, bytes, { signal })
      const maxBytes = maxSeconds * bytesPerSecond
      // Read up to one millisecond beyond the limit so oversized audio is refused.
      const decode = await run(
        executable,
        [
          '-nostdin',
          '-v',
          'error',
          '-xerror',
          '-filter_threads',
          '1',
          '-threads',
          '1',
          '-protocol_whitelist',
          'file',
          '-format_whitelist',
          'mp3,wav,ogg,mov,matroska,webm',
          '-i',
          input,
          '-map',
          '0:a:0',
          '-af',
          'asetpts=N/SR/TB',
          '-ac',
          '1',
          '-ar',
          String(rate),
          '-c:a',
          'pcm_s16le',
          '-t',
          (maxSeconds + 0.001).toFixed(3),
          '-f',
          's16le',
          'pipe:1',
        ],
        { encoding: 'buffer', maxBuffer: maxBytes + bytesPerSecond, timeout: 10000, signal },
      ).then(
        ({ stdout }) => ({ pcm: stdout }),
        (error: Error & { code?: string }) => ({ error }),
      )
      signal.throwIfAborted()
      if ('error' in decode)
        return { outcome: decode.error.code === 'ENOENT' ? 'unavailable' : 'invalid' }
      const { pcm } = decode
      if (pcm.length > maxBytes) return { outcome: 'too_long' }
      if (pcm.length < 2) return { outcome: 'invalid' }
      return {
        outcome: 'converted',
        bytes: encodeOggOpus(pcm, rate, { serial: 1 }),
        voice: { ...pcmVoiceMetadata(pcm, rate), durationSecs: pcm.length / bytesPerSecond },
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}
