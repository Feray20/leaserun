import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Seite nicht gefunden | LeaseRun', // „noindex“ setzt Next.js für 404-Seiten selbst
};

const LINKS: [string, string][] = [
  ['/', 'Startseite'],
  ['/calculators', 'Alle Rechner'],
  ['/learn', 'Wissenszentrale'],
  ['/learn/glossar', 'Glossar'],
  ['/start', 'Meine erste Immobilie'],
  ['/app/dashboard', 'Mein Konto'],
];

// Eigene 404-Seite ohne Skripte: funktioniert auch unter strenger Content-Security-Policy.
export default function NotFound() {
  return (
    <main className="nf">
      <a className="nf-brand" href="/">
        <img src="/logo-icon.svg" alt="" width={38} height={32} />
        <span>Immo<span>Adv</span></span>
      </a>
      <p className="nf-code">404</p>
      <h1>Diese Seite gibt es nicht (mehr).</h1>
      <p>Vielleicht hat sich die Adresse geändert. Von hier aus geht es weiter:</p>
      <ul>
        {LINKS.map(([href, label]) => (
          <li key={href}><a href={href}>{label}</a></li>
        ))}
      </ul>
    </main>
  );
}
