import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminList } from '@/lib/security/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

// Sicherheitsalarm per E-Mail an alle Administratoren. Gedrosselt: je Art höchstens eine E-Mail pro 15 Minuten.
// Schwere Ereignisse (Admin-Zugriffsversuche, Scanner, gesperrte Quellen) melden sofort; Bots und Drosselungen erst als Welle.
type Rule = { level: 'hoch' | 'mittel'; title: string; minCount: number; windowMin: number; action: string };
const RULES: Record<string, Rule> = {
  invoice_tampered: { level: 'hoch', title: 'Rechnungs-PDF weicht von der festgeschriebenen Prüfsumme ab (GoBD)', minCount: 1, windowMin: 60, action: 'Betroffene Rechnungen nicht weitergeben. Original aus Stripe bzw. Sicherung prüfen und mich informieren; Korrektur nur über Storno und neue Rechnung.' },
  admin_denied: { level: 'hoch', title: 'Zugriffsversuch auf den Web-Admin ohne Berechtigung', minCount: 1, windowMin: 15, action: 'Prüfen, ob ein bekanntes Konto betroffen ist. Bei Häufung: Quelle im Reiter Sicherheit sperren.' },
  admin_ip_blocked: { level: 'hoch', title: 'Web-Admin-Zugriff von nicht freigegebener IP-Adresse', minCount: 1, windowMin: 15, action: 'Waren Sie das (z. B. unterwegs)? Sonst: Passwort ändern und Sitzungen beenden.' },
  admin_mfa_missing: { level: 'hoch', title: 'Web-Admin-Anmeldung ohne zweiten Faktor', minCount: 3, windowMin: 15, action: 'Wenn Sie es nicht waren: sofort Passwort ändern, alle Sitzungen beenden (Reiter Sicherheit).' },
  probe: { level: 'hoch', title: 'Angriffs-Scanner sucht nach Schwachstellen', minCount: 5, windowMin: 10, action: 'Die Anfragen wurden abgewiesen. Bei anhaltendem Scan die Quelle im Reiter Sicherheit sperren.' },
  blocked: { level: 'mittel', title: 'Gesperrte Quelle versucht weiter zuzugreifen', minCount: 20, windowMin: 10, action: 'Keine Aktion nötig – die Sperre wirkt. Bei sehr vielen Versuchen Not-Aus erwägen.' },
  panic: { level: 'hoch', title: 'Not-Aus wurde geschaltet', minCount: 1, windowMin: 1, action: 'Prüfen, ob das gewollt war (Reiter Sicherheit).' },
  rate_limit: { level: 'mittel', title: 'Ungewöhnlich viele Anfragen (Drosselung aktiv)', minCount: 30, windowMin: 10, action: 'Die Begrenzung greift. Wenn eine einzelne Quelle dominiert: im Reiter Sicherheit sperren.' },
  honeypot: { level: 'mittel', title: 'Bot-Welle auf Formularen', minCount: 15, windowMin: 10, action: 'Formular-Abwehr greift (Anfragen verworfen). Bei Dauerbeschuss Quelle sperren.' },
  too_fast: { level: 'mittel', title: 'Bot-Welle auf Formularen (zu schnelle Absendungen)', minCount: 15, windowMin: 10, action: 'Formular-Abwehr greift. Bei Dauerbeschuss Quelle sperren.' },
  content_flagged: { level: 'mittel', title: 'Viele verdächtige Formular-Inhalte (Spam)', minCount: 10, windowMin: 30, action: 'Anfragen im Web-Admin prüfen, Spam löschen.' },
  login_flood: { level: 'hoch', title: 'Viele fehlgeschlagene Anmeldungen', minCount: 1, windowMin: 15, action: 'Möglicher Passwort-Rateangriff. Quelle sperren; betroffene Konten informieren.' },
  upload_rejected: { level: 'mittel', title: 'Abgewiesene Datei-Uploads (falsches Format/Schadcode-Verdacht)', minCount: 5, windowMin: 30, action: 'Uploads wurden abgewiesen. Bei Häufung Quelle sperren.' },
};
const THROTTLE_MS = 15 * 60_000;
const lastLocal = new Map<string, number>();

export async function maybeAlert(kind: string, area: string): Promise<void> {
  const rule = RULES[kind];
  if (!rule || !adminConfigured() || !mailConfigured()) return;
  const now = Date.now();
  if (now - (lastLocal.get(kind) || 0) < 60_000) return; // pro Instanz entprellen
  lastLocal.set(kind, now);
  const db = supabaseAdmin();
  const since = new Date(now - rule.windowMin * 60_000).toISOString();
  const { count } = await db.from('immo_security_log').select('id', { count: 'exact', head: true }).eq('kind', kind).gte('created_at', since);
  if ((count ?? 0) < rule.minCount) return;
  const { data: st } = await db.from('immo_settings').select('value').eq('key', 'sec_alert_last').maybeSingle();
  const last = ((st?.value as Record<string, string>) || {});
  if (last[kind] && now - new Date(last[kind]).getTime() < THROTTLE_MS) return;
  await db.from('immo_settings').upsert({ key: 'sec_alert_last', value: { ...last, [kind]: new Date(now).toISOString() }, updated_at: new Date(now).toISOString(), updated_by: 'system' });
  const { data: top } = await db.from('immo_security_log').select('ip_hash, bucket, detail').eq('kind', kind).gte('created_at', since).limit(500);
  const by = new Map<string, number>(); for (const r of top ?? []) { const k = r.ip_hash || '–'; by.set(k, (by.get(k) || 0) + 1); }
  const sources = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k === '–' ? 'unbekannt' : 'Quelle ' + k.slice(0, 8)}: ${n}×`).join(', ');
  const areas = [...new Set((top ?? []).map((r) => r.detail || r.bucket).filter(Boolean))].slice(0, 5).join(', ');
  const text = `${rule.level === 'hoch' ? 'Sicherheitsalarm' : 'Sicherheitshinweis'}: ${rule.title}\n\n${count} Ereignis(se) in den letzten ${rule.windowMin} Minuten.\nBereich: ${areas || area}\nHäufigste Quellen: ${sources || '–'}\n\nWas zu tun ist: ${rule.action}\n\nIm Web-Admin unter „Sicherheit“ sehen Sie alle Vorfälle und können Quellen mit einem Klick sperren oder den Not-Aus auslösen. Es werden keine IP-Adressen gespeichert, nur gekürzte Kennungen.`;
  for (const to of adminList()) {
    await sendMail(to, `${rule.level === 'hoch' ? '⚠ Sicherheitsalarm' : 'Sicherheitshinweis'}: ${rule.title}`, text, [], { title: rule.title, button: { label: 'Im Web-Admin ansehen', url: 'https://immoadv.de/intern/web-admin#sicherheit' }, note: 'Diese E-Mail wird automatisch gesendet, höchstens alle 15 Minuten je Art.' });
  }
}
