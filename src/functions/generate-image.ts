import { getRandomBucketItem, getBucketUrl } from '../services/bucket-service.ts'

export const generateImage = async (): Promise<string | null> => {
  const image = await getRandomBucketItem<string>('images.json')
  if (!image) return null
  return getBucketUrl(image)
}
