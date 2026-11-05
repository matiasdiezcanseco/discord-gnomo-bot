/** Bounded in-process admission. Cancellation removes queued work, never starts it later. */
export class Admission {
  private active = 0
  private queue: (() => void)[] = []
  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid concurrency')
  }
  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    if (this.active >= this.limit) {
      if (this.queue.length >= 100) throw new Error('queue full')
      await new Promise<void>((resolve, reject) => {
        const start = () => {
          signal.removeEventListener('abort', cancel)
          resolve()
        }
        const cancel = () => {
          this.queue = this.queue.filter((item) => item !== start)
          reject(new Error('timeout'))
        }
        this.queue.push(start)
        signal.addEventListener('abort', cancel, { once: true })
      })
    } else this.active++
    if (signal.aborted) {
      this.release()
      signal.throwIfAborted()
    }
    return () => this.release()
  }
  private release() {
    const next = this.queue.shift()
    if (next) next()
    else this.active--
  }
}
