import { Module, Global } from '@nestjs/common';
import { LRUCache } from 'lru-cache';

export const LRU_CACHE = 'LRU_CACHE';

export interface CacheInterface {
  user_id: string;
  public_id?: string;
  last_used?: string;
}

@Global()
@Module({
  providers: [
    {
      provide: LRU_CACHE,
      useFactory: () => {
        return new LRUCache<string, CacheInterface>({
          max: 500,
          ttl: 1000 * 60 * 60,
          updateAgeOnGet: true,
          updateAgeOnHas: false,
          allowStale: false,
        });
      },
    },
  ],
  exports: [LRU_CACHE],
})
export class CacheModule {}
