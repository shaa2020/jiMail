import Link from 'next/link';
import { LogoMark } from '@/components/logo';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <LogoMark size={44} className="mx-auto" />
        <h1 className="mt-6 text-3xl font-semibold">This page does not exist</h1>
        <p className="mt-2 text-ink-3">The address may be mistyped, or the item was moved or deleted.</p>
        <Link href="/app" className="mt-6 inline-block rounded-xl bg-petrol px-5 py-2.5 font-medium text-white">Go to your dashboard</Link>
      </div>
    </div>
  );
}
