import { supabaseAdmin } from '@/lib/supabase/admin';

// Kundenreise (Agent Tyler): Sobald ein Kunde auf der Website, in der App oder im Portal auf einen Fehler stößt
// oder an der Kasse abbricht, sieht Tyler das – sofort beim Eintreffen der Meldung (siehe app/api/errors) und in
// jeder Schicht. Er bestimmt die wahrscheinliche Ursache, erledigt Harmloses selbst (z. B. Meldungen aus privaten
// Browserfenstern oder veraltete Programmteile, die sich beim Kunden selbst neu geladen haben) und legt alles andere
// mit Ursache und konkreter Lösung vor. Er schreibt nie an Kunden; nach außen geht nichts ohne Freigabe.
// Keine personenbezogenen Daten: Fehlermeldungen kommen ohne IP und Nutzerkennung an, Push-Texte nennen keine Namen.

import { diagnose, type ErrRow, type Level } from '@/lib/admin/kunden-diagnose';
export { diagnose };
export type KIssue = { id: string; level: Level; title: string; detail: string; customer: boolean };
export type KReport = { at: string; issues: KIssue[]; fixed: string[]; checkout?: CheckoutInsight | null; funnel?: Funnel | null };

// ---------- Kasse und Trichter: gemeinsame Kennzahl ohne eigenen Testverkehr (lib/admin/kasse-kennzahl.ts) ----------
import { kasseKennzahl, type CheckoutInsight, type Funnel } from '@/lib/admin/kasse-kennzahl';
export { ownEmails, type CheckoutInsight, type Funnel } from '@/lib/admin/kasse-kennzahl';
export async function checkoutInsight(hours = 72): Promise<CheckoutInsight | null> { return (await kasseKennzahl(hours)).checkout; }
export async function funnel(days = 7): Promise<Funnel | null> { return (await kasseKennzahl(days * 24, { stripe: false })).trichter; }

// ---------- Gesamtbild für die Schicht ----------
export async function kundenReport(opts: { stripe?: boolean } = {}): Promise<KReport> {
  const db = supabaseAdmin(), fixed: string[] = [], issues: KIssue[] = [];
  const { data } = await db.from('lr_client_errors').select('id, fingerprint, message, source, page, area, browser, count, first_seen, last_seen').is('resolved_at', null).gte('last_seen', new Date(Date.now() - 3 * 864e5).toISOString()).order('last_seen', { ascending: false }).limit(60);
  const auto: string[] = [];
  for (const e of (data ?? []) as ErrRow[]) {
    const d = diagnose(e);
    if (d.auto) { if (e.id) auto.push(e.id); continue; }
    issues.push({ id: `k:${e.fingerprint || e.id}`, level: d.level, customer: d.customer, title: d.title, detail: `${d.cause} Lösung: ${d.fix}` });
  }
  if (auto.length) { await db.from('lr_client_errors').update({ resolved_at: new Date().toISOString() }).in('id', auto); fixed.push(`${auto.length} harmlose Meldung${auto.length === 1 ? '' : 'en'} abgehakt (Funkloch, privates Fenster, Erweiterung, selbst neu geladen)`); }

  // Stripe 3 Tage, Trichter 7 Tage – beides ohne eigene Tests, Testkonten und Admin-Sitzungen.
  const k = await kasseKennzahl(72, { trichterTage: 7, stripe: opts.stripe !== false }).catch(() => null);
  const co = k?.checkout ?? null, fu = k?.trichter ?? null;
  if (co && co.total) {
    const top = Object.entries(co.reasons).sort((a, b) => b[1] - a[1]);
    if (co.declined) issues.push({ id: 'kasse:abgelehnt', level: co.declined >= 2 ? 'hoch' : 'mittel', customer: true, title: `${co.declined} Zahlung${co.declined === 1 ? '' : 'en'} an der Kasse abgelehnt (3 Tage)`, detail: `Grund: ${top.map(([r, k]) => `${r} (${k}×)`).join(', ')}. Lösung: ${top[0]?.[0].includes('3-D') ? 'Kunden brechen bei der Bankbestätigung ab – in Stripe → Einstellungen → Zahlungsmethoden PayPal, Klarna oder SEPA-Lastschrift als Alternative aktivieren.' : 'Liegt bei der Bank des Kunden. Mehr Zahlungsarten (PayPal, Klarna, SEPA) in Stripe aktivieren senkt die Abbrüche.'}` });
    const lost = co.expired + co.open - co.declined;
    const pp = co.methods.includes('paypal') ? '' : ' PayPal fehlt an der Kasse – in Deutschland die meistgenutzte Online-Zahlart: Stripe → Einstellungen → Zahlungsmethoden → PayPal aktivieren.';
    // „hoch“ erst ab 3 verschiedenen Fremdpersonen ohne Kauf (k.alarm); bei 2 Personen höchstens „mittel“.
    if (lost >= 2 && co.people >= 2 && co.complete / co.total < 0.5) issues.push({ id: 'kasse:abbruch', level: k?.alarm ? 'hoch' : 'mittel', customer: true, title: `Kasse ${lost}× ohne Kauf verlassen (3 Tage, ${co.people} Personen, ${co.complete} Käufe)`, detail: `Von ${co.total} geöffneten Kassen wurden ${co.complete} bezahlt${co.own ? ` (eigene Tests nicht mitgezählt: ${co.own})` : ''}.${pp} Lösung: Kaufweg selbst testen (Preise → Paket → Kasse) – stimmen Preis, Laufzeit und Zahlungsarten? Die Seite zeigt dem Kunden nach dem Abbruch 4 Minuten lang den Hinweis „Bestellung offen“. Erinnerungs-E-Mails an Abbrecher gehen nur mit Einwilligung und nur nach deiner Freigabe.` });
  }
  if (co && co.total && !co.methods.includes('paypal')) issues.push({ id: 'kasse:paypal', level: 'mittel', customer: true, title: 'PayPal fehlt an der Kasse', detail: 'In Deutschland bezahlen viele Kunden online am liebsten mit PayPal; fehlt es, brechen sie häufiger ab. Lösung: Stripe → Einstellungen → Zahlungsmethoden → PayPal aktivieren (die Kasse zeigt es dann automatisch an, ohne Änderung an der Website).' });
  // Nur eigener Testverkehr (höchstens eine Fremdperson): kein Alarm, nur ein Hinweis.
  if (co && k?.nurTest && (k.davon_eigene || k.gestartet)) issues.push({ id: 'kasse:nur-test', level: 'niedrig', customer: false, title: k.hinweis, detail: `Bei Stripe (3 Tage): ${k.gestartet} fremde Kassen, ${k.personen} Person${k.personen === 1 ? '' : 'en'}, ${k.davon_eigene} eigene Sitzungen abgezogen (Testkonten, Admin-Sitzungen, gleiche Person). Erst ab 3 verschiedenen Fremdpersonen ohne Kauf wird Alarm gegeben.` });
  else if (fu && fu.start >= 3 && !fu.back && !(co && co.complete) && (!co || co.people >= 2)) issues.push({ id: 'kasse:keinerueckkehr', level: co && k?.alarm ? 'hoch' : 'mittel', customer: true, title: `${fu.start} Personen starteten die Kasse, aber kein abgeschlossener Kauf in ${fu.days} Tagen`, detail: `Trichter nach Personen (eigene Tests ausgenommen): ${fu.pricing} sahen Preise → ${fu.open} öffneten die Kasse → ${fu.start} wechselten zu Stripe → 0 kamen nach Kauf zurück. Lösung: einmal selbst bis zur Zahlungsseite durchklicken; stimmt alles, liegt es am Angebot (Preis, Vertrauen, Zahlungsarten).` });

  const order = { hoch: 0, mittel: 1, niedrig: 2 } as const;
  issues.sort((a, b) => order[a.level] - order[b.level] || Number(b.customer) - Number(a.customer));
  const rep: KReport = { at: new Date().toISOString(), issues: issues.slice(0, 40), fixed, checkout: co, funnel: fu };
  await db.from('lr_settings').upsert({ key: 'hq_kundenreise', value: rep, updated_by: 'system:kundenreise' });
  return rep;
}
export async function loadKundenReport(): Promise<KReport | null> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', 'hq_kundenreise').maybeSingle();
  return (data?.value as KReport) || null;
}

