import { getRandomBucketItem } from '../services/bucket-service.ts'

export const generatePhrase = async (): Promise<string | null> => {
  return getRandomBucketItem<string>('phrases.json')
}
