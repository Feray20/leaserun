import { supabaseAdmin } from '@/lib/supabase/admin';

// Kassen-Kennzahl: eine gemeinsame Zählung der Kasse für alle Agenten-Analysen (Hannah, Sophie, Tyler, Ethan) und
// den Trichter im Kundenreise-Bericht. Eigener Testverkehr wird vorher abgezogen, damit Testkäufe der Betreiberin
// keinen Fehlalarm „hoch“ auslösen. Als eigen zählt eine Sitzung, wenn sie
//   • zu einem Testkonto gehört (ADMIN_EMAILS, OWNER_TEST_EMAILS oder app_metadata.testkonto = true – nur serverseitig setzbar),
//   • zu einer Admin-Sitzung gehört (Merkmal „intern“, Stripe-Testmodus bzw. livemode = false, Konto-ID eines Admins),
//   • oder zur gleichen Person wie eine eigene Sitzung gehört: gleiche E-Mail, gleiche Stripe-Customer-ID oder
//     gleiche Besucherkennung (täglich wechselnder Hash aus gekürzter IP + Browser) innerhalb von 24 Stunden.
// Nur lesend gegenüber Stripe. Keine personenbezogenen Daten im Ergebnis – nur Zahlen.

export type CheckoutInsight = { since: string; total: number; complete: number; expired: number; open: number; declined: number; reasons: Record<string, number>; people: number; own: number; methods: string[] };
export type Funnel = { days: number; pricing: number; open: number; start: number; back: number; register: number; persons: true };
export type KasseKennzahl = {
  since: string; stunden: number;
  geoeffnet: number; gestartet: number; bezahlt: number; personen: number; davon_eigene: number;
  nurTest: boolean; alarm: boolean; hinweis: string;
  checkout: CheckoutInsight | null; trichter: Funnel | null;
};

// Gemeinsamer Befund-Schlüssel: „Kasse ohne Kauf“ wird nur einmal gemeldet (Tyler), die anderen verweisen darauf.
export const KASSE_KEY = 'kasse:keine-kaeufe';
export const KASSE_MELDER = 'support';
const KASSE_IDS = /^(kasse:(abbruch|keinerueckkehr|nur-test|keine-kaeufe)|neu:kasse-(ohne-kauf|quote|test)|mkt:(checkout-rate|kasse-test))$/;
export const befundKey = (id: string): string | null => (KASSE_IDS.test(id) ? KASSE_KEY : null);

// Regel für alle Analysen: „hoch“ erst ab 3 verschiedenen Fremdpersonen ohne Kauf; bei höchstens einer Person nur ein Hinweis.
export const kasseHinweis = (eigene: number) => `Kasse: nur Testverkehr (${eigene} eigene Sitzung${eigene === 1 ? '' : 'en'}), keine Fremdkäufe messbar`;
const bewerte = (personen: number, bezahlt: number, gestartet: number) => ({ nurTest: personen <= 1 || gestartet === 0, alarm: personen >= 3 && bezahlt === 0 });

const DECLINE: Record<string, string> = {
  insufficient_funds: 'Konto nicht gedeckt', card_declined: 'Karte von der Bank abgelehnt', generic_decline: 'Karte von der Bank abgelehnt', do_not_honor: 'Karte von der Bank abgelehnt',
  expired_card: 'Karte abgelaufen', incorrect_cvc: 'Prüfnummer falsch', incorrect_number: 'Kartennummer falsch', authentication_required: 'Bankbestätigung (3-D Secure) nicht abgeschlossen',
  payment_intent_authentication_failure: 'Bankbestätigung (3-D Secure) nicht abgeschlossen', processing_error: 'Störung bei der Zahlungsabwicklung', lost_card: 'Karte gesperrt', stolen_card: 'Karte gesperrt', fraudulent: 'Von Stripe als Betrugsverdacht blockiert',
};
// Adressen der Betreiberin: Admin-Zugänge und private Testkonten (Vercel-Variable OWNER_TEST_EMAILS, kommagetrennt).
export const ownEmails = () => new Set(`${process.env.ADMIN_EMAILS || ''},${process.env.OWNER_TEST_EMAILS || ''}`.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));

