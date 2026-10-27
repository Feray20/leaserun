import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { pushAlert } from '@/lib/security/push';

// Automatische IP-Sperre bei wiederholten Angriffs-Signalen. Dauerhaft in der Datenbank (gilt für alle Serverinstanzen);
// die Middleware weist gesperrte Quellen ab. Gespeichert wird nur der anonymisierte IP-Hash.
// [Anzahl, Zeitfenster in Minuten, Sperrdauer in Stunden]
const RULES: Record<string, [number, number, number]> = {
  // Fehlversuche meldet der Browser selbst (nicht vom Server bestätigt). Gesperrt wird ein ganzes Teilnetz (/24) –
  // dahinter können viele Kunden sitzen (Mobilfunk, Büro). Deshalb höhere Schwelle und nur kurz sperren,
  // damit niemand mit gefälschten Meldungen fremde Kunden aussperren kann. Echte Abwehr: Supabase-Anmeldegrenzen.
  login_flood: [30, 15, 1],
  admin_denied: [10, 15, 24],       // Web-Admin ohne Berechtigung
  admin_mfa_missing: [10, 15, 24],  // Web-Admin ohne zweiten Faktor
  probe: [20, 10, 24],              // Schwachstellen-Scanner (24 Std. statt 7 Tage: Teilnetz-Sperre trifft sonst Unbeteiligte)
};

export async function maybeAutoBlock(kind: string, ipHash: string | null): Promise<void> {
  const rule = RULES[kind];
  if (!rule || !ipHash || !/^[0-9a-f]{32}$/.test(ipHash) || !adminConfigured()) return;
  if (await (await import('@/lib/security/trusted')).isTrustedIp(ipHash)) return; // eigene Netze nie sperren
  const [n, win, hours] = rule;
  const db = supabaseAdmin();
  const since = new Date(Date.now() - win * 60_000).toISOString();
  const { count } = await db.from('lr_security_log').select('id', { count: 'exact', head: true }).eq('kind', kind).eq('ip_hash', ipHash).gte('created_at', since);
  if ((count ?? 0) < n) return;
  const { data: cur } = await db.from('lr_security_blocks').select('until').eq('ip_hash', ipHash).maybeSingle();
  if (cur && (!cur.until || new Date(cur.until).getTime() > Date.now())) return; // schon gesperrt
  const until = new Date(Date.now() + hours * 3600_000).toISOString();
  const r = await db.from('lr_security_blocks').upsert({ ip_hash: ipHash, until, reason: `automatisch: ${count}× ${kind} in ${win} Min.`, created_by: 'system', created_at: new Date().toISOString() });
  if (r.error) return;
  await pushAlert(`⚠ LeaseRun: Quelle ${ipHash.slice(0, 8)} automatisch für ${hours >= 48 ? hours / 24 + ' Tage' : hours + ' Std.'} gesperrt (${count}× ${kind} in ${win} Min.).\nhttps://leaserun.com/internal/web-admin#sicherheit`).catch(() => null);
}
