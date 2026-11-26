'use client';

import { useParams } from 'next/navigation';
import { roleIn, useMe } from './hooks';

export function useOrg() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: me } = useMe();
  const role = roleIn(me, orgId);
  return { orgId, role, me, base: `/org/${orgId}` };
}
