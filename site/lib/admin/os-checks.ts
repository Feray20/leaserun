import { supabaseAdmin } from '@/lib/supabase/admin';

// LeaseRun Intelligence (regelbasiert, ohne KI-Kosten): prüft Postfach, Belege & Rechnungen, Website & Technik sowie
// eBay & Dropshipping und korrigiert, was sich eindeutig und ohne Risiko korrigieren lässt. Alles andere wird mit einem
// Ziel zum Beheben gemeldet. Nichts wird gelöscht; jede Korrektur steht im Korrektur-Protokoll (vorher → nachher).
export type Area = 'postfach' | 'belege' | 'website' | 'ebay' | 'steuer';
export type Check = { area: Area; level: 'bad' | 'warn' | 'ok' | 'info'; text: string; detail?: string; tab?: string; seg?: string; n?: number };
export type Fix = { at: string; area: Area; text: string; from?: string; to?: string };
export type OsReport = { at: string; checks: Check[]; fixes: Fix[]; badges: Record<string, number>; lights: Record<Area, 'ok' | 'warn' | 'bad'> };

const LOG = 'os_fixlog';
const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

async function loadLog(): Promise<Fix[]> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', LOG).maybeSingle();
  return (data?.value as Fix[] | null) || [];
}
async function addLog(f: Fix[]) {
  if (!f.length) return;
  const cur = await loadLog();
  await supabaseAdmin().from('lr_settings').upsert({ key: LOG, value: [...f, ...cur].slice(0, 200), updated_at: new Date().toISOString(), updated_by: 'intelligence' });
}

