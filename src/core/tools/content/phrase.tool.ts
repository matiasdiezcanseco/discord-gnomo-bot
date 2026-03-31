import { Injectable } from '@nestjs/common'
import { tool } from 'ai'
import { z } from 'zod'
import type { Tool } from 'ai'
import type { BotTool } from '../tool.interface'
import type { BotContext } from '../../context/bot-context'
import { BucketService } from '../../../modules/services/bucket/bucket.service'

@Injectable()
export class PhraseTool implements BotTool {
  readonly name = 'phrase'

  constructor(private readonly bucket: BucketService) {}

  build(_ctx: BotContext): Record<string, Tool> {
    return {
      generatePhrase: tool({
        description:
          'Envía una frase o cita aleatoria del bot de la colección de frases guardadas para recordar al Gnomo. Usa esto cuando el usuario pida una frase o se refiera a las frases del bot.',
        inputSchema: z.object({}),
        execute: async () => {
          const phrase = await this.bucket.getRandomBucketItem<string>('phrases.json')

          if (!phrase) {
            return { success: false, text: 'No hay frases disponibles' }
          }

          return { success: true, text: phrase }
        },
      }),
    }
  }
}
