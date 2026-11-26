import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

/** Fixed-window counters in Redis, shared across API instances. */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async hit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; count: number; retryAfter: number }> {
    const k = `rl:${key}`;
    const res = await this.redis.client.multi().incr(k).expire(k, windowSec, 'NX').ttl(k).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    const ttl = Number(res?.[2]?.[1] ?? windowSec);
    return { allowed: count <= limit, count, retryAfter: ttl > 0 ? ttl : windowSec };
  }

  async enforce(key: string, limit: number, windowSec: number, message = 'Too many requests, please slow down.') {
    const r = await this.hit(key, limit, windowSec);
    if (!r.allowed) {
      throw new HttpException({ message, retryAfter: r.retryAfter }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return r;
  }

  async reset(key: string) {
    await this.redis.client.del(`rl:${key}`);
  }
}
