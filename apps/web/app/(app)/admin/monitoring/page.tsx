'use client';

import { useQuery } from '@tanstack/react-query';
import { ComponentList, SystemResources } from '@/components/health';
import { ErrorState, LoadingRows, PageHeader, Panel } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { get } from '@/lib/api';
import { dateTime } from '@/lib/format';

export default function Monitoring() {
  const q = useQuery<any>({ queryKey: ['monitoring'], queryFn: () => get('/admin/monitoring'), refetchInterval: 15_000 });
  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const { components, system, jobs } = q.data;
  return (
    <div>
      <PageHeader title="Monitoring" description="Service health, host resources and background jobs. Refreshes every 15 seconds. Critical failures are also sent to the alert webhook when configured." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Services"><ComponentList components={components} /></Panel>
        <Panel title="Host resources"><SystemResources system={system} /></Panel>
      </div>
      <Panel title="Background jobs" className="mt-5">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-5">
          {Object.entries(jobs.counts).map(([k, v]) => <div key={k}><dt className="text-ink-3 capitalize">{k}</dt><dd className="font-display text-2xl font-semibold">{v as number}</dd></div>)}
        </dl>
      </Panel>
      <Panel title="Recent job failures" className="mt-5" padded={false}>
        <DataTable rows={jobs.recentFailures.map((j: any) => ({ ...j, id: String(j.id) }))} empty={<p className="px-5 py-6 text-sm text-ink-3">No failed jobs.</p>} columns={[
          { key: 'n', header: 'Job', cell: (j) => <code className="font-mono text-xs">{j.name}</code> },
          { key: 'r', header: 'Error', cell: (j) => <span className="text-bad">{j.failedReason}</span> },
          { key: 'a', header: 'Attempts', cell: (j) => j.attemptsMade },
          { key: 'w', header: 'When', cell: (j) => dateTime(j.finishedOn) },
        ]} />
      </Panel>
    </div>
  );
}
