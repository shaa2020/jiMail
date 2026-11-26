'use client';

import { useQuery } from '@tanstack/react-query';
import { MoreHorizontal, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, Dialog, Menu, MenuItem, MenuSeparator } from '@/components/ui/overlay';
import { Avatar, Badge, Button, ErrorState, Field, Input, LoadingRows, PageHeader, Panel, Select } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { del, get, patch, post } from '@/lib/api';
import { relative, ROLE_LABEL } from '@/lib/format';
import { atLeast, RANK, useAction } from '@/lib/hooks';
import { useOrg } from '@/lib/org';

const ROLES = ['OWNER', 'ADMIN', 'MAILBOX_ADMIN', 'MEMBER'] as const;
const ROLE_HELP: Record<string, string> = {
  OWNER: 'Full control including billing, security policy and owners',
  ADMIN: 'Manage domains, mailboxes, people, API keys and billing',
  MAILBOX_ADMIN: 'Create and manage mailboxes, aliases and forwarding',
  MEMBER: 'Uses webmail only',
};

export default function MembersPage() {
  const { orgId, role, me } = useOrg();
  const members = useQuery<any[]>({ queryKey: ['members', orgId], queryFn: () => get(`/orgs/${orgId}/members`) });
  const isAdmin = atLeast(role, 'ADMIN');
  const invites = useQuery<any[]>({ queryKey: ['invites', orgId], queryFn: () => get(`/orgs/${orgId}/invitations`), enabled: isAdmin });
  const [open, setOpen] = useState(false);
  const [inv, setInv] = useState({ email: '', role: 'ADMIN' });
  const invite = useAction(() => post<any>(`/orgs/${orgId}/invitations`, inv), {
    success: (r) => (r.emailSent ? `Invitation sent to ${r.email}` : `Invitation created, but the email could not be sent. Check SMTP settings.`),
    invalidate: [['invites', orgId]],
    onSuccess: () => { setOpen(false); setInv({ email: '', role: 'ADMIN' }); },
  });
  const changeRole = useAction((v: { userId: string; role: string }) => patch(`/orgs/${orgId}/members/${v.userId}`, { role: v.role }), { success: 'Role updated', invalidate: [['members', orgId]] });
  const [removing, setRemoving] = useState<any>(null);
  const remove = useAction(() => del(`/orgs/${orgId}/members/${removing.user.id}`), { success: 'Member removed', invalidate: [['members', orgId]], onSuccess: () => setRemoving(null) });
  const revoke = useAction((id: string) => del(`/orgs/${orgId}/invitations/${id}`), { success: 'Invitation revoked', invalidate: [['invites', orgId]] });
  const assignable = ROLES.filter((r) => role === 'OWNER' || (role && RANK[r] <= RANK[role] && r !== 'OWNER'));

  return (
    <div>
      <PageHeader title="People" description="Administrators of this organisation and the mailbox users who sign in to webmail." actions={isAdmin && <Button icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)}>Invite administrator</Button>} />
      <Panel padded={false}>
        {members.isLoading ? <LoadingRows /> : members.error ? <ErrorState error={members.error} /> : (
          <DataTable
            rows={members.data!}
            columns={[
              { key: 'user', header: 'Person', cell: (m) => <div className="flex items-center gap-3"><Avatar name={m.user.name} email={m.user.email} /><div className="min-w-0"><p className="truncate font-medium">{m.user.name}{m.user.id === me?.id && <span className="ml-1.5 text-xs text-ink-3">(you)</span>}</p><p className="truncate text-xs text-ink-3">{m.user.email}</p></div></div> },
              { key: 'role', header: 'Role', cell: (m) => <span>{ROLE_LABEL[m.role]}</span> },
              { key: 'type', header: 'Account', hideOnMobile: true, cell: (m) => <div className="flex gap-1.5">{m.user.authSource === 'MAILBOX' ? <Badge>Mailbox</Badge> : <Badge tone="info">Personal</Badge>}{m.user.totpEnabledAt && <Badge tone="ok">2FA</Badge>}{m.user.status !== 'ACTIVE' && <Badge tone="bad">Suspended</Badge>}</div> },
              { key: 'login', header: 'Last sign-in', hideOnMobile: true, cell: (m) => <span className="text-ink-3">{relative(m.user.lastLoginAt)}</span> },
              {
                key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12',
                cell: (m) => isAdmin && m.user.id !== me?.id && (
                  <Menu trigger={<button className="rounded-md p-1.5 hover:bg-surface-2" aria-label={`Actions for ${m.user.email}`}><MoreHorizontal className="size-4" /></button>}>
                    {assignable.filter((r) => r !== m.role && !(m.user.authSource === 'MAILBOX' && RANK[r] > RANK.MAILBOX_ADMIN)).map((r) => (
                      <MenuItem key={r} onSelect={() => changeRole.mutate({ userId: m.user.id, role: r })}>Make {ROLE_LABEL[r].toLowerCase()}</MenuItem>
                    ))}
                    {m.user.authSource !== 'MAILBOX' && (<><MenuSeparator /><MenuItem danger onSelect={() => setRemoving(m)}>Remove from organisation</MenuItem></>)}
                  </Menu>
                ),
              },
            ]}
          />
        )}
      </Panel>
      {isAdmin && (invites.data?.length ?? 0) > 0 && (
        <Panel title="Pending invitations" className="mt-5" padded={false}>
          <DataTable rows={invites.data!} columns={[
            { key: 'email', header: 'Email', cell: (i) => i.email },
            { key: 'role', header: 'Role', cell: (i) => ROLE_LABEL[i.role] },
            { key: 'exp', header: 'Expires', hideOnMobile: true, cell: (i) => relative(i.expiresAt) },
            { key: 'x', header: <span className="sr-only">Actions</span>, cell: (i) => <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Revoke</Button> },
          ]} />
        </Panel>
      )}
      <Dialog open={open} onOpenChange={setOpen} title="Invite an administrator" description="They receive an email link valid for 7 days. Mailbox users do not need invitations — they sign in with their mailbox password." footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={invite.isPending} disabled={!inv.email} onClick={() => invite.mutate()}>Send invitation</Button></>}>
        <div className="space-y-4">
          <Field label="Email address">{(id) => <Input id={id} type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} autoFocus />}</Field>
          <Field label="Role" hint={ROLE_HELP[inv.role]}>{(id, d) => <Select id={id} aria-describedby={d} value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>{assignable.filter((r) => r !== 'MEMBER').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>}</Field>
        </div>
      </Dialog>
      <ConfirmDialog open={!!removing} onOpenChange={(v) => !v && setRemoving(null)} title="Remove member?" description={`${removing?.user.email} loses access to this organisation.`} confirmLabel="Remove" loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </div>
  );
}
