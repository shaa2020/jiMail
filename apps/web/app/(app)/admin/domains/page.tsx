'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorState, LoadingRows, PageHeader, Panel, StatusPill } from '@/components/ui/primitives';
import { DataTable, Pagination, SearchInput } from '@/components/ui/table';
import { get } from '@/lib/api';
import { relative } from '@/lib/format';

export default function AdminDomains() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const list = useQuery<any>({ queryKey: ['admin-domains', page, q], queryFn: () => get(`/admin/domains?page=${page}&pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}`), placeholderData: (p: any) => p });
  return (
    <div>
      <PageHeader title="Domains" description="All customer domains across organisations." />
      <Panel padded={false}>
        <div className="border-b border-line px-5 py-3"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search domain" /></div>
        {list.isLoading ? <LoadingRows /> : list.error ? <ErrorState error={list.error} /> : (
          <>
            <DataTable rows={list.data.items} onRowClick={(d) => router.push(`/admin/organizations/${d.organization.id}`)} columns={[
              { key: 'n', header: 'Domain', cell: (d) => <span className="font-medium">{d.name}</span> },
              { key: 'o', header: 'Organisation', cell: (d) => d.organization.name },
              { key: 's', header: 'Status', cell: (d) => <StatusPill status={d.status} /> },
              { key: 'm', header: 'Mailboxes', hideOnMobile: true, cell: (d) => d._count.mailboxes },
              { key: 'c', header: 'Last check', hideOnMobile: true, cell: (d) => <span className="text-ink-3">{relative(d.lastCheckedAt)}</span> },
            ]} />
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </div>
  );
}
