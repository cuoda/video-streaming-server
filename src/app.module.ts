import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { RedisModule, CacheModule } from './infra';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiKeyUsageCron } from './scheduler/api-key-last-use.corn';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    CacheModule,
    RedisModule,
  ],
  controllers: [AppController],
  providers: [AppService, ApiKeyUsageCron],
})
export class AppModule {}
