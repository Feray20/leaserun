import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api, post } from '../../src/api';
import { Activity } from '../../src/activity';
import { ago, Badge, Btn, C, Card, ErrorBox, H2, Kpi, Loading, Note, Screen } from '../../src/ui';

const SEV = { critical: ['Kritisch', 'bad'], warning: ['Wichtig', 'warn'], info: ['Info', 'info'] };
// Aktivität & Hinweise: alles Auffällige (Zahlungen, Angriffe, Postfach, Termine, Anfragen) und der Verlauf.
export default function Aktivitaet() {
  const [o, setO] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); const r = await api('/api/admin/app/overview'); setBusy(false); if (r.ok) { setO(r.data); setErr(''); } else setErr(r.data?.error || 'Nicht verfügbar.'); }, []);
  useEffect(() => { load(); }, [load]);
  const ack = async (k) => { await post('/api/admin/sec', { action: 'ack', kind: k }); load(); };
  if (err) return <Screen inStack title="Aktivität"><ErrorBox text={err} onRetry={load} /></Screen>;
  if (!o) return <Loading />;
  return (
    <Screen inStack kicker="Jetzt wichtig" title="Aktivität" refreshing={busy} onRefresh={load}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{(o.metrics || []).slice(0, 6).map((m) => <Kpi key={m.key} label={m.label} value={String(m.value)} tone={m.tone === 'bad' || m.tone === 'warn' ? 'bad' : undefined} />)}</View>
      <H2>Hinweise</H2>
      {(o.alerts || []).length ? o.alerts.map((a) => { const [l, t] = SEV[a.severity] || ['Info', 'info']; return (
        <Card key={a.id}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Badge text={l} tone={t} /><Text style={{ flex: 1, fontWeight: '800', color: C.navy }}>{a.title}</Text></View>
          <Note style={{ marginTop: 6 }}>{a.detail}{a.at ? ` · ${ago(a.at)}` : ''}</Note>
          {a.action?.kind === 'ack_security' ? <Btn small kind="outline" title={a.action.label} onPress={() => ack(a.action.kindKey)} style={{ alignSelf: 'flex-start', marginTop: 8 }} /> : null}
        </Card>); }) : <Card><Text style={{ color: C.ok, fontWeight: '700' }}>Alles ruhig – nichts braucht gerade Ihre Aufmerksamkeit.</Text></Card>}
      <H2>Verlauf</H2>
      <Activity items={o.activity || []} />
    </Screen>
  );
}
