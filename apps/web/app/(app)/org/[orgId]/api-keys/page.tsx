'use client';

import { useQuery } from '@tanstack/react-query';
import { KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, Dialog } from '@/components/ui/overlay';
import { Badge, Button, Checkbox, EmptyState, ErrorState, Field, Input, LoadingRows, PageHeader, Panel, Secret, Select } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { del, get, post } from '@/lib/api';
import { relative } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useOrg } from '@/lib/org';

const SCOPES: [string, string][] = [
  ['organization:read', 'Read organisation details and dashboard'],
  ['domains:read', 'List domains and DNS status'],
  ['domains:write', 'Add, verify and remove domains'],
  ['mailboxes:read', 'List mailboxes'],
  ['mailboxes:write', 'Create, update, suspend and delete mailboxes'],
  ['aliases:write', 'Manage aliases'],
  ['usage:read', 'Read storage and usage'],
  ['delivery:read', 'Read delivery statistics'],
];

export default function ApiKeysPage() {
  const { orgId } = useOrg();
  const keys = useQuery<any[]>({ queryKey: ['api-keys', orgId], queryFn: () => get(`/orgs/${orgId}/api-keys`) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', scopes: ['mailboxes:read'] as string[], expires: '365' });
  const [secret, setSecret] = useState<string | null>(null);
  const create = useAction(() => post<any>(`/orgs/${orgId}/api-keys`, { name: form.name, scopes: form.scopes, expiresInDays: form.expires ? Number(form.expires) : undefined }), { invalidate: [['api-keys', orgId]], onSuccess: (r) => setSecret(r.secret) });
  const rotate = useAction((id: string) => post<any>(`/orgs/${orgId}/api-keys/${id}/rotate`), { invalidate: [['api-keys', orgId]], onSuccess: (r) => { setSecret(r.secret); setOpen(true); } });
  const [revoking, setRevoking] = useState<any>(null);
  const revoke = useAction(() => del(`/orgs/${orgId}/api-keys/${revoking.id}`), { success: 'Key revoked', invalidate: [['api-keys', orgId]], onSuccess: () => setRevoking(null) });
  const close = (v: boolean) => { setOpen(v); if (!v) { setSecret(null); setForm({ name: '', scopes: ['mailboxes:read'], expires: '365' }); } };

  return (
    <div>
      <PageHeader title="API keys" description={<>Automate provisioning with the REST API. Keys work only for this organisation and only within their scopes. <a href="/api/docs" className="text-petrol underline" target="_blank">API reference</a></>} actions={<Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Create key</Button>} />
      <Panel padded={false}>
        {keys.isLoading ? <LoadingRows /> : keys.error ? <ErrorState error={keys.error} /> : (
          <DataTable rows={keys.data!} empty={<EmptyState icon={<KeyRound className="size-5" />} title="No API keys">Create a key to provision mailboxes from your own systems.</EmptyState>} columns={[
            { key: 'name', header: 'Name', cell: (k) => <div><p className="font-medium">{k.name}</p><p className="font-mono text-xs text-ink-3">{k.prefix}…</p></div> },
            { key: 'scopes', header: 'Scopes', hideOnMobile: true, cell: (k) => <div className="flex flex-wrap gap-1">{k.scopes.map((s: string) => <Badge key={s}>{s}</Badge>)}</div> },
            { key: 'used', header: 'Last used', hideOnMobile: true, cell: (k) => <span className="text-ink-3">{relative(k.lastUsedAt)}</span> },
            { key: 'state', header: 'State', cell: (k) => k.revokedAt ? <Badge tone="neutral">Revoked</Badge> : k.expiresAt && new Date(k.expiresAt) < new Date() ? <Badge tone="warn">Expired</Badge> : <Badge tone="ok">Active</Badge> },
            { key: 'x', header: <span className="sr-only">Actions</span>, cell: (k) => !k.revokedAt && <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => rotate.mutate(k.id)}>Rotate</Button><Button size="sm" variant="ghost" className="text-bad" onClick={() => setRevoking(k)}>Revoke</Button></div> },
          ]} />
        )}
      </Panel>
      <Dialog open={open} onOpenChange={close} title={secret ? 'Copy your API key' : 'Create API key'} wide footer={secret ? <Button onClick={() => close(false)}>Done</Button> : <><Button variant="secondary" onClick={() => close(false)}>Cancel</Button><Button loading={create.isPending} disabled={!form.name || !form.scopes.length} onClick={() => create.mutate()}>Create key</Button></>}>
        {secret ? (
          <div className="space-y-3">
            <Secret label="API key — shown once" value={secret} />
            <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">curl -H &quot;Authorization: Bearer {secret.slice(0, 14)}…&quot; {typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/orgs/{orgId}/mailboxes</pre>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Name">{(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="CRM provisioning" />}</Field>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[13px] font-medium text-ink-2">Scopes</legend>
              {SCOPES.map(([s, d]) => <Checkbox key={s} label={s} hint={d} checked={form.scopes.includes(s)} onChange={(v) => setForm({ ...form, scopes: v ? [...form.scopes, s] : form.scopes.filter((x) => x !== s) })} />)}
            </fieldset>
            <Field label="Expires">{(id) => <Select id={id} value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })}><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In 1 year</option><option value="">Never</option></Select>}</Field>
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={!!revoking} onOpenChange={(v) => !v && setRevoking(null)} title="Revoke API key?" description={`Integrations using “${revoking?.name}” stop working immediately.`} confirmLabel="Revoke key" loading={revoke.isPending} onConfirm={() => revoke.mutate()} />
    </div>
  );
}
