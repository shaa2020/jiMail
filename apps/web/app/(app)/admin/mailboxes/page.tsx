'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorState, LoadingRows, PageHeader, Panel, Select, StatusPill } from '@/components/ui/primitives';
import { DataTable, Pagination, SearchInput } from '@/components/ui/table';
import { get, post } from '@/lib/api';
import { bytes, mb } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export default function AdminMailboxes() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const list = useQuery<any>({ queryKey: ['admin-mailboxes', page, q, status], queryFn: () => get(`/admin/mailboxes?page=${page}&pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}`), placeholderData: (p: any) => p });
  const toggle = useAction((m: any) => post(`/admin/organizations/${m.organization.id}/mailboxes/${m.id}/suspension`, { suspended: m.status === 'ACTIVE', reason: 'Suspended by platform administrator' }), { success: 'Mailbox updated', invalidate: [['admin-mailboxes']] });
  return (
    <div>
      <PageHeader title="Mailboxes" description="All mailboxes on the platform. Suspend compromised accounts here." />
      <Panel padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search address" />
          <Select aria-label="Status" className="h-9 w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Any status</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></Select>
        </div>
        {list.isLoading ? <LoadingRows /> : list.error ? <ErrorState error={list.error} /> : (
          <>
            <DataTable rows={list.data.items} columns={[
              { key: 'a', header: 'Address', cell: (m) => <div><p className="font-medium">{m.address}</p>{m.suspendedReason && <p className="text-xs text-bad">{m.suspendedReason}</p>}</div> },
              { key: 'o', header: 'Organisation', hideOnMobile: true, cell: (m) => m.organization.name },
              { key: 's', header: 'Status', cell: (m) => <StatusPill status={m.status} /> },
              { key: 'u', header: 'Storage', hideOnMobile: true, cell: (m) => `${bytes(m.usedBytes)} / ${mb(m.quotaMb)}` },
              { key: 'x', header: <span className="sr-only">Actions</span>, cell: (m) => <Button size="sm" variant="ghost" onClick={() => toggle.mutate(m)}>{m.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}</Button> },
            ]} />
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </div>
  );
}
