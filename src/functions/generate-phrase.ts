import axios from 'axios'

export const generatePhrase = async (): Promise<string | null> => {
  try {
    const { data: phrases } = await axios.get<string[]>(process.env.BUCKET_URL + 'phrases.json')
    const phrase = phrases[Math.floor(Math.random() * phrases.length)]

    return phrase
  } catch (e) {
    console.log('Error:', e)
    return null
  }
}
