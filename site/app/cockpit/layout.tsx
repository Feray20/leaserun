import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Investment-Cockpit: DSCR, Stresstest, Bank-Score | LeaseRun',
  description: 'Technische Objekt- und Kapitaldienstprüfung für Immobilien in Deutschland. Keine Finanzierungsberatung.',
  alternates: { canonical: '/cockpit' },
  robots: { index: true, follow: true },
};

export default function CockpitLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
