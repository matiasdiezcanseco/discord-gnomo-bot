import { imagesUrls } from '../utils/images'

export const generateImage = (pos?: number) => {
  if (pos && imagesUrls[pos]) return process.env.BUCKET_URL + imagesUrls[pos]
  return process.env.BUCKET_URL + imagesUrls[Math.floor(Math.random() * imagesUrls.length)]
}
