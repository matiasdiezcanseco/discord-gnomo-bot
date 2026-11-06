import { isIP } from 'node:net'
import {
  nodeReaderNetwork,
  safeReader,
  type ReaderNetwork,
  type SafeReader,
} from '../web/safe-reader'

const discordDomains = [
  'discord.com',
  'discord.gg',
  'discordapp.com',
  'discordapp.net',
  'discord.media',
  'discord.gift',
  'discord.new',
  'discordcdn.com',
  'discord.dev',
  'dis.gd',
]

function allowedHost(raw: string) {
  const host = raw
    .toLowerCase()
    .replace(/\.+$/, '')
    .replace(/^\[|\]$/g, '')
  return (
    !isIP(host) && !discordDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  )
}

/** Checked before DNS and again before each connection, including every redirect. */
export function sandboxNetwork(net: ReaderNetwork = nodeReaderNetwork()): ReaderNetwork {
  return {
    resolve(host, signal) {
      if (!allowedHost(host)) throw new Error('blocked')
      return net.resolve(host, signal)
    },
    request(options, listener) {
      const headers = options.headers
      const hostHeader = headers && 'Host' in headers ? headers.Host : undefined
      const host = typeof hostHeader === 'string' ? new URL(`http://${hostHeader}`).hostname : ''
      if (!host || !allowedHost(host)) throw new Error('blocked')
      return net.request(options, listener)
    },
  }
}

export function sandboxReader(live = false, network?: ReaderNetwork): SafeReader {
  if (live) return safeReader(sandboxNetwork(network))
  return {
    async read(url, context, policy) {
      context.signal.throwIfAborted()
      let host: string
      try {
        host = new URL(url).hostname
      } catch {
        return { status: 'blocked', url }
      }
      if (!allowedHost(host)) return { status: 'blocked', url }
      if (url !== 'https://sandbox.invalid/news') return { status: 'inaccessible', url }
      const bytes = Buffer.from(
        'SANDBOX FIXTURE: Ana ganó un torneo ficticio. No es una noticia real.',
      )
      return {
        status: bytes.length > policy.maxBytes ? 'partial' : 'complete',
        bytes: bytes.subarray(0, policy.maxBytes),
        url,
        requestedUrl: url,
        contentType: 'text/plain',
        retrievedAt: new Date().toISOString(),
      }
    },
  }
}
