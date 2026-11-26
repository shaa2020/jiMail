'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Checkbox, CopyButton, ErrorState, Field, Input, LoadingRows, Meter, PageHeader, Panel, Textarea } from '@/components/ui/primitives';
import { get, patch, put } from '@/lib/api';
import { bytes, mb as fmtMb } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useMailbox } from '@/lib/mail';

const toLocalInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');

export default function MailSettings() {
  const { mb } = useMailbox();
  const ids = useQuery<any[]>({ queryKey: ['identities', mb], queryFn: () => get(`/webmail/${mb}/identities`) });
  const vac = useQuery<any>({ queryKey: ['vacation', mb], queryFn: () => get(`/webmail/${mb}/vacation`) });
  const quota = useQuery<any>({ queryKey: ['quota', mb], queryFn: () => get(`/webmail/${mb}/quota`) });
  const conn = useQuery<any>({ queryKey: ['mail-settings', mb], queryFn: () => get(`/webmail/${mb}/connection`) });

  const [identityId, setIdentityId] = useState('');
  const identity = ids.data?.find((i) => i.id === identityId) ?? ids.data?.[0];
  const [sig, setSig] = useState({ name: '', textSignature: '' });
  useEffect(() => { if (identity) { setIdentityId(identity.id); setSig({ name: identity.name ?? '', textSignature: identity.textSignature ?? '' }); } }, [identity?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveSig = useAction(() => {
    const html = sig.textSignature.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/\n/g, '<br>');
    return patch(`/webmail/${mb}/identities/${identity.id}`, { name: sig.name, textSignature: sig.textSignature, htmlSignature: html });
  }, { success: 'Signature saved', invalidate: [['identities', mb]] });

  const [v, setV] = useState<any>(null);
  useEffect(() => { if (vac.data) setV({ isEnabled: !!vac.data.isEnabled, subject: vac.data.subject ?? '', textBody: vac.data.textBody ?? '', fromDate: toLocalInput(vac.data.fromDate), toDate: toLocalInput(vac.data.toDate) }); }, [vac.data]);
  const saveVac = useAction(() => put(`/webmail/${mb}/vacation`, { isEnabled: v.isEnabled, subject: v.subject || null, textBody: v.textBody || null, fromDate: v.fromDate ? new Date(v.fromDate).toISOString() : null, toDate: v.toDate ? new Date(v.toDate).toISOString() : null }), { success: 'Automatic reply saved', invalidate: [['vacation', mb]] });

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHeader title="Mail settings" description={<>Password and two-factor settings are in <Link href="/settings" className="text-petrol underline">Account &amp; security</Link>.</>} />
        <Panel title="Signature" description="Added automatically when you write a new message or reply.">
          {ids.isLoading ? <LoadingRows rows={2} /> : ids.error ? <ErrorState error={ids.error} /> : (
            <div className="space-y-3">
              {(ids.data?.length ?? 0) > 1 && (
                <Field label="Sending address">{(id) => <select id={id} className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" value={identityId} onChange={(e) => setIdentityId(e.target.value)}>{ids.data!.map((i) => <option key={i.id} value={i.id}>{i.email}</option>)}</select>}</Field>
              )}
              <Field label="Sender name">{(id) => <Input id={id} value={sig.name} onChange={(e) => setSig({ ...sig, name: e.target.value })} />}</Field>
              <Field label="Signature">{(id) => <Textarea id={id} rows={4} value={sig.textSignature} onChange={(e) => setSig({ ...sig, textSignature: e.target.value })} placeholder={'Jane Doe\nHead of Sales · Company Ltd\n+44 20 0000 0000'} />}</Field>
              <div className="flex justify-end"><Button loading={saveSig.isPending} onClick={() => saveSig.mutate()}>Save signature</Button></div>
            </div>
          )}
        </Panel>
        <Panel title="Automatic reply" description="Sends a vacation or out-of-office reply to people who write to you, once per sender within a few days.">
          {!v ? <LoadingRows rows={3} /> : (
            <div className="space-y-3">
              <Checkbox label="Send automatic replies" checked={v.isEnabled} onChange={(x) => setV({ ...v, isEnabled: x })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Start (optional)">{(id) => <Input id={id} type="datetime-local" value={v.fromDate} onChange={(e) => setV({ ...v, fromDate: e.target.value })} />}</Field>
                <Field label="End (optional)">{(id) => <Input id={id} type="datetime-local" value={v.toDate} onChange={(e) => setV({ ...v, toDate: e.target.value })} />}</Field>
              </div>
              <Field label="Subject">{(id) => <Input id={id} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} placeholder="Out of office" />}</Field>
              <Field label="Message">{(id) => <Textarea id={id} rows={4} value={v.textBody} onChange={(e) => setV({ ...v, textBody: e.target.value })} placeholder="I am away until Monday and will reply when I am back." />}</Field>
              <div className="flex justify-end"><Button loading={saveVac.isPending} onClick={() => saveVac.mutate()}>Save automatic reply</Button></div>
            </div>
          )}
        </Panel>
        <Panel title="Storage">
          {quota.data && (
            <>
              <p className="mb-2 text-sm">{bytes(quota.data.usedBytes)} of {fmtMb(quota.data.quotaMb)} used</p>
              <Meter value={quota.data.usedBytes} max={quota.data.quotaMb * 1048576} label="Mailbox storage" />
            </>
          )}
        </Panel>
        <Panel title="Use this mailbox in other apps" description="Outlook, Apple Mail, Thunderbird, Samsung Email and the Gmail app (add account → Other) support IMAP and SMTP.">
          {conn.data && (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {[['Username', conn.data.username], ['Incoming server (IMAP)', `${conn.data.imap.host}:${conn.data.imap.port}`], ['Outgoing server (SMTP)', `${conn.data.smtp.host}:${conn.data.smtp.port}`], ['Encryption', 'SSL/TLS for both'], ['Authentication', 'Normal password, same as webmail']].map(([k, val]) => (
                <div key={k}><dt className="text-xs text-ink-3">{k}</dt><dd className="flex items-center justify-between gap-2 break-all font-mono text-[13px]">{val}<CopyButton value={val} /></dd></div>
              ))}
            </dl>
          )}
        </Panel>
      </div>
    </div>
  );
}
