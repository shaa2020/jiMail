import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const bricolage = Bricolage_Grotesque({ subsets: ['latin', 'latin-ext'], variable: '--font-bricolage', display: 'swap' });
const plex = IBM_Plex_Sans({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700'], variable: '--font-plex', display: 'swap' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'JiMail — Your email. Your domain. Your control.', template: '%s · JiMail' },
  description: 'Self-hosted, multi-tenant business email on your own domain.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f7f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1416' },
  ],
};

// Applies a saved theme choice before paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem('jm-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${plex.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
