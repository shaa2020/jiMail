'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Button, Field, Input, Notice } from '@/components/ui/primitives';
import { errorMessage, post } from '@/lib/api';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <h1 className="text-[28px] font-semibold">Reset your password</h1>
      <p className="mt-1.5 text-sm text-ink-3">Enter your account email and we will send you a reset link. Mailbox users get instructions to contact their administrator.</p>
      {sent ? (
        <div className="mt-6">
          <Notice tone="ok">If an account exists for {email}, an email with next steps is on its way.</Notice>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-7 space-y-4">
          {error && <Notice tone="bad">{error}</Notice>}
          <Field label="Email address">{(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}</Field>
          <Button type="submit" className="w-full" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <Link href="/login" className="mt-6 inline-block text-sm font-medium text-petrol hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}
