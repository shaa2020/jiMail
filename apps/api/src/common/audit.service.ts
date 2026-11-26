import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { actorOf, Principal } from './principal';
import { logger } from './logger';

export interface AuditInput {
  action: string;
  organizationId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(principal: Principal | undefined, input: AuditInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const row = await db.auditLog.create({
      data: {
        ...actorOf(principal),
        organizationId: input.organizationId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: input.ip,
      },
    });
    logger.info({ audit: input.action, org: input.organizationId, target: input.targetId }, 'audit');
    return row;
  }
}
