'use client';

import clsx from 'clsx';
import { AlertTriangle, Check, CircleAlert, Copy, Loader2 } from 'lucide-react';
import { ButtonHTMLAttributes, forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useId, useState } from 'react';

export const cx = clsx;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
const variants: Record<Variant, string> = {
  primary: 'bg-petrol text-white hover:bg-petrol-ink dark:text-[#06201f] shadow-sm',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'bg-bad text-white hover:opacity-90',
  quiet: 'text-petrol hover:underline px-0 h-auto',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(
          'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55 whitespace-nowrap',
          size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
          variants[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
        {children}
      </button>
    );
  },
);

const fieldBase =
  'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-petrol focus:outline-none focus:ring-2 focus:ring-saffron/40 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(fieldBase, 'h-10', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(fieldBase, 'py-2 min-h-24', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(fieldBase, 'h-10 pr-8', className)} {...rest}>
      {children}
    </select>
  );
});

/** Label + control + hint/error, wired with ids for screen readers. */
export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string, describedBy?: string) => ReactNode; className?: string }) {
  const id = useId();
  const hintId = hint || error ? `${id}-hint` : undefined;
  return (
    <div className={cx('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children(id, hintId)}
      {(error || hint) && (
        <p id={hintId} className={cx('text-xs', error ? 'text-bad' : 'text-ink-3')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[var(--petrol)]" />
      <label htmlFor={id} className="text-sm">
        {label}
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </label>
    </div>
  );
}

export function Panel({ title, action, children, className, padded = true, description }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            {title && <h2 className="text-[15px] font-semibold font-sans tracking-normal">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent';
const tones: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-petrol-soft text-petrol-ink',
  neutral: 'bg-surface-2 text-ink-2',
  accent: 'bg-saffron-soft text-warn',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

const STATUS: Record<string, { tone: Tone; label: string }> = {
  ACTIVE: { tone: 'ok', label: 'Active' },
  SUSPENDED: { tone: 'bad', label: 'Suspended' },
  PENDING_VERIFICATION: { tone: 'warn', label: 'Awaiting verification' },
  VERIFIED: { tone: 'info', label: 'DNS incomplete' },
  PENDING_DELETION: { tone: 'bad', label: 'Pending deletion' },
  TRIALING: { tone: 'accent', label: 'Trial' },
  PAST_DUE: { tone: 'warn', label: 'Past due' },
  CANCELED: { tone: 'neutral', label: 'Cancelled' },
  PASS: { tone: 'ok', label: 'Pass' },
  FAIL: { tone: 'bad', label: 'Missing' },
  WARN: { tone: 'warn', label: 'Check' },
  PENDING: { tone: 'neutral', label: 'Pending' },
  MANUAL: { tone: 'neutral', label: 'Verify manually' },
  PAID: { tone: 'ok', label: 'Paid' },
  OPEN: { tone: 'warn', label: 'Open' },
  VOID: { tone: 'neutral', label: 'Void' },
  DRAFT: { tone: 'neutral', label: 'Draft' },
  UNCOLLECTIBLE: { tone: 'bad', label: 'Uncollectible' },
  INFO: { tone: 'info', label: 'Info' },
  WARNING: { tone: 'warn', label: 'Warning' },
  CRITICAL: { tone: 'bad', label: 'Critical' },
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? { tone: 'neutral' as Tone, label: status };
  return (
    <Badge tone={s.tone}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label ?? s.label}
    </Badge>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton h-4', className)} aria-hidden />;
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={i % 2 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-petrol-soft text-petrol">{icon}</div>}
      <h3 className="font-sans text-base font-semibold tracking-normal">{title}</h3>
      {children && <p className="mt-1.5 max-w-md text-sm text-ink-3">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="m-5 flex items-start gap-3 rounded-lg border border-bad/30 bg-bad-soft p-4 text-sm text-bad">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1">
        <p className="font-medium">Could not load this data</p>
        <p className="mt-0.5 opacity-90">{error instanceof Error ? error.message : 'Unknown error'}</p>
      </div>
      {retry && (
        <Button size="sm" variant="secondary" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; title?: string; children: ReactNode }) {
  const map = { info: 'border-petrol/25 bg-petrol-soft text-petrol-ink', warn: 'border-warn/30 bg-warn-soft text-warn', bad: 'border-bad/30 bg-bad-soft text-bad', ok: 'border-ok/30 bg-ok-soft text-ok' };
  return (
    <div className={cx('flex gap-3 rounded-lg border p-3.5 text-sm', map[tone])} role={tone === 'bad' ? 'alert' : undefined}>
      {tone === 'ok' ? <Check className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? 'mt-0.5' : ''}>{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-semibold sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Meter({ value, max, label, tone }: { value: number; max: number; label?: string; tone?: 'auto' | 'petrol' }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = tone === 'petrol' ? 'bg-petrol' : p > 90 ? 'bg-bad' : p > 75 ? 'bg-saffron' : 'bg-petrol';
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={cx('h-full rounded-full transition-[width]', color)} style={{ width: `${Math.max(p, p > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

export function Avatar({ name, email, size = 32 }: { name?: string | null; email?: string; size?: number }) {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  const ini = ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
  let h = 0;
  for (const c of email ?? src) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${h} 38% 38%)` }}
    >
      {ini}
    </span>
  );
}

export function CopyButton({ value, label = 'Copy', iconOnly }: { value: string; label?: string; iconOnly?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs text-ink-3 hover:bg-surface-2 hover:text-ink"
      aria-label={`${label} to clipboard`}
    >
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      <span className={iconOnly ? 'sr-only' : 'sr-only sm:not-sr-only'}>{done ? 'Copied' : label}</span>
    </button>
  );
}

export function Stat({ label, value, sub, href }: { label: string; value: ReactNode; sub?: ReactNode; href?: string }) {
  const body = (
    <>
      <p className="text-[13px] text-ink-3">{label}</p>
      <p className="mt-1 font-display text-[26px] font-semibold leading-none tracking-tight">{value}</p>
      {sub && <div className="mt-2 text-xs text-ink-3">{sub}</div>}
    </>
  );
  return href ? (
    <a href={href} className="block rounded-xl border border-line bg-surface p-4 hover:border-line-strong">
      {body}
    </a>
  ) : (
    <div className="rounded-xl border border-line bg-surface p-4">{body}</div>
  );
}

export function Secret({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-saffron/40 bg-saffron-soft p-3">
      <p className="text-xs font-medium text-warn">{label}</p>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <code className="break-all font-mono text-sm text-ink">{value}</code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}
