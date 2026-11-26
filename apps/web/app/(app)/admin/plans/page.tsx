'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '@/components/ui/overlay';
import { Badge, Button, Checkbox, ErrorState, Field, Input, LoadingRows, PageHeader, Panel, Textarea } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { get, post, put } from '@/lib/api';
import { mb, money } from '@/lib/format';
import { useAction } from '@/lib/hooks';

const empty = { code: '', name: '', description: '', priceMonthlyCents: 0, currency: 'EUR', maxMailboxes: 10, maxDomains: 1, storagePerMailboxMb: 5120, maxStorageMb: 51200, sendLimitPerHour: 200, trialDays: 14, features: [] as string[], isPublic: true, isActive: true, stripePriceId: '', sortOrder: 10 };

export default function Plans() {
  const q = useQuery<any[]>({ queryKey: ['admin-plans'], queryFn: () => get('/admin/plans') });
  const [editing, setEditing] = useState<any>(null);
  const isNew = editing && !editing.id;
  const save = useAction(() => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...body } = editing;
    const payload = { ...body, stripePriceId: body.stripePriceId || null };
    return isNew ? post('/admin/plans', payload) : put(`/admin/plans/${editing.code}`, payload);
  }, { success: 'Plan saved', invalidate: [['admin-plans'], ['plans']], onSuccess: () => setEditing(null) });
  const num = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, [k]: Number(e.target.value) });
  return (
    <div>
      <PageHeader title="Hosting plans" description="Limits enforced when organisations add domains and mailboxes. Link a Stripe price to sell a plan online." actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing({ ...empty })}>New plan</Button>} />
      <Panel padded={false}>
        {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} /> : (
          <DataTable rows={q.data!} onRowClick={(p) => setEditing({ ...p, stripePriceId: p.stripePriceId ?? '' })} columns={[
            { key: 'n', header: 'Plan', cell: (p) => <div><p className="font-medium">{p.name}</p><p className="font-mono text-xs text-ink-3">{p.code}</p></div> },
            { key: 'p', header: 'Price', cell: (p) => (p.priceMonthlyCents ? `${money(p.priceMonthlyCents, p.currency)}/mo` : 'Custom') },
            { key: 'l', header: 'Limits', hideOnMobile: true, cell: (p) => <span className="text-xs text-ink-2">{p.maxMailboxes} mailboxes · {p.maxDomains} domains · {mb(p.storagePerMailboxMb)}/mailbox · {p.sendLimitPerHour} sends/h</span> },
            { key: 's', header: 'Visibility', cell: (p) => <div className="flex gap-1">{p.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}{p.isPublic && <Badge tone="info">Public</Badge>}{p.stripePriceId && <Badge tone="accent">Stripe</Badge>}</div> },
          ]} />
        )}
      </Panel>
      {editing && (
        <Dialog open onOpenChange={(v) => !v && setEditing(null)} wide title={isNew ? 'New plan' : `Edit ${editing.name}`} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save plan</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code (permanent)">{(id) => <Input id={id} value={editing.code} disabled={!isNew} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />}</Field>
            <Field label="Name">{(id) => <Input id={id} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}</Field>
            <Field label="Description" className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />}</Field>
            <Field label="Monthly price (cents)">{(id) => <Input id={id} type="number" value={editing.priceMonthlyCents} onChange={num('priceMonthlyCents')} />}</Field>
            <Field label="Currency">{(id) => <Input id={id} value={editing.currency} maxLength={3} onChange={(e) => setEditing({ ...editing, currency: e.target.value.toUpperCase() })} />}</Field>
            <Field label="Max mailboxes">{(id) => <Input id={id} type="number" value={editing.maxMailboxes} onChange={num('maxMailboxes')} />}</Field>
            <Field label="Max domains">{(id) => <Input id={id} type="number" value={editing.maxDomains} onChange={num('maxDomains')} />}</Field>
            <Field label="Storage per mailbox (MB)">{(id) => <Input id={id} type="number" value={editing.storagePerMailboxMb} onChange={num('storagePerMailboxMb')} />}</Field>
            <Field label="Total storage (MB)">{(id) => <Input id={id} type="number" value={editing.maxStorageMb} onChange={num('maxStorageMb')} />}</Field>
            <Field label="Sends per hour per mailbox">{(id) => <Input id={id} type="number" value={editing.sendLimitPerHour} onChange={num('sendLimitPerHour')} />}</Field>
            <Field label="Trial days">{(id) => <Input id={id} type="number" value={editing.trialDays} onChange={num('trialDays')} />}</Field>
            <Field label="Stripe price ID">{(id) => <Input id={id} value={editing.stripePriceId} placeholder="price_..." onChange={(e) => setEditing({ ...editing, stripePriceId: e.target.value })} />}</Field>
            <Field label="Sort order">{(id) => <Input id={id} type="number" value={editing.sortOrder} onChange={num('sortOrder')} />}</Field>
            <Field label="Features (one per line)" className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} value={editing.features.join('\n')} onChange={(e) => setEditing({ ...editing, features: e.target.value.split('\n').filter(Boolean) })} />}</Field>
            <Checkbox label="Active (can be chosen)" checked={editing.isActive} onChange={(v) => setEditing({ ...editing, isActive: v })} />
            <Checkbox label="Public (shown on pricing)" checked={editing.isPublic} onChange={(v) => setEditing({ ...editing, isPublic: v })} />
          </div>
        </Dialog>
      )}
    </div>
  );
}
