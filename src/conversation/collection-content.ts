import { readBoundedBody } from '../web/bounded-body'
import { z } from 'zod'
import { defineCapability, type ExecutionContext } from './catalog'
import type { ToolResult } from './harness'

export interface CollectionSource {
  read(file: 'phrases.json' | 'images.json', signal: AbortSignal): Promise<string[]>
  photoUrl(path: string): string
}

/** Trusted configured bucket only; never accepts a URL from the invocation/model. */
export function bucketCollection(
  base: string | undefined,
  transport: typeof fetch = fetch,
): CollectionSource | undefined {
  if (!base) return undefined
  const url = new URL(base.endsWith('/') ? base : `${base}/`)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid bucket URL')
  return {
    async read(file, signal) {
      const response = await transport(new URL(file, url), { signal, redirect: 'error' })
      if (!response.ok || !response.body) throw new Error('Collection unavailable')
      const bytes = await readBoundedBody(response.body, 524288, signal)
      return z
        .array(z.string().min(1).max(8000))
        .max(10000)
        .parse(JSON.parse(bytes.toString('utf8')))
    },
    photoUrl(path) {
      const photo = new URL(path, url)
      if (
        photo.origin !== url.origin ||
        !photo.pathname.startsWith(url.pathname) ||
        photo.username ||
        photo.password ||
        photo.hash ||
        /[\s<>]/.test(photo.href)
      )
        throw new Error('Invalid collection photo')
      return photo.href
    },
  }
}

export function collectionCapabilities(source?: CollectionSource) {
  return (['phrase', 'photo'] as const).map((kind) => {
    const label = kind === 'phrase' ? 'frases' : 'fotos'
    const output = z
      .strictObject({ kind: z.literal(kind), text: z.string().min(1).max(8000) })
      .nullable()
    const render = (result: ToolResult): string => {
      if (result.status === 'success') return output.parse(result.value)!.text
      if (result.status === 'empty') return `No hay ${label} disponibles en la colección.`
      if (result.status === 'denied') return 'No tengo permiso para consultar la colección aquí.'
      return `No pude consultar la colección de ${label}. Inténtalo nuevamente más tarde.`
    }
    return defineCapability({
      name: `collection_${kind}`,
      // Chosen by the model from intent; there is no keyword/regex shortcut.
      description:
        kind === 'phrase'
          ? 'Entrega una frase al azar de la colección del Gnomo cuando el solicitante quiere una frase, dicho o cita del Gnomo, la pida como la pida. El sistema la entrega textual al solicitante: no la repitas ni la reescribas. No genera frases nuevas; si pide una frase inventada o sobre un tema concreto, responde tú sin esta herramienta.'
          : 'Entrega una foto al azar de la colección del Gnomo cuando el solicitante quiere una foto o imagen del Gnomo, la pida como la pida. El sistema entrega la URL textual al solicitante: no la repitas ni la reescribas. No genera ni edita imágenes.',
      capability: `collection.${kind}`,
      scope: 'channel',
      effect: 'read',
      input: z.strictObject({}),
      output,
      maxCalls: 1,
      maxResultChars: 16000,
      available: async () => !!source,
      verbatim: render,
      // A photo reply is only the bare URL so Discord shows the image in the chat.
      standalone: kind === 'photo',
      execute: async (_, context: ExecutionContext) => {
        const items = await context.external(() =>
          source!.read(kind === 'phrase' ? 'phrases.json' : 'images.json', context.signal),
        )
        if (!items.length) return null
        const item = items[Math.floor(Math.random() * items.length)]
        return { kind, text: kind === 'phrase' ? item : source!.photoUrl(item) }
      },
    })
  })
}
