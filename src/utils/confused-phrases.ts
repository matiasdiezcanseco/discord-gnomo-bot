export const confusedPhrases = [
  '¿Qué? 🤔 Creo que mi cerebro de gnomo necesita un upgrade...',
  'No entendí ni papa 🥔 ¿Me lo explicas como si tuviera 5 años?',
  'Emmm... ¿sí? ¿no? ¿tal vez? Estoy más perdido que gnomo en autopista 🚗',
  'Mi detector de sentido común está fallando. Error 404: comprensión no encontrada 🤖',
  '¿Hablas en código encriptado o soy yo que soy medio tonto? 🧐',
  'Disculpa, estaba pensando en hongos mágicos y no presté atención 🍄✨',
  'Ajá, ajá... no tengo ni idea de lo que dijiste pero suena interesante 👀',
  'Creo que me perdí en la parte donde... bueno, en toda la parte 😅',
  '¿Podrías repetir eso pero en idioma gnomo? Porque no cacé nada 🎣',
  'Mi QI de gnomo no alcanza para procesar eso, intenta de nuevo porfa 🧙‍♂️',
]

export function getRandomConfusedPhrase(): string {
  return confusedPhrases[Math.floor(Math.random() * confusedPhrases.length)]
}
