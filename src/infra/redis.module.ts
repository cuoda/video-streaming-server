import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService) => {
        const redis = new Redis({
          host: configService.get<string>('REDIS_HOST') ?? 'localhost',
          port: Number(configService.get<string>('REDIS_PORT') ?? 6379),
          //password: configService.get<string>('REDIS_PASSWORD'),
          db: Number(configService.get<string>('REDIS_DB') ?? 0),

          retryStrategy: (times: number) => {
            if (times > 3) return null;

            return Math.min(times * 200, 2000);
          },
        });

        redis.on('connect', () => {
          console.log('redis connected');
        });

        redis.on('error', (err) =>
          console.log('Redis connection error', err.message),
        );
        return redis;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
