'use client';

import { useQuery } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Menu, MenuItem } from '@/components/ui/overlay';
import { Avatar, Badge, ErrorState, LoadingRows, PageHeader, Panel } from '@/components/ui/primitives';
import { DataTable, Pagination, SearchInput } from '@/components/ui/table';
import { get, post } from '@/lib/api';
import { relative, ROLE_LABEL } from '@/lib/format';
import { useAction, useMe } from '@/lib/hooks';

export default function AdminUsers() {
  const { data: me } = useMe();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const list = useQuery<any>({ queryKey: ['admin-users', page, q], queryFn: () => get(`/admin/users?page=${page}&pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}`), placeholderData: (p: any) => p });
  const status = useAction((v: { id: string; suspended: boolean }) => post(`/admin/users/${v.id}/status`, { suspended: v.suspended }), { success: 'User updated', invalidate: [['admin-users']] });
  const role = useAction((v: { id: string; platformRole: string }) => post(`/admin/users/${v.id}/platform-role`, { platformRole: v.platformRole }), { success: 'Platform role updated', invalidate: [['admin-users']] });
  return (
    <div>
      <PageHeader title="Users" description="All accounts: administrators with personal logins and mailbox users who sign in with their mailbox password." />
      <Panel padded={false}>
        <div className="border-b border-line px-5 py-3"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search email or name" /></div>
        {list.isLoading ? <LoadingRows /> : list.error ? <ErrorState error={list.error} /> : (
          <>
            <DataTable rows={list.data.items} columns={[
              { key: 'u', header: 'User', cell: (u) => <div className="flex items-center gap-3"><Avatar name={u.name} email={u.email} /><div className="min-w-0"><p className="truncate font-medium">{u.name}</p><p className="truncate text-xs text-ink-3">{u.email}</p></div></div> },
              { key: 'flags', header: 'Account', cell: (u) => <div className="flex flex-wrap gap-1">{u.platformRole === 'SUPER_ADMIN' && <Badge tone="accent">Platform admin</Badge>}<Badge tone={u.authSource === 'MAILBOX' ? 'neutral' : 'info'}>{u.authSource === 'MAILBOX' ? 'Mailbox' : 'Personal'}</Badge>{u.totpEnabledAt && <Badge tone="ok">2FA</Badge>}{u.status !== 'ACTIVE' && <Badge tone="bad">Suspended</Badge>}{!u.emailVerifiedAt && <Badge tone="warn">Unverified</Badge>}</div> },
              { key: 'orgs', header: 'Organisations', hideOnMobile: true, cell: (u) => <span className="text-xs text-ink-2">{u.memberships.map((m: any) => `${m.organization.name} (${ROLE_LABEL[m.role]})`).join(', ') || '—'}</span> },
              { key: 'login', header: 'Last sign-in', hideOnMobile: true, cell: (u) => <span className="text-ink-3">{relative(u.lastLoginAt)}</span> },
              { key: 'x', header: <span className="sr-only">Actions</span>, cell: (u) => u.id !== me?.id && (
                <Menu trigger={<button className="rounded-md p-1.5 hover:bg-surface-2" aria-label={`Actions for ${u.email}`}><MoreHorizontal className="size-4" /></button>}>
                  <MenuItem onSelect={() => status.mutate({ id: u.id, suspended: u.status === 'ACTIVE' })} danger={u.status === 'ACTIVE'}>{u.status === 'ACTIVE' ? 'Suspend account' : 'Reactivate account'}</MenuItem>
                  {u.authSource === 'LOCAL' && <MenuItem onSelect={() => role.mutate({ id: u.id, platformRole: u.platformRole === 'SUPER_ADMIN' ? 'USER' : 'SUPER_ADMIN' })}>{u.platformRole === 'SUPER_ADMIN' ? 'Remove platform admin' : 'Make platform admin (requires 2FA)'}</MenuItem>}
                </Menu>
              ) },
            ]} />
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </div>
  );
}
