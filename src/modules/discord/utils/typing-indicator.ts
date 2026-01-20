import type { SendableChannels } from 'discord.js';
import { TYPING_INDICATOR_INTERVAL_MS } from '../../config/constants';

/**
 * Manages a typing indicator that stays active during async operations
 */
export class TypingIndicator {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private channel: SendableChannels;

  constructor(channel: SendableChannels) {
    this.channel = channel;
  }

  /**
   * Start the typing indicator
   * Sends typing signal immediately and refreshes every 7 seconds
   */
  async start(): Promise<void> {
    await this.channel.sendTyping();
    this.intervalId = setInterval(() => {
      this.channel.sendTyping().catch(() => this.stop());
    }, TYPING_INDICATOR_INTERVAL_MS);
  }

  /**
   * Stop the typing indicator
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

/**
 * Execute an async operation while showing a typing indicator
 * @param channel The channel to show typing in
 * @param operation The async operation to execute
 * @returns The result of the operation
 */
export async function withTypingIndicator<T>(
  channel: SendableChannels,
  operation: () => Promise<T>,
): Promise<T> {
  const indicator = new TypingIndicator(channel);
  await indicator.start();
  try {
    return await operation();
  } finally {
    indicator.stop();
  }
}
