import { isAudioAttachment } from '../core/conversation/invocation'
import type { SafeReader } from '../web/safe-reader'
import type { ExecutionContext } from './catalog'
import type { AudioUploadConverter } from './audio-upload-converter'

export interface AudioUploadDependencies {
  maxBytes: number
  maxSeconds: number
  read: SafeReader['read']
  convert: AudioUploadConverter
}

// Discord's declared type can differ from the CDN's type; the converter checks the actual format.
const servedTypes = [
  'application/octet-stream',
  'application/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/webm',
  'video/webm',
]

export async function loadAudioUpload(
  upload: AudioUploadDependencies | undefined,
  context: ExecutionContext,
) {
  const unavailable = {
    outcome: 'unavailable' as const,
    message: 'La conversión de audios adjuntos no está disponible.',
  }
  if (!upload) return unavailable
  const { invocation, signal } = context
  const own = invocation.attachments.find(isAudioAttachment)
  const messageId = own ? invocation.messageId : invocation.referencedMessageId
  const attachment = own ?? invocation.referencedAudioAttachments?.find(isAudioAttachment)
  const invalid = (message: string) => ({ outcome: 'invalid' as const, message })
  if (!attachment || !messageId)
    return invalid('Adjunta un archivo de audio o responde a un mensaje del canal que tenga uno.')

  const { maxBytes, maxSeconds } = upload
  const mib = maxBytes / (1024 * 1024)
  const size = Number.isInteger(mib) ? `${mib} MiB` : `${maxBytes} bytes`
  const sizeLimit = () => invalid(`El audio supera el límite de ${size} por archivo.`)
  if (attachment.size > maxBytes) return sizeLimit()

  const declared = attachment.contentType!.split(';')[0].trim().toLowerCase()
  const result = await upload.read(attachment.url, context, {
    types: [declared, ...servedTypes],
    maxBytes: maxBytes + 1,
  })
  signal.throwIfAborted()
  if ('bytes' in result && result.bytes.length > maxBytes) return sizeLimit()
  if (result.status !== 'complete')
    return invalid('No pude descargar el archivo de audio completo desde Discord.')

  const converted = await context.external(() => upload.convert(result.bytes, maxSeconds, signal))
  switch (converted.outcome) {
    case 'unavailable':
      return unavailable
    case 'too_long':
      return invalid(`El audio supera el límite de ${maxSeconds} segundos.`)
    case 'invalid':
      return invalid('El archivo no es un audio compatible o está dañado.')
    case 'converted':
      return {
        outcome: 'ready' as const,
        bytes: converted.bytes,
        voice: converted.voice,
        sourceMessageId: messageId,
        sourceAttachmentId: attachment.id,
        transcript: undefined,
      }
  }
}
