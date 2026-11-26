'use client';

import { useQuery } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Panel, Select, Stat } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { get } from '@/lib/api';
import { dateTime } from '@/lib/format';

export function DeliveryView({ path, title, description }: { path: string; title: string; description: string }) {
  const [days, setDays] = useState(14);
  const q = useQuery<any>({ queryKey: ['delivery', path, days], queryFn: () => get(`${path}?days=${days}`) });
  const t = q.data?.totals ?? {};
  return (
    <div>
      <PageHeader title={title} description={description} actions={<Select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-auto"><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select>} />
      {q.isLoading ? <LoadingRows rows={6} /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Sent" value={t.queued_outbound ?? 0} />
            <Stat label="Delivered" value={t.delivered ?? 0} />
            <Stat label="Bounced / failed" value={(t.bounce ?? 0) + (t.failed ?? 0)} />
            <Stat label="Deferred" value={t.temp_fail ?? 0} />
            <Stat label="Received (spam)" value={`${(t.ham ?? 0) + (t.spam ?? 0)} (${t.spam ?? 0})`} />
          </div>
          <Panel title="Volume" className="mt-5">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={q.data.series} margin={{ left: -20, right: 6, top: 6 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="delivered" name="Delivered" stroke="var(--petrol)" fill="var(--petrol)" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="ham" name="Received" stroke="var(--saffron)" fill="var(--saffron)" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="bounce" name="Bounced" stroke="var(--bad)" fill="var(--bad)" fillOpacity={0.12} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Recent delivery problems" className="mt-5" padded={false}>
            <DataTable
              rows={q.data.recentFailures}
              empty={<EmptyState icon={<Send className="size-5" />} title="No delivery problems in this period" />}
              columns={[
                { key: 'when', header: 'When', cell: (r) => <span className="whitespace-nowrap text-ink-3">{dateTime(r.occurredAt)}</span> },
                { key: 'cat', header: 'Result', cell: (r) => <span className={r.category === 'temp_fail' ? 'text-warn' : 'text-bad'}>{r.category === 'temp_fail' ? 'Deferred' : r.category === 'bounce' ? 'Bounced' : 'Failed'}</span> },
                { key: 'from', header: 'From', hideOnMobile: true, cell: (r) => r.sender },
                { key: 'to', header: 'To', cell: (r) => <span className="break-all">{r.recipient}</span> },
                { key: 'detail', header: 'Reason', hideOnMobile: true, cell: (r) => <span className="text-ink-2">{r.detail}</span> },
              ]}
            />
          </Panel>
        </>
      )}
    </div>
  );
}

