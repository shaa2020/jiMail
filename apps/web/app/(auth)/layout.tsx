import Link from 'next/link';
import { Logo } from '@/components/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(0,520px)]">
      <div className="relative hidden overflow-hidden bg-side lg:block">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'repeating-linear-gradient(135deg, #fff 0 2px, transparent 2px 22px)' }} aria-hidden />
        <div className="relative flex h-full flex-col justify-between p-12 text-side-ink">
          <Link href="/" aria-label="JiMail home">
            <Logo inverted size={32} />
          </Link>
          <div className="max-w-md">
            <p className="font-display text-[40px] font-semibold leading-[1.05] tracking-tight text-white">Your email. Your domain. Your control.</p>
            <p className="mt-4 text-[15px] leading-relaxed text-side-muted">Business mailboxes on the domain you already own, hosted on infrastructure you run. Webmail, IMAP and SMTP included.</p>
          </div>
          <p className="text-xs text-side-muted">Powered by Stalwart Mail Server</p>
        </div>
      </div>
      <div className="flex min-h-screen flex-col px-5 py-8 sm:px-10">
        <Link href="/" className="lg:hidden" aria-label="JiMail home">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center">
          <div className="w-full max-w-sm mx-auto lg:mx-0">{children}</div>
        </div>
      </div>
    </div>
  );
}
