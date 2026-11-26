'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, Receipt } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { toast } from 'sonner';
import { Button, cx, EmptyState, ErrorState, LoadingRows, Meter, Notice, PageHeader, Panel, StatusPill } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { errorMessage, get, post } from '@/lib/api';
import { bytes, date, mb, money, relative } from '@/lib/format';
import { atLeast, useAction } from '@/lib/hooks';
import { useOrg } from '@/lib/org';

function Billing() {
  const { orgId, role } = useOrg();
  const params = useSearchParams();
  const q = useQuery<any>({ queryKey: ['billing', orgId], queryFn: () => get(`/orgs/${orgId}/billing`) });
  const plans = useQuery<any[]>({ queryKey: ['plans'], queryFn: () => get('/plans') });
  const isOwner = atLeast(role, 'OWNER');
  const change = useAction((planCode: string) => post<any>(`/orgs/${orgId}/billing/plan`, { planCode }), {
    invalidate: [['billing', orgId], ['dash', orgId]],
    onSuccess: (r) => {
      if (r?.requiresCheckout && r.url) window.location.assign(r.url);
      else toast.success('Plan changed');
    },
  });
  const checkout = async (planCode: string) => {
    try {
      const r = await post<{ url: string }>(`/orgs/${orgId}/billing/checkout`, { planCode });
      window.location.assign(r.url);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const portal = async () => {
    try {
      window.location.assign((await post<{ url: string }>(`/orgs/${orgId}/billing/portal`)).url);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const { subscription: sub, limits, usage, invoices, provider } = q.data;

  return (
    <div>
      <PageHeader title="Plan & billing" description="Your subscription, usage against plan limits and invoices." actions={provider.configured && sub?.providerCustomerId && isOwner && <Button variant="secondary" icon={<ExternalLink className="size-4" />} onClick={portal}>Manage payment method</Button>} />
      {params.get('checkout') === 'success' && <div className="mb-5"><Notice tone="ok">Payment received. Your plan updates as soon as the payment provider confirms it.</Notice></div>}
      {!provider.configured && <div className="mb-5"><Notice tone="info">Online payments are not enabled on this installation. Plan changes after the trial are handled by the platform administrator.</Notice></div>}

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Panel title="Current subscription">
          {sub ? (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-ink-3">Plan</dt><dd className="mt-0.5 font-display text-xl font-semibold">{sub.plan.name}</dd></div>
              <div><dt className="text-ink-3">Status</dt><dd className="mt-1"><StatusPill status={sub.status} /></dd></div>
              {sub.status === 'TRIALING' && <div><dt className="text-ink-3">Trial ends</dt><dd>{date(sub.trialEndsAt)} ({relative(sub.trialEndsAt)})</dd></div>}
              {sub.status === 'PAST_DUE' && sub.graceEndsAt && <div><dt className="text-ink-3">Grace period ends</dt><dd className="text-warn">{date(sub.graceEndsAt)}</dd></div>}
              <div><dt className="text-ink-3">Current period</dt><dd>{date(sub.currentPeriodStart)} – {date(sub.currentPeriodEnd)}</dd></div>
              <div><dt className="text-ink-3">Price</dt><dd>{sub.plan.priceMonthlyCents ? `${money(sub.plan.priceMonthlyCents, sub.plan.currency)} / month` : 'Custom'}</dd></div>
            </dl>
          ) : <p className="text-sm text-ink-3">No subscription.</p>}
        </Panel>
        <Panel title="Usage">
          <dl className="space-y-4 text-sm">
            <div><div className="mb-1.5 flex justify-between"><dt>Mailboxes</dt><dd>{usage.mailboxes} / {limits.maxMailboxes}</dd></div><Meter value={usage.mailboxes} max={limits.maxMailboxes} label="Mailboxes" /></div>
            <div><div className="mb-1.5 flex justify-between"><dt>Domains</dt><dd>{usage.domains} / {limits.maxDomains}</dd></div><Meter value={usage.domains} max={limits.maxDomains} label="Domains" /></div>
            <div><div className="mb-1.5 flex justify-between"><dt>Allocated storage</dt><dd>{mb(usage.allocatedStorageMb)} / {mb(limits.maxStorageMb)}</dd></div><Meter value={usage.allocatedStorageMb} max={limits.maxStorageMb} label="Storage" /></div>
            <div className="flex justify-between border-t border-line pt-3 text-ink-2"><dt>Actually used</dt><dd>{bytes(usage.usedBytes)}</dd></div>
            <div className="flex justify-between text-ink-2"><dt>Sending limit</dt><dd>{limits.sendLimitPerHour} messages / hour / mailbox</dd></div>
          </dl>
        </Panel>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Plans</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.data?.map((p) => {
          const current = sub?.plan.code === p.code;
          return (
            <div key={p.id} className={cx('flex flex-col rounded-xl border bg-surface p-5', current ? 'border-petrol ring-1 ring-petrol' : 'border-line')}>
              <div className="flex items-start justify-between">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                {current && <StatusPill status="ACTIVE" label="Current" />}
              </div>
              <p className="mt-1 text-sm text-ink-3">{p.description}</p>
              <p className="mt-4 font-display text-3xl font-semibold">{p.priceMonthlyCents ? money(p.priceMonthlyCents, p.currency) : 'Custom'}<span className="text-sm font-normal text-ink-3">{p.priceMonthlyCents ? ' / month' : ''}</span></p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                {[`${p.maxMailboxes} mailboxes`, `${p.maxDomains} domain${p.maxDomains > 1 ? 's' : ''}`, `${mb(p.storagePerMailboxMb)} per mailbox`, ...p.features].map((f: string) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-ok" />{f}</li>)}
              </ul>
              {isOwner && !current && (
                <Button className="mt-5" variant={p.code === 'business' ? 'primary' : 'secondary'} loading={change.isPending && change.variables === p.code} onClick={() => (provider.configured && p.stripePriceId && sub?.status !== 'TRIALING' ? checkout(p.code) : change.mutate(p.code))}>
                  {provider.configured && p.stripePriceId ? `Switch to ${p.name}` : sub?.status === 'TRIALING' ? `Trial ${p.name}` : `Request ${p.name}`}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <Panel title="Invoices" className="mt-8" padded={false}>
        <DataTable
          rows={invoices}
          empty={<EmptyState icon={<Receipt className="size-5" />} title="No invoices yet">Invoices appear here when the payment provider issues them.</EmptyState>}
          columns={[
            { key: 'n', header: 'Invoice', cell: (i) => i.number ?? i.providerInvoiceId },
            { key: 'date', header: 'Date', cell: (i) => date(i.createdAt) },
            { key: 'amount', header: 'Amount', cell: (i) => money(i.amountDueCents, i.currency) },
            { key: 'status', header: 'Status', cell: (i) => <StatusPill status={i.status} /> },
            { key: 'link', header: <span className="sr-only">Link</span>, cell: (i) => i.hostedUrl && <a href={i.hostedUrl} target="_blank" rel="noreferrer" className="text-petrol hover:underline">View</a> },
          ]}
        />
      </Panel>
    </div>
  );
}

export default function Page() {
  return <Suspense><Billing /></Suspense>;
}
