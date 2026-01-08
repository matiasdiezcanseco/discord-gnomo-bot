import axios from 'axios'

export const generateImage = async (): Promise<string | null> => {
  try {
    const { data: images } = await axios.get<string[]>(process.env.BUCKET_URL + 'images.json')
    const image = images[Math.floor(Math.random() * images.length)]

    return process.env.BUCKET_URL + image
  } catch (e) {
    console.log('Error:', e)
    return null
  }
}
