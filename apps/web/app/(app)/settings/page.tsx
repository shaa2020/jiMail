'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/overlay';
import { Badge, Button, ErrorState, Field, Input, LoadingRows, Notice, PageHeader, Panel, Secret } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { del, get, patch, post } from '@/lib/api';
import { dateTime, relative } from '@/lib/format';
import { useAction, useMe } from '@/lib/hooks';
import { passwordProblems } from '@/lib/validation';

function TwoFactor() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [dis, setDis] = useState({ password: '', code: '' });
  useEffect(() => {
    if (setup) QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 200 }).then(setQr);
  }, [setup]);
  const begin = useAction(() => post('/auth/2fa/setup'), { onSuccess: setSetup });
  const confirm = useAction(() => post<{ recoveryCodes: string[] }>('/auth/2fa/confirm', { code }), {
    success: 'Two-factor authentication enabled',
    onSuccess: (r) => { setCodes(r.recoveryCodes); setSetup(null); setCode(''); qc.invalidateQueries({ queryKey: ['me'] }); },
  });
  const disable = useAction(() => post('/auth/2fa/disable', dis), { success: 'Two-factor authentication disabled', onSuccess: () => { setDisableOpen(false); qc.invalidateQueries({ queryKey: ['me'] }); } });
  const regen = useAction((c: string) => post<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', { code: c }), { onSuccess: (r) => setCodes(r.recoveryCodes) });
  const [regenCode, setRegenCode] = useState('');

  return (
    <Panel title="Two-factor authentication" description="Protect your account with a code from an authenticator app such as Aegis, 1Password, Google Authenticator or Microsoft Authenticator.">
      {codes && (
        <div className="mb-4 space-y-2">
          <Notice tone="warn" title="Save your recovery codes">Each code works once if you lose access to your authenticator. They will not be shown again.</Notice>
          <Secret label="Recovery codes" value={codes.join('  ')} />
        </div>
      )}
      {me?.twoFactorEnabled ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm"><ShieldCheck className="size-5 text-ok" /> Enabled</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Current code to regenerate recovery codes" className="flex-1">{(id) => <Input id={id} value={regenCode} onChange={(e) => setRegenCode(e.target.value)} inputMode="numeric" className="font-mono" />}</Field>
            <Button variant="secondary" disabled={regenCode.length !== 6} loading={regen.isPending} onClick={() => regen.mutate(regenCode)}>New recovery codes</Button>
          </div>
          <Button variant="ghost" className="text-bad" onClick={() => setDisableOpen(true)}>Turn off two-factor authentication</Button>
        </div>
      ) : setup ? (
        <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
          {qr ? <img src={qr} alt="QR code for your authenticator app" width={200} height={200} className="rounded-lg border border-line bg-white" /> : <div className="skeleton size-[200px]" />}
          <div className="space-y-3">
            <p className="text-sm text-ink-2">Scan the code with your authenticator app, or enter this key manually:</p>
            <code className="block break-all rounded-lg bg-surface-2 p-2 font-mono text-sm">{setup.secret}</code>
            <Field label="6-digit code from the app">{(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="font-mono tracking-widest" />}</Field>
            <Button loading={confirm.isPending} disabled={code.length !== 6} onClick={() => confirm.mutate()}>Enable</Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => begin.mutate()} loading={begin.isPending}>Set up two-factor authentication</Button>
      )}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen} title="Turn off two-factor authentication?" description="Confirm with your password and a current code." footer={<><Button variant="secondary" onClick={() => setDisableOpen(false)}>Cancel</Button><Button variant="danger" loading={disable.isPending} onClick={() => disable.mutate()}>Turn off</Button></>}>
        <div className="space-y-3">
          <Field label="Password">{(id) => <Input id={id} type="password" value={dis.password} onChange={(e) => setDis({ ...dis, password: e.target.value })} />}</Field>
          <Field label="Authenticator or recovery code">{(id) => <Input id={id} value={dis.code} onChange={(e) => setDis({ ...dis, code: e.target.value })} />}</Field>
        </div>
      </Dialog>
    </Panel>
  );
}

