'use client';

import { AuditView } from '@/components/audit-view';

export default function AdminAudit() {
  return <AuditView path="/admin/audit" showOrg />;
}
