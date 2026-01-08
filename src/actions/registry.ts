import { tool } from 'ai'
import { z } from 'zod'
import { generatePhrase } from '../functions/generate-phrase.ts'
import { generateImage } from '../functions/generate-image.ts'

// Create actions
export const createActions = () => ({
  generatePhrase: tool({
    description: 'Envía una frase o cita aleatoria al usuario. Usa esto cuando el usuario quiera una frase.',
    inputSchema: z.object({}),
    execute: async () => {
      const phrase = await generatePhrase()
      return { text: phrase }
    }
  }),
  generateImage: tool({
    description: 'Envía una imagen o foto aleatoria al usuario. Usa esto cuando el usuario quiera ver una image o una foto.',
    inputSchema: z.object({}),
    execute: async () => {
      const image = await generateImage()
      return { text: image }
    }
  })
})

// Get tools for AI SDK
export function getTools() {
  return createActions()
}
