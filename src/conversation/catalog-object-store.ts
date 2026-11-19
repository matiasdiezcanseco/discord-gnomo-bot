import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { readBoundedBody } from '../web/bounded-body'

/** Where a catalog's bytes live. */
export interface CatalogObjectStore {
  put(key: string, body: Uint8Array, contentType: string, signal: AbortSignal): Promise<void>
  remove(key: string): Promise<void>
  publicUrl(key: string): string
}

export type CatalogObjectReader = (
  key: string,
  maxBytes: number,
  signal: AbortSignal,
) => Promise<Buffer>

/** Only reads a catalog key from the configured public bucket. */
export function catalogObjectReader(store: CatalogObjectStore): CatalogObjectReader {
  return async (key, maxBytes, signal) => {
    const response = await fetch(store.publicUrl(key), { signal, redirect: 'error' })
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new Error('Catalog object unavailable')
    }
    return readBoundedBody(response.body, maxBytes, signal)
  }
}

/** Use a catalog-generated ID and a format extension without the leading dot. */
export function channelObjectKey(
  scope: { guildId: string; channelId: string },
  id: string,
  extension: string,
): string {
  return `${scope.guildId}/${scope.channelId}/${id}.${extension}`
}

/**
 * Any public-read S3-compatible bucket (Tigris on Fly by default). Fly's `fly storage create`
 * sets AWS_ENDPOINT_URL_S3/AWS_REGION/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/BUCKET_NAME.
 */
export function s3CatalogStore(
  get: (key: string) => string | undefined,
  client?: Pick<S3Client, 'send'>,
): CatalogObjectStore | undefined {
  const value = (key: string) => get(key)?.trim() || undefined
  const bucket = value('BUCKET_NAME')
  const endpoint = value('AWS_ENDPOINT_URL_S3')
  const accessKeyId = value('AWS_ACCESS_KEY_ID')
  const secretAccessKey = value('AWS_SECRET_ACCESS_KEY')
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return undefined
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid BUCKET_NAME')
  const base = new URL(value('MEDIA_PUBLIC_URL') ?? `https://${bucket}.t3.tigrisfiles.io/`)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
    throw new Error('Invalid MEDIA_PUBLIC_URL')
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  const s3 =
    client ??
    new S3Client({
      region: value('AWS_REGION') ?? 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 2,
    })
  return {
    async put(key, body, contentType, signal) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Tigris can serve cached copies after deletion. Keep that window to an hour.
          CacheControl: 'public, max-age=3600',
        }),
        { abortSignal: signal },
      )
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
    publicUrl: (key) => new URL(key, base).href,
  }
}
