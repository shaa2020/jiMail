'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { CopyButton, Notice, PageHeader, Panel } from '@/components/ui/primitives';
import { get } from '@/lib/api';
import { useMailbox } from '@/lib/mail';

/**
 * Calendars are provided by Stalwart over CalDAV (and JMAP for Calendars). JiMail does not yet include a
 * web calendar UI; this page gives the connection details for calendar apps instead of pretending.
 */
export default function CalendarPage() {
  const { mb } = useMailbox();
  const me = useQuery<any>({ queryKey: ['me'], queryFn: () => get('/me') });
  const address = me.data?.mailboxes.find((m: any) => m.id === mb)?.address ?? '';
  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Calendar" description="Your mailbox includes a calendar and address book on the mail server, synced with standard CalDAV and CardDAV." />
        <div className="mb-5"><Notice tone="info" title="Web calendar is not available yet">Use the connection details below in Apple Calendar, Thunderbird, DAVx⁵ (Android) or Outlook with a CalDAV add-in. Events you create there are stored on your JiMail mail server.</Notice></div>
        <CalDavDetails mb={mb} address={address} />
      </div>
    </div>
  );
}

function CalDavDetails({ mb, address }: { mb: string; address: string }) {
  const s = useQuery<any>({ queryKey: ['mail-settings', mb], queryFn: () => get(`/webmail/${mb}/connection`) });
  const base = s.data?.caldav ? s.data.caldav.replace(/\/dav\/cal\/$/, '') : null;
  const rows: [string, string][] = [
    ['Server (CalDAV)', s.data?.caldav ?? '—'],
    ['Server (CardDAV)', s.data?.carddav ?? '—'],
    ['Username', address],
    ['Password', 'Your mailbox password'],
  ];
  return (
    <Panel title={<span className="flex items-center gap-2"><CalendarDays className="size-4" /> Calendar app settings</span>}>
      <dl className="space-y-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k}><dt className="text-xs text-ink-3">{k}</dt><dd className="flex items-center justify-between gap-2 break-all font-mono text-[13px]">{v}{v !== '—' && k !== 'Password' && <CopyButton value={v} />}</dd></div>
        ))}
      </dl>
      {base && <p className="mt-4 text-xs text-ink-3">Most apps also discover the server automatically from {base} when you enter just your email address.</p>}
    </Panel>
  );
}
