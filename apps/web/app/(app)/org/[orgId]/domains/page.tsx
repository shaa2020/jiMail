'use client';

import { useQuery } from '@tanstack/react-query';
import { Globe, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Dialog } from '@/components/ui/overlay';
import { Button, EmptyState, ErrorState, Field, Input, LoadingRows, PageHeader, Panel, StatusPill } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { get, post } from '@/lib/api';
import { relative } from '@/lib/format';
import { atLeast, useAction } from '@/lib/hooks';
import { useOrg } from '@/lib/org';

export default function DomainsPage() {
  const { orgId, role, base } = useOrg();
  const router = useRouter();
  const q = useQuery<any[]>({ queryKey: ['domains', orgId], queryFn: () => get(`/orgs/${orgId}/domains`) });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const add = useAction((n: string) => post(`/orgs/${orgId}/domains`, { name: n }), {
    success: 'Domain added. Publish the verification record next.',
    invalidate: [['domains', orgId], ['dash', orgId]],
    onSuccess: (d) => router.push(`${base}/domains/${d.id}`),
  });
  const canAdd = atLeast(role, 'ADMIN');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(name.trim());
  };

  return (
    <div>
      <PageHeader
        title="Domains"
        description="Connect domains you own. Mail is accepted for a domain only after ownership is proven, and delivery is marked ready only when its DNS records pass."
        actions={canAdd && <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Add domain</Button>}
      />
      <Panel padded={false}>
        {q.isLoading ? (
          <LoadingRows />
        ) : q.error ? (
          <ErrorState error={q.error} retry={q.refetch} />
        ) : (
          <DataTable
            rows={q.data!}
            onRowClick={(d) => router.push(`${base}/domains/${d.id}`)}
            empty={
              <EmptyState icon={<Globe className="size-6" />} title="No domains yet" action={canAdd && <Button onClick={() => setOpen(true)} icon={<Plus className="size-4" />}>Add your first domain</Button>}>
                You need a domain such as company.com to create mailboxes. You will add a few DNS records at your DNS provider.
              </EmptyState>
            }
            columns={[
              { key: 'name', header: 'Domain', cell: (d) => <span className="font-medium">{d.name}</span> },
              { key: 'status', header: 'Status', cell: (d) => <StatusPill status={d.status} /> },
              {
                key: 'checks',
                header: 'DNS checks',
                hideOnMobile: true,
                cell: (d) => (d.checksSummary.required ? <span className="text-ink-2">{d.checksSummary.passed} of {d.checksSummary.required} required passing</span> : <span className="text-ink-3">Not checked</span>),
              },
              { key: 'mb', header: 'Mailboxes', hideOnMobile: true, cell: (d) => d._count.mailboxes },
              { key: 'checked', header: 'Last check', hideOnMobile: true, cell: (d) => <span className="text-ink-3">{relative(d.lastCheckedAt)}</span> },
            ]}
          />
        )}
      </Panel>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add a domain"
        description="Enter a domain you control. You will prove ownership with a DNS TXT record."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button form="add-domain" type="submit" loading={add.isPending} disabled={!name.trim()}>Add domain</Button>
          </>
        }
      >
        <form id="add-domain" onSubmit={submit}>
          <Field label="Domain name" hint="For example company.com — without www or https://">
            {(id, d) => <Input id={id} aria-describedby={d} value={name} onChange={(e) => setName(e.target.value)} placeholder="company.com" autoFocus autoCapitalize="none" spellCheck={false} />}
          </Field>
        </form>
      </Dialog>
    </div>
  );
}
