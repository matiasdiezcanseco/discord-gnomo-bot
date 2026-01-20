/**
 * Application constants
 * Centralized magic numbers and configuration defaults
 */

/** Discord message character limit */
export const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/** Typing indicator refresh interval in milliseconds */
export const TYPING_INDICATOR_INTERVAL_MS = 7000;

/** Maximum agent processing steps */
export const MAX_AGENT_STEPS = 3;

/** Maximum web search results to return */
export const MAX_SEARCH_RESULTS = 5;

/** Default conversation TTL in seconds (24 hours) */
export const DEFAULT_CONVERSATION_TTL = 86400;

/** Default maximum messages to keep in conversation history */
export const DEFAULT_MAX_MESSAGES = 100;

/** Default OpenAI model */
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
