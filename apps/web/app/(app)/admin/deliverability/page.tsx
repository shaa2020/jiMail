'use client';

import { useQuery } from '@tanstack/react-query';
import { ErrorState, LoadingRows, Notice, PageHeader, Panel, StatusPill } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { get } from '@/lib/api';

export default function Deliverability() {
  const q = useQuery<any>({ queryKey: ['deliverability'], queryFn: () => get('/admin/deliverability') });
  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data;
  return (
    <div>
      <PageHeader title="Deliverability readiness" description={`Infrastructure checks for ${d.mailHostname}${d.publicIp ? ` (${d.publicIp})` : ''} and the DNS state of every customer domain.`} />
      <div className="mb-5"><Notice tone="info">{d.note}</Notice></div>
      <Panel title="Mail server infrastructure" padded={false}>
        <ul className="divide-y divide-line">
          {d.checks.map((c: any) => (
            <li key={c.name} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
              <div><p className="text-sm font-medium">{c.name}</p><p className="text-[13px] text-ink-3">{c.detail}{c.found ? ` — found: ${c.found}` : ''}</p></div>
              <StatusPill status={c.status} />
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Customer domains" className="mt-5" padded={false}>
        <DataTable rows={d.domains.map((x: any) => ({ ...x, id: x.name }))} empty={<p className="px-5 py-6 text-sm text-ink-3">No domains yet.</p>} columns={[
          { key: 'n', header: 'Domain', cell: (x) => <span className="font-medium">{x.name}</span> },
          { key: 'o', header: 'Organisation', hideOnMobile: true, cell: (x) => x.organization },
          { key: 's', header: 'Status', cell: (x) => <StatusPill status={x.status} /> },
          { key: 'f', header: 'Failing records', cell: (x) => x.failing.length ? <span className="text-bad">{x.failing.join(', ')}</span> : <span className="text-ink-3">None</span> },
          { key: 'w', header: 'Warnings', hideOnMobile: true, cell: (x) => x.warnings.join(', ') || '—' },
        ]} />
      </Panel>
      <Panel title="What else affects inbox placement" className="mt-5">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>A static public IPv4 address whose reverse DNS (PTR) matches the mail hostname.</li>
          <li>Outbound TCP port 25 must be open at your hosting provider; many block it by default.</li>
          <li>SPF, DKIM and DMARC for every sending domain, with DMARC moved from p=none to quarantine or reject.</li>
          <li>A valid TLS certificate on the mail hostname for SMTP, IMAP and HTTPS.</li>
          <li>IP and domain reputation: new IPs should start with low volume; monitor blocklists and bounce rates.</li>
        </ul>
      </Panel>
    </div>
  );
}
