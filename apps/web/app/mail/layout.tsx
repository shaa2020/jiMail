'use client';

import { BookUser, CalendarDays, Inbox, Settings } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { LogoMark } from '@/components/logo';
import { UserMenu } from '@/components/shell/app-shell';
import { Menu, MenuItem } from '@/components/ui/overlay';
import { cx } from '@/components/ui/primitives';
import { useMe } from '@/lib/hooks';

export default function MailLayout({ children }: { children: ReactNode }) {
  const { data: me, isLoading, error } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const { mb } = useParams<{ mb?: string }>();
  useEffect(() => {
    if (error) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (me?.mfaPending) router.replace(`/login?step=mfa&next=${encodeURIComponent(pathname)}`);
  }, [error, me, router, pathname]);
  if (isLoading || !me || me.mfaPending) return <div className="grid h-screen place-items-center" role="status" aria-label="Loading"><div className="skeleton size-10 rounded-xl" /></div>;
  const current = me.mailboxes.find((m) => m.id === mb);
  const section = pathname.split('/')[3] ?? '';
  const nav = mb
    ? [
        { href: `/mail/${mb}`, label: 'Mail', icon: <Inbox className="size-5" />, active: section === '' },
        { href: `/mail/${mb}/contacts`, label: 'Contacts', icon: <BookUser className="size-5" />, active: section === 'contacts' },
        { href: `/mail/${mb}/calendar`, label: 'Calendar', icon: <CalendarDays className="size-5" />, active: section === 'calendar' },
        { href: `/mail/${mb}/settings`, label: 'Settings', icon: <Settings className="size-5" />, active: section === 'settings' },
      ]
    : [];
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 sm:px-4">
        <Link href={me.organizations.some((o) => o.role !== 'MEMBER') || me.platformRole === 'SUPER_ADMIN' ? '/app' : '/mail'} className="flex items-center gap-2" aria-label="JiMail home">
          <LogoMark size={28} />
          <span className="hidden font-display text-lg font-bold sm:inline">JiMail</span>
        </Link>
        {me.mailboxes.length > 1 ? (
          <Menu align="start" trigger={<button className="ml-2 max-w-[50vw] truncate rounded-lg px-2.5 py-1.5 text-sm font-medium hover:bg-surface-2">{current?.address ?? 'Choose mailbox'} ▾</button>}>
            {me.mailboxes.map((m) => <MenuItem key={m.id} onSelect={() => router.push(`/mail/${m.id}`)}>{m.address}</MenuItem>)}
          </Menu>
        ) : (
          current && <span className="ml-2 hidden truncate text-sm text-ink-2 sm:inline">{current.address}</span>
        )}
        <div className="ml-auto"><UserMenu me={me} compact /></div>
      </header>
      <div className="flex min-h-0 flex-1">
        {mb && (
          <nav aria-label="Webmail sections" className="hidden w-[72px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3 md:flex">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} aria-current={n.active ? 'page' : undefined} className={cx('flex w-14 flex-col items-center gap-1 rounded-xl py-2 text-[11px]', n.active ? 'bg-petrol-soft text-petrol-ink font-medium' : 'text-ink-3 hover:bg-surface-2 hover:text-ink')}>
                {n.icon}
                {n.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="min-w-0 flex-1 pb-14 md:pb-0">{children}</div>
      </div>
      {mb && (
        <nav aria-label="Webmail sections" className="fixed inset-x-0 bottom-0 z-30 flex h-14 border-t border-line bg-surface md:hidden">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={n.active ? 'page' : undefined} className={cx('flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]', n.active ? 'text-petrol font-medium' : 'text-ink-3')}>
              {n.icon}
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
