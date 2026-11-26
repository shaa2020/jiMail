import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { API_SCOPES, IS_PUBLIC, ORG_ROLE, SUPER_ADMIN_ONLY } from '../decorators';
import { PrismaService } from '../prisma.service';
import { JiRequest, ORG_ROLE_RANK } from '../principal';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Tenant isolation guard. Every route that touches organisation data has an :orgId
 * parameter; access is granted only when the caller is a member with a sufficient role,
 * an API key issued for that very organisation with the needed scope, or a super admin.
 * Services additionally scope every query by organizationId (defence in depth).
 */
@Injectable()
export class OrgGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<JiRequest>();
    const p = req.principal;
    if (!p) throw new ForbiddenException();

    const superOnly = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_ONLY, targets);
    const minRole = this.reflector.getAllAndOverride<OrgRole | undefined>(ORG_ROLE, targets);
    const scopes = this.reflector.getAllAndOverride<string[] | undefined>(API_SCOPES, targets);

    if (p.kind === 'apikey') {
      // API keys never reach platform-admin or personal routes.
      if (superOnly || !scopes?.length) throw new ForbiddenException('This endpoint is not available to API keys');
      const orgId = req.params?.orgId as string | undefined;
      if (!orgId || orgId !== p.organizationId) throw new NotFoundException('Organisation not found');
      if (!scopes.some((s) => p.scopes.includes(s))) throw new ForbiddenException(`API key lacks scope: ${scopes.join(' or ')}`);
      req.orgContext = { organizationId: orgId, role: 'API_KEY' };
      return true;
    }

    if (superOnly) {
      if (p.platformRole !== 'SUPER_ADMIN') throw new ForbiddenException('Platform administrators only');
      return true;
    }

    const orgId = req.params?.orgId as string | undefined;
    if (!orgId) return true; // personal routes (profile, webmail) handle their own checks
    if (!minRole) throw new ForbiddenException('Route is missing an organisation role requirement');

    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, status: true, deletedAt: true } });
    if (!org || org.deletedAt) throw new NotFoundException('Organisation not found');

    if (p.platformRole === 'SUPER_ADMIN') {
      req.orgContext = { organizationId: orgId, role: 'SUPER_ADMIN' };
      return true;
    }
    const m = p.memberships.find((x) => x.organizationId === orgId);
    // Not-found rather than forbidden: do not reveal that another tenant's organisation exists.
    if (!m) throw new NotFoundException('Organisation not found');
    if (ORG_ROLE_RANK[m.role] < ORG_ROLE_RANK[minRole]) throw new ForbiddenException('Your role does not allow this action');
    if (org.status !== 'ACTIVE' && !SAFE.has(req.method)) {
      throw new ForbiddenException('This organisation is suspended. Contact support to reactivate it.');
    }
    req.orgContext = { organizationId: orgId, role: m.role };
    return true;
  }
}
