import { embed } from 'ai'
import { openai } from '@ai-sdk/openai'
import { ConfigService } from '@nestjs/config'
import { DEFAULT_OPENAI_EMBEDDING_MODEL } from '../../../config/constants'

export async function generateEmbedding(
  text: string,
  configService: ConfigService,
): Promise<number[]> {
  const model = configService.get<string>(
    'OPENAI_EMBEDDING_MODEL',
    DEFAULT_OPENAI_EMBEDDING_MODEL,
  ) as 'text-embedding-3-small'

  const { embedding } = await embed({
    model: openai.embedding(model),
    value: text,
  })

  return embedding
}
