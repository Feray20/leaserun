import type { Metadata } from 'next';
import './globals.css';

// Gemeinsame Angaben für alle Next.js-Seiten; seitenspezifische Metadaten stehen in der jeweiligen Seite bzw. ihrem Layout.
export const metadata: Metadata = {
  metadataBase: new URL('https://immoadv.de'),
  manifest: '/manifest.webmanifest',
  openGraph: { type: 'website', locale: 'de_DE', siteName: 'ImmoAdv', images: ['/og-image.png'] },
  icons: { apple: '/apple-touch-icon.png', icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico', sizes: '48x48' }] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="de"><body>{children}</body></html>;
}
