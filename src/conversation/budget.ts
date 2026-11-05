export interface Clock {
  now(): number
  schedule(callback: () => void, delay: number): () => void
}
export const systemClock: Clock = {
  now: () => Date.now(),
  schedule: (callback, delay) => {
    const timer = setTimeout(callback, delay)
    return () => clearTimeout(timer)
  },
}
export class Budget {
  readonly controller = new AbortController()
  calls = 0
  steps = 0
  private readonly cancelTimer: () => void
  constructor(
    readonly clock: Clock,
    readonly startedAt: number,
    readonly duration = 12000,
  ) {
    this.cancelTimer = clock.schedule(
      () => this.controller.abort(new Error('timeout')),
      Math.max(0, startedAt + duration - clock.now()),
    )
  }
  check() {
    if (this.clock.now() >= this.startedAt + this.duration)
      this.controller.abort(new Error('timeout'))
    this.controller.signal.throwIfAborted()
  }
  async wait<T>(work: () => Promise<T>): Promise<T> {
    this.check()
    const signal = this.controller.signal
    let onAbort!: () => void
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('timeout'))
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      return await Promise.race([work(), cancelled])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }
  async external<T>(work: () => Promise<T>): Promise<T> {
    this.check()
    if (this.calls >= 8) throw new Error('budget')
    this.calls++
    return this.wait(work)
  }
  close() {
    this.cancelTimer()
    this.controller.abort()
  }
}
