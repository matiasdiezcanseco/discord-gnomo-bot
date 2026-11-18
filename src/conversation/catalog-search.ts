import { sql, type SQLWrapper } from 'drizzle-orm'

/** Lowercase, accents removed: «canción» matches «cancion». */
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const stopwords = new Set(
  'el la los las un una unos unas de del al y o que en con por para sin sobre este esta ese esa eso the of and'.split(
    ' ',
  ),
)

/** Extract distinct terms, with optional catalog-specific words to ignore. */
export function queryTerms(query: string, ignoredWords?: ReadonlySet<string>): string[] {
  return [
    ...new Set(
      fold(query)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length >= 3 && !stopwords.has(term) && !ignoredWords?.has(term)),
    ),
  ]
}

type SearchCandidate = {
  title: string
  description: string
  tags: readonly string[]
  similarity?: number | null
}

/** Title and tag matches count double. Ties keep the caller's order. */
export function rankCatalog<T extends SearchCandidate>(
  rows: readonly T[],
  terms: readonly string[],
  supplementalText?: (row: T) => string | null | undefined,
): T[] {
  return rows
    .map((row) => {
      const strong = fold(`${row.title} ${row.tags.join(' ')}`)
      const weak = fold(`${row.description} ${supplementalText?.(row) ?? ''}`)
      const lexical = terms.reduce(
        (score, term) => score + (strong.includes(term) ? 2 : weak.includes(term) ? 1 : 0),
        0,
      )
      const similarity = row.similarity ?? 0
      const vector = similarity >= 0.4 ? similarity * 4 : 0
      return { row, score: lexical + vector }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ row }) => row)
}

/** Compare only embeddings from the same model and with the same dimensions. */
export function catalogSimilarity(
  embedding: SQLWrapper,
  embeddingModel: SQLWrapper,
  query: { vector: readonly number[]; model: string } | null,
) {
  const vector = query ? JSON.stringify(query.vector) : null
  return sql<number | null>`CASE WHEN ${embeddingModel}=${query?.model ?? null}
    AND vector_dims(${embedding})=vector_dims(${vector}::vector)
    THEN 1-(${embedding} <=> ${vector}::vector) ELSE NULL END`
}