// Konto-IDs und Adressen der Testkonten: Admin-/Testadressen und Konten mit app_metadata.testkonto = true.
let idMemo: { at: number; ids: Set<string>; mails: Set<string> } | null = null;
async function testAccounts(emails: Set<string>): Promise<{ ids: Set<string>; mails: Set<string> }> {
  if (idMemo && Date.now() - idMemo.at < 36e5) return idMemo;
  const ids = new Set<string>(), mails = new Set<string>(emails);
  const r = await supabaseAdmin().auth.admin.listUsers({ perPage: 1000 }).catch(() => null);
  for (const u of r?.data?.users ?? []) {
    const mail = String(u.email || '').toLowerCase();
    if (emails.has(mail) || u.app_metadata?.testkonto === true) { ids.add(u.id); if (mail) mails.add(mail); }
  }
  idMemo = { at: Date.now(), ids, mails }; return idMemo;
}

// ---------- Eigene Besucherkennungen (24 Std.) ----------
// Beim Öffnen einer eigenen Kasse merkt sich der Server die tägliche Besucherkennung dieser Anfrage (kein Klartext, keine IP).
// Damit fallen dieselben Aufrufe auch aus dem Trichter (Preisseite, Kasse geöffnet, zu Stripe), selbst ohne Geräte-Cookie.
const OWN_KEY = 'hq_kasse_eigene_besucher';
type OwnVisitor = { v: string; at: string };
export async function rememberOwnVisitor(visitor: string | null): Promise<void> {
  if (!visitor || !/^[0-9a-f]{16}$/.test(visitor)) return;
  try {
    const db = supabaseAdmin(), now = Date.now();
    const { data } = await db.from('lr_settings').select('value').eq('key', OWN_KEY).maybeSingle();
    const list = (Array.isArray(data?.value) ? (data!.value as OwnVisitor[]) : []).filter((x) => x && x.v !== visitor && now - Date.parse(x.at) < 8 * 864e5);
    await db.from('lr_settings').upsert({ key: OWN_KEY, value: [...list, { v: visitor, at: new Date(now).toISOString() }].slice(-200), updated_by: 'system:kasse' });
  } catch { /* Zählung darf den Kauf nie stören */ }
}
async function ownVisitors(): Promise<Map<string, number[]>> {
  const m = new Map<string, number[]>();
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', OWN_KEY).maybeSingle();
  for (const x of (Array.isArray(data?.value) ? (data!.value as OwnVisitor[]) : [])) if (x?.v) m.set(x.v, [...(m.get(x.v) || []), Date.parse(x.at)]);
  return m;
}

// ---------- Kasse bei Stripe (nur lesend) ----------
async function stripeKasse(hours: number): Promise<CheckoutInsight | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  const { stripe } = await import('@/lib/billing/stripe');
  const since = Math.floor((Date.now() - hours * 36e5) / 1000);
  const list = await stripe().checkout.sessions.list({ created: { gte: since }, limit: 100, expand: ['data.payment_intent'] });
  const out: CheckoutInsight = { since: new Date(since * 1000).toISOString(), total: 0, complete: 0, expired: 0, open: 0, declined: 0, reasons: {}, people: 0, own: 0, methods: [] };
  const acc = await testAccounts(ownEmails());
  const mailOf = (s: (typeof list.data)[number]) => String(s.customer_details?.email || s.customer_email || '').toLowerCase();
  const custOf = (s: (typeof list.data)[number]) => (typeof s.customer === 'string' ? s.customer : s.customer?.id || '');
  const direct = (s: (typeof list.data)[number]) => {
    const uid = String(s.metadata?.supabase_user_id || s.client_reference_id || '').replace(/^test-/, '');
    return s.livemode === false || acc.mails.has(mailOf(s)) || (uid && acc.ids.has(uid)) || String(s.client_reference_id || '').startsWith('test-') || s.metadata?.intern === '1' || s.metadata?.leaserun_test === '1';
  };
  // Erst eigene Sitzungen erkennen, dann alle Sitzungen derselben Person (gleiche E-Mail oder Stripe-Customer-ID) mit abziehen.
  const ownMail = new Set<string>(), ownCust = new Set<string>();
  for (const s of list.data) if (direct(s)) { if (mailOf(s)) ownMail.add(mailOf(s)); if (custOf(s)) ownCust.add(custOf(s)); }
  const people = new Set<string>(), methods = new Set<string>();
  for (const s of list.data) {
    if (direct(s) || (mailOf(s) && ownMail.has(mailOf(s))) || (custOf(s) && ownCust.has(custOf(s)))) { out.own++; continue; }
    people.add(mailOf(s) || custOf(s) || s.id); for (const m of s.payment_method_types || []) methods.add(m);
    out.total++;
    if (s.status === 'complete') { out.complete++; continue; }
    if (s.status === 'expired') out.expired++; else out.open++;
    const pi = s.payment_intent && typeof s.payment_intent === 'object' ? s.payment_intent : null;
    const err = pi?.last_payment_error;
    if (err) { out.declined++; const r = DECLINE[err.decline_code || ''] || DECLINE[err.code || ''] || 'Zahlung abgelehnt'; out.reasons[r] = (out.reasons[r] || 0) + 1; }
  }
  out.people = people.size; out.methods = [...methods];
  return out;
}

