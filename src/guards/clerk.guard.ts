import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { verifyToken } from '@clerk/backend';
import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';
import * as argon2 from 'argon2';

import { and, eq, isNull } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from '../database/schema';
import { DRIZZLE_DB } from 'src/database/database.module';
import { REDIS_CLIENT } from 'src/infra';

import { extractKeyId } from 'src/utils/api-key.verify';
import { digest } from 'src/utils/api-key.digest';

import {
  VERSION,
  REDIS_HARD_TTL,
  LRU_SOFT_TTL_MS,
  LAST_USED_DEBOUNCE_SEC,
  LAST_USED_HASH,
} from 'src/configs/constant-global';

export interface CachedKey {
  userId?: string;
  apiKeyDigest: string;
  expiresAt: number;
}

const localCache = new LRUCache<string, CachedKey>({
  max: 100_000,
});

/**
 * Converts a compact UUID into a canonical UUID.
 * For example:
 * 5e4aab0f59c244c698420e68bb6f942a
 * becomes:
 * 5e4aab0f-59c2-44c6-9842-0e68bb6f942a
 */
function normalizeKeyId(keyId: string): string {
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

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: NeonHttpDatabase<typeof schema>,

    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  /**
   * Records API-key usage in Redis.
   * The lock prevents unnecessary writes for 60 seconds.
   */
  private async trackAPIKeyLastUsed(keyId: string): Promise<void> {
    const lockKey = `vmx:api_key:last_used_lock:${VERSION}:${keyId}`;

    const lockAcquired = await this.redis.set(
      lockKey,
      '1',
      'EX',
      LAST_USED_DEBOUNCE_SEC,
      'NX',
    );

    if (!lockAcquired) {
      return;
    }

    try {
      await this.redis.hset(LAST_USED_HASH, keyId, Date.now().toString());
    } catch (error) {
      // Allow a retry if saving the timestamp fails.
      try {
        await this.redis.del(lockKey);
      } catch {
        // Preserve the original Redis error.
      }

      throw error;
    }
  }

  /**
   * Tracks usage without creating an unhandled promise rejection.
   */
  private recordUsageInBackground(keyId: string): void {
    void this.trackAPIKeyLastUsed(keyId).catch((error: unknown) => {
      console.error('Failed to track API-key usage:', error);
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const apiKeyHeader = request.headers['x-api-key'];

    // API-key authentication
    if (apiKeyHeader !== undefined) {
      if (typeof apiKeyHeader !== 'string' || !apiKeyHeader.trim()) {
        throw new UnauthorizedException('Invalid API key header');
      }

      const apiKey = apiKeyHeader.trim();
      const extractedKeyId = extractKeyId(apiKey);

      if (!extractedKeyId) {
        throw new UnauthorizedException('Invalid API key format');
      }

      // Use a consistent UUID representation everywhere.
      const keyId = normalizeKeyId(extractedKeyId);
      const digestedApiKey = digest(apiKey);
      const lruKey = `${VERSION}:${keyId}`;
      const now = Date.now();

      try {
        // 1. Check the in-memory LRU cache.
        const cachedKey = localCache.get(lruKey);

        if (
          cachedKey &&
          cachedKey.expiresAt > now &&
          cachedKey.apiKeyDigest === digestedApiKey &&
          cachedKey.userId
        ) {
          request.user = {
            id: cachedKey.userId,
            keyId,
          };

          this.recordUsageInBackground(keyId);
          return true;
        }

        // Remove stale or mismatched in-memory entries.
        if (cachedKey) {
          localCache.delete(lruKey);
        }

        // 2. Check the Redis authentication cache.
        const redisKeyDigest = `vmx:api_key:${VERSION}:${keyId}`;

        const redisDigest = await this.redis.hgetall(redisKeyDigest);

        // Redis hash field names must match the names we write.
        if (redisDigest.invalid === '1') {
          throw new UnauthorizedException('Unauthorized!');
        }

        if (
          redisDigest.apikeydigest &&
          redisDigest.apikeydigest !== digestedApiKey
        ) {
          throw new UnauthorizedException('Unauthorized!');
        }

        // Both fields are required for a trusted cache hit.
        if (
          redisDigest.user_id &&
          redisDigest.apikeydigest === digestedApiKey
        ) {
          localCache.set(lruKey, {
            userId: redisDigest.user_id,
            apiKeyDigest: digestedApiKey,
            expiresAt: now + LRU_SOFT_TTL_MS,
          });

          request.user = {
            id: redisDigest.user_id,
            keyId,
          };

          this.recordUsageInBackground(keyId);
          return true;
        }

        // 3. Fall back to the database.
        const record = await this.db.query.api_key.findFirst({
          where: (apiKeyRecord) =>
            and(eq(apiKeyRecord.id, keyId), isNull(apiKeyRecord.revoked_at)),
          columns: {
            value: true,
            user_id: true,
          },
        });

        if (!record) {
          throw new UnauthorizedException('Unauthorized!');
        }

        // 4. Verify the supplied plaintext key against its hash.
        const isValid = await argon2.verify(record.value, apiKey);

        if (!isValid) {
          await this.redis.hset(redisKeyDigest, {
            invalid: '1',
          });

          await this.redis.expire(redisKeyDigest, REDIS_HARD_TTL);

          throw new UnauthorizedException('Unauthorized!');
        }

        // 5. Cache the successfully verified key.
        await this.redis.hset(redisKeyDigest, {
          user_id: record.user_id,
          apikeydigest: digestedApiKey,
        });

        await this.redis.expire(redisKeyDigest, REDIS_HARD_TTL);

        localCache.set(lruKey, {
          userId: record.user_id,
          apiKeyDigest: digestedApiKey,
          expiresAt: now + LRU_SOFT_TTL_MS,
        });

        request.user = {
          id: record.user_id,
          keyId,
        };

        // Track usage on every successful authentication path.
        this.recordUsageInBackground(keyId);

        return true;
      } catch (error) {
        if (error instanceof UnauthorizedException) {
          throw error;
        }

        console.error('API-key authentication failed:', error);

        // Preserve unexpected database/Redis failures as server
        // errors instead of incorrectly reporting them as 401.
        throw error;
      }
    }

    // Clerk Bearer-token authentication
    const authorization = request.headers.authorization;
    const token = authorization?.split(' ')[1];

    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    try {
      const secretKey = process.env.CLERK_SECRET_KEY;

      if (!secretKey) {
        throw new Error('CLERK_SECRET_KEY is not configured');
      }

      const verifiedToken = await verifyToken(token, {
        secretKey,
      });

      request.user = {
        id: verifiedToken.sub,
        ...verifiedToken,
      };

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      console.error('Clerk token verification failed:', error);

      throw new UnauthorizedException('Invalid or expired Clerk session token');
    }
  }
}
