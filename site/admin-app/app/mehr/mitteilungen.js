import React, { useEffect, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { api, post } from '../../src/api';
import { registerPush } from '../../src/push';
import { Btn, C, Card, Loading, Note, Screen } from '../../src/ui';

const KINDS = [['payment', 'Zahlungen', 'Neue Zahlung, fehlgeschlagene Zahlung'], ['mail', 'Postfach & Anfragen', 'Neue E-Mail mit Absender, Kontakt- und Unternehmensanfragen'], ['booking', 'Termine', 'Neue Terminanfrage, Absage durch den Kunden'], ['support', 'Technische Probleme', 'Kunde meldet ein Problem (Antwort in 12 Std.)'], ['security', 'Sicherheit & Angriffe', 'Angriffe, abgefangene Phishing-Mails, neue Geräte – immer an']];
// Mitteilungen: welche Ereignisse sofort aufs Handy kommen.
export default function Mitteilungen() {
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/admin/push').then((r) => setP(r.ok ? r.data.prefs : { payment: true, mail: true, booking: true, security: true, support: true })); }, []);
  const set = async (k, v) => { const n = { ...p, [k]: v, security: true }; setP(n); const r = await post('/api/admin/push', { action: 'prefs', prefs: n }); if (!r.ok) Alert.alert('Nicht gespeichert', r.data?.error || 'Fehler'); };
  const test = async () => { setBusy(true); await registerPush().catch(() => null); const r = await post('/api/admin/push', { action: 'test' }); setBusy(false); Alert.alert(r.ok ? 'Gesendet' : 'Nicht möglich', r.ok ? 'Die Test-Mitteilung sollte gleich erscheinen.' : r.data?.error || 'Bitte Mitteilungen in den iOS-Einstellungen erlauben.'); };
  if (!p) return <Loading />;
  return (
    <Screen inStack kicker="Einstellungen" title="Mitteilungen">
      <Card style={{ padding: 0 }}>{KINDS.map(([k, t, sub], i) => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.text }}>{t}</Text><Note>{sub}</Note></View>
          <Switch value={k === 'security' ? true : p[k] !== false} disabled={k === 'security'} onValueChange={(v) => set(k, v)} />
        </View>))}</Card>
      <Btn title="Test-Mitteilung senden" onPress={test} busy={busy} />
      <Note>Mitteilungen erscheinen im LeaseRun-Stil mit Anlass und Absender. Antippen öffnet direkt den passenden Bereich.</Note>
    </Screen>
  );
}
