import { DISCORD_MAX_MESSAGE_LENGTH } from '../../config/constants';

/**
 * Truncate text to a maximum length, adding ellipsis if truncated
 * @param text The text to truncate
 * @param maxLength Maximum allowed length (default: 2000 for Discord)
 * @returns Truncated text with ellipsis if needed
 */
export function truncateText(text: string, maxLength: number = DISCORD_MAX_MESSAGE_LENGTH): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}
