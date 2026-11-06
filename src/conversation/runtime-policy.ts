/** Trusted deployment policy. Pause denies new work and delivery, retaining durable state. */
export interface RuntimeConfiguration {
  get<T>(key: string, fallback?: T): T | undefined
}
export function runtimeAllows(
  config: RuntimeConfiguration,
  origin: { guildId: string; channelId: string },
): boolean {
  if (origin.guildId !== config.get<string>('GUILD_ID')) return false
  const mode = config.get<string>('RUNTIME_MODE', 'paused')
  return (
    mode === 'guild' ||
    (mode === 'pilot' &&
      (config.get<string>('RUNTIME_CHANNEL_IDS', '') ?? '')
        .split(',')
        .map((id) => id.trim())
        .includes(origin.channelId))
  )
}
