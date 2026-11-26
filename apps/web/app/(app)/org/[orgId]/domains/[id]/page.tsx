'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, CircleDashed, RefreshCw, Trash2, XCircle, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/overlay';
import { Button, CopyButton, cx, ErrorState, Field, LoadingRows, Notice, PageHeader, Panel, Select, StatusPill } from '@/components/ui/primitives';
import { del, get, post, put } from '@/lib/api';
import { relative } from '@/lib/format';
import { atLeast, useAction } from '@/lib/hooks';
import { useOrg } from '@/lib/org';

const ICON: Record<string, React.ReactNode> = {
  PASS: <CheckCircle2 className="size-5 text-ok" aria-label="Pass" />,
  FAIL: <XCircle className="size-5 text-bad" aria-label="Missing" />,
  WARN: <AlertTriangle className="size-5 text-warn" aria-label="Needs attention" />,
  PENDING: <CircleDashed className="size-5 text-ink-3" aria-label="Pending" />,
};

const KIND_LABEL: Record<string, string> = {
  OWNERSHIP: 'Ownership', MX: 'Incoming mail (MX)', SPF: 'SPF', DKIM: 'DKIM signature', DMARC: 'DMARC policy', MTA_STS: 'MTA-STS', TLS_RPT: 'TLS reporting', AUTOCONFIG: 'Client autoconfig', PTR: 'Reverse DNS',
};

function RecordRow({ type, host, value, priority }: { type: string; host: string; value: string; priority?: number }) {
  return (
    <div className="grid gap-2 py-3 text-sm sm:grid-cols-[64px_minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
      <span className="font-mono text-xs font-medium text-ink-2">{type}{priority !== undefined ? ` ${priority}` : ''}</span>
      <div className="flex min-w-0 items-start gap-1">
        <code className="min-w-0 break-words font-mono text-[12.5px] [overflow-wrap:anywhere]">{host}</code>
        <CopyButton value={host} label="Copy host" iconOnly />
      </div>
      <div className="flex min-w-0 items-start gap-1">
        <code className="min-w-0 break-all font-mono text-[12.5px] text-ink-2">{value}</code>
        <CopyButton value={value} label="Copy value" iconOnly />
      </div>
    </div>
  );
}

