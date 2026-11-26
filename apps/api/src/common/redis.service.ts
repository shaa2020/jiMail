import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { loadConfig } from '../config/config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  constructor() {
    this.client = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  }
  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}