// ---------- Sofort-Reaktion beim Eintreffen einer Fehlermeldung ----------
// Läuft nach der Antwort an den Browser (kein Warten für den Kunden). Harmloses wird sofort abgehakt; ein echter
// Kundenfehler (hoch) löst sofort eine Mitteilung an Ferays Gerät aus – höchstens einmal je Fehler in 6 Stunden.
export async function reactNow(fp: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: e } = await db.from('lr_client_errors').select('id, fingerprint, message, source, page, area, browser, count, first_seen, last_seen, resolved_at').eq('fingerprint', fp).maybeSingle();
  if (!e) return;
  const d = diagnose(e as ErrRow);
  if (d.auto) { await db.from('lr_client_errors').update({ resolved_at: new Date().toISOString() }).eq('id', e.id); return; }
  if (e.resolved_at) await db.from('lr_client_errors').update({ resolved_at: null }).eq('id', e.id); // wieder aufgetreten → wieder offen
  if (!d.customer || d.level !== 'hoch') return;
  const { data: st } = await db.from('lr_settings').select('value').eq('key', 'hq_kunden_alerts').maybeSingle();
  const seen = { ...((st?.value as Record<string, number>) || {}) };
  if (seen[fp] && Date.now() - seen[fp] < 6 * 36e5) return;
  seen[fp] = Date.now();
  for (const [k, t] of Object.entries(seen)) if (Date.now() - t > 7 * 864e5) delete seen[k];
  await db.from('lr_settings').upsert({ key: 'hq_kunden_alerts', value: seen, updated_by: 'system:kundenreise' });
  const { pushAdmins } = await import('@/lib/admin/push');
  await pushAdmins('support', 'Kunde hatte gerade ein Problem', `${d.title}. Tyler hat die Ursache im Headquarters.`.slice(0, 160), 'kunden_fehler');
  await kundenReport({ stripe: false }).catch(() => null);
}
