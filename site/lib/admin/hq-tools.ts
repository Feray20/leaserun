import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { INTENTS } from '@/lib/admin/hq-brain';
import { analyse, applyFixes, type Area } from '@/lib/admin/fixer';
import { webhookSelfTest } from '@/lib/admin/livecheck';
import { syncReceivedDetailed } from '@/lib/mail/ingest';
import { kundenReport, loadKundenReport, ownEmails, type CheckoutInsight } from '@/lib/admin/kundenreise';
import { loadOptimizer, runOptimizer } from '@/lib/admin/optimizer';
import { loadMarketing, marketingIdeas, marketingPages, marketingSources, marketingSummary, runMarketing } from '@/lib/admin/marketing';
import { mailboxAddress } from '@/lib/mail/resend';
import { snippetOf } from '@/lib/mail/store';
import { htmlToText, sanitizeBody } from '@/lib/mail/template';
import { ctaFromLabel, extractCta, parseCta, type Cta } from '@/lib/mail/cta';
import { pushAdmins } from '@/lib/admin/push';
import { legalChecks } from '@/lib/mail/legal-gate';
import { addProposal, loadProposals, loadShift } from '@/lib/admin/hq-store';
import { AGENT_NAMES } from '@/lib/admin/hq-agents';
import type { Tool } from '@/lib/admin/hq-ai';

// Werkzeuge der Agenten. Drei Arten:
//  lesen     – Live-Daten abfragen (alle Agenten)
//  erledigen – Internes sofort tun (nur sichere Aktionen, die auch die Knöpfe im Web-Admin auslösen)
//  vorschlagen – alles, was nach außen ginge: nur als Entwurf oder Vorschlag anlegen, Feray gibt frei
type Ctx = { actor: string; origin: string; agent: string };
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] || c);
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
// Kasse mit Gesamtzahl und bereinigter Zahl nebeneinander: „gesamt“ alle Sitzungen, „extern“ ohne Admin-Konten, Testkonten und Stripe-Testmodus.
const kasseMitExtern = (co: CheckoutInsight | null | undefined) => (co ? { ...co, gesamt: co.total + co.own, extern: co.total, intern: co.own } : null);

const read = (c: Ctx): Tool[] => [
  {
    name: 'daten_abfragen', description: 'Live-Zahlen aus LeaseRun zu einem Thema (Umsatz, Besucher, Nutzer, Unternehmen, Termine, Tickets, Website-Fehler, Sicherheit, Creator, Newsletter, Akquise, Marketing, Käufe/Abos, Abrechnungsstand je Abo/Unternehmenskonto, Kundenprobleme, Vorschläge/Bewertungen). Zeitraum in Alltagssprache, z. B. „heute“, „diese Woche“, „30 Tage“.',
    input_schema: { type: 'object', properties: { thema: { type: 'string', enum: INTENTS.filter((i) => i.id !== 'suche').map((i) => i.id) }, zeitraum: { type: 'string' } }, required: ['thema'] },
    run: async (i) => { const it = INTENTS.find((x) => x.id === i.thema); if (!it) throw new Error('Unbekanntes Thema'); const t = `${i.thema} ${String(i.zeitraum || '')}`.toLowerCase(); const r = await it.run(t, t); return r.daten !== undefined ? { antwort: r.reply, daten: r.daten } : r; },
  },
  {
    name: 'suchen', description: 'Person, Firma oder E-Mail-Adresse in Kontakten, Unternehmenskonten, Postfach und Terminen suchen.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: async (i) => INTENTS.find((x) => x.id === 'suche')!.run(`suche ${String(i.text)}`, `Suche ${String(i.text)}`),
  },
  {
    name: 'befunde_lesen', description: 'Aktuelle Befunde der Prüfstelle (Sicherheit, E-Mail, Technik, Betrieb) mit Kennung, Schwere, ob automatisch behebbar, und Anleitung.',
    input_schema: { type: 'object', properties: { bereich: { type: 'string', enum: ['Sicherheit', 'E-Mail', 'Technik', 'Betrieb'] } } },
    run: async (i) => { const r = await analyse({ areas: i.bereich ? [i.bereich as Area] : undefined, origin: c.origin }); return r.findings.map((f) => ({ id: f.id, bereich: f.area, schwere: f.sev, titel: f.title, detail: f.detail, automatisch: f.auto, anleitung: f.how })); },
  },
  {
    name: 'agenten_stand', description: 'Letzter Stand aller Abteilungen (Status, Zeile, offene Punkte) – für Zusammenhänge und Prioritäten.',
    input_schema: { type: 'object', properties: {} },
    run: async () => { const s = await loadShift(); return Object.values(s).map((r) => ({ agent: AGENT_NAMES[r.id] || r.id, status: r.status, zeile: r.line.slice(0, 300), punkte: (r.issues || []).slice(0, 8).map((x) => `${x.level}: ${x.title}`) })); },
  },
  {
    name: 'website_befunde', description: 'Befunde der letzten Website-Prüfung von Noah (Tempo, SEO, Links, Inhalte, Darstellung).',
    input_schema: { type: 'object', properties: {} },
    run: async () => { const r = await loadOptimizer(); return r ? { geprueft: r.at, seiten: r.pages, befunde: r.findings.slice(0, 25).map((f) => ({ id: f.id, bereich: f.area, schwere: f.level, titel: f.title, detail: f.detail })), selbstErledigt: r.fixed } : 'Noch keine Prüfung gelaufen.'; },
  },
  {
    name: 'kunden_befunde', description: 'Befunde der Kundenreise (Fehler, die Kunden gesehen haben, Formulare, Kasse, Abbrüche) aus der letzten Prüfung.',
    input_schema: { type: 'object', properties: {} },
    run: async () => { const r = await loadKundenReport(); return r ? { geprueft: r.at, kasse: kasseMitExtern(r.checkout), trichter: r.funnel, befunde: r.issues.slice(0, 20), selbstErledigt: r.fixed } : 'Noch keine Prüfung gelaufen.'; },
  },
  {
    name: 'marketing_bericht', description: 'Marketing-Auswertung (Reichweite, Quellen, meistgelesene Seiten, Ideen, Entwürfe) aus der letzten Prüfung.',
    input_schema: { type: 'object', properties: { teil: { type: 'string', enum: ['zusammenfassung', 'ideen', 'quellen', 'seiten'] } } },
    run: async (i) => { const r = (await loadMarketing()) || (await runMarketing(7)); const t = String(i.teil || 'zusammenfassung'); return t === 'ideen' ? marketingIdeas(r) : t === 'quellen' ? marketingSources(r) : t === 'seiten' ? marketingPages(r) : marketingSummary(r); },
  },
  {
    name: 'protokoll_lesen', description: 'Was zuletzt im Web-Admin getan wurde (Ferays Aktionen und die der Agenten): Aktion, Zeitpunkt, Ziel. Für „was habe ich gemacht“ und um nichts doppelt vorzuschlagen.',
    input_schema: { type: 'object', properties: { anzahl: { type: 'number' } } },
    run: async (i) => { const { data } = await supabaseAdmin().from('lr_admin_audit').select('action, target, meta, created_at').order('created_at', { ascending: false }).limit(Math.min(Number(i.anzahl) || 30, 60)); return (data ?? []).map((r) => ({ am: r.created_at, aktion: r.action, ziel: r.target && !String(r.target).startsWith('ps:') ? r.target : undefined, details: r.meta })); },
  },
  {
    name: 'vorschlaege_lesen', description: 'Offene Vorschläge, die auf Ferays Freigabe warten.',
    input_schema: { type: 'object', properties: {} },
    run: async () => (await loadProposals()).filter((p) => p.status === 'offen').slice(0, 20).map((p) => ({ id: p.id, von: AGENT_NAMES[p.agent] || p.agent, art: p.kind, titel: p.title, seit: p.at })),
  },
];

