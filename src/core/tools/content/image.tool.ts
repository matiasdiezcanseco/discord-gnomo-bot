import { Injectable } from '@nestjs/common'
import { tool } from 'ai'
import { z } from 'zod'
import type { Tool } from 'ai'
import type { BotTool } from '../tool.interface'
import type { BotContext } from '../../context/bot-context'
import { BucketService } from '../../../modules/services/bucket/bucket.service'

@Injectable()
export class ImageTool implements BotTool {
  readonly name = 'image'

  constructor(private readonly bucket: BucketService) {}

  build(_ctx: BotContext): Record<string, Tool> {
    return {
      generateImage: tool({
        description:
          'Envía una imagen o foto aleatoria del bot de la colección de fotos guardadas para recordar al Gnomo. Usa esto cuando el usuario pida una foto, se refiera a "las fotos guardadas", "fotos para recordar al gnomo", o simplemente quiera ver una imagen.',
        inputSchema: z.object({}),
        execute: async () => {
          const image = await this.bucket.getRandomBucketItem<string>('images.json')

          if (!image) {
            return { success: false, text: 'No hay imágenes disponibles' }
          }

          const imageUrl = this.bucket.getBucketUrl(image)
          return { success: true, text: imageUrl }
        },
      }),
    }
  }
}
