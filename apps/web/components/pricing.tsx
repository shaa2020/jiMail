'use client';

import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { get } from '@/lib/api';
import { mb, money } from '@/lib/format';

/** Live plan list from the API — prices and limits are whatever the platform administrator configured. */
export function Pricing() {
  const q = useQuery<any[]>({ queryKey: ['plans'], queryFn: () => get('/plans') });
  if (q.isLoading) return <div className="mt-8 grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-72 rounded-xl" />)}</div>;
  if (q.error || !q.data?.length) return <p className="mt-8 text-sm text-ink-3">Plans are not available right now.</p>;
  return (
    <div className="mt-8 grid gap-4 md:grid-cols-3">
      {q.data.map((p) => (
        <div key={p.id} className={`flex flex-col rounded-2xl border p-6 ${p.code === 'business' ? 'border-petrol bg-petrol-soft/40' : 'border-line bg-paper'}`}>
          <h3 className="text-xl font-semibold">{p.name}</h3>
          <p className="mt-1 min-h-10 text-sm text-ink-3">{p.description}</p>
          <p className="mt-5 font-display text-4xl font-semibold">
            {p.priceMonthlyCents ? money(p.priceMonthlyCents, p.currency) : 'Custom'}
            {p.priceMonthlyCents > 0 && <span className="text-base font-normal text-ink-3"> / month</span>}
          </p>
          <ul className="mt-5 flex-1 space-y-2 text-sm">
            {[`Up to ${p.maxMailboxes} mailboxes`, `${p.maxDomains} domain${p.maxDomains > 1 ? 's' : ''}`, `${mb(p.storagePerMailboxMb)} per mailbox`, ...p.features].map((f: string) => (
              <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-ok" />{f}</li>
            ))}
          </ul>
          <Link href="/register" className={`mt-6 rounded-xl px-4 py-2.5 text-center text-sm font-medium ${p.code === 'business' ? 'bg-petrol text-white hover:bg-petrol-ink dark:text-[#06201f]' : 'border border-line-strong bg-surface hover:bg-surface-2'}`}>
            {p.priceMonthlyCents ? `Try ${p.name} free` : 'Talk to us'}
          </Link>
        </div>
      ))}
    </div>
  );
}
