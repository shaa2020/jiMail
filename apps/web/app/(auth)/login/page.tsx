'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { Button, Field, Input, Notice } from '@/components/ui/primitives';
import { ApiError, get, post } from '@/lib/api';
import { homeFor, Me } from '@/lib/hooks';

function safeNext(n: string | null) {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : null;
}

function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState<'password' | 'mfa'>(params.get('step') === 'mfa' ? 'mfa' : 'password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  const finish = async () => {
    qc.clear();
    const me = await get<Me>('/me');
    router.replace(safeNext(params.get('next')) ?? homeFor(me));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      if (step === 'password') {
        const r = await post<{ mfaRequired: boolean }>('/auth/login', { email, password });
        if (r.mfaRequired) {
          setStep('mfa');
          setBusy(false);
          return;
        }
      } else {
        await post('/auth/mfa', { code });
      }
      await finish();
    } catch (err) {
      if (err instanceof ApiError && err.body?.emailNotVerified) setUnverified(true);
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-[28px] font-semibold">{step === 'mfa' ? 'Two-step verification' : 'Sign in'}</h1>
      <p className="mt-1.5 text-sm text-ink-3">
        {step === 'mfa' ? 'Enter the 6-digit code from your authenticator app, or one of your recovery codes.' : 'Administrators and mailbox users sign in here with their email address.'}
      </p>
      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        {error && (
          <Notice tone="bad">
            {error}
            {unverified && (
              <button
                type="button"
                className="ml-1 underline"
                onClick={async () => {
                  await post('/auth/resend-verification', { email }).catch(() => undefined);
                  setResent(true);
                }}
              >
                {resent ? 'Verification email sent.' : 'Send the link again'}
              </button>
            )}
          </Notice>
        )}
        {step === 'password' ? (
          <>
            <Field label="Email address">{(id) => <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}</Field>
            <Field label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
            <div className="flex justify-end">
              <Link href="/forgot-password" className="text-[13px] text-petrol hover:underline">
                Forgot your password?
              </Link>
            </div>
          </>
        ) : (
          <Field label="Verification code">
            {(id) => <Input id={id} inputMode="text" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} autoFocus className="font-mono tracking-widest" />}
          </Field>
        )}
        <Button type="submit" className="w-full" loading={busy}>
          {step === 'mfa' ? 'Verify and sign in' : 'Sign in'}
        </Button>
      </form>
      {step === 'password' && (
        <p className="mt-6 text-sm text-ink-3">
          New to JiMail?{' '}
          <Link href="/register" className="font-medium text-petrol hover:underline">
            Create an account
          </Link>
        </p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
