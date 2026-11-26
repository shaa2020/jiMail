'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/ui/primitives';
import { errorMessage, post } from '@/lib/api';

function Verify() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [msg, setMsg] = useState('');
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState('error');
      setMsg('The verification link is incomplete.');
      return;
    }
    post('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((e) => {
        setState('error');
        setMsg(errorMessage(e));
      });
  }, [token]);
  return (
    <div>
      <h1 className="text-[28px] font-semibold">Email verification</h1>
      <div className="mt-6">
        {state === 'working' && <p className="text-sm text-ink-3">Verifying your email address…</p>}
        {state === 'ok' && <Notice tone="ok" title="Your email address is verified">You can now sign in to JiMail.</Notice>}
        {state === 'error' && <Notice tone="bad" title="Verification failed">{msg} Sign in to request a new link.</Notice>}
      </div>
      <Link href="/login" className="mt-6 inline-block text-sm font-medium text-petrol hover:underline">
        Go to sign in
      </Link>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
