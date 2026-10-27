import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../src/api';
import { useScope } from '../../src/scope';
import { C, Card, ErrorBox, H2, Kpi, Loading, Note, num, Screen, Seg } from '../../src/ui';

const DAYS = [[1, 'Heute'], [7, '7 Tage'], [30, '30 Tage'], [90, '90 Tage']];
const DEV = { mobile: 'Smartphone', tablet: 'Tablet', desktop: 'Computer', '?': 'Unbekannt' };
const delta = (a, b) => (!b ? (a ? 'neu' : '') : `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round(((a - b) / b) * 100))} % zum Vorzeitraum`);

function Chart({ series }) {
  if (!series?.length) return <Note>Noch keine Daten.</Note>;
  const max = Math.max(1, ...series.map((x) => x[1]));
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 2 }}>
        {series.map((x, i) => <View key={i} style={{ flex: 1, height: Math.max(2, (x[1] / max) * 120), backgroundColor: i === series.length - 1 ? C.sky : C.blue, borderRadius: 3 }} />)}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Note>{new Date(series[0][0]).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</Note><Note>max. {num(max)} Besucher/Tag</Note><Note>{new Date(series[series.length - 1][0]).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</Note>
      </View>
    </View>
  );
}
function List({ title, rows, label = (x) => x }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[1])));
  return (
    <Card><H2>{title}</H2>{rows.length ? rows.slice(0, 8).map((r, i) => (
      <View key={i} style={{ paddingVertical: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text numberOfLines={1} style={{ flex: 1, color: C.text }}>{label(r[0]) || '–'}</Text><Text style={{ fontWeight: '700', color: C.navy }}>{num(r[1])}</Text></View>
        <View style={{ height: 5, backgroundColor: '#EEF2F7', borderRadius: 3, marginTop: 4 }}><View style={{ width: `${Math.round((Number(r[1]) / max) * 100)}%`, height: 5, backgroundColor: C.blue, borderRadius: 3 }} /></View>
      </View>)) : <Note>Noch keine Daten.</Note>}</Card>
  );
}

// Statistik: Besucher, Herkunft, Geräte und der Weg zum Kauf – cookielos, getrennt nach B2C und B2B.
export default function Statistik() {
  const [sc, , scopeSeg] = useScope();
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setErr('');
    const r = await api(`/api/admin/system?analytics=${sc}&days=${days}`, { scope: sc });
    setBusy(false);
    if (!r.ok) { setErr(r.data?.error || 'Statistik nicht verfügbar.'); return; }
    setD(r.data);
  }, [sc, days]);
  useEffect(() => { setD(null); load(); }, [load]);
  const ev = d?.events || {};
  return (
    <Screen kicker="Analytics" title="Statistik" refreshing={busy} onRefresh={load}>
      {scopeSeg}
      <Seg items={DAYS} value={days} onChange={setDays} />
      {err ? <ErrorBox text={err} onRetry={load} /> : !d ? <Loading /> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Kpi label="Besucher" value={num(d.visitors)} sub={delta(d.visitors, d.prevVisitors)} />
            <Kpi label="Seitenaufrufe" value={num(d.pageviews)} sub={delta(d.pageviews, d.prevPageviews)} />
            {sc === 'b2b' ? <Kpi label="Kontoanfragen" value={num(ev.b2b_request)} sub={`Demo & Kontakt ${num(ev.b2b_contact)}`} /> : <Kpi label="Registrierungen" value={num(d.registrations)} sub={`Anmeldungen ${num(ev.login)}`} />}
            <Kpi label={sc === 'b2b' ? 'Tarife gebucht' : 'Käufe'} value={num(d.purchases)} sub={`Bezahlseite geöffnet ${num(ev.checkout_start)}`} tone={d.purchases ? 'ok' : undefined} />
          </View>
          <Card><H2>Besucher je Tag</H2><Chart series={d.series} /></Card>
          <List title="Beliebteste Seiten" rows={(d.pages || []).map((p) => [p[0], p[1]])} />
          <List title="Herkunft" rows={d.refs || []} />
          <List title="Geräte" rows={d.devices || []} label={(x) => DEV[x] || x} />
          <List title="Browser" rows={d.browsers || []} />
          <Note>Ohne Cookies und ohne gespeicherte IP-Adressen. Administratoren und Bots werden nicht gezählt.</Note>
        </>
      )}
    </Screen>
  );
}
