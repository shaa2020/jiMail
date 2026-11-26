'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  ChevronsUpDown,
  CreditCard,
  Gauge,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu as MenuIcon,
  Moon,
  Inbox,
  ScrollText,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Tags,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/overlay';
import { Avatar, cx, Notice } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { atLeast, Me, roleIn, useMe } from '@/lib/hooks';
import { relative, ROLE_LABEL } from '@/lib/format';

type NavItem = { href: string; label: string; icon: ReactNode; exact?: boolean };

function adminNav(): NavItem[] {
  const i = 'size-4';
  return [
    { href: '/admin', label: 'Overview', icon: <LayoutDashboard className={i} />, exact: true },
    { href: '/admin/organizations', label: 'Organisations', icon: <Building2 className={i} /> },
    { href: '/admin/domains', label: 'Domains', icon: <Globe className={i} /> },
    { href: '/admin/mailboxes', label: 'Mailboxes', icon: <Inbox className={i} /> },
    { href: '/admin/users', label: 'Users', icon: <Users className={i} /> },
    { href: '/admin/delivery', label: 'Mail delivery', icon: <Send className={i} /> },
    { href: '/admin/deliverability', label: 'Deliverability', icon: <ShieldCheck className={i} /> },
    { href: '/admin/security', label: 'Security', icon: <ShieldAlert className={i} /> },
    { href: '/admin/monitoring', label: 'Monitoring', icon: <Gauge className={i} /> },
    { href: '/admin/plans', label: 'Plans', icon: <Tags className={i} /> },
    { href: '/admin/audit', label: 'Audit log', icon: <ScrollText className={i} /> },
  ];
}

function orgNav(orgId: string, role: Me['organizations'][number]['role'] | undefined): NavItem[] {
  const i = 'size-4';
  const base = `/org/${orgId}`;
  const items: (NavItem & { min: 'MAILBOX_ADMIN' | 'ADMIN' | 'OWNER' })[] = [
    { href: base, label: 'Dashboard', icon: <LayoutDashboard className={i} />, exact: true, min: 'MAILBOX_ADMIN' },
    { href: `${base}/domains`, label: 'Domains', icon: <Globe className={i} />, min: 'MAILBOX_ADMIN' },
    { href: `${base}/mailboxes`, label: 'Mailboxes', icon: <Inbox className={i} />, min: 'MAILBOX_ADMIN' },
    { href: `${base}/members`, label: 'People', icon: <Users className={i} />, min: 'MAILBOX_ADMIN' },
    { href: `${base}/delivery`, label: 'Mail activity', icon: <BarChart3 className={i} />, min: 'MAILBOX_ADMIN' },
    { href: `${base}/billing`, label: 'Plan & billing', icon: <CreditCard className={i} />, min: 'ADMIN' },
    { href: `${base}/api-keys`, label: 'API keys', icon: <KeyRound className={i} />, min: 'ADMIN' },
    { href: `${base}/activity`, label: 'Audit log', icon: <Activity className={i} />, min: 'ADMIN' },
    { href: `${base}/settings`, label: 'Settings', icon: <Settings className={i} />, min: 'ADMIN' },
  ];
  return items.filter((x) => atLeast(role, x.min));
}

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  useEffect(() => {
    const t = document.documentElement.dataset.theme as 'light' | 'dark' | undefined;
    setTheme(t ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('jm-theme', next);
    } catch {}
    setTheme(next);
  };
  return { theme, toggle };
}

export function UserMenu({ me, compact }: { me: Me; compact?: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { theme, toggle } = useTheme();
  const logout = async () => {
    await post('/auth/logout').catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };
  return (
    <Menu
      align={compact ? 'end' : 'start'}
      trigger={
        <button className={cx('flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left', compact ? 'hover:bg-surface-2' : 'hover:bg-side-active')} aria-label="Account menu">
          <Avatar name={me.name} email={me.email} size={30} />
          {!compact && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-white">{me.name}</span>
              <span className="block truncate text-xs text-side-muted">{me.email}</span>
            </span>
          )}
        </button>
      }
    >
      <MenuLabel>{me.email}</MenuLabel>
      {me.mailboxes.length > 0 && (
        <MenuItem icon={<Mail className="size-4" />} onSelect={() => router.push('/mail')}>
          Open webmail
        </MenuItem>
      )}
      <MenuItem icon={<Settings className="size-4" />} onSelect={() => router.push('/settings')}>
        Account &amp; security
      </MenuItem>
      <MenuItem icon={theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />} onSelect={toggle}>
        {theme === 'dark' ? 'Light theme' : 'Dark theme'}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<LogOut className="size-4" />} onSelect={logout}>
        Sign out
      </MenuItem>
    </Menu>
  );
}

