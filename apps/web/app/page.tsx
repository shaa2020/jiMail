import { Check, CheckCircle2, Code2, Inbox, LayoutDashboard, Lock, Server, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { Pricing } from '@/components/pricing';

const RECORDS = [
  { type: 'TXT', host: '_jimail.northwind.eu', label: 'Ownership' },
  { type: 'MX', host: 'northwind.eu', label: 'Incoming mail' },
  { type: 'TXT', host: 'northwind.eu', label: 'SPF' },
  { type: 'TXT', host: 'v1-rsa._domainkey', label: 'DKIM' },
  { type: 'TXT', host: '_dmarc.northwind.eu', label: 'DMARC' },
];

function DomainCard() {
  return (
    <div className="relative rounded-2xl border border-line bg-surface p-5 shadow-[0_24px_60px_-24px_rgb(10_60_64/0.35)] sm:p-6" aria-label="Example: DNS checks for a customer domain">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-ink-3">Domain</p>
          <p className="font-display text-xl font-semibold">northwind.eu</p>
        </div>
        <span className="hero-ready inline-flex items-center gap-1.5 rounded-md bg-ok-soft px-2 py-1 text-xs font-medium text-ok">
          <span className="size-1.5 rounded-full bg-current" /> Ready for mail
        </span>
      </div>
      <ul className="mt-5 divide-y divide-line">
        {RECORDS.map((r, i) => (
          <li key={r.label} className="flex items-center gap-3 py-2.5" style={{ ['--i' as string]: i }}>
            <span className="relative grid size-5 place-items-center">
              <span className="hero-pending absolute size-4 rounded-full border-2 border-dashed border-line-strong" />
              <CheckCircle2 className="hero-check size-5 text-ok" aria-hidden />
            </span>
            <span className="w-24 text-sm font-medium">{r.label}</span>
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">{r.type} {r.host}</code>
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-ink-2">
        <span className="font-medium text-ink">info@northwind.eu</span> · <span>sales@northwind.eu</span> · <span>anna@northwind.eu</span>
      </div>
      <style>{`
        .hero-check { opacity: 0; transform: scale(.6); animation: heroPop .35s cubic-bezier(.3,1.4,.6,1) forwards; animation-delay: calc(0.5s + var(--i) * 0.38s); }
        .hero-pending { animation: heroFade .2s forwards; animation-delay: calc(0.5s + var(--i) * 0.38s); }
        .hero-ready { opacity: 0; animation: heroFadeIn .4s forwards; animation-delay: 2.6s; }
        @keyframes heroPop { to { opacity: 1; transform: scale(1); } }
        @keyframes heroFade { to { opacity: 0; } }
        @keyframes heroFadeIn { to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .hero-check, .hero-ready { opacity: 1; transform: none; animation: none; } .hero-pending { display: none; } }
      `}</style>
    </div>
  );
}

const FEATURES = [
  { icon: <Inbox className="size-5" />, title: 'Webmail people enjoy', body: 'Threads, search with filters, drafts that save themselves, attachments, signatures and auto-replies — on desktop and phone.' },
  { icon: <Smartphone className="size-5" />, title: 'Works in every mail app', body: 'Standard IMAP and SMTP over TLS for Outlook, Apple Mail, Thunderbird, Samsung Email and the Gmail app. CalDAV and CardDAV for calendars and contacts.' },
  { icon: <LayoutDashboard className="size-5" />, title: 'Administration without tickets', body: 'Create mailboxes, aliases, forwarding and catch-alls, import from CSV, reset passwords and suspend compromised accounts in seconds.' },
  { icon: <Lock className="size-5" />, title: 'Security by default', body: 'Two-factor sign-in, strict tenant isolation, sanitised HTML mail with remote images blocked, sending limits and a complete audit log.' },
  { icon: <Code2 className="size-5" />, title: 'An API for provisioning', body: 'Scoped, rotatable API keys bound to one organisation. Create mailboxes from your CRM or onboarding flow.' },
  { icon: <Server className="size-5" />, title: 'Runs on your server', body: 'Docker Compose on a single VPS to start, built on the Stalwart mail server. Your data stays on infrastructure you control.' },
];

export default function Landing() {
  return (
    <div className="bg-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <a href="#pricing" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:text-ink sm:inline">Pricing</a>
          <Link href="/login" className="rounded-lg px-3 py-2 text-ink-2 hover:text-ink">Sign in</Link>
          <Link href="/register" className="rounded-lg bg-petrol px-4 py-2 font-medium text-white hover:bg-petrol-ink dark:text-[#06201f]">Start free trial</Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div>
            <h1 className="font-display text-[44px] font-semibold leading-[1.02] tracking-[-0.03em] sm:text-[64px]">
              Your email.
              <br />
              Your domain.
              <br />
              Your control.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
              JiMail hosts business mailboxes on the domain you already own. Connect it with a few DNS records, create addresses for your team, and use them in the browser or any mail app.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="rounded-xl bg-petrol px-5 py-3 font-medium text-white hover:bg-petrol-ink dark:text-[#06201f]">Start a 14-day trial</Link>
              <Link href="/login" className="rounded-xl border border-line-strong bg-surface px-5 py-3 font-medium hover:bg-surface-2">Open webmail</Link>
            </div>
            <p className="mt-4 text-sm text-ink-3">No card required for the trial. Cancel any time.</p>
          </div>
          <DomainCard />
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <h2 className="max-w-xl text-3xl font-semibold sm:text-4xl">From domain to inbox in three steps</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {[
                ['Add your domain', 'Enter company.com. JiMail gives you one TXT record to prove it is yours — nothing is changed in your DNS automatically.'],
                ['Publish the mail records', 'Copy the MX, SPF, DKIM and DMARC values. JiMail checks them continuously and tells you exactly what is missing.'],
                ['Create mailboxes', 'Add info@, sales@ or one per person. Share the sign-in details and your team is ready.'],
              ].map(([t, b], i) => (
                <li key={t}>
                  <span className="grid size-9 place-items-center rounded-full bg-saffron-soft font-display text-base font-semibold text-warn">{i + 1}</span>
                  <h3 className="mt-4 text-lg font-semibold">{t}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{b}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <h2 className="max-w-2xl text-3xl font-semibold sm:text-4xl">Everything a business mailbox needs</h2>
          <div className="mt-10 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <div className="grid size-10 place-items-center rounded-xl bg-petrol-soft text-petrol">{f.icon}</div>
                <h3 className="mt-4 font-sans text-base font-semibold tracking-normal">{f.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
            <h2 className="text-3xl font-semibold sm:text-4xl">Plans</h2>
            <p className="mt-2 text-ink-2">Every plan includes webmail, IMAP/SMTP access and DNS guidance.</p>
            <Pricing />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="rounded-2xl bg-side px-6 py-10 text-side-ink sm:px-10">
            <h2 className="max-w-xl text-2xl font-semibold text-white sm:text-3xl">Honest about deliverability</h2>
            <ul className="mt-5 grid gap-3 text-[15px] sm:grid-cols-2">
              {[
                'We mark a domain ready only when its DNS checks really pass.',
                'Correct DNS improves delivery but never guarantees the inbox — reputation builds over time.',
                'Outgoing mail always requires authentication; JiMail is never an open relay.',
                'Mail is encrypted in transit with TLS. JiMail does not claim end-to-end encryption.',
              ].map((t) => (
                <li key={t} className="flex gap-2.5"><Check className="mt-1 size-4 shrink-0 text-saffron" />{t}</li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-ink-3 sm:px-8">
          <Logo size={22} />
          <p>Built on the Stalwart mail server · <a href="/api/docs" className="hover:text-ink">API reference</a></p>
        </div>
      </footer>
    </div>
  );
}
