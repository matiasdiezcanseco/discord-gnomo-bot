import express, { type Express } from 'express'
import { createLogger } from '../services/logger.ts'

const log = createLogger('health')

const DEFAULT_PORT = 8080

/**
 * Create and start the health check Express server
 * @param port The port to listen on (default: 8080)
 * @returns The Express app instance
 */
export function startHealthServer(port: number = DEFAULT_PORT): Express {
  const app = express()

  app.get('/', (_, res) => {
    log.debug('Health check requested')
    res.send('Health: Ok')
  })

  app.listen(port, () => {
    log.info({ port }, 'Health server started')
  })

  return app
}
