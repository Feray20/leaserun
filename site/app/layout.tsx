import type { Metadata } from 'next';
import './globals.css';

// Gemeinsame Angaben für alle Next.js-Seiten; seitenspezifische Metadaten stehen in der jeweiligen Seite bzw. ihrem Layout.
export const metadata: Metadata = {
  metadataBase: new URL('https://leaserun.com'),
  manifest: '/manifest.webmanifest',
  openGraph: { type: 'website', locale: 'de_DE', siteName: 'LeaseRun', images: ['/og-image.png'] },
  icons: { apple: '/apple-touch-icon.png?v=4', shortcut: '/favicon.ico?v=4', icon: [{ url: '/favicon-32x32.png?v=4', sizes: '32x32', type: 'image/png' }, { url: '/favicon.svg?v=4', type: 'image/svg+xml' }, { url: '/favicon.ico?v=4', sizes: '48x48' }, { url: '/favicon-48x48.png?v=4', sizes: '48x48', type: 'image/png' }, { url: '/favicon-96x96.png?v=4', sizes: '96x96', type: 'image/png' }, { url: '/icon-192.png?v=4', sizes: '192x192', type: 'image/png' }] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="de"><body>{children}</body></html>;
}
