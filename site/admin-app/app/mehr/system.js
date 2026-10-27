import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../src/api';
import { Badge, Btn, C, Card, ErrorBox, Loading, Note, Screen } from '../../src/ui';

const ST = { ok: ['OK', 'ok'], warn: ['Hinweis', 'warn'], fail: ['Fehler', 'bad'], off: ['Aus', 'neutral'] };
// Systemstatus: Website, Datenbank, Speicher, Zahlungen, E-Mail, Mitteilungen, Zugangsschutz – plus Live-Prüfung.
export default function System() {
  const [o, setO] = useState(null);
  const [live, setLive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => { const r = await api('/api/admin/app/overview'); if (r.ok) setO(r.data); else setErr(r.data?.error || 'Nicht verfügbar.'); }, []);
  useEffect(() => { load(); }, [load]);
  const check = async () => { setBusy(true); const r = await api('/api/admin/setup?live=1'); setBusy(false); if (r.ok) setLive(r.data.checks); else setErr(r.data?.error || 'Prüfung fehlgeschlagen.'); };
  if (err) return <Screen inStack title="System"><ErrorBox text={err} onRetry={load} /></Screen>;
  if (!o) return <Loading />;
  const bad = (live || []).filter((c) => c.state !== 'ok');
  return (
    <Screen inStack kicker="Betrieb" title="Systemstatus" onRefresh={load}>
      <Card style={{ padding: 0 }}>{(o.systems || []).map((x, i) => { const [l, t] = ST[x.state] || ST.off; return (
        <View key={x.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.text }}>{x.label}</Text><Note>{x.info}{x.ms ? ` · ${x.ms} ms` : ''}</Note></View><Badge text={l} tone={t} />
        </View>); })}</Card>
      <Btn title={live ? 'Erneut prüfen' : 'Live-Prüfung starten'} onPress={check} busy={busy} />
      {live ? (bad.length ? bad.map((c) => { const [l, t] = ST[c.state] || ST.off; return <Card key={c.id}><View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Badge text={l} tone={t} /><Text style={{ fontWeight: '800', color: C.navy, flex: 1 }}>{c.label}</Text></View><Note style={{ marginTop: 6 }}>{c.info}</Note></Card>; })
        : <Card><Text style={{ color: C.ok, fontWeight: '700' }}>Alle {live.length} Prüfungen bestanden.</Text></Card>) : null}
      <Note>Version {o.deploy?.commit || '–'} · {o.deploy?.region || ''}</Note>
    </Screen>
  );
}
