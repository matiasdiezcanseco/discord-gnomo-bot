import { Resolver } from 'node:dns/promises'
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { checkServerIdentity } from 'node:tls'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'

export interface ReadContext {
  signal: AbortSignal
  external<T>(work: () => Promise<T>): Promise<T>
}
/** Infrastructure seams only: production uses configured DNS and Node HTTP/TLS. */
export interface ReaderNetwork {
  resolve(host: string, signal: AbortSignal): Promise<{ address: string; family: number }[]>
  request(options: RequestOptions, response: (message: IncomingMessage) => void): ClientRequest
}
/** Optional nameservers are trusted infrastructure configuration, never model arguments. */
export function nodeReaderNetwork(servers?: string[]): ReaderNetwork {
  return {
    async resolve(host, signal) {
      signal.throwIfAborted()
      const resolver = new Resolver({ timeout: 2000, tries: 1 })
      if (servers) resolver.setServers(servers)
      const cancel = () => resolver.cancel()
      signal.addEventListener('abort', cancel, { once: true })
      try {
        const answers = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)])
        signal.throwIfAborted()
        return answers.flatMap((answer, index) => {
          if (answer.status === 'fulfilled')
            return answer.value.map((address) => ({ address, family: index ? 6 : 4 }))
          if (!['ENODATA', 'ENOTFOUND'].includes(answer.reason?.code))
            throw new Error('inaccessible')
          return []
        })
      } finally {
        signal.removeEventListener('abort', cancel)
        resolver.cancel()
      }
    },
    request: (options, response) =>
      (options.protocol === 'https:' ? httpsRequest : httpRequest)(options, response),
  }
}
export type ReadResult =
  | {
      status: 'complete' | 'partial'
      bytes: Buffer
      url: string
      requestedUrl: string
      contentType: string
      retrievedAt: string
    }
  | { status: 'blocked' | 'inaccessible' | 'unsupported' | 'timeout' | 'cancelled'; url: string }

export interface ReadPolicy {
  types: readonly string[]
  maxBytes: number
  timeoutMs?: number
}
export type SafeReader = ReturnType<typeof safeReader>

function publicAddress(address: string) {
  // Reject mapped/transition IPv6 too; never unwrap it into a different address family.
  if (address === '168.63.129.16' || !isIP(address)) return false
  const parsed = ipaddr.parse(address)
  return (
    parsed.range() === 'unicast' &&
    (parsed.kind() === 'ipv4' || parsed.match(ipaddr.parseCIDR('2000::/3')))
  )
}
function destination(raw: string) {
  const url = new URL(raw)
  if (
    raw.length > 2048 ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== '80' && url.port !== '443')
  )
    throw new Error('blocked')
  url.hash = ''
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !publicAddress(host)) throw new Error('blocked')
  return { url, host }
}

/** GET-only bounded bytes. No cookies, auth, decompression, proxy, pooling or retries.
 * T09 must validate image signatures/dimensions and require complete bytes before model use.
 */
export function safeReader(net: ReaderNetwork = nodeReaderNetwork()) {
  return {
    async read(raw: string, context: ReadContext, policy: ReadPolicy): Promise<ReadResult> {
      const controller = new AbortController()
      const signal = AbortSignal.any([context.signal, controller.signal])
      const timer = setTimeout(() => controller.abort(), Math.min(policy.timeoutMs ?? 5000, 5000))
      let current = raw
      const wait = async <T>(work: () => Promise<T>): Promise<T> => {
        signal.throwIfAborted()
        let abort!: () => void
        const cancelled = new Promise<never>((_, reject) => {
          abort = () => reject(new Error('cancelled'))
          signal.addEventListener('abort', abort, { once: true })
        })
        try {
          return await Promise.race([work(), cancelled])
        } finally {
          signal.removeEventListener('abort', abort)
        }
      }
      try {
        if (
          !Number.isInteger(policy.maxBytes) ||
          policy.maxBytes < 1 ||
          policy.maxBytes > 5_000_000
        )
          throw new Error('unsupported')
        for (let hop = 0; hop <= 3; hop++) {
          const { url, host } = destination(current)
          current = url.href
          const addresses = isIP(host)
            ? [{ address: host, family: isIP(host) }]
            : await context.external(() => wait(() => net.resolve(host, signal)))
          signal.throwIfAborted()
          if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address)))
            throw new Error('blocked')
          const response = await context.external(() =>
            wait(
              () =>
                new Promise<
                  { location: string } | { bytes: Buffer; contentType: string; partial: boolean }
                >((resolve, reject) => {
                  // Connect directly to the validated literal. DNS cannot run again at connection time.
                  // TLS still verifies the original host, including IP SANs for literal URLs.
                  const req = net.request(
                    {
                      protocol: url.protocol,
                      hostname: addresses[0].address,
                      family: isIP(addresses[0].address),
                      port: url.port || (url.protocol === 'https:' ? 443 : 80),
                      path: url.pathname + url.search,
                      method: 'GET',
                      agent: false,
                      signal,
                      servername: isIP(host) ? '' : host,
                      rejectUnauthorized: true,
                      checkServerIdentity: (_, cert) => checkServerIdentity(host, cert),
                      maxHeaderSize: 16384,
                      headers: {
                        Host: url.host,
                        Accept: policy.types.join(', '),
                        'Accept-Encoding': 'identity',
                      },
                    },
                    (res) => {
                      res.on('error', reject)
                      if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
                        const location = res.headers.location
                        res.destroy()
                        if (!location || hop === 3) reject(new Error('inaccessible'))
                        else resolve({ location })
                        return
                      }
                      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                        res.destroy()
                        reject(new Error('inaccessible'))
                        return
                      }
                      const contentType = (res.headers['content-type'] ?? '').toLowerCase()
                      if (
                        !policy.types.includes(contentType.split(';')[0].trim()) ||
                        (res.headers['content-encoding'] &&
                          res.headers['content-encoding'] !== 'identity')
                      ) {
                        res.destroy()
                        reject(new Error('unsupported'))
                        return
                      }
                      const chunks: Buffer[] = []
                      let size = 0
                      res.on('data', (chunk: Buffer) => {
                        const remaining = policy.maxBytes - size
                        chunks.push(chunk.subarray(0, remaining))
                        size += Math.min(chunk.length, remaining)
                        if (chunk.length > remaining) {
                          resolve({ bytes: Buffer.concat(chunks), contentType, partial: true })
                          res.destroy()
                        }
                      })
                      res.on('end', () =>
                        resolve({ bytes: Buffer.concat(chunks), contentType, partial: false }),
                      )
                      res.on('aborted', () => reject(new Error('inaccessible')))
                    },
                  )
                  req.on('error', reject)
                  req.end()
                }),
            ),
          )
          signal.throwIfAborted()
          if ('location' in response) {
            current = new URL(response.location, url).href
            continue
          }
          return {
            status: response.partial ? 'partial' : 'complete',
            bytes: response.bytes,
            contentType: response.contentType,
            url: current,
            requestedUrl: raw,
            retrievedAt: new Date().toISOString(),
          }
        }
        return { status: 'inaccessible', url: current }
      } catch (error) {
        const status = context.signal.aborted
          ? 'cancelled'
          : controller.signal.aborted
            ? 'timeout'
            : error instanceof Error && ['blocked', 'unsupported'].includes(error.message)
              ? (error.message as 'blocked' | 'unsupported')
              : 'inaccessible'
        return { status, url: current }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
