import { phrases } from '../../utils/phrases'

export const generatePhrase = (pos?: number) => {
  if (typeof pos === 'number' && phrases[pos]) return phrases[pos]
  return phrases[Math.floor(Math.random() * phrases.length)]
}
