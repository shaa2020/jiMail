'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Pause, Play, Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ConfirmDialog, Dialog } from '@/components/ui/overlay';
import { Button, Checkbox, CopyButton, ErrorState, Field, Input, LoadingRows, Meter, Notice, PageHeader, Panel, Secret, Select, StatusPill, Textarea } from '@/components/ui/primitives';
import { del, get, patch, post, put } from '@/lib/api';
import { bytes, dateTime, mb, relative } from '@/lib/format';
import { atLeast, useAction } from '@/lib/hooks';
import { useOrg } from '@/lib/org';
import { passwordProblems } from '@/lib/validation';

export default function MailboxDetail() {
  const { orgId, role, base } = useOrg();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const key = ['mailbox', orgId, id];
  const q = useQuery<any>({ queryKey: key, queryFn: () => get(`/orgs/${orgId}/mailboxes/${id}`) });
  const conn = useQuery<any>({ queryKey: ['conn', id], queryFn: () => get(`/orgs/${orgId}/mailboxes/${id}/connection`) });
  const domains = useQuery<any[]>({ queryKey: ['domains', orgId], queryFn: () => get(`/orgs/${orgId}/domains`) });
  const isAdmin = atLeast(role, 'ADMIN');
  const access = useQuery<any[]>({ queryKey: ['access', id], queryFn: () => get(`/orgs/${orgId}/mailboxes/${id}/access`), enabled: isAdmin });
  const members = useQuery<any[]>({ queryKey: ['members', orgId], queryFn: () => get(`/orgs/${orgId}/members`), enabled: isAdmin });
  const inv = [key, ['mailboxes', orgId], ['dash', orgId]];

  const [edit, setEdit] = useState({ displayName: '', quotaMb: '' });
  useEffect(() => {
    if (q.data) setEdit({ displayName: q.data.displayName, quotaMb: String(q.data.quotaMb) });
  }, [q.data]);
  const save = useAction(() => patch(`/orgs/${orgId}/mailboxes/${id}`, { displayName: edit.displayName, quotaMb: Number(edit.quotaMb) }), { success: 'Mailbox updated', invalidate: inv });

  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [newPw, setNewPw] = useState<string | null>(null);
  const reset = useAction(() => post<any>(`/orgs/${orgId}/mailboxes/${id}/reset-password`, pw ? { password: pw } : {}), {
    success: 'Password changed and existing webmail sessions signed out',
    onSuccess: (r) => {
      setNewPw(r.temporaryPassword ?? null);
      if (!r.temporaryPassword) setPwOpen(false);
      setPw('');
    },
  });

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState('');
  const suspend = useAction(() => post(`/orgs/${orgId}/mailboxes/${id}/suspend`, { reason: reason || undefined }), { success: 'Mailbox suspended', invalidate: inv, onSuccess: () => setSuspendOpen(false) });
  const reactivate = useAction(() => post(`/orgs/${orgId}/mailboxes/${id}/reactivate`), { success: 'Mailbox reactivated', invalidate: inv });

  const [alias, setAlias] = useState({ localPart: '', domainId: '' });
  const addAlias = useAction(() => post(`/orgs/${orgId}/mailboxes/${id}/aliases`, alias), { success: 'Alias added', invalidate: inv, onSuccess: () => setAlias({ ...alias, localPart: '' }) });
  const removeAlias = useAction((aliasId: string) => del(`/orgs/${orgId}/mailboxes/${id}/aliases/${aliasId}`), { success: 'Alias removed', invalidate: inv });

  const [fwd, setFwd] = useState<{ text: string; keepCopy: boolean } | null>(null);
  const saveFwd = useAction(
    () => put(`/orgs/${orgId}/mailboxes/${id}/forwarding`, { addresses: fwd!.text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean), keepCopy: fwd!.keepCopy }),
    { success: 'Forwarding saved', invalidate: inv, onSuccess: () => setFwd(null) },
  );

  const [grantUser, setGrantUser] = useState('');
  const grant = useAction(() => post(`/orgs/${orgId}/mailboxes/${id}/access`, { userId: grantUser }), { success: 'Access granted', invalidate: [['access', id]], onSuccess: () => setGrantUser('') });
  const revoke = useAction((userId: string) => del(`/orgs/${orgId}/mailboxes/${id}/access/${userId}`), { success: 'Access removed', invalidate: [['access', id]] });

  const [delOpen, setDelOpen] = useState(false);
  const remove = useAction(() => del(`/orgs/${orgId}/mailboxes/${id}`, { confirmAddress: q.data.address }), { success: 'Mailbox deleted', invalidate: inv, onSuccess: () => router.push(`${base}/mailboxes`) });

  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const m = q.data;
  const usable = (domains.data ?? []).filter((d) => d.verifiedAt);
  const aliasDomain = alias.domainId || m.domainId;
  const fwdState = fwd ?? { text: m.forwardTo.join('\n'), keepCopy: m.forwardKeepCopy };
  const pwIssue = pw ? passwordProblems(pw) : null;

  return (
    <div>
      <PageHeader
        back={<Link href={`${base}/mailboxes`} className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5" /> Mailboxes</Link>}
        title={<span className="flex flex-wrap items-center gap-3 break-all">{m.address} <StatusPill status={m.status} /></span>}
        description={`${m.displayName} · created ${relative(m.createdAt)}`}
        actions={
          <>
            <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => { setNewPw(null); setPwOpen(true); }}>Reset password</Button>
            {m.status === 'ACTIVE' ? (
              <Button variant="secondary" icon={<Pause className="size-4" />} onClick={() => setSuspendOpen(true)}>Suspend</Button>
            ) : (
              <Button variant="secondary" icon={<Play className="size-4" />} loading={reactivate.isPending} onClick={() => reactivate.mutate()}>Reactivate</Button>
            )}
          </>
        }
      />
      {m.status === 'SUSPENDED' && <div className="mb-5"><Notice tone="bad" title="Suspended">{m.suspendedReason ?? 'This mailbox cannot sign in, send or receive mail.'}</Notice></div>}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Panel title="Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name">{(fid) => <Input id={fid} value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} />}</Field>
              <Field label="Quota (MB)">{(fid) => <Input id={fid} type="number" min={50} value={edit.quotaMb} onChange={(e) => setEdit({ ...edit, quotaMb: e.target.value })} />}</Field>
            </div>
            <div className="mt-4">
              <p className="mb-1.5 text-[13px] text-ink-2">{bytes(m.usedBytes)} used of {mb(m.quotaMb)} {m.usageSyncedAt && <span className="text-ink-3">· synced {relative(m.usageSyncedAt)}</span>}</p>
              <Meter value={m.usedBytes} max={m.quotaMb * 1048576} label="Storage used" />
            </div>
            <div className="mt-4 flex justify-end">
              <Button loading={save.isPending} disabled={edit.displayName === m.displayName && Number(edit.quotaMb) === m.quotaMb} onClick={() => save.mutate()}>Save changes</Button>
            </div>
          </Panel>

          <Panel title="Aliases" description="Extra addresses that deliver into this mailbox and can be used as the sender.">
            {m.aliases.length > 0 && (
              <ul className="mb-4 divide-y divide-line rounded-lg border border-line">
                {m.aliases.map((a: any) => (
                  <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="break-all">{a.address}</span>
                    <Button size="sm" variant="ghost" aria-label={`Remove alias ${a.address}`} icon={<X className="size-4" />} loading={removeAlias.isPending && removeAlias.variables === a.id} onClick={() => removeAlias.mutate(a.id)} />
                  </li>
                ))}
              </ul>
            )}
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); addAlias.mutate(); }}>
              <Input aria-label="Alias local part" placeholder="sales" value={alias.localPart} onChange={(e) => setAlias({ ...alias, localPart: e.target.value.toLowerCase() })} className="sm:flex-1" />
              <Select aria-label="Alias domain" value={aliasDomain} onChange={(e) => setAlias({ ...alias, domainId: e.target.value })} className="sm:w-56">
                {usable.map((d) => <option key={d.id} value={d.id}>@{d.name}</option>)}
              </Select>
              <Button type="submit" variant="secondary" icon={<Plus className="size-4" />} loading={addAlias.isPending} disabled={!alias.localPart} onClick={() => setAlias((x) => ({ ...x, domainId: aliasDomain }))}>Add alias</Button>
            </form>
          </Panel>

          <Panel title="Forwarding" description="Redirect incoming mail to other addresses. Use with care: forwarding to external providers can affect deliverability.">
            <Field label="Forward to (one address per line)">{(fid) => <Textarea id={fid} rows={3} value={fwdState.text} onChange={(e) => setFwd({ ...fwdState, text: e.target.value })} placeholder="colleague@company.com" />}</Field>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <Checkbox label="Keep a copy in this mailbox" checked={fwdState.keepCopy} onChange={(v) => setFwd({ ...fwdState, keepCopy: v })} />
              <Button variant="secondary" loading={saveFwd.isPending} disabled={!fwd} onClick={() => saveFwd.mutate()}>Save forwarding</Button>
            </div>
          </Panel>

          {isAdmin && (
            <Panel title="Webmail access" description="People who can open this mailbox in JiMail webmail. The mailbox owner signs in with the mailbox password.">
              <ul className="mb-4 divide-y divide-line rounded-lg border border-line">
                {(access.data ?? []).map((a) => (
                  <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{a.user.name} <span className="text-ink-3">{a.user.email}</span></span>
                    {a.user.email !== m.address && <Button size="sm" variant="ghost" aria-label={`Remove access for ${a.user.email}`} icon={<X className="size-4" />} onClick={() => revoke.mutate(a.user.id)} />}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Select aria-label="Member to grant access" value={grantUser} onChange={(e) => setGrantUser(e.target.value)}>
                  <option value="">Choose a team member…</option>
                  {(members.data ?? []).filter((x) => !(access.data ?? []).some((a) => a.user.id === x.user.id)).map((x) => <option key={x.user.id} value={x.user.id}>{x.user.name} ({x.user.email})</option>)}
                </Select>
                <Button variant="secondary" disabled={!grantUser} loading={grant.isPending} onClick={() => grant.mutate()}>Grant</Button>
              </div>
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          <Panel title="Mail app settings" description="For Outlook, Apple Mail, Thunderbird, Samsung Email and the Gmail app (“Other” account type).">
            {conn.data ? (
              <dl className="space-y-3 text-sm">
                {[
                  ['Username', conn.data.username],
                  ['Incoming (IMAP)', `${conn.data.imap.host} · port ${conn.data.imap.port} · ${conn.data.imap.security}`],
                  ['Outgoing (SMTP)', `${conn.data.smtp.host} · port ${conn.data.smtp.port} · ${conn.data.smtp.security}`],
                  ['POP3', `${conn.data.pop3.host} · port ${conn.data.pop3.port} · ${conn.data.pop3.security}`],
                  ['Calendar (CalDAV)', conn.data.caldav],
                  ['Contacts (CardDAV)', conn.data.carddav],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-ink-3">{k}</dt>
                    <dd className="flex items-start justify-between gap-2 break-all font-mono text-[12.5px]">{v}<CopyButton value={v} /></dd>
                  </div>
                ))}
                <p className="border-t border-line pt-3 text-xs text-ink-3">{conn.data.authentication}. Outgoing mail always requires sign-in. Some apps do not support calendar or contact sync.</p>
              </dl>
            ) : (
              <LoadingRows rows={3} />
            )}
          </Panel>
          {isAdmin && (
            <Panel title="Delete mailbox">
              <p className="mb-3 text-sm text-ink-3">Permanently deletes the mailbox and all its mail on the mail server. This cannot be undone.</p>
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDelOpen(true)}>Delete mailbox</Button>
            </Panel>
          )}
          <p className="text-xs text-ink-3">Last updated {dateTime(m.updatedAt)}</p>
        </div>
      </div>

      <Dialog
        open={pwOpen}
        onOpenChange={(v) => { setPwOpen(v); if (!v) setNewPw(null); }}
        title="Reset password"
        description={`Set a new password for ${m.address}. Open webmail sessions are signed out; mail apps must be updated.`}
        footer={newPw ? <Button onClick={() => setPwOpen(false)}>Done</Button> : (
          <>
            <Button variant="secondary" onClick={() => setPwOpen(false)}>Cancel</Button>
            <Button loading={reset.isPending} disabled={!!pwIssue} onClick={() => reset.mutate()}>{pw ? 'Set password' : 'Generate password'}</Button>
          </>
        )}
      >
        {newPw ? <Secret label="New temporary password — shown once" value={newPw} /> : (
          <Field label="New password (leave empty to generate one)" error={pwIssue}>{(fid) => <Input id={fid} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
        )}
      </Dialog>
      <ConfirmDialog open={suspendOpen} onOpenChange={setSuspendOpen} title={`Suspend ${m.address}?`} description="The mailbox will not be able to sign in, send or receive mail. Its messages are kept." confirmLabel="Suspend mailbox" loading={suspend.isPending} onConfirm={() => suspend.mutate()}>
        <Field label="Reason (visible to administrators)">{(fid) => <Input id={fid} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <div className="h-3" />
      </ConfirmDialog>
      <ConfirmDialog open={delOpen} onOpenChange={setDelOpen} title="Delete mailbox permanently?" description="All mail, folders and settings of this mailbox are removed from the mail server." confirmLabel="Delete mailbox" typeToConfirm={m.address} loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </div>
  );
}