function Notifications({ me }: { me: Me }) {
  const qc = useQueryClient();
  const { data } = useQuery<any[]>({ queryKey: ['notifications'], queryFn: () => get('/me/notifications'), refetchInterval: 60_000 });
  const unread = data?.filter((n) => !n.readAt).length ?? me.unreadNotifications;
  return (
    <Menu
      trigger={
        <button className="relative rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <Bell className="size-[18px]" />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-saffron ring-2 ring-paper" />}
        </button>
      }
    >
      <div className="w-80">
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button
              className="text-xs text-petrol hover:underline"
              onClick={async () => {
                await post('/me/notifications/read-all');
                qc.invalidateQueries({ queryKey: ['notifications'] });
              }}
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {!data?.length && <p className="px-2.5 py-6 text-center text-sm text-ink-3">You are all caught up.</p>}
          {data?.map((n) => (
            <div key={n.id} className={cx('rounded-lg px-2.5 py-2', !n.readAt && 'bg-petrol-soft/60')}>
              <p className="text-sm font-medium">{n.title}</p>
              <p className="text-xs text-ink-2">{n.body}</p>
              <p className="mt-0.5 text-[11px] text-ink-3">{relative(n.createdAt)}</p>
            </div>
          ))}
        </div>
      </div>
    </Menu>
  );
}

function OrgSwitcher({ me, orgId, isAdminArea }: { me: Me; orgId?: string; isAdminArea: boolean }) {
  const router = useRouter();
  const current = me.organizations.find((o) => o.id === orgId);
  const adminOrgs = me.organizations.filter((o) => o.role !== 'MEMBER');
  return (
    <Menu
      align="start"
      trigger={
        <button className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-left hover:bg-white/10">
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] text-side-muted">{isAdminArea ? 'Workspace' : 'Organisation'}</span>
            <span className="block truncate text-sm font-medium text-white">{isAdminArea ? 'Platform administration' : (current?.name ?? 'Select organisation')}</span>
          </span>
          <ChevronsUpDown className="size-4 text-side-muted" />
        </button>
      }
    >
      {me.platformRole === 'SUPER_ADMIN' && (
        <MenuItem icon={<ShieldCheck className="size-4" />} onSelect={() => router.push('/admin')}>
          Platform administration
        </MenuItem>
      )}
      {adminOrgs.length > 0 && <MenuLabel>Your organisations</MenuLabel>}
      {adminOrgs.map((o) => (
        <MenuItem key={o.id} icon={<Building2 className="size-4" />} onSelect={() => router.push(`/org/${o.id}`)}>
          <span className="flex-1 truncate">{o.name}</span>
          <span className="text-xs text-ink-3">{ROLE_LABEL[o.role]}</span>
        </MenuItem>
      ))}
    </Menu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me, isLoading, error } = useMe();
  const pathname = usePathname();
  const params = useParams<{ orgId?: string }>();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    if (error) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (me?.mfaPending) router.replace(`/login?step=mfa&next=${encodeURIComponent(pathname)}`);
  }, [error, me, router, pathname]);

  if (isLoading || !me || me.mfaPending) {
    return (
      <div className="grid min-h-screen place-items-center" role="status" aria-label="Loading">
        <div className="skeleton size-10 rounded-xl" />
      </div>
    );
  }

  const isAdminArea = pathname.startsWith('/admin');
  const orgId = params.orgId;
  const role = orgId ? roleIn(me, orgId) : undefined;
  const nav = isAdminArea ? adminNav() : orgId ? orgNav(orgId, role) : [];
  const isActive = (n: NavItem) => (n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(`${n.href}/`));

  const sidebar = (
    <div className="flex h-full flex-col bg-side px-3 py-4 text-side-ink">
      <div className="flex items-center justify-between px-1.5 pb-4">
        <Link href="/app" aria-label="JiMail home">
          <Logo inverted />
        </Link>
        <button className="rounded-md p-1 text-side-muted lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
          <X className="size-5" />
        </button>
      </div>
      {(me.platformRole === 'SUPER_ADMIN' || me.organizations.some((o) => o.role !== 'MEMBER')) && <OrgSwitcher me={me} orgId={orgId} isAdminArea={isAdminArea} />}
      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto" aria-label="Main">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={isActive(n) ? 'page' : undefined}
            className={cx(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors',
              isActive(n) ? 'bg-side-active font-medium text-white shadow-[inset_2px_0_0_var(--saffron)]' : 'text-side-ink/85 hover:bg-white/5 hover:text-white',
            )}
          >
            {n.icon}
            {n.label}
          </Link>
        ))}
        {me.mailboxes.length > 0 && (
          <Link href="/mail" className="mt-3 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] text-side-ink/85 hover:bg-white/5 hover:text-white">
            <Mail className="size-4" />
            Webmail
          </Link>
        )}
      </nav>
      <div className="border-t border-white/10 pt-3">
        <UserMenu me={me} />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-screen lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">{sidebar}</div>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-paper/90 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <MenuIcon className="size-5" />
          </button>
          <div className="lg:hidden">
            <Logo size={24} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Notifications me={me} />
            <div className="lg:hidden">
              <UserMenu me={me} compact />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {me.mustEnroll2fa && pathname !== '/settings' && (
            <div className="mb-5">
              <Notice tone="warn" title="Two-factor authentication required">
                {me.platformRole === 'SUPER_ADMIN' ? 'Platform administrators must protect their account with two-factor authentication.' : 'An organisation you belong to requires two-factor authentication.'}{' '}
                <Link href="/settings" className="font-medium underline">
                  Set it up now
                </Link>
              </Notice>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
