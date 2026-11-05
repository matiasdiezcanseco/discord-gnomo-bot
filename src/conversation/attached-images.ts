import sharp from 'sharp'
import type { ExecutionContext } from './catalog'
import type { SafeReader } from '../web/safe-reader'

export interface VerifiedImage {
  bytes: Uint8Array
  mediaType: string
  source: {
    attachmentId: string
    messageId: string
    requesterId: string
    channelId: string
    width: number
    height: number
    retrievedAt: string
  }
}
export class AttachmentError extends Error {}
const types = ['image/png', 'image/jpeg', 'image/webp']
const maxBytes = 2_500_000

/** Only the authenticated invocation supplies URLs. All-or-nothing, no image cache. */
export function attachedImages(reader: SafeReader) {
  return async (context: ExecutionContext): Promise<VerifiedImage[]> => {
    const { invocation, signal } = context
    const fail = (reason: string): never => {
      throw new AttachmentError(`No pude usar los adjuntos: ${reason}`)
    }
    if (invocation.attachments.length > 2) fail('máximo dos imágenes y 5 MB en total.')
    const images: VerifiedImage[] = []
    let total = 0
    for (const attachment of invocation.attachments) {
      signal.throwIfAborted()
      const claimed = attachment.contentType?.toLowerCase().split(';')[0].trim()
      if (!claimed || !types.includes(claimed))
        fail('solo PNG, JPEG o WebP estáticos con MIME declarado.')
      if (!Number.isInteger(attachment.size) || attachment.size < 1 || attachment.size > maxBytes)
        fail('tamaño inválido; máximo 2,5 MB por imagen.')
      const result = await reader.read(attachment.url, context, { types, maxBytes })
      if (result.status !== 'complete')
        fail(
          `descarga ${result.status}; puede estar caducada, bloqueada, incompleta o exceder el límite.`,
        )
      if (result.status !== 'complete') throw new Error('unreachable')
      total += result.bytes.length
      if (total > 5_000_000 || result.bytes.length !== attachment.size)
        fail('el tamaño real no coincide con el declarado o supera 5 MB.')
      const bytes = result.bytes
      const format = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? 'jpeg'
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
            ? 'webp'
            : undefined
      const mime = format && `image/${format}`
      if (!mime || mime !== claimed || mime !== result.contentType.split(';')[0].trim())
        fail('la firma de imagen y los tipos MIME no coinciden.')
      const decoder = sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: 4_000_000,
        animated: true,
      }).timeout({ seconds: 1 })
      const abort = () => decoder.destroy(new Error('cancelled'))
      signal.addEventListener('abort', abort, { once: true })
      try {
        const metadata = await decoder.metadata()
        if (
          metadata.format !== format ||
          (metadata.pages ?? 1) !== 1 ||
          !metadata.width ||
          !metadata.height ||
          metadata.width > 4096 ||
          metadata.height > 4096 ||
          metadata.width * metadata.height > 4_000_000
        )
          fail('formato, animación o dimensiones no admitidas (4096 por lado; 4 megapíxeles).')
        // Force a complete pixel decode: metadata alone accepts truncated/corrupt payloads.
        await decoder.raw().toBuffer()
        signal.throwIfAborted()
        images.push({
          bytes,
          mediaType: mime!,
          source: {
            attachmentId: attachment.id,
            messageId: invocation.messageId,
            requesterId: invocation.requester.id,
            channelId: invocation.channelId,
            width: metadata.width!,
            height: metadata.height!,
            retrievedAt: result.retrievedAt,
          },
        })
      } catch (error) {
        signal.throwIfAborted()
        if (error instanceof AttachmentError) throw error
        fail('imagen dañada, incompleta o dimensiones excesivas.')
      } finally {
        signal.removeEventListener('abort', abort)
        decoder.destroy()
      }
    }
    return images
  }
}