// ---------- Trichter aus der cookielosen Reichweitenmessung ----------
// Gezählt nach Personen (anonyme Besucherkennung, kein Cookie). Eigene Geräte der Betreiberin werden schon bei der Messung
// ausgelassen; zusätzlich fallen Kennungen weg, die innerhalb von 24 Std. eine eigene Kasse geöffnet haben.
async function trichter(days: number): Promise<Funnel | null> {
  const [{ data, error }, own] = await Promise.all([
    supabaseAdmin().from('lr_analytics').select('ev, visitor, ts').in('ev', ['pricing_view', 'pricing_viewed', 'checkout_open', 'checkout_start', 'purchase_return', 'register']).gte('ts', new Date(Date.now() - days * 864e5).toISOString()).limit(20000),
    ownVisitors().catch(() => new Map<string, number[]>()),
  ]);
  if (error) return null;
  const rows = (data ?? []).filter((x) => { const t = own.get(x.visitor as string); return !t || !t.some((at) => Math.abs(Date.parse(x.ts as string) - at) < 864e5); });
  const c = (...ev: string[]) => new Set(rows.filter((x) => ev.includes(x.ev as string)).map((x, i) => (x.visitor as string) || `n${i}`)).size;
  return { days, pricing: c('pricing_view', 'pricing_viewed'), open: c('checkout_open'), start: c('checkout_start'), back: c('purchase_return'), register: c('register'), persons: true };
}

// ---------- Gemeinsame Kennzahl (5 Minuten zwischengespeichert, damit vier Agenten nicht viermal Stripe fragen) ----------
const memo = new Map<string, { at: number; v: Promise<KasseKennzahl> }>();
export function kasseKennzahl(stunden = 72, opts: { stripe?: boolean; trichterTage?: number } = {}): Promise<KasseKennzahl> {
  const tage = opts.trichterTage ?? Math.max(1, Math.round(stunden / 24));
  const key = `${stunden}:${tage}:${opts.stripe !== false}`, hit = memo.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.v;
  const v = (async (): Promise<KasseKennzahl> => {
    const [co, fu] = await Promise.all([opts.stripe === false ? null : stripeKasse(stunden).catch(() => null), trichter(tage).catch(() => null)]);
    const gestartet = co ? co.total : fu?.start ?? 0, bezahlt = co ? co.complete : fu?.back ?? 0, eigene = co?.own ?? 0;
    // Ohne Stripe-Daten kennt die Zählung keine Personen über Tage hinweg – dann zählen die Kassenstarts im Trichter.
    const personen = co ? co.people : fu?.start ?? 0;
    return { since: new Date(Date.now() - stunden * 36e5).toISOString(), stunden, geoeffnet: fu?.open ?? 0, gestartet, bezahlt, personen, davon_eigene: eigene, ...bewerte(personen, bezahlt, gestartet), hinweis: kasseHinweis(eigene), checkout: co, trichter: fu };
  })();
  memo.set(key, { at: Date.now(), v });
  v.catch(() => memo.delete(key));
  return v;
}
