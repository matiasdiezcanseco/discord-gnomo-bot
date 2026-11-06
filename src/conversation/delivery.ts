/** Markdown sources and URLs are indivisible; a URL Discord cannot fit is reported explicitly. */
export function splitReply(text: string): string[] {
  const tokens = text.match(/\[[^\]\n]*\]\(https?:\/\/[^\s)]+\)|https?:\/\/\S+|\s+|[^\s]+/gu) ?? []
  const chunks: string[] = []
  let current = ''
  for (const token of tokens) {
    if (token.length > 2000 && /https?:\/\//.test(token)) throw new Error('source too long')
    for (const part of token.length > 2000 ? (token.match(/[\s\S]{1,1999}/gu) ?? []) : [token]) {
      if (current.length + part.length > 2000) {
        if (current.trim()) chunks.push(current)
        current = ''
      }
      current += part
    }
  }
  if (current.trim()) chunks.push(current)
  return chunks
}
