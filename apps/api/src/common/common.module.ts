import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { MailerService } from './mailer.service';
import { PrismaService } from './prisma.service';
import { RateLimitService } from './rate-limit.service';
import { RedisService } from './redis.service';
import { StalwartClient } from '../modules/stalwart/stalwart.client';

@Global()
@Module({
  providers: [PrismaService, RedisService, RateLimitService, AuditService, MailerService, StalwartClient],
  exports: [PrismaService, RedisService, RateLimitService, AuditService, MailerService, StalwartClient],
})
export class CommonModule {}
