import { phrases } from '../utils/phrases'

export const generatePhrase = () => {
  return phrases[Math.floor(Math.random() * phrases.length)]
}
