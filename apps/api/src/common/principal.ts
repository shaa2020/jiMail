import { OrgRole, PlatformRole } from '@prisma/client';
import type { Request } from 'express';

export interface UserPrincipal {
  kind: 'user';
  userId: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
  sessionId: string;
  memberships: { organizationId: string; role: OrgRole }[];
}

export interface ApiKeyPrincipal {
  kind: 'apikey';
  apiKeyId: string;
  organizationId: string;
  scopes: string[];
  createdById: string;
}

export type Principal = UserPrincipal | ApiKeyPrincipal;

export interface JiRequest extends Request {
  principal?: Principal;
  /** Set by OrgGuard once tenant access is proven for :orgId */
  orgContext?: { organizationId: string; role: OrgRole | 'SUPER_ADMIN' | 'API_KEY' };
}

export function actorOf(p: Principal | undefined) {
  if (!p) return {};
  return p.kind === 'user' ? { actorUserId: p.userId } : { actorApiKeyId: p.apiKeyId, actorUserId: p.createdById };
}

/** Role hierarchy for organisation permissions (higher includes lower). */
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  OWNER: 40,
  ADMIN: 30,
  MAILBOX_ADMIN: 20,
  MEMBER: 10,
};

/** Shape of a multipart file handled by multer (memory storage). */
export interface UploadedFileData {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}
