import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { api, post } from '../../src/api';
import { Badge, Btn, C, Card, ErrorBox, H2, Loading, Note, Screen } from '../../src/ui';

// Headquarters in der App: dieselben Entscheidungen wie im Web-Admin (gleiche Schnittstellen, gleiche Wirkung).
// Was hier erledigt oder verworfen wird, ist sofort auch im Web erledigt – und umgekehrt.
const WEB_HQ = 'https://leaserun.com/internal/web-admin#hq';
const SEV = { bad: ['bad', 'Kritisch'], warn: ['warn', 'Wichtig'], info: ['info', 'Neu'] };
const FSEV = { critical: 'bad', warning: 'warn', info: 'info' };
const RANK = { bad: 0, warn: 1, info: 2 };
// Gleiche Logik wie im Web-Admin (public/src/intern-hq.mjs): wichtigster Punkt eines Agenten und sein stabiler Schlüssel.
const LV = { hoch: 0, mittel: 1, niedrig: 2 };
const topIssue = (r) => [...(r.issues || [])].sort((x, y) => (LV[x.level] ?? 3) - (LV[y.level] ?? 3))[0] || null;
const aKey = (id, r) => { const t = topIssue(r); return `a|${id}|${r.status}|${t?.id || String(r.line || '').replace(/\d+(?:[.,]\d+)*/g, '#')}`; };
// Lösungen verändern etwas → vor dem Umsetzen bestätigen (kein versehentlicher Auftrag mit einem Tipp).
const confirmDo = (title) => new Promise((res) => Alert.alert('Bestätigung erforderlich', `„${title}“ wird umgesetzt.`, [{ text: 'Abbrechen', style: 'cancel', onPress: () => res(false) }, { text: 'Umsetzen', onPress: () => res(true) }]));

