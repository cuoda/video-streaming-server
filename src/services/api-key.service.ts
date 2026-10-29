import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { randomBytes } from 'crypto';
import { and, count, eq, isNull } from 'drizzle-orm';
import { DRIZZLE_DB } from 'src/database/database.module';
import { api_key } from 'src/database/schema';
import * as argon2 from 'argon2';
import { REDIS_CLIENT } from 'src/infra';
import Redis from 'ioredis';
import { LAST_USED_HASH, VERSION } from 'src/configs/constant-global';

type ApiKeyListItem = {
  id: string;
  keyId: string;
  prefix: string;
  createdAt: Date | string | null;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
};

@Injectable()
export class ApiKeyService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: any,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private toCanonicalUuid(keyId: string): string {
    const compactId = keyId.replace(/-/g, '');

    if (!/^[0-9a-fA-F]{32}$/.test(compactId)) {
      return keyId;
    }

    return [
      compactId.slice(0, 8),
      compactId.slice(8, 12),
      compactId.slice(12, 16),
      compactId.slice(16, 20),
      compactId.slice(20, 32),
    ]
      .join('-')
      .toLowerCase();
  }

  private generateKey(): {
    plaintextkey: string;
    compactKeyId: string;
    dbKeyId: string;
  } {
    const dbKeyId = crypto.randomUUID();
    const compactKeyId = dbKeyId.replace(/-/g, '');
    const secret = randomBytes(32).toString('base64url');
    const plaintextkey = `VMX_${compactKeyId}_${secret}`;

    return {
      plaintextkey,
      compactKeyId,
      dbKeyId,
    };
  }

  async createApiKey(userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required.');
    }

    const [result] = await this.db
      .select({ count: count() })
      .from(api_key)
      .where(and(eq(api_key.user_id, userId), isNull(api_key.revoked_at)));

    if (result.count >= 5) {
      throw new BadRequestException(
        'You have reached the maximum limit of 5 API keys. Please contact support teams.',
      );
    }

    const { plaintextkey, dbKeyId } = this.generateKey();
    const hash = await argon2.hash(plaintextkey, {
      type: argon2.argon2id,
      timeCost: 3,
      memoryCost: 1 << 16,
      parallelism: 1,
    });

    const prefix = plaintextkey.substring(0, 18) + '...';

    await this.db.insert(api_key).values({
      id: dbKeyId,
      user_id: userId,
      prefix,
      value: hash,
    });

    return { key: plaintextkey };
  }

  async listApiKeys(userId: string): Promise<ApiKeyListItem[]> {
    if (!userId) {
      throw new BadRequestException('User ID is required.');
    }

    const keys: ApiKeyListItem[] = await this.db
      .select({
        id: api_key.id,
        keyId: api_key.id,
        prefix: api_key.prefix,
        createdAt: api_key.created_at,
        lastUsedAt: api_key.last_used_at,
        revokedAt: api_key.revoked_at,
      })
      .from(api_key)
      .where(and(eq(api_key.user_id, userId), isNull(api_key.revoked_at)));

    if (keys.length === 0) {
      return keys;
    }

    const redisLastUsedValues: Array<string | null> = await this.redis.hmget(
      LAST_USED_HASH,
      ...keys.map((key: ApiKeyListItem) => key.id),
    );

    return keys.map((key: ApiKeyListItem, index: number): ApiKeyListItem => {
      const redisValue = redisLastUsedValues[index];

      if (!redisValue) {
        return key;
      }

      const redisDate = new Date(Number(redisValue));

      if (Number.isNaN(redisDate.getTime())) {
        return key;
      }

      const dbLastUsedAt =
        key.lastUsedAt === null ? null : new Date(key.lastUsedAt);

      return {
        ...key,
        lastUsedAt:
          dbLastUsedAt === null || redisDate > dbLastUsedAt
            ? redisDate
            : key.lastUsedAt,
      };
    });
  }

  async deleteApiKeys(userId: string, keyId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required.');
    }

    const normalizedKeyId = this.toCanonicalUuid(keyId);

    await this.db
      .update(api_key)
      .set({ revoked_at: new Date() })
      .where(and(eq(api_key.user_id, userId), eq(api_key.id, normalizedKeyId)));

    await this.redis.del(`vmx:api_key:${VERSION}:${normalizedKeyId}`);
    await this.redis.hdel(LAST_USED_HASH, normalizedKeyId);

    return { success: true };
  }

  async regenerateApiKey(userId: string, keyId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required.');
    }

    const oldKeyId = this.toCanonicalUuid(keyId);
    const { plaintextkey, dbKeyId } = this.generateKey();

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
        id: dbKeyId,
        value: hash,
        prefix,
        created_at: new Date(),
        last_used_at: null,
      })
      .where(and(eq(api_key.user_id, userId), eq(api_key.id, oldKeyId)));

    await this.redis.del(`vmx:api_key:${VERSION}:${oldKeyId}`);
    await this.redis.del(`vmx:api_key:${VERSION}:${dbKeyId}`);
    await this.redis.hdel(LAST_USED_HASH, oldKeyId);

    return { key: plaintextkey };
  }

  async getApiKeyLastUsed(userId: string, keyId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required.');
    }

    const normalizedKeyId = this.toCanonicalUuid(keyId);
    const redisValue = await this.redis.hget(LAST_USED_HASH, normalizedKeyId);

    if (redisValue !== null) {
      return {
        lastUsedAt: new Date(Number(redisValue)),
      };
    }

    const record = await this.db.query.api_key.findFirst({
      where: (ak: typeof api_key) =>
        and(eq(ak.id, normalizedKeyId), eq(ak.user_id, userId)),
      columns: {
        last_used_at: true,
      },
    });

    return {
      lastUsedAt: record?.last_used_at ?? null,
    };
  }
}