const act = (c: Ctx, areas: Area[]): Tool[] => [
  {
    name: 'befund_erledigen', description: `Automatisch behebbare Befunde (Kennungen aus befunde_lesen) jetzt erledigen – nur Bereiche ${areas.join(', ')}. Prüft danach selbst, ob der Punkt weg ist.`,
    input_schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
    run: async (i) => { const ids = (i.ids as string[] | undefined) || []; if (!ids.length) throw new Error('Keine Kennung'); const r = await applyFixes(c.actor, { ids, areas, origin: c.origin }); return r.results.length ? r.results.map((x) => `${x.ok ? '✓' : '✗'} ${x.text}`) : 'Nichts davon ist automatisch behebbar.'; },
  },
];
const mail = (): Tool[] => [
  { name: 'emails_abholen', description: 'Neue E-Mails bei Resend abholen und ins Postfach legen.', input_schema: { type: 'object', properties: {} }, run: async () => { const s = await syncReceivedDetailed(50); return s.ok ? `${s.fetched || 0} neue E-Mails abgeholt.` : `Fehler: ${s.error}`; } },
  {
    name: 'emails_lesen', description: 'Ungelesene oder neueste eingegangene E-Mails lesen (Betreff, Absender, Anfang des Textes). Nur Posteingang, keine Anhänge.',
    input_schema: { type: 'object', properties: { nur_ungelesen: { type: 'boolean' }, anzahl: { type: 'number' } } },
    run: async (i) => { let q = supabaseAdmin().from('lr_mail_messages').select('id, subject, from_email, from_name, received_at, text_body, read_at').eq('direction', 'in').eq('folder', 'inbox').order('received_at', { ascending: false }).limit(Math.min(Number(i.anzahl) || 10, 25)); if (i.nur_ungelesen !== false) q = q.is('read_at', null); const { data } = await q; return (data ?? []).map((m) => ({ id: m.id, betreff: m.subject, von: m.from_name || m.from_email, am: m.received_at, text: String(m.text_body || '').slice(0, 700) })); },
  },
];
// Entwürfe im Postfach sichten und ordnen (nichts wird gesendet oder gelöscht – Archivieren = Ordner „Archiv“, jederzeit zurückholbar).
// Gemeinsame Logik für das Werkzeug und die Paket-Ansicht im Web-Admin (Ava · Freigaben).
// Je Entwurf: „Werbung“ oder „Transaktion/Antwort“ und Rechtsgrundlage (lib/mail/legal-gate.ts). Gesperrte Entwürfe
// (ohne Rechtsgrundlage) stehen mit Grund in der Liste und sind nicht sendbar.
type DraftRow = { id: string; an: string; betreff: string; vorschau: string; erstellt: string; alter_tage: number; herkunft: string; doppel: string | null; art: 'Werbung' | 'Transaktion/Antwort'; grundlage: string; sendbar: boolean; grund: string | null };
export async function listDrafts(max = 500): Promise<DraftRow[]> {
  const { data } = await supabaseAdmin().from('lr_mail_messages').select('id, to_emails, cc_emails, bcc_emails, subject, snippet, text_body, created_at, source, status, error, in_reply_to, with_unsub, design, cta').eq('direction', 'out').eq('folder', 'drafts').in('status', ['entwurf', 'gesperrt']).order('created_at', { ascending: true }).limit(Math.min(Math.max(1, max), 1000));
  const rows = data ?? [];
  const checks = await legalChecks(rows as never[]).catch(() => null);
  const first = new Map<string, string>();
  return rows.map((r) => {
    const to = (r.to_emails as string[] | null) || [], k = `${String(to[0] || '').toLowerCase()}|${String(r.subject || '').toLowerCase().trim()}`, dup = first.get(k);
    if (!dup) first.set(k, r.id as string);
    const c = checks?.get(r.id as string), locked = r.status === 'gesperrt';
    // Nicht prüfbar (z. B. Datenbank kurz weg) = vorsichtshalber „fehlt“.
    const grundlage = !c ? 'fehlt (nicht prüfbar)' : c.basis === 'einwilligung' ? `Einwilligung vom ${new Date(c.consentAt as string).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}` : c.basis === 'bestandskunde' ? 'Bestandskunde' : c.basis === 'antwort' ? 'Antwort/Transaktion' : 'fehlt';
    return { id: r.id as string, an: to.join(', ') || '(ohne Empfänger)', betreff: String(r.subject || ''), vorschau: String(r.snippet || '').slice(0, 200), erstellt: r.created_at as string, alter_tage: Math.floor((Date.now() - new Date(r.created_at as string).getTime()) / 864e5), herkunft: (r.source as string | null) || 'manuell', doppel: dup || null,
      art: c?.kind === 'transaktion' ? 'Transaktion/Antwort' : 'Werbung', grundlage: locked && c?.basis !== 'fehlt' ? `${grundlage} · gesperrt` : grundlage, sendbar: Boolean(c && c.basis !== 'fehlt' && !locked), grund: locked ? String(r.error || 'gesperrt').replace(/^Gesperrt:\s*/, '').slice(0, 160) : c?.reason || null };
  });
}
// Pakete nach Herkunft + Erstellungstag (deutsche Zeit), z. B. „gmail-entwurf, 24.10.2026, 58 Stück“ – neueste zuerst.
export async function draftPackets() {
  const rows = await listDrafts(1000), map = new Map<string, { herkunft: string; tag: string; entwuerfe: DraftRow[] }>();
  for (const r of rows) {
    const tag = new Date(r.erstellt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }), k = `${r.herkunft}|${tag}`;
    if (!map.has(k)) map.set(k, { herkunft: r.herkunft, tag, entwuerfe: [] });
    map.get(k)!.entwuerfe.push(r);
  }
  return { anzahl: rows.length, pakete: [...map.values()].sort((a, b) => b.tag.localeCompare(a.tag) || a.herkunft.localeCompare(b.herkunft)) };
}
// Verschieben in „Archiv“ – nur echte, ungesendete Entwürfe; nichts wird gesendet oder gelöscht.
export async function archiveDrafts(rawIds: unknown, actor: string, meta: { agent: string; grund: string }, max = 50): Promise<number> {
  const ids = ((Array.isArray(rawIds) ? rawIds : []) as unknown[]).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, max);
  if (!ids.length) throw new Error('Keine gültigen Kennungen');
  const r = await supabaseAdmin().from('lr_mail_messages').update({ folder: 'archive', updated_at: new Date().toISOString() }).in('id', ids).eq('direction', 'out').eq('folder', 'drafts').in('status', ['entwurf', 'gesperrt']).select('id');
  if (r.error) throw new Error('Archivieren fehlgeschlagen');
  await adminAudit(actor, 'hq_drafts_archive', null, { agent: meta.agent, count: r.data?.length || 0, grund: meta.grund.slice(0, 120) });
  return r.data?.length || 0;
}
const drafts = (c: Ctx): Tool[] => [
  {
    name: 'entwuerfe_lesen', description: 'E-Mail-Entwürfe im Postfach (Ordner Entwürfe), seitenweise: Kennung, Empfänger, Betreff, Alter in Tagen, Herkunft und „doppel“ (Kennung des ersten Entwurfs mit gleichem Empfänger + Betreff, sonst null). „ab“ = Startposition (Standard 0), „anzahl“ = Einträge pro Seite (Standard 30, höchstens 100). Ist „weiter_ab“ gesetzt, gibt es weitere Einträge – dann mit ab = weiter_ab erneut lesen.',
    input_schema: { type: 'object', properties: { ab: { type: 'number' }, anzahl: { type: 'number' } } },
    run: async (i) => {
      // Doppel werden über alle Entwürfe bestimmt, nicht nur über die aktuelle Seite.
      const rows = await listDrafts(1000), ab = Math.max(0, Math.floor(Number(i.ab) || 0)), per = Math.min(Math.max(1, Math.floor(Number(i.anzahl) || 30)), 100);
      const page = rows.slice(ab, ab + per);
      return { anzahl: rows.length, ab, weiter_ab: ab + per < rows.length ? ab + per : null, entwuerfe: page.map((r) => ({ id: r.id, an: r.an, betreff: r.betreff, alter_tage: r.alter_tage, herkunft: r.herkunft, doppel: r.doppel, art: r.art, rechtsgrundlage: r.grundlage, sendbar: r.sendbar })) };
    },
  },
  {
    name: 'entwuerfe_archivieren', description: 'Entwürfe in den Ordner „Archiv“ verschieben (z. B. Doppel oder veraltete). Nichts wird gesendet oder gelöscht; Feray kann sie im Postfach zurückholen. Höchstens 50 auf einmal.',
    input_schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, grund: { type: 'string' } }, required: ['ids', 'grund'] },
    run: async (i) => {
      const n = await archiveDrafts(i.ids, c.actor, { agent: c.agent, grund: String(i.grund || '') });
      return `${n} Entwürfe ins Archiv verschoben (im Postfach unter „Archiv“ jederzeit zurückholbar).`;
    },
  },
];
// Entwürfe lesen und überarbeiten – bleiben Entwürfe (nichts wird gesendet). Vorher wird die alte Fassung gesichert
// (lr_settings „draft_backup“), damit nichts verloren geht. Signatur und Fußzeile setzt das Postfach beim Senden selbst.
const draftEdit = (c: Ctx): Tool[] => [
  {
    name: 'entwurf_lesen', description: 'Einen E-Mail-Entwurf vollständig lesen (Empfänger, Betreff, ganzer Text).',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: async (i) => { const { data } = await supabaseAdmin().from('lr_mail_messages').select('id, to_emails, subject, text_body, design, with_unsub').eq('id', String(i.id)).eq('direction', 'out').eq('status', 'entwurf').maybeSingle(); if (!data) throw new Error('Entwurf nicht gefunden'); return { id: data.id, an: data.to_emails, betreff: data.subject, werbung_mit_abmeldelink: data.with_unsub, text: String(data.text_body || '').slice(0, 6000) }; },
  },
  {
    name: 'entwurf_verbessern', description: 'Einen E-Mail-Entwurf überarbeiten: neuer Betreff und/oder neuer Text. Er bleibt Entwurf und geht nicht raus. Den Text OHNE Signatur und Fußzeile schreiben (endet mit der Grußformel, z. B. „Viele Grüße“) – Signatur, Logo, Impressum und Abmeldelink fügt das Postfach automatisch an. Absätze durch Leerzeilen. Die alte Fassung wird gesichert.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, betreff: { type: 'string' }, text: { type: 'string' }, was_geaendert: { type: 'string' } }, required: ['id', 'text', 'was_geaendert'] },
    run: async (i) => {
      const db = supabaseAdmin();
      const { data: m } = await db.from('lr_mail_messages').select('id, subject, html, text_body, design, cta').eq('id', String(i.id)).eq('direction', 'out').eq('status', 'entwurf').maybeSingle();
      if (!m) throw new Error('Entwurf nicht gefunden');
      const raw = String(i.text || '').trim().slice(0, 8000);
      if (raw.length < 40) throw new Error('Text zu kurz');
      const { data: bk } = await db.from('lr_settings').select('value').eq('key', 'draft_backup').maybeSingle();
      const backup = { ...((bk?.value as Record<string, unknown>) || {}) };
      if (!backup[m.id as string]) backup[m.id as string] = { at: new Date().toISOString(), subject: m.subject, html: m.html, text_body: m.text_body, design: m.design };
      await db.from('lr_settings').upsert({ key: 'draft_backup', value: backup, updated_at: new Date().toISOString(), updated_by: `hq-${c.agent}` });
      const html = sanitizeBody(raw.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));
      const text = htmlToText(html);
      const subject = i.betreff ? String(i.betreff).trim().slice(0, 300) : (m.subject as string);
      // Knopf des gestalteten Entwurfs übernehmen – sonst ginge er beim Umstellen auf Brief-Layout verloren.
      const cta = parseCta(m.cta) || (m.design === 'fertig' ? extractCta(String(m.html || '')) : null);
      const u = await db.from('lr_mail_messages').update({ subject, html, text_body: text, snippet: snippetOf(text), design: 'frei', cta, updated_at: new Date().toISOString() }).eq('id', m.id).eq('status', 'entwurf');
      if (u.error) throw new Error('Speichern fehlgeschlagen');
      await adminAudit(c.actor, 'hq_draft_edit', null, { agent: c.agent, was: String(i.was_geaendert || '').slice(0, 160) });
      return `Entwurf überarbeitet (alte Fassung gesichert). Geändert: ${String(i.was_geaendert || '').slice(0, 160)}`;
    },
  },
];
const reviewTool = (c: Ctx): Tool[] => [
  {
    name: 'entwuerfe_alle_ueberarbeiten', description: 'Alle wartenden E-Mail-Entwürfe im Hintergrund überarbeiten lassen (in Paketen, Fortschritt in Avas Karte). Nichts wird gesendet, Originale werden gesichert. Optional ein Wunsch von Feray, worauf besonders zu achten ist.',
    input_schema: { type: 'object', properties: { wunsch: { type: 'string' } } },
    run: async (i) => { const { startReview } = await import('@/lib/admin/hq-think'); const r = await startReview(c.agent === 'postfach' ? 'postfach' : 'freigaben', i.wunsch ? String(i.wunsch).slice(0, 300) : undefined); return `Überarbeitung gestartet: ${r.total} Entwürfe, ${r.done.length} bereits geprüft. Läuft im Hintergrund (etwa alle 5 Minuten ein Paket).`; },
  },
];
// Zoe · Akquise: Kontakte anlegen/fortschreiben und Wiedervorlagen setzen (intern, nichts wird gesendet oder gelöscht).
const KINDS = ['bank', 'vermittler', 'makler', 'finanzberater', 'sonstige'], STATI = ['neu', 'angeschrieben', 'angerufen', 'interesse', 'termin', 'kunde', 'kein_interesse', 'widerspruch'];
const akquise = (c: Ctx): Tool[] => [
  {
    name: 'akquise_kontakt_anlegen', description: 'Akquise-Kontakt anlegen oder (bei gleicher E-Mail) fortschreiben. Typ: bank, vermittler, makler, finanzberater, sonstige. Status: neu, angeschrieben, angerufen, interesse, termin, kunde, kein_interesse, widerspruch. Optional Wiedervorlage (JJJJ-MM-TT) und Notiz.',
    input_schema: { type: 'object', properties: { firma: { type: 'string' }, ansprechpartner: { type: 'string' }, email: { type: 'string' }, typ: { type: 'string', enum: KINDS }, status: { type: 'string', enum: STATI }, quelle: { type: 'string' }, wiedervorlage: { type: 'string' }, notiz: { type: 'string' } }, required: ['firma'] },
    run: async (i) => {
      const db = supabaseAdmin(), now = new Date().toISOString(), email = String(i.email || '').trim().toLowerCase();
      if (email && !EMAIL.test(email)) throw new Error('Ungültige E-Mail-Adresse');
      const next = /^\d{4}-\d{2}-\d{2}$/.test(String(i.wiedervorlage || '')) ? `${i.wiedervorlage}T08:00:00+01:00` : undefined;
      const row: Record<string, unknown> = { company: String(i.firma).slice(0, 160), ...(i.ansprechpartner ? { contact_name: String(i.ansprechpartner).slice(0, 120) } : {}), ...(KINDS.includes(String(i.typ)) ? { kind: i.typ } : {}), ...(STATI.includes(String(i.status)) ? { status: i.status } : {}), ...(next ? { next_at: next } : {}), updated_at: now };
      const { data: have } = email ? await db.from('lr_crm_contacts').select('id').ilike('email', email).limit(1) : { data: [] as { id: string }[] };
      let id = have?.[0]?.id as string | undefined;
      if (id) { const u = await db.from('lr_crm_contacts').update(row).eq('id', id); if (u.error) throw new Error('Speichern fehlgeschlagen'); }
      else { const n = await db.from('lr_crm_contacts').insert({ kind: 'sonstige', status: 'neu', source: String(i.quelle || `Headquarters (${c.agent})`).slice(0, 120), ...(email ? { email } : {}), ...row }).select('id').single(); if (n.error || !n.data) throw new Error('Anlegen fehlgeschlagen'); id = n.data.id as string; }
      if (i.notiz) await db.from('lr_crm_activities').insert({ contact_id: id, type: 'notiz', note: String(i.notiz).slice(0, 1000), actor: `hq-${c.agent}` });
      await adminAudit(c.actor, 'akquise_kontakt', null, { agent: c.agent, neu: !have?.length });
      return `${have?.length ? 'Kontakt aktualisiert' : 'Kontakt angelegt'}${next ? `, Wiedervorlage ${i.wiedervorlage}` : ''}.`;
    },
  },
  {
    name: 'akquise_wiedervorlage_setzen', description: 'Wiedervorlage für einen Akquise-Kontakt setzen (per E-Mail-Adresse oder Firmenname). Datum JJJJ-MM-TT.',
    input_schema: { type: 'object', properties: { email: { type: 'string' }, firma: { type: 'string' }, datum: { type: 'string' }, grund: { type: 'string' } }, required: ['datum'] },
    run: async (i) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(i.datum))) throw new Error('Datum als JJJJ-MM-TT');
      const db = supabaseAdmin();
      let q = db.from('lr_crm_contacts').select('id, company').limit(2);
      if (i.email) q = q.ilike('email', String(i.email).trim()); else if (i.firma) q = q.ilike('company', `%${String(i.firma).replace(/[%,()]/g, ' ').trim()}%`); else throw new Error('E-Mail oder Firma nötig');
      const { data } = await q;
      if (!data?.length) throw new Error('Kontakt nicht gefunden');
      if (data.length > 1 && !i.email) throw new Error(`Mehrere Treffer (${data.map((d) => d.company).join(', ')}) – bitte E-Mail angeben`);
      await db.from('lr_crm_contacts').update({ next_at: `${i.datum}T08:00:00+01:00`, updated_at: new Date().toISOString() }).eq('id', data[0].id);
      if (i.grund) await db.from('lr_crm_activities').insert({ contact_id: data[0].id, type: 'notiz', note: `Wiedervorlage ${i.datum}: ${String(i.grund).slice(0, 500)}`, actor: `hq-${c.agent}` });
      await adminAudit(c.actor, 'akquise_wiedervorlage', null, { agent: c.agent });
      return `Wiedervorlage für ${data[0].company} am ${i.datum} gesetzt.`;
    },
  },
];
// Liam · Bestandskunden: Zugänge, Ablauf, Kündigungen, letzte Anmeldung, Erstattungen (nur lesen).
const bestand = (): Tool[] => [
  {
    name: 'bestand_lesen', description: 'Übersicht aller Kunden mit Zugang: Tarif, Ablauf, Kündigung vorgemerkt, Zahlungsproblem, letzte Anmeldung (Tage), eigenes Testkonto ja/nein; dazu Erstattungen und Rückbuchungen der letzten 90 Tage. Fehlende Werte als „nicht verfügbar“.',
    input_schema: { type: 'object', properties: {} },
    run: async () => {
      const db = supabaseAdmin(), now = Date.now(), D = 864e5;
      const admins = ownEmails();
      const { data: ent } = await db.from('lr_entitlements').select('user_id, plan, status, valid_until, created_at').limit(500);
      const rows = await Promise.all((ent ?? []).slice(0, 150).map(async (e) => {
        const u = await db.auth.admin.getUserById(e.user_id as string).then((r) => r.data.user, () => null);
        const last = u?.last_sign_in_at ? Math.floor((now - new Date(u.last_sign_in_at).getTime()) / D) : null;
        return { tarif: e.plan, status: e.status, seit: String(e.created_at || '').slice(0, 10), ablauf: e.valid_until ? String(e.valid_until).slice(0, 10) : 'nicht verfügbar', tage_bis_ablauf: e.valid_until ? Math.ceil((new Date(e.valid_until as string).getTime() - now) / D) : null, letzte_anmeldung_vor_tagen: last ?? 'nicht verfügbar', testkonto: admins.has(String(u?.email || '').toLowerCase()) };
      }));
      let abos: unknown = 'nicht verfügbar', erstattungen: unknown = 'nicht verfügbar';
      if (process.env.STRIPE_SECRET_KEY) {
        try {
          const { stripe } = await import('@/lib/billing/stripe');
          const [subs, refunds, disputes] = await Promise.all([stripe().subscriptions.list({ status: 'all', limit: 100 }), stripe().refunds.list({ created: { gte: Math.floor((now - 90 * D) / 1000) }, limit: 100 }), stripe().disputes.list({ created: { gte: Math.floor((now - 90 * D) / 1000) }, limit: 100 })]);
          abos = { aktiv: subs.data.filter((x) => x.status === 'active').length, kuendigung_vorgemerkt: subs.data.filter((x) => x.cancel_at_period_end || x.cancel_at).length, zahlungsproblem: subs.data.filter((x) => ['past_due', 'unpaid'].includes(x.status)).length };
          erstattungen = { erstattungen_90_tage: refunds.data.map((r) => ({ am: new Date(r.created * 1000).toISOString().slice(0, 10), betrag_eur: r.amount / 100, grund: r.reason || 'ohne Angabe' })), rueckbuchungen_90_tage: disputes.data.length };
        } catch (e) { abos = `nicht verfügbar (${(e as Error).message.slice(0, 80)})`; }
      }
      const real = rows.filter((r) => !r.testkonto);
      return { zusammenfassung: { zugaenge: real.length, laufen_in_14_tagen_aus: real.filter((r) => r.tage_bis_ablauf != null && r.tage_bis_ablauf >= 0 && r.tage_bis_ablauf <= 14).length, still_seit_21_tagen: real.filter((r) => r.status === 'active' && typeof r.letzte_anmeldung_vor_tagen === 'number' && r.letzte_anmeldung_vor_tagen >= 21).length }, abos, erstattungen, kunden: rows.slice(0, 60) };
    },
  },
];
const tech = (c: Ctx): Tool[] => [
  { name: 'webhook_testen', description: 'Stripe-Zahlungs-Webhook live testen.', input_schema: { type: 'object', properties: {} }, run: async () => { const r = await webhookSelfTest(c.origin); return `${r.label}: ${r.state} – ${r.info}`; } },
];
const kunden = (): Tool[] => [
  { name: 'kunden_pruefen', description: 'Kundenreise jetzt frisch prüfen (Fehler, Formulare, Kasse, Abbrüche); Harmloses wird dabei selbst erledigt.', input_schema: { type: 'object', properties: {} }, run: async () => { const r = await kundenReport(); return { kasse: kasseMitExtern(r.checkout), trichter: r.funnel, befunde: r.issues.slice(0, 20), selbstErledigt: r.fixed }; } },
];
const site = (c: Ctx): Tool[] => [
  { name: 'website_pruefen', description: 'Website jetzt komplett prüfen (dauert bis zu 20 Sekunden); Internes wird dabei selbst erledigt.', input_schema: { type: 'object', properties: {} }, run: async () => { const r = await runOptimizer(c.origin); return { seiten: r.pages, befunde: r.findings.slice(0, 25).map((f) => `${f.level}: ${f.title} – ${f.detail}`), selbstErledigt: r.fixed }; } },
];
const propose = (c: Ctx): Tool[] => [
  {
    name: 'email_entwurf_anlegen', description: 'E-Mail als Entwurf ins Postfach legen (geht NICHT raus – Feray sendet sie dort). Text in Alltagssprache, höflich, ohne Floskeln; Signatur und Fußzeile kommen automatisch dazu. Bei Akquise/Werbung PFLICHT: quelle_url = öffentliche Seite, auf der genau diese Adresse steht (meist Impressum/Kontakt), und recherche = 2–3 Sätze in eigenen Worten (wer, Thema/Zielgruppe, warum passend). Beides sieht nur Feray im Postfach, es wird nie mitgesendet.',
    input_schema: { type: 'object', properties: { an: { type: 'string', description: 'E-Mail-Adresse' }, betreff: { type: 'string' }, text: { type: 'string', description: 'Reiner Text, Absätze durch Leerzeilen' }, werbung: { type: 'boolean', description: 'true, wenn werblich (dann Abmeldelink Pflicht)' }, quelle_url: { type: 'string', description: 'https-Link zur Seite, auf der die Adresse öffentlich steht' }, recherche: { type: 'string', description: 'Kurz-Recherche, 2–3 Sätze' }, adresse_bestaetigt: { type: 'boolean', description: 'false, wenn die Adresse auf der Quelle nicht wörtlich steht' }, knopf: { type: 'string', enum: ['Termin vorschlagen', 'Kurz antworten', 'Zugang schicken', 'Zugang anfordern', 'Unterlagen anfordern', 'Zahlen anfordern', 'Muster anfordern', 'Gliederung anfordern', 'Thema auswählen'], description: 'Knopf unter dem Text – öffnet die passende Seite (Termin über Teams bzw. Anfrage-Seite). Bei Akquise Pflicht.' }, anrede: { type: 'string', enum: ['sie', 'du', 'ihr'], description: 'Wie der Empfänger im Text angesprochen wird' } }, required: ['an', 'betreff', 'text'] },
    run: async (i) => {
      const to = String(i.an || '').trim().toLowerCase();
      if (!EMAIL.test(to)) throw new Error('Keine gültige E-Mail-Adresse');
      const subject = String(i.betreff || '').trim().slice(0, 300), raw = String(i.text || '').trim().slice(0, 8000);
      if (!subject || raw.length < 10) throw new Error('Betreff und Text nötig');
      const quelle = String(i.quelle_url || '').trim().slice(0, 600), recherche = String(i.recherche || '').trim().slice(0, 1200);
      if (quelle && !/^https:\/\/[^\s"<>]+$/.test(quelle)) throw new Error('quelle_url muss ein https-Link sein');
      if (i.werbung !== false && (!quelle || recherche.length < 40)) throw new Error('Für Akquise-Entwürfe bitte quelle_url (Fundstelle der Adresse) und recherche (2–3 Sätze) mitgeben.');
      const kc = i.knopf ? ctaFromLabel(String(i.knopf)) : null;
      if (i.werbung !== false && !kc) throw new Error('Für Akquise-Entwürfe bitte einen knopf wählen (z. B. „Termin vorschlagen“).');
      const cta: Cta | null = kc ? { ...kc, label: String(i.knopf), anrede: i.anrede === 'du' || i.anrede === 'ihr' ? i.anrede : 'sie' } : null;
      const research = { cta, research_url: quelle || null, research_summary: recherche || null, research_flag: i.adresse_bestaetigt === false ? 'Adresse nicht öffentlich bestätigt – vor Versand prüfen' : null, research_checked_at: quelle || recherche ? new Date().toISOString() : null };
      const html = sanitizeBody(raw.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));
      const id = randomUUID(), text = htmlToText(html), now = new Date().toISOString();
      const r = await supabaseAdmin().from('lr_mail_messages').insert({ id, thread_id: id, direction: 'out', folder: 'drafts', status: 'entwurf', design: 'frei', from_email: mailboxAddress(), attachments: [], to_emails: [to], cc_emails: [], bcc_emails: [], subject, html, text_body: text, snippet: snippetOf(text), with_unsub: i.werbung !== false, source: `hq-${c.agent}`, updated_at: now, ...research });
      if (r.error) throw new Error('Entwurf konnte nicht gespeichert werden');
      await adminAudit(c.actor, 'hq_draft', to, { agent: c.agent, subject: subject.slice(0, 80) });
      return `Entwurf gespeichert (Postfach → Entwürfe). Gesendet wird erst, wenn Feray dort auf „Senden“ tippt.`;
    },
  },
  {
    name: 'vorschlag_anlegen', description: 'Lösung für Feray hinterlegen. Sie sieht nur „Erledigen“ / „Verwerfen“; bei „Erledigen“ setzt ein Umsetzungs-Agent (Opus, mit vollem Zugriff auf den Code) sie automatisch um und spielt sie ein. Darum: so konkret, dass ein Entwickler ohne Rückfrage loslegen kann (welche Seite/Datei/Funktion, was genau). Kein Vorschlag für Dinge, die nur Feray außerhalb tun kann.',
    input_schema: { type: 'object', properties: { art: { type: 'string', enum: ['code', 'text', 'marketing', 'einstellung', 'sonstiges'] }, titel: { type: 'string' }, beschreibung: { type: 'string', description: 'Konkrete Umsetzung; bei Code: welche Seite/Funktion, was geändert werden soll' }, warum: { type: 'string', description: 'Zahl oder Beobachtung, die den Vorschlag begründet' } }, required: ['art', 'titel', 'beschreibung'] },
    run: async (i) => { const p = await addProposal({ agent: c.agent, kind: (i.art as 'code') || 'sonstiges', title: String(i.titel || '').slice(0, 160), detail: String(i.beschreibung || '').slice(0, 3000), why: i.warum ? String(i.warum).slice(0, 600) : undefined }, 'hq'); return `Vorschlag hinterlegt (${p.id}). Feray sieht ihn bei Ava unter Freigaben.`; },
  },
  {
    name: 'dokument_erstellen', description: 'Ein fertiges Dokument für Feray erstellen, das sie als PDF oder Word-Datei herunterladen und annehmen kann: Erklärung, Anleitung, Konzept, Brief, Checkliste, Marketing-Plan, Text zum Veröffentlichen. Nutze es, wenn eine Lösung länger ist als ein paar Sätze oder Feray etwas nicht versteht. Text mit Überschriften (Zeile mit # davor), Absätzen und Aufzählungen (- ). Geht nicht nach außen.',
    input_schema: { type: 'object', properties: { titel: { type: 'string' }, inhalt: { type: 'string', description: 'Vollständiger Text des Dokuments' }, warum: { type: 'string' } }, required: ['titel', 'inhalt'] },
    run: async (i) => { const title = String(i.titel || '').slice(0, 140), body = String(i.inhalt || '').slice(0, 20000); if (body.length < 40) throw new Error('Inhalt zu kurz'); const p = await addProposal({ agent: c.agent, kind: 'dokument', title, detail: body.split('\n').filter((l) => l.trim() && !l.startsWith('#')).slice(0, 2).join(' ').slice(0, 300), why: i.warum ? String(i.warum).slice(0, 400) : undefined, doc: { title, body } }, 'hq'); return `Dokument erstellt (${p.id}). Feray kann es in deiner Karte als PDF oder Word herunterladen und annehmen.`; },
  },
  {
    name: 'feray_benachrichtigen', description: 'Push-Mitteilung auf Ferays Handy – nur bei echten Problemen, die sofort Aufmerksamkeit brauchen. Keine Namen, Adressen oder Beträge im Text.',
    input_schema: { type: 'object', properties: { titel: { type: 'string' }, text: { type: 'string' } }, required: ['titel', 'text'] },
    run: async (i) => { await pushAdmins('support', `${AGENT_NAMES[c.agent] || 'HQ'}: ${String(i.titel || '').slice(0, 60)}`, String(i.text || '').slice(0, 140), 'hq_alarm'); return 'Mitteilung gesendet.'; },
  },
];

// Werkzeugkasten je Abteilung. Die Zentrale (zentrale) und Ethan bekommen alles.
export function toolsFor(c: Ctx): Tool[] {
  const r = read(c);
  switch (c.agent) {
    case 'postfach': return [...r, ...mail(), ...drafts(c), ...draftEdit(c), ...reviewTool(c), ...act(c, ['E-Mail']), ...propose(c)];
    case 'freigaben': return [...r, ...drafts(c), ...draftEdit(c), ...reviewTool(c), ...propose(c)];
    case 'sicherheit': return [...r, ...act(c, ['Sicherheit']), ...propose(c)];
    case 'technik': return [...r, ...tech(c), ...act(c, ['Technik', 'Betrieb']), ...propose(c)];
    case 'support': return [...r, ...kunden(), ...act(c, ['Betrieb']), ...propose(c)];
    case 'optimierung': return [...r, ...site(c), ...propose(c)];
    case 'recht': return [...r, ...act(c, ['E-Mail']), ...propose(c)];
    case 'zentrale': case 'briefing': return [...r, ...mail(), ...drafts(c), ...draftEdit(c), ...reviewTool(c), ...akquise(c), ...bestand(), ...tech(c), ...kunden(), ...act(c, ['Sicherheit', 'E-Mail', 'Technik', 'Betrieb']), ...propose(c)];
    case 'akquise': case 'vertrieb': return [...r, ...akquise(c), ...drafts(c), ...draftEdit(c), ...propose(c)];
    case 'bestandskunden': return [...r, ...bestand(), ...propose(c)];
    default: return [...r, ...propose(c)];
  }
}
