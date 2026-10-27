import { eurText, periodLabel, type BillingMode } from '@/lib/creator/billing';
import { SITE_ORIGIN } from '@/lib/creator/site';

// Texte der automatischen E-Mails zur Abrechnung (ohne Zahlungsdaten).
export function readyMail(mode: BillingMode, period: string, payoutCents: number, name: string): { subject: string; text: string; title: string } {
  const p = periodLabel(period);
  return mode === 'INVOICE'
    ? { subject: `Deine Abrechnung ${p} ist bereit`, title: 'Abrechnung bereit',
        text: `Hallo ${name},\n\ndeine Creator-Abrechnung für ${p} ist abgeschlossen: ${eurText(payoutCents)} Auszahlungsbetrag.\n\nBitte erstelle im Creator-Portal mit einem Klick deine Rechnung – die Angaben sind bereits ausgefüllt. Danach prüfen wir sie und zahlen aus.\n\n${SITE_ORIGIN}/creator#abrechnung` }
    : { subject: `Deine Abrechnung ${p} ist bereit`, title: 'Abrechnung bereit',
        text: `Hallo ${name},\n\ndeine Creator-Abrechnung für ${p} ist abgeschlossen: ${eurText(payoutCents)} Auszahlungsbetrag.\n\nDu musst nichts tun: LeaseRun erstellt dafür eine Gutschrift und zahlt nach der Freigabe auf dein hinterlegtes Konto aus.\n\n${SITE_ORIGIN}/creator#abrechnung` };
}
export function reminderMail(period: string, name: string): { subject: string; text: string; title: string } {
  const p = periodLabel(period);
  return { subject: `Erinnerung: Rechnung für ${p} fehlt noch`, title: 'Rechnung fehlt noch',
    text: `Hallo ${name},\n\nfür deine Creator-Abrechnung ${p} liegt noch keine Rechnung vor. Ohne Rechnung können wir leider nicht auszahlen.\n\nDie Rechnung erstellst du mit einem Klick im Creator-Portal:\n${SITE_ORIGIN}/creator#abrechnung` };
}

