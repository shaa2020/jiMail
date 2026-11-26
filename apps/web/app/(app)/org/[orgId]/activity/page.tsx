'use client';

import { AuditView } from '@/components/audit-view';
import { useOrg } from '@/lib/org';

export default function ActivityPage() {
  const { orgId } = useOrg();
  return <AuditView path={`/orgs/${orgId}/audit`} />;
}
