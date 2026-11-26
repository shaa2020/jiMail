'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage, get } from './api';

export interface Me {
  id: string;
  email: string;
  name: string;
  platformRole: 'SUPER_ADMIN' | 'USER';
  authSource: 'LOCAL' | 'MAILBOX';
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  mfaPending: boolean;
  mustEnroll2fa: boolean;
  organizations: { id: string; name: string; slug: string; status: string; require2fa: boolean; role: 'OWNER' | 'ADMIN' | 'MAILBOX_ADMIN' | 'MEMBER' }[];
  mailboxes: { id: string; address: string; displayName: string; status: string }[];
  unreadNotifications: number;
}

export function useMe() {
  return useQuery<Me>({ queryKey: ['me'], queryFn: () => get('/me'), retry: false, staleTime: 60_000 });
}

/** Mutation with toast feedback and cache invalidation. */
export function useAction<TVars = void, TRes = any>(fn: (v: TVars) => Promise<TRes>, opts: { success?: string | ((r: TRes) => string); invalidate?: unknown[][]; onSuccess?: (r: TRes) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      opts.onSuccess?.(r);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

const ADMIN_ROLES = ['OWNER', 'ADMIN', 'MAILBOX_ADMIN'];

/** Where a signed-in user should land. */
export function homeFor(me: Me): string {
  if (me.platformRole === 'SUPER_ADMIN') return '/admin';
  const adminOrg = me.organizations.find((o) => ADMIN_ROLES.includes(o.role));
  if (adminOrg) return `/org/${adminOrg.id}`;
  if (me.mailboxes.length) return '/mail';
  return '/settings';
}

export function roleIn(me: Me | undefined, orgId: string) {
  if (!me) return undefined;
  if (me.platformRole === 'SUPER_ADMIN') return 'OWNER' as const;
  return me.organizations.find((o) => o.id === orgId)?.role;
}

export const RANK = { OWNER: 40, ADMIN: 30, MAILBOX_ADMIN: 20, MEMBER: 10 } as const;
export function atLeast(role: keyof typeof RANK | undefined, min: keyof typeof RANK) {
  return !!role && RANK[role] >= RANK[min];
}
