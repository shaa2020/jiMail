'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button, Checkbox, EmptyState, ErrorState, LoadingRows, PageHeader, Panel, StatusPill } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { get, post } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export default function SecurityEvents() {
  const [open, setOpen] = useState(true);
  const q = useQuery<any[]>({ queryKey: ['security', open], queryFn: () => get(`/admin/security-events${open ? '?unresolved=1' : ''}`) });
  const resolve = useAction((id: string) => post(`/admin/security-events/${id}/resolve`), { success: 'Marked as resolved', invalidate: [['security'], ['admin-overview']] });
  return (
    <div>
      <PageHeader title="Security incidents" description="Account lockouts, suspicious sending, IP bans, DNS regressions, billing suspensions and component failures." />
      <Panel padded={false}>
        <div className="border-b border-line px-5 py-3"><Checkbox label="Show only open incidents" checked={open} onChange={setOpen} /></div>
        {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} /> : (
          <DataTable rows={q.data!} empty={<EmptyState icon={<ShieldCheck className="size-5" />} title="No incidents" />} columns={[
            { key: 'w', header: 'When', cell: (e) => <span className="whitespace-nowrap text-ink-3">{dateTime(e.createdAt)}</span> },
            { key: 's', header: 'Severity', cell: (e) => <StatusPill status={e.severity} /> },
            { key: 't', header: 'Event', cell: (e) => <div><code className="font-mono text-xs">{e.type}</code><p className="text-sm text-ink-2">{e.message}</p></div> },
            { key: 'o', header: 'Organisation', hideOnMobile: true, cell: (e) => e.organization?.name ?? 'Platform' },
            { key: 'x', header: <span className="sr-only">Actions</span>, cell: (e) => e.resolvedAt ? <span className="text-xs text-ink-3">Resolved</span> : <Button size="sm" variant="secondary" onClick={() => resolve.mutate(e.id)}>Resolve</Button> },
          ]} />
        )}
      </Panel>
    </div>
  );
}
