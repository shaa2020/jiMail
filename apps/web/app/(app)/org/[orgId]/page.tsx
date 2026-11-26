'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Globe, Inbox, Plus } from 'lucide-react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, EmptyState, ErrorState, LoadingRows, Meter, Notice, PageHeader, Panel, Stat, StatusPill } from '@/components/ui/primitives';
import { get } from '@/lib/api';
import { bytes, date, mb, relative } from '@/lib/format';
import { useOrg } from '@/lib/org';
import { describeAction } from '@/lib/actions';

export default function OrgDashboard() {
  const { orgId, base } = useOrg();
  const dash = useQuery<any>({ queryKey: ['dash', orgId], queryFn: () => get(`/orgs/${orgId}/dashboard`) });
  const delivery = useQuery<any>({ queryKey: ['delivery', orgId, 14], queryFn: () => get(`/orgs/${orgId}/delivery?days=14`) });
  if (dash.isLoading) return <LoadingRows rows={8} />;
  if (dash.error) return <ErrorState error={dash.error} retry={dash.refetch} />;
  const d = dash.data;
  const allocatedPct = d.limits.maxStorageMb ? Math.round((d.storage.allocatedMb / d.limits.maxStorageMb) * 100) : 0;
  const noDomain = d.domains.length === 0;

  return (
    <div>
      <PageHeader
        title={d.organization.name}
        description={`Created ${date(d.organization.createdAt)}`}
        actions={
          <>
            <Link href={`${base}/domains`}>
              <Button variant="secondary" icon={<Globe className="size-4" />}>
                Add domain
              </Button>
            </Link>
            <Link href={`${base}/mailboxes?new=1`}>
              <Button icon={<Plus className="size-4" />} disabled={noDomain}>
                New mailbox
              </Button>
            </Link>
          </>
        }
      />
      {d.organization.status !== 'ACTIVE' && (
        <div className="mb-5">
          <Notice tone="bad" title="Organisation suspended">Mail for this organisation is paused. Contact the platform administrator.</Notice>
        </div>
      )}
      {d.subscription?.status === 'TRIALING' && d.subscription.trialEndsAt && (
        <div className="mb-5">
          <Notice tone="info">
            Your {d.subscription.plan} trial ends {relative(d.subscription.trialEndsAt)}.{' '}
            <Link href={`${base}/billing`} className="font-medium underline">
              Review plans
            </Link>
          </Notice>
        </div>
      )}
      {['PAST_DUE', 'SUSPENDED'].includes(d.subscription?.status) && (
        <div className="mb-5">
          <Notice tone="warn" title={d.subscription.status === 'PAST_DUE' ? 'Payment overdue' : 'Subscription suspended'}>
            {d.subscription.status === 'PAST_DUE' ? 'Settle billing to avoid suspension.' : 'You cannot add mailboxes or domains until billing is resolved.'}{' '}
            <Link href={`${base}/billing`} className="font-medium underline">
              Go to billing
            </Link>
          </Notice>
        </div>
      )}

      {noDomain ? (
        <Panel>
          <EmptyState
            icon={<Globe className="size-6" />}
            title="Connect your first domain"
            action={
              <Link href={`${base}/domains`}>
                <Button icon={<Plus className="size-4" />}>Add a domain</Button>
              </Link>
            }
          >
            Add a domain you own, prove ownership with one DNS record, then create mailboxes like info@ and sales@ on it.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Mailboxes" value={`${d.mailboxes.total} / ${d.limits.maxMailboxes}`} sub={`${d.mailboxes.active} active · ${d.mailboxes.suspended} suspended`} href={`${base}/mailboxes`} />
            <Stat label="Domains" value={`${d.domains.length} / ${d.limits.maxDomains}`} sub={`${d.domains.filter((x: any) => x.status === 'ACTIVE').length} ready for mail`} href={`${base}/domains`} />
            <Stat label="Storage used" value={bytes(d.storage.usedBytes)} sub={<span>{mb(d.storage.allocatedMb)} allocated of {mb(d.limits.maxStorageMb)}</span>} />
            <Stat label="Delivered (30 days)" value={d.mail30d.delivered} sub={`${d.mail30d.failed} failed · ${d.mail30d.received} received`} href={`${base}/delivery`} />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_380px]">
            <Panel title="Mail activity" description="Last 14 days, from mail server delivery events" action={<Link className="text-[13px] text-petrol hover:underline" href={`${base}/delivery`}>Details</Link>}>
              {delivery.data ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={delivery.data.series} margin={{ left: -24, right: 4, top: 4 }}>
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} cursor={{ fill: 'var(--surface-2)' }} />
                      <Bar dataKey="delivered" name="Delivered" stackId="a" fill="var(--petrol)" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="ham" name="Received" stackId="b" fill="var(--saffron)" />
                      <Bar dataKey="bounce" name="Bounced" stackId="a" fill="var(--bad)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <LoadingRows rows={3} />
              )}
            </Panel>

            <Panel title="Domain health" padded={false}>
              <ul>
                {d.domains.map((dom: any) => (
                  <li key={dom.id} className="border-b border-line last:border-0">
                    <Link href={`${base}/domains/${dom.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{dom.name}</span>
                        <span className="text-xs text-ink-3">Checked {relative(dom.lastCheckedAt)}</span>
                      </span>
                      <StatusPill status={dom.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[380px_1fr]">
            <Panel title="Plan usage">
              <dl className="space-y-4 text-sm">
                <div>
                  <div className="mb-1.5 flex justify-between"><dt className="text-ink-2">Mailboxes</dt><dd>{d.mailboxes.total} of {d.limits.maxMailboxes}</dd></div>
                  <Meter value={d.mailboxes.total} max={d.limits.maxMailboxes} label="Mailbox usage" />
                </div>
                <div>
                  <div className="mb-1.5 flex justify-between"><dt className="text-ink-2">Allocated storage</dt><dd>{allocatedPct}%</dd></div>
                  <Meter value={d.storage.allocatedMb} max={d.limits.maxStorageMb} label="Allocated storage" />
                </div>
                <div className="flex justify-between border-t border-line pt-3"><dt className="text-ink-2">Plan</dt><dd className="font-medium">{d.subscription?.plan ?? '—'}</dd></div>
              </dl>
            </Panel>
            <Panel title="Recent activity" padded={false} action={<Link className="text-[13px] text-petrol hover:underline" href={`${base}/activity`}>Audit log</Link>}>
              {d.recentActivity.length === 0 ? (
                <EmptyState icon={<Inbox className="size-5" />} title="No activity yet" />
              ) : (
                <ul>
                  {d.recentActivity.map((a: any) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5 text-sm last:border-0">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{a.actor?.name ?? 'System'}</span> <span className="text-ink-2">{describeAction(a)}</span>
                      </span>
                      <span className="shrink-0 text-xs text-ink-3">{relative(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
      <p className="mt-6 flex items-center gap-1 text-xs text-ink-3">
        <ArrowUpRight className="size-3" /> Statistics come from mail server events and are updated as they arrive.
      </p>
    </div>
  );
}
