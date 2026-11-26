'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { Button, Field, Input, Notice } from '@/components/ui/primitives';
import { errorMessage, get, post } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/format';
import { useMe } from '@/lib/hooks';
import { passwordProblems } from '@/lib/validation';

function Invite() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const inv = useQuery<{ email: string; role: string; organizationName: string; userExists: boolean }>({ queryKey: ['invite', token], queryFn: () => get(`/invitations/${encodeURIComponent(token)}`), retry: false });
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState(false);

  if (inv.isLoading) return <p className="text-sm text-ink-3">Loading invitation…</p>;
  if (inv.error) return <Notice tone="bad" title="Invitation unavailable">{errorMessage(inv.error)}</Notice>;
  const i = inv.data!;

  const accept = async () => {
    setBusy(true);
    try {
      const r = await post<{ organizationId: string }>(`/invitations/${encodeURIComponent(token)}/accept`);
      qc.invalidateQueries({ queryKey: ['me'] });
      router.replace(`/org/${r.organizationId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  const register = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/invitations/${encodeURIComponent(token)}/register`, { name, password: pw });
      setRegistered(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-[28px] font-semibold">Join {i.organizationName}</h1>
      <p className="mt-1.5 text-sm text-ink-3">
        You were invited as <strong>{ROLE_LABEL[i.role]}</strong> using {i.email}.
      </p>
      <div className="mt-6 space-y-4">
        {error && <Notice tone="bad">{error}</Notice>}
        {registered ? (
          <Notice tone="ok" title="Account created">
            <Link className="underline" href="/login">
              Sign in
            </Link>{' '}
            to start working in {i.organizationName}.
          </Notice>
        ) : me.data ? (
          <Button onClick={accept} loading={busy} className="w-full">
            Accept invitation as {me.data.email}
          </Button>
        ) : i.userExists ? (
          <Link href={`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`}>
            <Button className="w-full">Sign in to accept</Button>
          </Link>
        ) : (
          <form onSubmit={register} className="space-y-4">
            <Field label="Your name">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Choose a password" error={pw ? passwordProblems(pw) : null}>{(id) => <Input id={id} type="password" required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
            <Button type="submit" className="w-full" loading={busy} disabled={!name || !!passwordProblems(pw)}>
              Create account and join
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Invite />
    </Suspense>
  );
}
