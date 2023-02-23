import { imagesUrls } from '../utils/images'

export const generateImage = () => {
  return process.env.BUCKET_URL + imagesUrls[Math.floor(Math.random() * imagesUrls.length)]
}
