import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { loadConfig } from '../../config/config';
import { hashToken, safeEqual } from '../crypto';
import { ALLOW_MFA_PENDING, IS_PUBLIC } from '../decorators';
import { PrismaService } from '../prisma.service';
import { JiRequest } from '../principal';
import { RateLimitService } from '../rate-limit.service';

export const SESSION_COOKIE = 'jm_session';
export const CSRF_COOKIE = 'jm_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global authentication guard.
 *  - Browser sessions: opaque random token in an HttpOnly cookie, stored hashed in PostgreSQL.
 *    Mutating requests must echo the per-session CSRF token in the X-CSRF-Token header (double submit).
 *  - API keys: "Authorization: Bearer jm_live_..." — tenant-bound and scope-limited (see OrgGuard).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly cfg = loadConfig();
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly rl: RateLimitService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<JiRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);

    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer jm_')) {
      await this.authenticateApiKey(req, auth.slice(7));
      return true;
    }

    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Authentication required');
    }

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { memberships: { select: { organizationId: true, role: true } } } } },
    });
    const now = new Date();
    const idleMs = this.cfg.SESSION_IDLE_TIMEOUT_HOURS * 3600_000;
    if (!session || session.revokedAt || session.expiresAt < now || now.getTime() - session.lastSeenAt.getTime() > idleMs) {
      if (isPublic) return true;
      throw new UnauthorizedException('Session expired');
    }
    if (session.user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account suspended');
    }

    if (!SAFE_METHODS.has(req.method)) {
      const header = (req.headers['x-csrf-token'] as string | undefined) ?? '';
      if (!header || !safeEqual(header, session.csrfToken)) throw new ForbiddenException('Invalid CSRF token');
    }

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_PENDING, [ctx.getHandler(), ctx.getClass()]);
    if (session.mfaPending && !allowPending && !isPublic) {
      throw new UnauthorizedException({ message: 'Two-factor verification required', mfaRequired: true });
    }

    if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }

    req.principal = {
      kind: 'user',
      userId: session.userId,
      email: session.user.email,
      name: session.user.name,
      platformRole: session.user.platformRole,
      sessionId: session.id,
      memberships: session.user.memberships,
    };
    return true;
  }

  private async authenticateApiKey(req: JiRequest, raw: string) {
    const ip = req.ip ?? 'unknown';
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: hashToken(raw) } });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) {
      await this.rl.enforce(`apikey-fail:${ip}`, 20, 300, 'Too many invalid API key attempts');
      throw new UnauthorizedException('Invalid API key');
    }
    const org = await this.prisma.organization.findUnique({ where: { id: key.organizationId }, select: { status: true } });
    if (!org || org.status !== 'ACTIVE') throw new ForbiddenException('Organisation is not active');
    await this.rl.enforce(`apikey:${key.id}`, 600, 60, 'API rate limit exceeded (600 requests/minute)');
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
      await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date(), lastUsedIp: ip } });
    }
    req.principal = {
      kind: 'apikey',
      apiKeyId: key.id,
      organizationId: key.organizationId,
      scopes: key.scopes,
      createdById: key.createdById,
    };
  }
}
