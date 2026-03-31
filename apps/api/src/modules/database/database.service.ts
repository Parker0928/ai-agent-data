import { Inject, Injectable } from '@nestjs/common'
import { Pool, PoolClient } from 'pg'

@Injectable()
export class DatabaseService {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async query<T = any>(text: string, params: any[] = []) {
    const res = await this.pool.query(text, params)
    return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 }
  }

  /** 知识库写入等场景：失败时整单回滚，避免半截 document_chunks */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const out = await fn(client)
      await client.query('COMMIT')
      return out
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }
}

