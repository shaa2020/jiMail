'use client';

import { useEffect } from 'react';
import { LogoMark } from '@/components/logo';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div>
        <LogoMark size={40} className="mx-auto" />
        <h1 className="mt-5 text-2xl font-semibold">Something went wrong on this page</h1>
        <p className="mt-2 max-w-md text-sm text-ink-3">The error has been logged. Try again, and if it keeps happening contact your administrator{error.digest ? ` with reference ${error.digest}` : ''}.</p>
        <button onClick={reset} className="mt-5 rounded-xl bg-petrol px-5 py-2.5 font-medium text-white">Try again</button>
      </div>
    </div>
  );
}
