import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/infra';
import { DRIZZLE_DB } from 'src/database/database.module';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from 'src/database/schema';
import { sql } from 'drizzle-orm';
import { LAST_USED_HASH } from 'src/configs/constant-global';

@Injectable()
export class ApiKeyUsageCron {
  constructor(
    @Inject(DRIZZLE_DB) private db: NeonHttpDatabase<typeof schema>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('*/5 * * * *')
  async flushLastUsed() {
    const flattened = (await this.redis.eval(
      `
        local values = redis.call('HGETALL', KEYS[1])
        if #values > 0 then
          redis.call('DEL', KEYS[1])
        end
        return values
      `,
      1,
      LAST_USED_HASH,
    )) as string[];

    if (!flattened || flattened.length === 0) return;

    const entries = [];

    for (let i = 0; i < flattened.length; i += 2) {
      const keyId = flattened[i];
      const ts = new Date(Number(flattened[i + 1]));

      if (keyId && !Number.isNaN(ts.getTime())) {
        entries.push({ keyId, ts });
      }
    }

    if (entries.length === 0) return;

    const valuesSql = sql.join(
      entries.map((entry) => sql`(${entry.keyId}::uuid, ${entry.ts})`),
      sql`,`,
    );

    await this.db.execute(sql`
        UPDATE api_key AS ak
        SET last_used_at = GREATEST(
                COALESCE(ak.last_used_at, v.ts),
                v.ts
                           )
            FROM (
        VALUES ${valuesSql}
            ) AS v(id, ts)
        WHERE ak.id = v.id
    `);
  }
}
