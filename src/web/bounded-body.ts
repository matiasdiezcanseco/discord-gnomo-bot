/** Consume a whole body within a byte limit; transports and domain validation stay at callers. */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  signal.throwIfAborted()
  const reader = body.getReader()
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) throw new Error('Response too large')
      chunks.push(value)
    }
    return Buffer.concat(chunks, bytes)
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel()
    reader.releaseLock()
  }
}
