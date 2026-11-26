'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ComponentList, SystemResources } from '@/components/health';
import { ErrorState, LoadingRows, PageHeader, Panel, Stat, StatusPill } from '@/components/ui/primitives';
import { get } from '@/lib/api';
import { bytes, mb, relative } from '@/lib/format';

export default function AdminOverview() {
  const q = useQuery<any>({ queryKey: ['admin-overview'], queryFn: () => get('/admin/overview'), refetchInterval: 30_000 });
  if (q.isLoading) return <LoadingRows rows={10} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data;
  return (
    <div>
      <PageHeader title="Platform overview" description="Live figures from the JiMail database and the mail server. Refreshes every 30 seconds." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Organisations" value={d.organizations.total} sub={`${d.organizations.byStatus.SUSPENDED ?? 0} suspended`} href="/admin/organizations" />
        <Stat label="Users" value={d.users} href="/admin/users" />
        <Stat label="Domains" value={d.domains.total} sub={`${d.domains.byStatus.ACTIVE ?? 0} ready · ${d.domains.byStatus.PENDING_VERIFICATION ?? 0} awaiting verification`} href="/admin/domains" />
        <Stat label="Mailboxes" value={d.mailboxes.total} sub={`${d.mailboxes.active} active · ${d.mailboxes.suspended} suspended`} href="/admin/mailboxes" />
        <Stat label="Storage used" value={bytes(d.storage.usedBytes)} sub={`${mb(d.storage.allocatedMb)} allocated`} />
        <Stat label="Incoming (24 h)" value={d.mail24h.incoming} sub={`${d.mail24h.spam} classified as spam`} href="/admin/delivery" />
        <Stat label="Outgoing (24 h)" value={d.mail24h.outgoing} sub={`${d.mail24h.delivered} delivered · ${d.mail24h.deferred} deferred`} href="/admin/delivery" />
        <Stat label="Failed deliveries (24 h)" value={d.mail24h.failed} sub={'error' in d.queue ? `Queue unavailable: ${d.queue.error}` : `${d.queue.total} message(s) in queue`} href="/admin/delivery" />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Panel title="Service health" action={<Link href="/admin/monitoring" className="text-[13px] text-petrol hover:underline">Monitoring</Link>}><ComponentList components={d.components} /></Panel>
        <Panel title="Server resources"><SystemResources system={d.system} /></Panel>
        <Panel title="Open security alerts" padded={false} action={<Link href="/admin/security" className="text-[13px] text-petrol hover:underline">All</Link>}>
          {d.alerts.length === 0 ? <p className="px-5 py-8 text-center text-sm text-ink-3">No open alerts.</p> : (
            <ul className="divide-y divide-line">
              {d.alerts.map((a: any) => <li key={a.id} className="px-5 py-2.5 text-sm"><div className="flex items-center justify-between gap-2"><StatusPill status={a.severity} /><span className="text-xs text-ink-3">{relative(a.createdAt)}</span></div><p className="mt-1 text-ink-2">{a.message}</p></li>)}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title="Recent administrative activity" className="mt-5" padded={false} action={<Link href="/admin/audit" className="text-[13px] text-petrol hover:underline">Audit log</Link>}>
        <ul className="divide-y divide-line">
          {d.recentActivity.map((a: any) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
              <span><span className="font-medium">{a.actor?.email ?? 'System'}</span> <code className="ml-1 font-mono text-xs text-ink-2">{a.action}</code>{a.organization && <span className="text-ink-3"> · {a.organization.name}</span>}</span>
              <span className="text-xs text-ink-3">{relative(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
