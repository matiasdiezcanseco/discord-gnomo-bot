import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { ffmpegAudioConverter } from '../src/conversation/audio-upload-converter'

const ffmpegTest = {
  skip:
    (spawnSync('ffmpeg', ['-version']).error as (Error & { code?: string }) | undefined)?.code ===
      'ENOENT' && 'ffmpeg is not installed',
}
const signal = () => new AbortController().signal

test(
  'normalizes a WAV to a one-second mono Opus file and uses the real loudness for its waveform',
  ffmpegTest,
  async () => {
    const result = await ffmpegAudioConverter()(
      await readFile('test/fixtures/audio/tone.wav'),
      60,
      signal(),
    )
    assert.equal(result.outcome, 'converted')
    assert.match(result.bytes.toString('ascii', 0, 4), /^OggS$/)
    assert.match(result.bytes.toString('ascii', 28, 36), /^OpusHead$/)
    assert.equal(result.bytes[37], 1)
    const pcm = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-xerror', '-i', 'pipe:0', '-ar', '48000', '-f', 's16le', 'pipe:1'],
      { input: result.bytes },
    )
    assert.equal(pcm.length, 96000)
    assert.equal(result.voice.durationSecs, 1)
    const waveform = Buffer.from(result.voice.waveform, 'base64')
    assert.equal(waveform.length, 10)
    assert.ok(waveform.subarray(0, 5).every((value) => value > 240))
    assert.ok(waveform.subarray(5).every((value) => value === 0))
  },
)

for (const [fixture, seconds] of [
  ['audio/tone.mp3', 1],
  ['audio/tone.ogg', 1],
  ['audio/tone.m4a', 1],
  ['audio/tone.webm', 1],
  ['tone-then-silence.ogg', 3], // The Opus fixture used by Gnomo's voice-message tests.
] as const) {
  test(
    `normalizes ${fixture} to playable Ogg/Opus with matching duration`,
    ffmpegTest,
    async () => {
      const result = await ffmpegAudioConverter()(
        await readFile(`test/fixtures/${fixture}`),
        60,
        signal(),
      )
      assert.equal(result.outcome, 'converted')
      const pcm = execFileSync(
        'ffmpeg',
        ['-v', 'error', '-xerror', '-i', 'pipe:0', '-ar', '48000', '-f', 's16le', 'pipe:1'],
        { input: result.bytes },
      )
      assert.ok(Math.abs(pcm.length / 96000 - seconds) < 0.03)
      assert.ok(Math.abs(pcm.length / 96000 - result.voice.durationSecs) <= 0.0005)
      assert.equal(Buffer.from(result.voice.waveform, 'base64').length, seconds * 10)
    },
  )
}

test('the converter refuses non-audio and audio over 60 seconds', ffmpegTest, async () => {
  const convert = ffmpegAudioConverter()
  const notAudio = await readFile('test/fixtures/audio/not-audio.txt')
  const tooLong = await readFile('test/fixtures/audio/over-60s.ogg')
  assert.deepEqual(await convert(notAudio, 60, signal()), { outcome: 'invalid' })
  assert.deepEqual(await convert(tooLong, 60, signal()), { outcome: 'too_long' })
})
