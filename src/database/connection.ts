import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool, PoolClient } from 'pg'
import * as schema from './schema'

/** Bind ORM work to the caller's pool or pinned transaction client, never a second connection. */
export const memoryDatabase = (client: Pool | PoolClient) =>
  drizzle(client, { schema, logger: false })
