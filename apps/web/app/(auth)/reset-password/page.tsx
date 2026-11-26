'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { Button, Field, Input, Notice } from '@/components/ui/primitives';
import { errorMessage, post } from '@/lib/api';
import { passwordProblems } from '@/lib/validation';

function Reset() {
  const token = useSearchParams().get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const issue = pw ? passwordProblems(pw) : null;
  const mismatch = pw2 && pw !== pw2 ? 'Passwords do not match' : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (issue || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await post('/auth/reset-password', { token, password: pw });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <h1 className="text-[28px] font-semibold">Choose a new password</h1>
      {done ? (
        <div className="mt-6 space-y-4">
          <Notice tone="ok">Your password was changed and all other sessions were signed out.</Notice>
          <Link href="/login" className="text-sm font-medium text-petrol hover:underline">
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-7 space-y-4">
          {error && <Notice tone="bad">{error}</Notice>}
          <Field label="New password" error={issue}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
          <Field label="Repeat new password" error={mismatch}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />}</Field>
          <Button type="submit" className="w-full" loading={busy} disabled={!pw || !!issue || !!mismatch}>
            Change password
          </Button>
        </form>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
