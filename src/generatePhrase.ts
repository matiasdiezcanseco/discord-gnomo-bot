import { phrases } from '../utils/phrases'

export const generatePhrase = (pos?: number) => {
  if (pos && phrases[pos]) return phrases[pos]
  return phrases[Math.floor(Math.random() * phrases.length)]
}
