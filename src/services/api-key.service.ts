import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { randomBytes } from 'crypto';
import { count, eq, and } from 'drizzle-orm';
import { DRIZZLE_DB } from 'src/database/database.module';
import { api_key } from 'src/database/schema';
import * as argon2 from 'argon2';
import { last } from 'rxjs';
import { REDIS_CLIENT } from 'src/infra';
import Redis from 'ioredis';
import { LAST_USED_HASH, VERSION } from 'src/configs/constant-global';
import { CachedKey } from 'src/guards/clerk.guard';
import { LRUCache } from 'lru-cache';

const localCache = new LRUCache<string, CachedKey>({ max: 100_000 });

@Injectable()
export class ApiKeyService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: any,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private generateKey(): { plaintextkey: string; keyId: string } {
    const keyId = crypto.randomUUID().replace(/-/g, '');
    const secret = randomBytes(32).toString('base64url');
    const plaintextkey = `VMX_${keyId}_${secret}`;
    return { plaintextkey, keyId };
  }

  async createApiKey(userId: string) {
    // Enforce user to have only 5 api keys
    const [result] = await this.db
      .select({ count: count() })
      .from(api_key)
      .where(eq(api_key.user_id, userId));

    if (result.count >= 5) {
      throw new BadRequestException(
        'You have reached the maximum limit of 5 API keys. Please contact support teams.',
      );
    }

    const { plaintextkey, keyId } = this.generateKey();
    const hash = await argon2.hash(plaintextkey, {
      type: argon2.argon2id,
      timeCost: 3,
      memoryCost: 1 << 16,
      parallelism: 1,
    });

    const prefix = plaintextkey.substring(0, 18) + '...';

    await this.db.insert(api_key).values({
      id: keyId,
      user_id: userId,
      prefix: prefix,
      value: hash,
    });

    return { key: plaintextkey };
  }

  async listApiKeys(userId: string): Promise<any> {
    return await this.db
      .select({
        id: api_key.id,
        prefix: api_key.prefix,
        created_at: api_key.created_at,
        last_used_at: api_key.last_used_at,
        revoked_at: api_key.revoked_at,
      })
      .from(api_key)
      .where(and(eq(api_key.user_id, userId)));
  }

  async deleteApiKeys(userId: string, keyId: string) {
    await this.db
      .update(api_key)
      .set({ revoked_at: new Date() })
      .where(and(eq(api_key.user_id, userId), eq(api_key.id, keyId)));

    await this.redis.del(`vmx:api_key:${VERSION}:${keyId}`);
    localCache.delete(`${VERSION}:${keyId}`);
  }

  async regenerateApiKey(userId: string, keyId: string) {
    const { plaintextkey, keyId: newKeyId } = this.generateKey();
    const hash = await argon2.hash(plaintextkey, {
      type: argon2.argon2id,
      timeCost: 3,
      memoryCost: 1 << 16,
      parallelism: 1,
    });

    const prefix = plaintextkey.substring(0, 18) + '...';

    await this.db
      .update(api_key)
      .set({
        id: newKeyId,
        value: hash,
        prefix: prefix,
        created_at: new Date(),
      })
      .where(and(eq(api_key.user_id, userId), eq(api_key.id, keyId)));

    return { key: plaintextkey };
  }

  async getApiKeyLastUsed(keyId: string) {
    const redisValue = await this.redis.hget(LAST_USED_HASH, keyId);

    if (redisValue) {
      return {
        last_used_at: new Date(Number(redisValue)),
      };
    }

    const record = await this.db.query.api_key.findFirst({
      where: (ak: typeof api_key) => eq(ak.id, keyId),
      columns: {
        last_used_at: true,
      },
    });

    const lastUsedAt: Date | null = record?.last_used_at ?? null;

    return lastUsedAt;
  }
}