export default function HQ() {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [work, setWork] = useState({});
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setErr('');
    const [hq, fix, ov, dis] = await Promise.all([api('/api/admin/hq'), api('/api/admin/fix'), api('/api/admin/app/overview'), api('/api/admin/os/dismiss')]);
    setBusy(false);
    if (!hq.ok && !ov.ok) { setErr(hq.data?.error || ov.data?.error || 'Headquarters nicht erreichbar.'); return; }
    setSt({ hq: hq.ok ? hq.data : {}, findings: fix.ok ? (fix.data.findings || []).filter((x) => x.sev !== 'info' || x.auto) : [], ov: ov.ok ? ov.data : null, dismissed: dis.ok ? dis.data.dismissed || {} : {} });
  }, []);
  useEffect(() => { load(); const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); }); return () => sub.remove(); }, [load]);

  const items = () => {
    if (!st) return [];
    const staff = st.hq.staff || [], name = (id) => staff.find((x) => x.id === id)?.name || id, out = [], now = Date.now();
    const gone = (k) => (st.dismissed[k] || 0) > now;
    for (const f of st.findings) out.push({ k: `f|${f.id}`, sev: FSEV[f.sev] || 'info', area: f.area, title: f.title, yes: f.auto ? ['Erledigen', () => post('/api/admin/fix', { ids: [f.id] })] : ['Erledigt', () => post('/api/admin/fix', { dismiss: f.id })], no: f.auto ? ['Verwerfen', () => post('/api/admin/fix', { dismiss: f.id })] : null });
    for (const p of (st.hq.proposals || []).filter((x) => x.status === 'offen')) out.push({ k: `p|${p.id}`, sev: 'info', area: name(p.agent), title: p.title, detail: p.detail, yes: ['Erledigen', async () => (p.kind === 'dokument' || await confirmDo(p.title) ? post('/api/admin/hq', { action: 'proposal', proposalId: p.id, decision: 'erledigen' }) : { ok: true, data: {} })], no: ['Verwerfen', () => post('/api/admin/hq', { action: 'proposal', proposalId: p.id, decision: 'verworfen' })] });
    for (const [id, r] of Object.entries(st.hq.agents || {})) {
      // Ava (Freigaben) zeigt der Web-Admin gesammelt; Ethan (Lagebild) fasst nur die anderen zusammen.
      if (!r || r.status === 'ok' || id === 'freigaben' || id === 'briefing') continue;
      const k = aKey(id, r); if (gone(k)) continue;
      // „Erledigen“: Agent arbeitet, danach gilt der Punkt als bearbeitet (24 Std. weg, außer die Lage ändert sich) – wie im Web-Admin.
      const done = async () => {
        const x = await post('/api/admin/hq', { action: 'erledigen', agents: [id] });
        if (x.ok) { await post('/api/admin/os/dismiss', { key: k }); const n = x.data?.agents?.[id]; if (n && n.status !== 'ok') await post('/api/admin/os/dismiss', { key: aKey(id, n) }); }
        return x;
      };
      const t = topIssue(r);
      out.push({ k, sev: r.status === 'error' ? 'bad' : t?.level === 'hoch' ? 'warn' : 'info', area: name(id), title: t?.title || r.line, detail: r.line, yes: ['Erledigen', done], no: ['Verwerfen', () => post('/api/admin/os/dismiss', { key: k })] });
    }
    return out.sort((a, b) => RANK[a.sev] - RANK[b.sev]);
  };
  const act = async (it, which) => {
    setWork((w) => ({ ...w, [it.k]: which }));
    const r = await (which === 'yes' ? it.yes[1]() : it.no[1]());
    setWork((w) => { const n = { ...w }; delete n[it.k]; return n; });
    if (!r.ok) Alert.alert('Nicht möglich', r.data?.error || 'Bitte erneut versuchen.');
    load();
  };
  const ask = async () => {
    const t = q.trim(); if (!t) return;
    setAsking(true); setAnswer(null);
    const r = await post('/api/admin/hq', { agent: 'zentrale', command: t });
    setAsking(false); setAnswer(r.ok ? r.data.reply : r.data?.error || 'Das hat nicht geklappt.'); if (r.ok) setQ('');
  };

  const list = items(), lvl = st?.ov?.status?.level;
  return (
    <Screen kicker="Zentralsteuerung" title="Headquarters" refreshing={busy} onRefresh={load}>
      {err ? <ErrorBox text={err} onRetry={load} /> : !st ? <Loading /> : (
        <>
          {st.ov?.status ? <Card><View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: lvl === 'critical' ? '#EF4444' : lvl === 'warn' ? '#F59E0B' : '#22C55E' }} /><Text style={{ fontSize: 17, fontWeight: '800', color: C.navy, flex: 1 }}>{st.ov.status.title}</Text></View>{st.ov.status.detail ? <Note style={{ marginTop: 4 }}>{st.ov.status.detail}</Note> : null}</Card> : <Card><View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#94A3B8' }} /><Text style={{ fontSize: 17, fontWeight: '800', color: C.navy, flex: 1 }}>Status momentan nicht verfügbar</Text></View><Note style={{ marginTop: 4 }}>Nach unten ziehen, um es erneut zu versuchen.</Note></Card>}
          <Card>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput value={q} onChangeText={setQ} placeholder="Auftrag an LeaseRun Intelligence …" placeholderTextColor="#94A3B8" onSubmitEditing={ask} returnKeyType="send" style={{ flex: 1, minHeight: 44, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, fontSize: 16, color: C.text }} />
              <Btn small title="Los" onPress={ask} busy={asking} />
            </View>
            {answer ? <Text style={{ marginTop: 10, color: C.text, lineHeight: 21 }}>{answer.replace(/\*\*/g, '')}</Text> : null}
          </Card>
          <H2 style={{ marginTop: 6 }}>Entscheidungen{list.length ? ` (${list.length})` : ''}</H2>
          {!list.length ? <Card><Text style={{ color: C.ok, fontWeight: '700' }}>✓ Nichts zu entscheiden.</Text></Card> : list.map((it) => (
            <Card key={it.k} style={{ borderLeftWidth: 5, borderLeftColor: it.sev === 'bad' ? '#EF4444' : it.sev === 'warn' ? '#F59E0B' : '#0284C7' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}><Badge text={SEV[it.sev][1]} tone={SEV[it.sev][0]} /><Note>{it.area}</Note></View>
              <Text style={{ fontSize: 15.5, fontWeight: '700', color: C.navy }}>{it.title}</Text>
              {it.detail ? <Note style={{ marginTop: 4 }} numberOfLines={4}>{it.detail}</Note> : null}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                {it.yes ? <Btn title={it.yes[0]} onPress={() => act(it, 'yes')} busy={work[it.k] === 'yes'} disabled={!!work[it.k]} style={{ flex: 1 }} /> : null}
                {it.no ? <Btn kind="outline" title={it.no[0]} onPress={() => act(it, 'no')} busy={work[it.k] === 'no'} disabled={!!work[it.k]} style={{ flex: 1 }} /> : null}
              </View>
            </Card>
          ))}
          <Pressable onPress={() => Linking.openURL(WEB_HQ)} accessibilityRole="link" style={{ paddingVertical: 14, alignItems: 'center' }}><Text style={{ color: C.blue, fontWeight: '700' }}>Agenten, Chat und Dokumente im Web öffnen</Text></Pressable>
        </>
      )}
    </Screen>
  );
}