export default function DomainDetail() {
  const { orgId, role, base } = useOrg();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const key = ['domain', orgId, id];
  const q = useQuery<any>({ queryKey: key, queryFn: () => get(`/orgs/${orgId}/domains/${id}`) });
  const recs = useQuery<any>({ queryKey: ['records', id], queryFn: () => get(`/orgs/${orgId}/domains/${id}/records`), enabled: !!q.data });
  const mailboxes = useQuery<any>({ queryKey: ['mailboxes', orgId, 'domain', id], queryFn: () => get(`/orgs/${orgId}/mailboxes?domainId=${id}&pageSize=100`), enabled: !!q.data?.verifiedAt });
  const inv = [key, ['records', id], ['domains', orgId], ['dash', orgId]];
  const verify = useAction(() => post<any>(`/orgs/${orgId}/domains/${id}/verify`), {
    success: (r) => (r.verified ? 'Ownership verified and domain provisioned on the mail server' : 'Verification record not found yet'),
    invalidate: inv,
  });
  const check = useAction(() => post(`/orgs/${orgId}/domains/${id}/check`), { success: 'DNS checks completed', invalidate: inv });
  const [catchAll, setCatchAll] = useState<string | null>(null);
  const saveCatchAll = useAction((address: string | null) => put(`/orgs/${orgId}/domains/${id}/catch-all`, { address }), { success: 'Catch-all updated', invalidate: inv });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useAction(() => del(`/orgs/${orgId}/domains/${id}`), { success: 'Domain removed', invalidate: [['domains', orgId]], onSuccess: () => router.push(`${base}/domains`) });

  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data;
  const isAdmin = atLeast(role, 'ADMIN');
  const verified = !!d.verifiedAt;
  const checks: any[] = d.dnsChecks.filter((c: any) => c.kind !== 'OWNERSHIP');
  const required = checks.filter((c) => c.required);
  const passing = required.filter((c) => c.status === 'PASS' || c.status === 'WARN').length;
  const records: any[] = recs.data?.records ?? [];
  const addresses: string[] = (mailboxes.data?.items ?? []).flatMap((m: any) => [m.address, ...m.aliases.map((a: any) => a.address)]);

  return (
    <div>
      <PageHeader
        back={
          <Link href={`${base}/domains`} className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5" /> Domains
          </Link>
        }
        title={<span className="flex flex-wrap items-center gap-3">{d.name} <StatusPill status={d.status} /></span>}
        description={d.lastCheckedAt ? `DNS last checked ${relative(d.lastCheckedAt)}. JiMail re-checks every 30 minutes.` : 'Not checked yet.'}
        actions={
          verified && (
            <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={check.isPending} onClick={() => check.mutate()}>
              Re-check DNS
            </Button>
          )
        }
      />

      {d.status === 'SUSPENDED' && <div className="mb-5"><Notice tone="bad" title="Domain suspended">{d.suspendedReason ?? 'Mail for this domain is disabled by the platform administrator.'}</Notice></div>}

      <ol className="space-y-5">
        <li>
          <Panel
            title={<span className="flex items-center gap-2">{verified ? ICON.PASS : ICON.PENDING} Step 1 · Prove you own {d.name}</span>}
            description={verified ? 'Ownership verified. The domain is provisioned on the mail server.' : 'Add this TXT record at your DNS provider, then select Verify. DNS changes can take a few minutes to 48 hours to appear.'}
            action={!verified && isAdmin && <Button loading={verify.isPending} onClick={() => verify.mutate()}>Verify ownership</Button>}
          >
            <RecordRow type="TXT" host={d.ownershipRecord.host} value={d.ownershipRecord.value} />
            {!verified && verify.data && !verify.data.verified && (
              <div className="mt-2"><Notice tone="warn">{verify.data.check?.message} {verify.data.check?.found ? `Found: ${verify.data.check.found}` : ''}</Notice></div>
            )}
          </Panel>
        </li>

        <li>
          <Panel
            title={<span className="flex items-center gap-2">{d.status === 'ACTIVE' ? ICON.PASS : verified ? ICON.WARN : ICON.PENDING} Step 2 · Publish mail records</span>}
            description={
              verified
                ? d.status === 'ACTIVE'
                  ? 'All required records pass. The domain is ready to send and receive mail.'
                  : `${passing} of ${required.length} required records pass. Add the missing records below — JiMail never changes your DNS for you.`
                : 'Available after ownership is verified.'
            }
            padded={false}
          >
            {verified && (
              <>
                <div className="divide-y divide-line">
                  {checks.map((c) => (
                    <div key={c.id} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          {ICON[c.status]}
                          <div>
                            <p className="text-sm font-medium">
                              {KIND_LABEL[c.kind]}
                              {c.kind === 'DKIM' && <span className="ml-1.5 font-mono text-xs font-normal text-ink-3">{c.host.split('._domainkey')[0]}</span>} {!c.required && <span className="ml-1 text-xs font-normal text-ink-3">recommended</span>}
                            </p>
                            <p className={cx('text-[13px]', c.status === 'FAIL' ? 'text-bad' : c.status === 'WARN' ? 'text-warn' : 'text-ink-3')}>{c.message}</p>
                          </div>
                        </div>
                        <StatusPill status={c.status} />
                      </div>
                      {c.status !== 'PASS' && (
                        <div className="mt-2 rounded-lg bg-surface-2 px-3 sm:ml-8">
                          <RecordRow type={c.type} host={c.host} value={c.kind === 'MX' ? c.expected.replace(/^\d+\s+/, '') : c.expected} priority={c.kind === 'MX' ? 10 : undefined} />
                          {c.found && <p className="pb-2.5 text-xs text-ink-3">Currently published: <code className="break-all font-mono">{c.found}</code></p>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <details className="border-t border-line px-5 py-3.5">
                  <summary className="cursor-pointer text-sm font-medium text-petrol">All records for {d.name} (including client autodiscovery)</summary>
                  <div className="mt-2 divide-y divide-line">
                    {records.filter((r) => !r.host.startsWith('_jimail')).map((r, i) => (
                      <div key={i}>
                        <p className="pt-3 text-xs text-ink-3">{r.purpose}{r.required ? '' : ' · optional'}</p>
                        <RecordRow type={r.type} host={r.host} value={r.value} priority={r.priority} />
                      </div>
                    ))}
                  </div>
                  {recs.data?.zoneFile && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-ink-3">
                      Prefer a BIND zone import? <CopyButton value={recs.data.zoneFile} label="Copy zone file" />
                    </div>
                  )}
                </details>
              </>
            )}
          </Panel>
        </li>
      </ol>

      {verified && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Panel title="Catch-all address" description="Deliver mail sent to unknown addresses on this domain to one mailbox. Leave off to reject unknown recipients (recommended against spam).">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Deliver unknown recipients to" className="flex-1">
                {(fid) => (
                  <Select id={fid} value={catchAll ?? d.catchAllAddress ?? ''} onChange={(e) => setCatchAll(e.target.value)} disabled={!isAdmin}>
                    <option value="">Off — reject unknown recipients</option>
                    {addresses.map((a) => <option key={a} value={a}>{a}</option>)}
                  </Select>
                )}
              </Field>
              {isAdmin && (
                <Button variant="secondary" loading={saveCatchAll.isPending} disabled={catchAll === null || catchAll === (d.catchAllAddress ?? '')} onClick={() => saveCatchAll.mutate(catchAll || null)}>
                  Save
                </Button>
              )}
            </div>
          </Panel>
          {isAdmin && (
            <Panel title="Remove domain" description="Removes the domain from the mail server. Delete its mailboxes first; mail data is never removed implicitly.">
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)} disabled={addresses.length > 0}>
                Remove {d.name}
              </Button>
              {addresses.length > 0 && <p className="mt-2 text-xs text-ink-3">{mailboxes.data?.total} mailbox(es) still use this domain.</p>}
            </Panel>
          )}
        </div>
      )}
      {!verified && isAdmin && (
        <div className="mt-5">
          <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>Cancel and remove this domain</Button>
        </div>
      )}
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Remove ${d.name}?`} description="Mail for this domain will no longer be accepted." confirmLabel="Remove domain" typeToConfirm={d.name} loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </div>
  );
}
