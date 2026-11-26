export function bytes(n: number | null | undefined, digits = 1): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function mb(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(n % 1024 ? 1 : 0)} GB` : `${n} MB`;
}

export function date(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(d));
}

export function dateTime(d: string | Date | null | undefined): string {
  return date(d, { dateStyle: 'medium', timeStyle: 'short' });
}

export function relative(d: string | Date | null | undefined): string {
  if (!d) return 'never';
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return date(d);
}

/** Inbox-style timestamp: time today, weekday this week, date otherwise. */
export function mailTime(d: string): string {
  const t = new Date(d);
  const now = new Date();
  if (t.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(t);
  if (now.getTime() - t.getTime() < 6 * 86400_000) return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(t);
  if (t.getFullYear() === now.getFullYear()) return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(t);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(t);
}

export function money(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

export function pct(used: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
}

export const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Administrator',
  MAILBOX_ADMIN: 'Mailbox administrator',
  MEMBER: 'Mailbox user',
  SUPER_ADMIN: 'Platform administrator',
};

export function initials(name?: string | null, email?: string): string {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}
