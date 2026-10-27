import React, { useCallback, useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, post } from '../../src/api';
import { useScope } from '../../src/scope';
import { Badge, C, Card, dt, Empty, ErrorBox, eur, H2, Kpi, Loading, Note, s, Screen, Seg } from '../../src/ui';

const RANGES = [['heute', 'Heute'], ['woche', 'Woche'], ['monat', 'Monat'], ['jahr', 'Jahr']];

// Zahlungen: Umsatz, Abos, offene Posten und einzelne Zahlungen – B2C (Stripe) bzw. B2B (Rechnungen).
export default function Zahlungen() {
  const [sc, , scopeSeg] = useScope();
  const [z, setZ] = useState('monat');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tk, setTk] = useState(null);

  const load = useCallback(async () => {
    setBusy(true); setErr('');
    const [r, t] = await Promise.all([api(`/api/admin/finance?zeitraum=${z}`, { scope: sc }), api('/api/admin/testkauf')]);
    setBusy(false);
    if (!r.ok) { setErr(r.data?.error || 'Zahlungen konnten nicht geladen werden.'); return; }
    setD(r.data); if (t.ok) setTk(t.data);
  }, [sc, z]);
  useEffect(() => { setD(null); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleTest = async (on) => {
    setTk((x) => ({ ...x, on }));
    const r = await post('/api/admin/testkauf', { on });
    if (!r.ok) setTk((x) => ({ ...x, on: !on }));
  };

  return (
    <Screen kicker="Finanzen" title="Zahlungen" refreshing={busy} onRefresh={load}>
      {scopeSeg}
      <Seg items={RANGES} value={z} onChange={setZ} />
      {err ? <ErrorBox text={err} onRetry={load} /> : !d ? <Loading /> : sc === 'b2c' ? (
        <>
          {d.billingLive === false ? <Card style={{ backgroundColor: C.warnBg }}><Text style={{ color: C.warn }}>Zahlungen laufen noch im Testbetrieb – Werte aus dem Stripe-Testmodus.</Text></Card> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Kpi label="Umsatz brutto" value={eur(d.revenue?.gross)} sub={`${d.revenue?.count || 0} Zahlungen`} />
            <Kpi label="Umsatz netto" value={eur(d.revenue?.net)} sub={`USt ${eur(d.revenue?.vat)}`} />
            <Kpi label="Laufende Pro-Abos" value={String(d.recurring?.activeSubs || 0)} sub={`MRR ${eur(d.recurring?.mrrNet)}`} />
            <Kpi label="Erstattet" value={String(d.revenue?.refunds || 0)} tone={d.revenue?.refunds ? 'bad' : undefined} />
          </View>
          <Card><H2>Zahlungen im Zeitraum</H2>
            {(d.payments || []).length ? d.payments.slice(0, 60).map((p, i) => (
              <View key={i} style={[s.row, { paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }]}>
                <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.text }}>{p.planName}</Text><Note>{dt(p.date)} · {p.kind === 'kauf' ? 'Kauf' : 'Abo-Verlängerung'}</Note></View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}><Text style={{ fontWeight: '800', color: C.navy }}>{eur(p.gross)}</Text>{p.refunded ? <Badge text="erstattet" tone="warn" /> : <Badge text="bezahlt" tone="ok" />}</View>
              </View>)) : <Empty title="Keine Zahlungen" text="Im gewählten Zeitraum ist nichts eingegangen." />}
          </Card>
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Kpi label="Umsatz netto" value={eur(d.revenue?.net)} sub={`${d.revenue?.count || 0} Rechnungen`} />
            <Kpi label="Brutto" value={eur(d.revenue?.gross)} sub={`USt ${eur(d.revenue?.vat)}`} />
            <Kpi label="MRR netto" value={eur(d.recurring?.mrrNet)} sub={`${d.recurring?.activeAccounts || 0} aktive Tarife`} />
            <Kpi label="Offene Posten" value={String((d.openItems || []).length)} tone={(d.openItems || []).some((x) => x.daysOverdue > 0) ? 'bad' : undefined} sub={eur((d.openItems || []).reduce((t, x) => t + Number(x.gross_cents || 0), 0))} />
          </View>
          <Card><H2>Offene Posten</H2>
            {(d.openItems || []).length ? d.openItems.map((x, i) => (
              <View key={x.id} style={[s.row, { paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }]}>
                <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>{x.buyer?.company || x.invoice_number}</Text><Note>{x.invoice_number} · fällig {dt(x.due_date)}</Note></View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}><Text style={{ fontWeight: '800', color: C.navy }}>{eur(x.gross_cents)}</Text><Badge text={x.daysOverdue > 0 ? `${x.daysOverdue} Tage überfällig` : 'fristgerecht'} tone={x.daysOverdue > 0 ? 'bad' : 'ok'} /></View>
              </View>)) : <Empty title="Keine offenen Posten" />}
          </Card>
          <Card><H2>Rechnungen im Zeitraum</H2>
            {(d.invoices || []).length ? d.invoices.slice(0, 60).map((x, i) => (
              <View key={x.id || i} style={[s.row, { paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }]}>
                <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>{x.invoice_number}</Text><Note>{dt(x.issue_date)} · {x.buyer?.company || ''}</Note></View>
                <Text style={{ fontWeight: '700', color: C.navy }}>{eur(x.gross_cents)}</Text>
              </View>)) : <Empty title="Keine Rechnungen" />}
          </Card>
        </>
      )}
      {tk ? (
        <Card>
          <View style={s.row}><View style={{ flex: 1 }}><H2 style={{ marginBottom: 2 }}>Testkauf jetzt möglich</H2><Note>{tk.on ? 'An: Ihre eigenen Käufe laufen im Stripe-Testmodus (Karte 4242 4242 4242 4242). Kunden kaufen immer echt.' : 'Aus: alles läuft live und wird von Stripe voll geprüft.'}</Note></View>
            <Switch value={!!tk.on} onValueChange={toggleTest} disabled={!tk.available} trackColor={{ true: '#16A34A' }} /></View>
        </Card>
      ) : null}
    </Screen>
  );
}
