import { Module } from '@nestjs/common'
import { Pool } from 'pg'

import { DatabaseService } from './database.service'
import { DatabaseSchemaService } from './database-schema.service'

@Module({
  providers: [
    DatabaseService,
    DatabaseSchemaService,
    {
      provide: 'PG_POOL',
      useFactory: () => {
        const conn = process.env.DATABASE_URL
        if (!conn) throw new Error('Missing DATABASE_URL')
        return new Pool({ connectionString: conn })
      },
    },
  ],
  exports: [DatabaseService, DatabaseSchemaService],
})
export class DatabaseModule {}

