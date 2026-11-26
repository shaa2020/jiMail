'use client';

import { useQuery } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Button, Field, Input, Notice } from '@/components/ui/primitives';
import { errorMessage, get, post } from '@/lib/api';
import { passwordProblems } from '@/lib/validation';

export default function RegisterPage() {
  const { data: cfg } = useQuery<{ allowSignup: boolean }>({ queryKey: ['auth-config'], queryFn: () => get('/auth/config') });
  const [form, setForm] = useState({ name: '', email: '', organizationName: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const pwIssue = form.password ? passwordProblems(form.password) : null;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pwIssue) return;
    setBusy(true);
    setError(null);
    try {
      await post('/auth/register', form);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div>
        <div className="mb-5 grid size-12 place-items-center rounded-2xl bg-petrol-soft text-petrol">
          <MailCheck className="size-6" />
        </div>
        <h1 className="text-[28px] font-semibold">Check your inbox</h1>
        <p className="mt-2 text-sm text-ink-2">
          We sent a verification link to <strong>{form.email}</strong>. Open it to activate your account, then sign in.
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-petrol hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[28px] font-semibold">Create your account</h1>
      <p className="mt-1.5 text-sm text-ink-3">Start a free trial. You can connect your domain right after signing up.</p>
      {cfg && !cfg.allowSignup ? (
        <div className="mt-6">
          <Notice tone="info">Sign-up is by invitation on this installation. Ask your administrator for an invitation.</Notice>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-7 space-y-4">
          {error && <Notice tone="bad">{error}</Notice>}
          <Field label="Your name">{(id) => <Input id={id} required autoComplete="name" value={form.name} onChange={set('name')} />}</Field>
          <Field label="Work email">{(id) => <Input id={id} type="email" required autoComplete="email" value={form.email} onChange={set('email')} />}</Field>
          <Field label="Company or organisation" hint="Shown to your team; you can change it later.">
            {(id, d) => <Input id={id} aria-describedby={d} required value={form.organizationName} onChange={set('organizationName')} />}
          </Field>
          <Field label="Password" error={pwIssue} hint="At least 10 characters with upper and lower case letters and a digit.">
            {(id, d) => <Input id={id} aria-describedby={d} type="password" required autoComplete="new-password" value={form.password} onChange={set('password')} />}
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={!!pwIssue}>
            Create account
          </Button>
        </form>
      )}
      <p className="mt-6 text-sm text-ink-3">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-petrol hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