export default function AccountSettings() {
  const me = useMe();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  useEffect(() => { if (me.data) setName(me.data.name); }, [me.data]);
  const saveName = useAction(() => patch('/me', { name }), { success: 'Profile saved', invalidate: [['me']] });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', repeat: '' });
  const changePw = useAction(() => post('/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword }), {
    success: 'Password changed. Other sessions were signed out.',
    onSuccess: () => { setPw({ currentPassword: '', newPassword: '', repeat: '' }); qc.invalidateQueries({ queryKey: ['sessions'] }); },
  });
  const sessions = useQuery<any[]>({ queryKey: ['sessions'], queryFn: () => get('/auth/sessions') });
  const history = useQuery<any[]>({ queryKey: ['login-history'], queryFn: () => get('/auth/login-history?limit=20') });
  const revoke = useAction((id: string) => del(`/auth/sessions/${id}`), { success: 'Session signed out', invalidate: [['sessions']] });
  const revokeOthers = useAction(() => post('/auth/sessions/revoke-others'), { success: 'Other sessions signed out', invalidate: [['sessions']] });
  if (me.isLoading) return <LoadingRows />;
  if (me.error) return <ErrorState error={me.error} />;
  const pwIssue = pw.newPassword ? passwordProblems(pw.newPassword) : null;
  const mismatch = pw.repeat && pw.repeat !== pw.newPassword ? 'Passwords do not match' : null;

  return (
    <div className="max-w-4xl">
      <PageHeader title="Account & security" description={me.data!.email} />
      <div className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          <Panel title="Profile">
            <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <div className="mt-4 flex justify-end"><Button loading={saveName.isPending} disabled={!name || name === me.data!.name} onClick={() => saveName.mutate()}>Save</Button></div>
          </Panel>
          <Panel title="Password" description={me.data!.authSource === 'MAILBOX' ? 'This also changes the password used by your mail apps.' : undefined}>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); changePw.mutate(); }}>
              <Field label="Current password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
              <Field label="New password" error={pwIssue}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}</Field>
              <Field label="Repeat new password" error={mismatch}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} />}</Field>
              <div className="flex justify-end"><Button type="submit" loading={changePw.isPending} disabled={!pw.currentPassword || !pw.newPassword || !!pwIssue || !!mismatch || !pw.repeat}>Change password</Button></div>
            </form>
          </Panel>
        </div>
        <TwoFactor />
        <Panel title="Active sessions" padded={false} action={(sessions.data?.length ?? 0) > 1 && <Button size="sm" variant="secondary" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>Sign out other sessions</Button>}>
          {sessions.isLoading ? <LoadingRows rows={2} /> : (
            <DataTable rows={sessions.data ?? []} columns={[
              { key: 'dev', header: 'Device', cell: (s) => <div className="flex items-center gap-3"><Laptop className="size-4 text-ink-3" /><div className="min-w-0"><p className="max-w-md truncate text-sm">{s.userAgent ?? 'Unknown device'}</p><p className="font-mono text-xs text-ink-3">{s.ip}</p></div></div> },
              { key: 'seen', header: 'Last active', cell: (s) => s.current ? <Badge tone="ok">This device</Badge> : <span className="text-ink-3">{relative(s.lastSeenAt)}</span> },
              { key: 'x', header: <span className="sr-only">Actions</span>, cell: (s) => !s.current && <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>Sign out</Button> },
            ]} />
          )}
        </Panel>
        <Panel title="Recent sign-ins" padded={false}>
          {history.isLoading ? <LoadingRows rows={3} /> : (
            <DataTable rows={history.data ?? []} columns={[
              { key: 'when', header: 'When', cell: (h) => <span className="whitespace-nowrap">{dateTime(h.createdAt)}</span> },
              { key: 'res', header: 'Result', cell: (h) => h.success ? (h.suspicious ? <Badge tone="warn">New location</Badge> : <Badge tone="ok">Success</Badge>) : <Badge tone="bad">{h.reason === 'bad_2fa' ? 'Wrong code' : 'Failed'}</Badge> },
              { key: 'ip', header: 'IP address', cell: (h) => <span className="font-mono text-xs">{h.ip}</span> },
              { key: 'ua', header: 'Device', hideOnMobile: true, cell: (h) => <span className="line-clamp-1 text-xs text-ink-3">{h.userAgent}</span> },
            ]} />
          )}
        </Panel>
      </div>
    </div>
  );
}
