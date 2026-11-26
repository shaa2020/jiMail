'use client';

import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Panel } from '@/components/ui/primitives';
import { DataTable, Pagination, SearchInput } from '@/components/ui/table';
import { get } from '@/lib/api';
import { dateTime } from '@/lib/format';

export function AuditView({ path, showOrg }: { path: string; showOrg?: boolean }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const r = useQuery<any>({ queryKey: ['audit', path, page, q], queryFn: () => get(`${path}?page=${page}&pageSize=50${q ? `&q=${encodeURIComponent(q)}` : ''}`), placeholderData: (p: any) => p });
  return (
    <div>
      <PageHeader title="Audit log" description="Every administrative change, who made it and from where. Entries cannot be edited." />
      <Panel padded={false}>
        <div className="border-b border-line px-5 py-3"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search action, target or email" /></div>
        {r.isLoading ? <LoadingRows /> : r.error ? <ErrorState error={r.error} /> : (
          <>
            <DataTable rows={r.data.items} empty={<EmptyState icon={<ScrollText className="size-5" />} title="No entries" />} columns={[
              { key: 'when', header: 'When', cell: (a) => <span className="whitespace-nowrap text-ink-3">{dateTime(a.createdAt)}</span> },
              { key: 'actor', header: 'Actor', cell: (a) => a.actor ? <span>{a.actor.name}<span className="block text-xs text-ink-3">{a.actorApiKeyId ? 'via API key' : a.actor.email}</span></span> : <span className="text-ink-3">System</span> },
              ...(showOrg ? [{ key: 'org', header: 'Organisation', hideOnMobile: true, cell: (a: any) => a.organization?.name ?? '—' }] : []),
              { key: 'action', header: 'Action', cell: (a) => <code className="font-mono text-xs">{a.action}</code> },
              { key: 'meta', header: 'Details', hideOnMobile: true, cell: (a) => <span className="line-clamp-2 break-all text-xs text-ink-2">{a.metadata ? Object.entries(a.metadata).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : ''}</span> },
              { key: 'ip', header: 'IP', hideOnMobile: true, cell: (a) => <span className="font-mono text-xs text-ink-3">{a.ip ?? ''}</span> },
            ]} />
            <Pagination page={page} pageSize={50} total={r.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </div>
  );
}
