import { pushAdmins } from '@/lib/admin/push';

// Sofort-Meldungen an den Betreiber zusätzlich zur E-Mail: Mitteilung in der LeaseRun-App (Kategorie „Sicherheit“).
// Früher Telegram/Slack – entfernt; die App ist der einzige Sofort-Kanal. Inhalte ohne personenbezogene Daten.
export const pushConfigured = () => true;

// Erste Zeile = Titel (ohne „⚠ LeaseRun:“), zweite Zeile = Text der Mitteilung. Links werden nicht mitgeschickt.
export async function pushAlert(text: string): Promise<{ app: boolean }> {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^https?:\/\//.test(l));
  const title = (lines[0] || 'Sicherheitshinweis').replace(/^⚠\s*/, '').replace(/^LeaseRun:\s*/, '').slice(0, 120);
  const body = (lines.slice(1).join(' · ') || 'Details im Web-Admin unter Sicherheit.').slice(0, 220);
  await pushAdmins('security', title, body, 'security_alert');
  return { app: true };
}
