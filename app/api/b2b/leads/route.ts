import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { json, requireMember } from '@/lib/b2b/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLS = 'id, source, client_name, client_email, client_phone, message, property_data, metrics, consent_at, consent_text, status, assigned_to, notes, created_at';

// Anfragen des eigenen Unternehmens (alle Mitglieder sehen die Pipeline).
export async function GET(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-leads', limit: 60 });
  if (ctx instanceof Response) return ctx;
  const u = new URL(req.url);
  const status = u.searchParams.get('status');
  let q = supabaseAdmin().from('immo_b2b_leads').select(COLS).eq('account_id', ctx.account.id).order('created_at', { ascending: false }).limit(500);
  if (status && ['neu', 'in_bearbeitung', 'abgeschlossen', 'abgelehnt'].includes(status)) q = q.eq('status', status);
  if (u.searchParams.get('mine') === '1') q = q.eq('assigned_to', ctx.user.id);
  const { data, error } = await q;
  if (error) return json({ error: 'Anfragen konnten nicht geladen werden.' }, 500);
  if (u.searchParams.get('format') === 'csv') {
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
    const rows = [['Eingang', 'Quelle', 'Status', 'Name', 'E-Mail', 'Telefon', 'Objekt', 'Kaufpreis', 'Kaltmiete', 'Eigenkapital', 'Darlehen', 'DSCR', 'Nachricht', 'Notizen']];
    for (const l of data ?? []) {
      const p = (l.property_data ?? {}) as Record<string, unknown>;
      const m = (l.metrics ?? {}) as Record<string, unknown>;
      rows.push([l.created_at, l.source, l.status, l.client_name, l.client_email, l.client_phone, p.address ?? p.ref ?? '', p.price ?? '', p.rent ?? '', p.equity ?? '', m.loan ?? '', m.dscr ?? '', l.message ?? '', l.notes ?? ''].map(String));
    }
    const csv = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ImmoAdv_Anfragen.csv"', 'Cache-Control': 'no-store' } });
  }
  return json({ leads: data ?? [] });
}

const Patch = z.object({
  id: z.string().uuid(),
  status: z.enum(['neu', 'in_bearbeitung', 'abgeschlossen', 'abgelehnt']).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  notes: z.string().max(4000).optional(),
}).refine((x) => x.status !== undefined || x.assignedTo !== undefined || x.notes !== undefined);

export async function PATCH(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-leads', limit: 60 });
  if (ctx instanceof Response) return ctx;
  const p = Patch.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Ungültige Anfrage.' }, 400);
  const db = supabaseAdmin();
  const up: Record<string, unknown> = {};
  if (p.data.status) up.status = p.data.status;
  if (p.data.notes !== undefined) up.notes = p.data.notes.trim() || null;
  if (p.data.assignedTo !== undefined) {
    // Zuweisung nur an Mitglieder des eigenen Unternehmens; Berater dürfen nur sich selbst zuweisen oder freigeben.
    if (p.data.assignedTo) {
      if (ctx.role !== 'owner' && p.data.assignedTo !== ctx.user.id) return json({ error: 'Berater können Anfragen nur sich selbst zuweisen.' }, 403);
      const { data: m } = await db.from('immo_b2b_members').select('user_id').eq('account_id', ctx.account.id).eq('user_id', p.data.assignedTo).maybeSingle();
      if (!m) return json({ error: 'Kein Mitglied dieses Unternehmens.' }, 400);
    }
    up.assigned_to = p.data.assignedTo;
  }
  const { error } = await db.from('immo_b2b_leads').update(up).eq('id', p.data.id).eq('account_id', ctx.account.id);
  if (error) return json({ error: 'Speichern fehlgeschlagen.' }, 500);
  return json({ ok: true });
}

// Löschen (z. B. nach Widerruf der Einwilligung oder Ablauf der Aufbewahrung beim Partner).
export async function DELETE(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-leads', limit: 60 });
  if (ctx instanceof Response) return ctx;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Ungültige Anfrage.' }, 400);
  const { error } = await supabaseAdmin().from('immo_b2b_leads').delete().eq('id', id).eq('account_id', ctx.account.id);
  if (error) return json({ error: 'Löschen fehlgeschlagen.' }, 500);
  return json({ ok: true });
}
