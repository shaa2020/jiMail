import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { JiRequest, Principal } from './principal';

export const IS_PUBLIC = 'jimail:public';
export const ALLOW_MFA_PENDING = 'jimail:mfa-pending';
export const SUPER_ADMIN_ONLY = 'jimail:super-admin';
export const ORG_ROLE = 'jimail:org-role';
export const API_SCOPES = 'jimail:scopes';

/** Route needs no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route reachable while the session still awaits its second factor. */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING, true);
/** Platform super administrators only. */
export const SuperAdmin = () => SetMetadata(SUPER_ADMIN_ONLY, true);
/** Minimum organisation role for routes with an :orgId parameter. */
export const OrgRoles = (min: OrgRole) => SetMetadata(ORG_ROLE, min);
/** API-key scopes accepted by the route. Routes without scopes reject API keys. */
export const Scopes = (...scopes: string[]) => SetMetadata(API_SCOPES, scopes);

export const CurrentPrincipal = createParamDecorator((_d: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest<JiRequest>().principal!;
});

export const ClientIp = createParamDecorator((_d: unknown, ctx: ExecutionContext): string | undefined => {
  return ctx.switchToHttp().getRequest<JiRequest>().ip;
});

export const API_KEY_SCOPES = [
  'organization:read',
  'domains:read',
  'domains:write',
  'mailboxes:read',
  'mailboxes:write',
  'aliases:write',
  'usage:read',
  'delivery:read',
] as const;
