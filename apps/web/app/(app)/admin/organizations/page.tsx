'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Dialog } from '@/components/ui/overlay';
import { Button, EmptyState, ErrorState, Field, Input, LoadingRows, PageHeader, Panel, Select, StatusPill } from '@/components/ui/primitives';
import { DataTable, Pagination, SearchInput } from '@/components/ui/table';
import { get, post } from '@/lib/api';
import { date } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export default function AdminOrgs() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const list = useQuery<any>({ queryKey: ['admin-orgs', page, q, status], queryFn: () => get(`/admin/organizations?page=${page}&pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}`), placeholderData: (p: any) => p });
  const plans = useQuery<any[]>({ queryKey: ['admin-plans'], queryFn: () => get('/admin/plans') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', ownerEmail: '', planCode: 'starter' });
  const create = useAction(() => post<any>('/admin/organizations', f), {
    success: (r) => (r.invitation ? `Organisation created; invitation sent to ${f.ownerEmail}` : 'Organisation created'),
    invalidate: [['admin-orgs']],
    onSuccess: (r) => router.push(`/admin/organizations/${r.organization.id}`),
  });
  return (
    <div>
      <PageHeader title="Organisations" description="Every customer organisation on this JiMail installation." actions={<Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>New organisation</Button>} />
      <Panel padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name, slug or domain" />
          <Select aria-label="Status" className="h-9 w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Any status</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></Select>
        </div>
        {list.isLoading ? <LoadingRows /> : list.error ? <ErrorState error={list.error} /> : (
          <>
            <DataTable rows={list.data.items} onRowClick={(o) => router.push(`/admin/organizations/${o.id}`)} empty={<EmptyState icon={<Building2 className="size-5" />} title="No organisations found" />} columns={[
              { key: 'name', header: 'Organisation', cell: (o) => <div><p className="font-medium">{o.name}</p><p className="text-xs text-ink-3">{o.slug}</p></div> },
              { key: 'status', header: 'Status', cell: (o) => <StatusPill status={o.status} /> },
              { key: 'plan', header: 'Plan', hideOnMobile: true, cell: (o) => o.subscription ? <span>{o.subscription.plan.name} <StatusPill status={o.subscription.status} /></span> : '—' },
              { key: 'counts', header: 'Domains / mailboxes', hideOnMobile: true, cell: (o) => `${o._count.domains} / ${o._count.mailboxes}` },
              { key: 'created', header: 'Created', hideOnMobile: true, cell: (o) => <span className="text-ink-3">{date(o.createdAt)}</span> },
            ]} />
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
      <Dialog open={open} onOpenChange={setOpen} title="New organisation" description="The owner receives an invitation email (or is added directly if they already have an account)." footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={create.isPending} disabled={!f.name || !f.ownerEmail} onClick={() => create.mutate()}>Create</Button></>}>
        <div className="space-y-4">
          <Field label="Organisation name">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Owner email">{(id) => <Input id={id} type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} />}</Field>
          <Field label="Plan (starts as trial)">{(id) => <Select id={id} value={f.planCode} onChange={(e) => setF({ ...f, planCode: e.target.value })}>{plans.data?.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select>}</Field>
        </div>
      </Dialog>
    </div>
  );
}
