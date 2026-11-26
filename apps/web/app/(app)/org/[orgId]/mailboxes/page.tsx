'use client';

import { useQuery } from '@tanstack/react-query';
import { Inbox, Plus, Upload } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/overlay';
import { Button, Checkbox, EmptyState, ErrorState, Field, Input, LoadingRows, Meter, Notice, PageHeader, Panel, Secret, Select, StatusPill } from '@/components/ui/primitives';
import { DataTable, Pagination, SearchInput } from '@/components/ui/table';
import { api, get, post } from '@/lib/api';
import { bytes, mb } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useOrg } from '@/lib/org';
import { passwordProblems } from '@/lib/validation';

function CreateMailbox({ open, onOpenChange, domains, maxMb }: { open: boolean; onOpenChange: (v: boolean) => void; domains: any[]; maxMb: number }) {
  const { orgId } = useOrg();
  const usable = domains.filter((d) => d.verifiedAt && d.status !== 'SUSPENDED');
  const [f, setF] = useState({ localPart: '', domainId: '', displayName: '', quotaMb: String(maxMb), password: '', generate: true });
  const [result, setResult] = useState<{ address: string; temporaryPassword?: string } | null>(null);
  useEffect(() => setF((x) => ({ ...x, domainId: x.domainId || usable[0]?.id || '', quotaMb: String(maxMb) })), [usable.length, maxMb]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useAction(
    () => post(`/orgs/${orgId}/mailboxes`, { domainId: f.domainId, localPart: f.localPart, displayName: f.displayName, quotaMb: Number(f.quotaMb), ...(f.generate ? { generatePassword: true } : { password: f.password }) }),
    { success: 'Mailbox created', invalidate: [['mailboxes', orgId], ['dash', orgId]], onSuccess: (r: any) => setResult({ address: r.mailbox.address, temporaryPassword: r.temporaryPassword }) },
  );
  const pwIssue = !f.generate && f.password ? passwordProblems(f.password) : null;
  const domain = usable.find((d) => d.id === f.domainId);
  const close = (v: boolean) => {
    if (!v) {
      setResult(null);
      setF({ localPart: '', domainId: usable[0]?.id ?? '', displayName: '', quotaMb: String(maxMb), password: '', generate: true });
    }
    onOpenChange(v);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  if (result) {
    return (
      <Dialog open={open} onOpenChange={close} title="Mailbox created" description={result.address} footer={<Button onClick={() => close(false)}>Done</Button>}>
        {result.temporaryPassword ? (
          <div className="space-y-3">
            <Secret label="Temporary password — shown once" value={result.temporaryPassword} />
            <p className="text-sm text-ink-3">Share it through a secure channel. The user can change it after signing in. JiMail does not store or log this password.</p>
          </div>
        ) : (
          <p className="text-sm text-ink-2">The mailbox uses the password you chose.</p>
        )}
      </Dialog>
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="New mailbox"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
          <Button type="submit" form="create-mb" loading={create.isPending} disabled={!f.localPart || !f.displayName || !f.domainId || !!pwIssue || (!f.generate && !f.password)}>Create mailbox</Button>
        </>
      }
    >
      {usable.length === 0 ? (
        <Notice tone="warn">Verify ownership of a domain before creating mailboxes.</Notice>
      ) : (
        <form id="create-mb" onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Address">
              {(id) => (
                <div className="flex items-center rounded-lg border border-line-strong bg-surface focus-within:border-petrol focus-within:ring-2 focus-within:ring-saffron/40">
                  <input id={id} className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" value={f.localPart} onChange={(e) => setF({ ...f, localPart: e.target.value.toLowerCase() })} placeholder="info" autoCapitalize="none" spellCheck={false} />
                  <span className="pr-3 text-sm text-ink-3">@{domain?.name}</span>
                </div>
              )}
            </Field>
            <Field label="Domain">
              {(id) => (
                <Select id={id} value={f.domainId} onChange={(e) => setF({ ...f, domainId: e.target.value })}>
                  {usable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Display name" hint="Shown as the sender name, e.g. “Support team” or “Jane Doe”.">{(id, d) => <Input id={id} aria-describedby={d} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />}</Field>
          <Field label="Storage quota (MB)" hint={`Your plan allows up to ${mb(maxMb)} per mailbox.`}>{(id, d) => <Input id={id} aria-describedby={d} type="number" min={50} max={maxMb} value={f.quotaMb} onChange={(e) => setF({ ...f, quotaMb: e.target.value })} />}</Field>
          <Checkbox label="Generate a secure temporary password" checked={f.generate} onChange={(v) => setF({ ...f, generate: v })} />
          {!f.generate && <Field label="Password" error={pwIssue}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>}
        </form>
      )}
    </Dialog>
  );
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { orgId } = useOrg();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
  const run = useAction(
    async () => {
      const form = new FormData();
      form.append('file', file!);
      return api(`/orgs/${orgId}/mailboxes/import`, { method: 'POST', form });
    },
    { invalidate: [['mailboxes', orgId], ['dash', orgId]], onSuccess: setResult },
  );
  const close = (v: boolean) => {
    if (!v) {
      setResult(null);
      setFile(null);
    }
    onOpenChange(v);
  };
  const csv = result?.created?.filter((c: any) => c.temporaryPassword).map((c: any) => `${c.address},${c.temporaryPassword}`).join('\n');
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      wide
      title="Import mailboxes from CSV"
      description="Columns: address, name, quota_mb (optional), password (optional — generated when empty). Every row is validated before anything is created."
      footer={
        result ? <Button onClick={() => close(false)}>Done</Button> : (
          <>
            <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
            <Button loading={run.isPending} disabled={!file} onClick={() => run.mutate()}>Validate and import</Button>
          </>
        )
      }
    >
      {!result ? (
        <div className="space-y-3">
          <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-petrol-soft file:px-3 file:py-2 file:text-petrol-ink" aria-label="CSV file" />
          <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-ink-2">address,name,quota_mb{'\n'}info@company.com,Info desk,2048{'\n'}jane@company.com,Jane Doe,</pre>
        </div>
      ) : (
        <div className="space-y-3">
          {result.dryRunFailed && <Notice tone="bad" title="Nothing was created">Fix these rows and import again.</Notice>}
          {result.created.length > 0 && <Notice tone="ok">{result.created.length} mailbox(es) created.</Notice>}
          {result.errors.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-3 text-sm">
              {result.errors.map((e: any, i: number) => <li key={i}><span className="font-mono text-xs text-ink-3">Row {e.row}</span> <span className="text-bad">{e.message}</span></li>)}
            </ul>
          )}
          {csv && <Secret label="Generated passwords (address,password) — shown once, copy now" value={csv} />}
        </div>
      )}
    </Dialog>
  );
}

function MailboxesInner() {
  const { orgId, base } = useOrg();
  const router = useRouter();
  const params = useSearchParams();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [domainId, setDomainId] = useState('');
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [importing, setImporting] = useState(false);
  const domains = useQuery<any[]>({ queryKey: ['domains', orgId], queryFn: () => get(`/orgs/${orgId}/domains`) });
  const billing = useQuery<any>({ queryKey: ['dash', orgId], queryFn: () => get(`/orgs/${orgId}/dashboard`) });
  const list = useQuery<any>({
    queryKey: ['mailboxes', orgId, page, q, status, domainId],
    queryFn: () => get(`/orgs/${orgId}/mailboxes?page=${page}&pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}${domainId ? `&domainId=${domainId}` : ''}`),
    placeholderData: (prev: any) => prev,
  });
  const maxMb = billing.data?.limits?.storagePerMailboxMb ?? 1024;

  return (
    <div>
      <PageHeader
        title="Mailboxes"
        description="Every mailbox works in JiMail webmail and in any IMAP/SMTP app such as Outlook, Apple Mail, Thunderbird or the Gmail app."
        actions={
          <>
            <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>Import CSV</Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New mailbox</Button>
          </>
        }
      />
      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search address or name" />
          <Select aria-label="Filter by domain" className="h-9 w-auto" value={domainId} onChange={(e) => { setDomainId(e.target.value); setPage(1); }}>
            <option value="">All domains</option>
            {domains.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select aria-label="Filter by status" className="h-9 w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </Select>
        </div>
        {list.isLoading ? (
          <LoadingRows />
        ) : list.error ? (
          <ErrorState error={list.error} retry={list.refetch} />
        ) : (
          <>
            <DataTable
              rows={list.data.items}
              onRowClick={(m) => router.push(`${base}/mailboxes/${m.id}`)}
              empty={
                <EmptyState icon={<Inbox className="size-6" />} title={q || status || domainId ? 'No mailboxes match these filters' : 'No mailboxes yet'} action={!q && <Button onClick={() => setCreating(true)} icon={<Plus className="size-4" />}>Create a mailbox</Button>}>
                  {!q && !status && 'Create addresses such as info@, support@ or one per person.'}
                </EmptyState>
              }
              columns={[
                { key: 'address', header: 'Address', cell: (m) => <div><p className="font-medium">{m.address}</p><p className="text-xs text-ink-3">{m.displayName}{m.aliases.length ? ` · ${m.aliases.length} alias${m.aliases.length > 1 ? 'es' : ''}` : ''}</p></div> },
                { key: 'status', header: 'Status', cell: (m) => <StatusPill status={m.status} /> },
                {
                  key: 'storage',
                  header: 'Storage',
                  hideOnMobile: true,
                  cell: (m) => (
                    <div className="w-40">
                      <p className="mb-1 text-xs text-ink-3">{bytes(m.usedBytes)} of {mb(m.quotaMb)}</p>
                      <Meter value={m.usedBytes} max={m.quotaMb * 1024 * 1024} label={`Storage used by ${m.address}`} />
                    </div>
                  ),
                },
                { key: 'fwd', header: 'Forwarding', hideOnMobile: true, cell: (m) => (m.forwardTo.length ? <span className="text-ink-2">{m.forwardTo.length} address(es)</span> : <span className="text-ink-3">—</span>) },
              ]}
            />
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
      <CreateMailbox open={creating} onOpenChange={setCreating} domains={domains.data ?? []} maxMb={maxMb} />
      <ImportDialog open={importing} onOpenChange={setImporting} />
    </div>
  );
}

export default function MailboxesPage() {
  return (
    <Suspense>
      <MailboxesInner />
    </Suspense>
  );
}