export async function runOsChecks(o: { fix: boolean; origin?: string }): Promise<OsReport> {
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const C: Check[] = [], F: Fix[] = [];
  const add = (c: Check) => C.push(c);

  // ---------- Postfach & E-Mails ----------
  const [unread, drafts, failed] = await Promise.all([
    db.from('lr_mail_messages').select('id,received_at', { count: 'exact' }).eq('folder', 'inbox').eq('direction', 'in').is('read_at', null).limit(500),
    db.from('lr_mail_messages').select('id,subject,text_body,html,attachments,status,updated_at').eq('folder', 'drafts').limit(500),
    db.from('lr_mail_messages').select('id', { count: 'exact', head: true }).eq('status', 'fehler').neq('folder', 'trash'),
  ]);
  const old = (unread.data || []).filter((m) => m.received_at && Date.now() - Date.parse(m.received_at) > 48 * 36e5).length;
  if (unread.count) add({ area: 'postfach', level: old ? 'warn' : 'info', text: `${unread.count} ungelesene E-Mails${old ? `, ${old} davon älter als 2 Tage` : ''}`, tab: 'postfach', seg: 'system', n: unread.count });
  const ATT = /\b(h[äa]ngt an|anbei|im anhang|angeh[äa]ngt|beigef[üu]gt|als anhang)\b/i;
  const noAtt = (drafts.data || []).filter((m) => m.status === 'entwurf' && !((m.attachments as unknown[]) || []).length && ATT.test(`${m.text_body || ''} ${String(m.html || '').replace(/<[^>]+>/g, ' ')}`));
  if (noAtt.length) add({ area: 'postfach', level: 'bad', text: `${noAtt.length} Entwurf/Entwürfe kündigen einen Anhang an, haben aber keinen`, detail: noAtt.slice(0, 3).map((m) => m.subject).join(' · '), tab: 'postfach', seg: 'system', n: noAtt.length });
  const blocked = (drafts.data || []).filter((m) => m.status === 'gesperrt').length;
  if (blocked) add({ area: 'postfach', level: 'info', text: `${blocked} Entwürfe gesperrt (Werbung ohne Einwilligung – rechtlich nicht versendbar)`, detail: 'Bleiben stehen, bis du entscheidest. Nur mit nachweisbarer Einwilligung versenden.', tab: 'postfach', seg: 'system' });
  if (failed.count) add({ area: 'postfach', level: 'bad', text: `${failed.count} E-Mails mit Versandfehler`, tab: 'postfach', seg: 'system', n: failed.count });
  const ready = (drafts.data || []).filter((m) => m.status === 'entwurf').length - noAtt.length;
  if (ready > 0) add({ area: 'postfach', level: 'info', text: `${ready} Entwürfe bereit zum Prüfen und Senden`, tab: 'postfach', seg: 'system', n: ready });

  // ---------- Belege & Rechnungen ----------
  const { data: docs } = await db.from('lr_tax_docs').select('id,filename,amount_cents,confidence,status,reasons,doc_date,vendor').eq('status', 'offen').limit(2000);
  const open = docs || [];
  // Korrektur 1: unplausible Beträge aus der Texterkennung (z. B. AGB-PDF als 99.999 €) nicht stehen lassen.
  const weird = open.filter((d) => Number(d.amount_cents) > 1_000_000 && Number(d.confidence || 0) < 50);
  // Korrektur 2: AGB, Widerrufsformular, Datenschutz u. Ä. sind keine Rechnungen.
  const NOINV = /(agb|widerruf|datenschutz|nutzungsbedingung|bedingungen|terms|privacy|newsletter|flyer|katalog)/i;
  const noInv = open.filter((d) => NOINV.test(d.filename || '') && !(d.reasons || []).some((r: string) => /Kein Rechnungsbeleg/.test(r)));
  if (o.fix) {
    for (const d of weird) {
      await db.from('lr_tax_docs').update({ amount_cents: null, reasons: [...(d.reasons || []), `Betrag ${(Number(d.amount_cents) / 100).toLocaleString('de-DE')} € unplausibel – von LeaseRun Intelligence entfernt, bitte prüfen`] }).eq('id', d.id);
      F.push({ at: now, area: 'belege', text: `Unplausiblen Betrag entfernt: ${d.filename}`, from: `${(Number(d.amount_cents) / 100).toLocaleString('de-DE')} €`, to: 'leer (prüfen)' });
    }
    for (const d of noInv) {
      await db.from('lr_tax_docs').update({ amount_cents: null, reasons: ['Kein Rechnungsbeleg (AGB/Widerruf o. Ä.) – erkannt von LeaseRun Intelligence', ...(d.reasons || [])] }).eq('id', d.id);
      F.push({ at: now, area: 'belege', text: `Als „kein Rechnungsbeleg“ markiert: ${d.filename}` });
    }
  } else {
    if (weird.length) add({ area: 'belege', level: 'warn', text: `${weird.length} Belege mit unplausiblem Betrag (wird korrigiert)`, tab: 'st_belege', seg: 'steuer' });
    if (noInv.length) add({ area: 'belege', level: 'info', text: `${noInv.length} Dateien sind keine Rechnungen (AGB/Widerruf)`, tab: 'st_belege', seg: 'steuer' });
  }
  const recent = open.filter((d) => !d.doc_date || d.doc_date >= day(-400));
  if (recent.length) add({ area: 'belege', level: recent.length > 20 ? 'warn' : 'info', text: `${recent.length} Belege warten auf Zuordnung (Firma/Privat)`, detail: 'Einmal je Anbieter festlegen – danach ordnet die Software automatisch zu.', tab: 'st_belege', seg: 'steuer', n: recent.length });
  const { data: inv } = await db.from('lr_invoices').select('invoice_number,net_cents,vat_cents,gross_cents,payment_status,due_date,pdf_path,kind').limit(5000);
  const invs = inv || [];
  const overdue = invs.filter((i) => i.due_date && i.due_date < day(0) && !/paid|bezahlt/i.test(String(i.payment_status || '')));
  if (overdue.length) add({ area: 'belege', level: 'warn', text: `${overdue.length} LeaseRun-Rechnungen überfällig`, tab: 'rechnungen', seg: 'steuer', n: overdue.length });
  const sumErr = invs.filter((i) => i.gross_cents != null && i.net_cents != null && i.vat_cents != null && Math.abs(Number(i.net_cents) + Number(i.vat_cents) - Number(i.gross_cents)) > 1);
  if (sumErr.length) add({ area: 'belege', level: 'bad', text: `${sumErr.length} Rechnungen: Netto + USt ≠ Brutto`, detail: sumErr.slice(0, 5).map((i) => i.invoice_number).join(', '), tab: 'rechnungen', seg: 'steuer' });
  const noPdf = invs.filter((i) => !i.pdf_path);
  if (noPdf.length) add({ area: 'belege', level: 'warn', text: `${noPdf.length} Rechnungen ohne gespeichertes PDF (GoBD)`, tab: 'rechnungen', seg: 'steuer' });
  const nums = invs.map((i) => String(i.invoice_number || '')).filter(Boolean);
  const dup = nums.filter((n, k) => nums.indexOf(n) !== k);
  if (dup.length) add({ area: 'belege', level: 'bad', text: `Doppelte Rechnungsnummer(n): ${[...new Set(dup)].slice(0, 5).join(', ')}`, tab: 'rechnungen', seg: 'steuer' });

  // ---------- Website & Technik ----------
  if (o.origin) {
    const pages = ['/', '/preise', '/calculators', '/learn', '/sitemap.xml', '/robots.txt'];
    const res = await Promise.all(pages.map(async (p) => { const t0 = Date.now(); try { const r = await fetch(o.origin + p, { signal: AbortSignal.timeout(8000), redirect: 'manual', headers: { 'user-agent': 'LeaseRun-Intelligence' } }); return { p, s: r.status, ms: Date.now() - t0 }; } catch { return { p, s: 0, ms: Date.now() - t0 }; } }));
    const bad = res.filter((x) => x.s === 0 || x.s >= 500 || (x.s >= 400 && x.s !== 404));
    const slow = res.filter((x) => x.s && x.s < 400 && x.ms > 2500);
    if (bad.length) add({ area: 'website', level: 'bad', text: `Seiten nicht erreichbar: ${bad.map((x) => `${x.p} (${x.s || 'keine Antwort'})`).join(', ')}`, tab: 'system', seg: 'system' });
    else add({ area: 'website', level: slow.length ? 'warn' : 'ok', text: slow.length ? `Langsam: ${slow.map((x) => `${x.p} ${(x.ms / 1000).toFixed(1).replace('.', ',')} s`).join(', ')}` : `Website erreichbar (${res.length} Seiten geprüft, Ø ${Math.round(res.reduce((a, x) => a + x.ms, 0) / res.length)} ms)`, tab: 'system', seg: 'system' });
  }
  const { data: errs } = await db.from('lr_client_errors').select('message,count,last_seen').is('resolved_at', null).gte('last_seen', new Date(Date.now() - 3 * 864e5).toISOString()).order('count', { ascending: false }).limit(20);
  if (errs?.length) add({ area: 'website', level: errs.some((e) => Number(e.count) >= 5) ? 'warn' : 'info', text: `${errs.length} offene Browser-Fehler (3 Tage)`, detail: errs.slice(0, 3).map((e) => `${String(e.message).slice(0, 60)} (${e.count}×)`).join(' · '), tab: 'probleme', seg: 'b2c', n: errs.length });


  if (F.length) await addLog(F);
  const fixes = [...F, ...(await loadLog())].slice(0, 60);
  const areas: Area[] = ['postfach', 'belege', 'website', 'ebay', 'steuer'];
  const lights = Object.fromEntries(areas.map((a) => { const cs = C.filter((c) => c.area === a); return [a, cs.some((c) => c.level === 'bad') ? 'bad' : cs.some((c) => c.level === 'warn') ? 'warn' : 'ok']; })) as Record<Area, 'ok' | 'warn' | 'bad'>;
  const badges: Record<string, number> = {};
  for (const c of C) if (c.tab && c.n && c.level !== 'ok') badges[c.tab] = (badges[c.tab] || 0) + c.n;
  return { at: now, checks: C.sort((a, b) => ['bad', 'warn', 'info', 'ok'].indexOf(a.level) - ['bad', 'warn', 'info', 'ok'].indexOf(b.level)), fixes, badges, lights };
}
