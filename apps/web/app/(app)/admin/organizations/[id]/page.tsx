'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Pause, Play, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/overlay';
import { Button, ErrorState, Field, Input, LoadingRows, Notice, PageHeader, Panel, Select, Stat, StatusPill } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { del, get, patch, post, put } from '@/lib/api';
import { bytes, date, ROLE_LABEL } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export default function AdminOrgDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useQuery<any>({ queryKey: ['admin-org', id], queryFn: () => get(`/admin/organizations/${id}`) });
  const plans = useQuery<any[]>({ queryKey: ['admin-plans'], queryFn: () => get('/admin/plans') });
  const inv = [['admin-org', id], ['admin-orgs']];
  const [limits, setLimits] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setLimits({ maxMailboxesOverride: q.data.maxMailboxesOverride?.toString() ?? '', maxDomainsOverride: q.data.maxDomainsOverride?.toString() ?? '', maxStorageMbOverride: q.data.maxStorageMbOverride?.toString() ?? '', sendLimitPerHourOverride: q.data.sendLimitPerHourOverride?.toString() ?? '' });
  }, [q.data]);
  const saveLimits = useAction(() => patch(`/admin/organizations/${id}`, Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v === '' ? null : Number(v)]))), { success: 'Limits saved', invalidate: inv });
  const [sub, setSub] = useState({ planCode: '', status: '' });
  const saveSub = useAction(() => put(`/admin/organizations/${id}/subscription`, { ...(sub.planCode ? { planCode: sub.planCode } : {}), ...(sub.status ? { status: sub.status } : {}), ...(sub.status === 'ACTIVE' ? { currentPeriodEnd: new Date(Date.now() + 30 * 86400_000).toISOString() } : {}) }), { success: 'Subscription updated', invalidate: inv, onSuccess: () => setSub({ planCode: '', status: '' }) });
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState('');
  const suspend = useAction(() => post<any>(`/admin/organizations/${id}/suspend`, { reason }), { success: (r) => `Suspended (${r.suspendedMailboxes} mailboxes)`, invalidate: inv, onSuccess: () => setSuspendOpen(false) });
  const reactivate = useAction(() => post<any>(`/admin/organizations/${id}/reactivate`), { success: (r) => `Reactivated (${r.reactivatedMailboxes} mailboxes)`, invalidate: inv });
  const [delOpen, setDelOpen] = useState(false);
  const remove = useAction(() => del(`/admin/organizations/${id}`, { confirmName: q.data.name }), { success: 'Organisation deleted', invalidate: [['admin-orgs']], onSuccess: () => router.push('/admin/organizations') });
  const domainSusp = useAction((v: { domainId: string; suspended: boolean }) => post(`/admin/organizations/${id}/domains/${v.domainId}/suspension`, { suspended: v.suspended, reason: 'Platform administrator action' }), { success: 'Domain updated', invalidate: inv });

  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.error) return <ErrorState error={q.error} />;
  const o = q.data;
  return (
    <div>
      <PageHeader
        back={<Link href="/admin/organizations" className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5" /> Organisations</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{o.name} <StatusPill status={o.status} /></span>}
        description={`${o.slug} · created ${date(o.createdAt)}`}
        actions={
          <>
            <Link href={`/org/${o.id}`}><Button variant="secondary" icon={<ExternalLink className="size-4" />}>Open dashboard</Button></Link>
            {o.status === 'ACTIVE' ? <Button variant="secondary" icon={<Pause className="size-4" />} onClick={() => setSuspendOpen(true)}>Suspend</Button> : <Button variant="secondary" icon={<Play className="size-4" />} loading={reactivate.isPending} onClick={() => reactivate.mutate()}>Reactivate</Button>}
          </>
        }
      />
      {o.status === 'SUSPENDED' && <div className="mb-5"><Notice tone="bad" title="Suspended">{o.suspendedReason}</Notice></div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Mailboxes" value={`${o.usage.mailboxes} / ${o.usage.limits.maxMailboxes}`} />
        <Stat label="Domains" value={`${o.usage.domains} / ${o.usage.limits.maxDomains}`} />
        <Stat label="Storage used" value={bytes(o.usage.storage.usedBytes)} />
        <Stat label="Plan" value={o.subscription?.plan.name ?? '—'} sub={o.subscription && <StatusPill status={o.subscription.status} />} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Domains" padded={false}>
          <DataTable rows={o.domains} empty={<p className="px-5 py-6 text-sm text-ink-3">No domains.</p>} columns={[
            { key: 'n', header: 'Domain', cell: (d) => d.name },
            { key: 's', header: 'Status', cell: (d) => <StatusPill status={d.status} /> },
            { key: 'x', header: <span className="sr-only">Actions</span>, cell: (d) => <Button size="sm" variant="ghost" onClick={() => domainSusp.mutate({ domainId: d.id, suspended: d.status !== 'SUSPENDED' })}>{d.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}</Button> },
          ]} />
        </Panel>
        <Panel title="Members" padded={false}>
          <DataTable rows={o.memberships.map((m: any) => ({ ...m, id: m.id }))} columns={[
            { key: 'u', header: 'User', cell: (m) => <div><p>{m.user.name}</p><p className="text-xs text-ink-3">{m.user.email}</p></div> },
            { key: 'r', header: 'Role', cell: (m) => ROLE_LABEL[m.role] },
          ]} />
        </Panel>
        <Panel title="Limit overrides" description="Leave empty to use the plan's limits.">
          <div className="grid grid-cols-2 gap-3">
            {[['maxMailboxesOverride', 'Max mailboxes'], ['maxDomainsOverride', 'Max domains'], ['maxStorageMbOverride', 'Max storage (MB)'], ['sendLimitPerHourOverride', 'Sends per hour per mailbox']].map(([k, l]) => (
              <Field key={k} label={l}>{(fid) => <Input id={fid} type="number" min={0} value={limits[k] ?? ''} onChange={(e) => setLimits({ ...limits, [k]: e.target.value })} />}</Field>
            ))}
          </div>
          <div className="mt-4 flex justify-end"><Button loading={saveLimits.isPending} onClick={() => saveLimits.mutate()}>Save limits</Button></div>
        </Panel>
        <Panel title="Subscription" description="Manual changes are for invoiced customers and support cases; they are recorded in the audit log.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plan">{(fid) => <Select id={fid} value={sub.planCode} onChange={(e) => setSub({ ...sub, planCode: e.target.value })}><option value="">Keep {o.subscription?.plan.name}</option>{plans.data?.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select>}</Field>
            <Field label="Status">{(fid) => <Select id={fid} value={sub.status} onChange={(e) => setSub({ ...sub, status: e.target.value })}><option value="">Keep {o.subscription?.status}</option>{['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'].map((s) => <option key={s} value={s}>{s}</option>)}</Select>}</Field>
          </div>
          <div className="mt-4 flex justify-end"><Button loading={saveSub.isPending} disabled={!sub.planCode && !sub.status} onClick={() => saveSub.mutate()}>Update subscription</Button></div>
        </Panel>
      </div>
      <Panel title="Delete organisation" className="mt-5">
        <p className="mb-3 text-sm text-ink-3">Deletes all mailboxes (and their mail) and domains on the mail server, then the organisation. Suspend first. This cannot be undone.</p>
        <Button variant="danger" icon={<Trash2 className="size-4" />} disabled={o.status !== 'SUSPENDED'} onClick={() => setDelOpen(true)}>Delete organisation</Button>
      </Panel>
      <ConfirmDialog open={suspendOpen} onOpenChange={setSuspendOpen} title={`Suspend ${o.name}?`} description="All active mailboxes are suspended on the mail server: no sign-in, sending or receiving." confirmLabel="Suspend organisation" loading={suspend.isPending} onConfirm={() => reason.length >= 3 && suspend.mutate()}>
        <Field label="Reason (required, shown to the customer)">{(fid) => <Input id={fid} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <div className="h-3" />
      </ConfirmDialog>
      <ConfirmDialog open={delOpen} onOpenChange={setDelOpen} title="Delete organisation permanently?" description="All mail data of this organisation is destroyed." confirmLabel="Delete everything" typeToConfirm={o.name} loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </div>
  );
}
