/** Preserve the established fallback; explicit OPENAI_MODEL always wins. */
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'

/** Cheapest GPT Image model; explicit OPENAI_IMAGE_MODEL always wins. */
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1-mini'

/**
 * Realtime voice model: OpenAI's replacement for gpt-4o-mini-tts/tts-1, which shut down on
 * 2027-01-06. Explicit OPENAI_SPEECH_MODEL always wins, but it must be a Realtime model.
 */
export const DEFAULT_OPENAI_SPEECH_MODEL = 'gpt-realtime-2.1-mini'
/** One of the two voices OpenAI recommends for best quality (marin, cedar). */
export const DEFAULT_OPENAI_SPEECH_VOICE = 'cedar'
