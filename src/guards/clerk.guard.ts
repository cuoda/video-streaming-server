import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { LRUCache } from 'lru-cache';
import { REDIS_CLIENT } from 'src/infra';
import Redis from 'ioredis';
import { DRIZZLE_DB } from 'src/database/database.module';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '../database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import * as argon2 from 'argon2';
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

const localCache = new LRUCache<string, CachedKey>({ max: 100_000 });

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE_DB) private db: NeonHttpDatabase<typeof schema>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private async trackAPIKeyLastUsed(keyId: string) {
    const lockKey = `vmx:api_key:last_used_lock:${VERSION}:${keyId}`;

    const ok = await this.redis.set(
      lockKey,
      '1',
      'EX',
      LAST_USED_DEBOUNCE_SEC,
      'NX',
    );

    if (!ok) return;

    await this.redis.hset(LAST_USED_HASH, keyId, Date.now().toString());
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (apiKey) {
      const keyId = extractKeyId(apiKey);
      if (!keyId) {
        throw new UnauthorizedException('Invalid API key format');
      }

      const digested_api = digest(apiKey);
      const lruKey = '${VERSION}:${keyId}';
      const now = Date.now();

      try {
        const cachedKey = localCache.get(lruKey);
        if (
          cachedKey &&
          cachedKey.expiresAt > now &&
          cachedKey.apiKeyDigest === digested_api
        ) {
          request.user = {
            id: cachedKey.userId,
            keyId,
          };

          void this.trackAPIKeyLastUsed(keyId);

          return true;
        }
        const redisKeyDigest = `vmx:api_key:${VERSION}:${keyId}`;
        const redisDigest = await this.redis.hgetall(redisKeyDigest);

        if (
          redisDigest?.Invalid === '1' ||
          redisDigest.apiKeyDigest !== digested_api
        ) {
          throw new UnauthorizedException('Unauthorized!');
        }

        if (redisDigest.userId) {
          localCache.set(lruKey, {
            userId: redisDigest.user_id,
            apiKeyDigest: digested_api,
            expiresAt: now + LRU_SOFT_TTL_MS,
          });

          request.user = {
            id: redisDigest.user_id,
            keyId,
          };
          return true;
        }

        const record = await this.db.query.api_key.findFirst({
          where: (apiKey) =>
            and(eq(apiKey.id, keyId), isNull(apiKey.revoked_at)),

          columns: {
            value: true,
            user_id: true,
            revoked_at: true,
          },
        });

        if (!record) {
          throw new UnauthorizedException('Unauthorized!');
        }

        const isValid = await argon2.verify(record.value, apiKey);

        if (!isValid) {
          await this.redis.hset(redisKeyDigest, {
            invalid: '1',
          });

          await this.redis.expire(redisKeyDigest, REDIS_HARD_TTL);

          throw new UnauthorizedException('Unauthorized!');
        }

        await this.redis.hset(redisKeyDigest, {
          user_id: record.user_id,
          apikeydigest: digested_api,
        });

        await this.redis.expire(redisKeyDigest, REDIS_HARD_TTL);

        request.user = {
          id: record.user_id,
          keyId,
        };
        void this.trackAPIKeyLastUsed(keyId);

        return true;
      } catch (error) {
        console.error(error);
        throw new UnauthorizedException('Unauthorized!');
      }
      return true;
    }
    const token = request.headers.authorization?.split(' ')[1];

    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    try {
      const verifiedToken = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY!,
      });
      request.user = {
        id: verifiedToken.sub,
        ...verifiedToken,
      };
      return true;
    } catch (error) {
      throw new UnauthorizedException(
        'Something went wrong! please upload your file by using our SDK',
      );
    }
  }
}
