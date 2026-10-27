import React, { useCallback, useState } from 'react';
import { Alert, Linking, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, post } from '../../src/api';
import { Badge, Btn, C, Card, dtt, Empty, ErrorBox, H2, Loading, Note, s, Screen, Seg } from '../../src/ui';

const ST = { angefragt: ['Angefragt', 'warn'], bestaetigt: ['Bestätigt', 'ok'], abgelehnt: ['Abgelehnt', 'neutral'], abgesagt: ['Abgesagt', 'neutral'] };

// Termine: Anfragen bestätigen – der Kunde bekommt automatisch die Bestätigung mit Microsoft-Teams-Link und Kalendereintrag.
export default function Termine() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState('offen');
  const [act, setAct] = useState('');
  const [note, setNote] = useState({});

  const load = useCallback(async () => {
    setBusy(true); setErr('');
    const r = await api('/api/admin/termine');
    setBusy(false);
    if (!r.ok) { setErr(r.data?.error || 'Termine konnten nicht geladen werden.'); return; }
    setD(r.data);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (b, action) => {
    if (action !== 'accept') {
      const ok = await new Promise((res) => Alert.alert(action === 'decline' ? 'Anfrage ablehnen?' : 'Termin absagen?', `${b.name} erhält eine E-Mail.`, [{ text: 'Abbrechen', style: 'cancel', onPress: () => res(false) }, { text: action === 'decline' ? 'Ablehnen' : 'Absagen', style: 'destructive', onPress: () => res(true) }]));
      if (!ok) return;
    }
    setAct(b.id + action);
    const r = await post('/api/admin/termine', { action, id: b.id, ...(action === 'accept' ? {} : { note: note[b.id] || '' }) });
    setAct('');
    if (!r.ok) { Alert.alert('Nicht möglich', r.data?.error || 'Fehler'); return; }
    if (action === 'accept') Alert.alert('Bestätigt', r.data?.mailed === false ? 'Termin bestätigt, die E-Mail an den Kunden konnte aber nicht gesendet werden.' : `${b.name} hat die Bestätigung mit Teams-Link und Kalendereintrag per E-Mail bekommen.`);
    load();
  };

  const now = Date.now();
  const list = (d?.bookings || []).filter((b) => (f === 'offen' ? b.status === 'angefragt' : f === 'kommend' ? b.status === 'bestaetigt' && Date.parse(b.ends_at) > now : true))
    .sort((a, b) => (f === 'alle' ? Date.parse(b.starts_at) - Date.parse(a.starts_at) : Date.parse(a.starts_at) - Date.parse(b.starts_at)));
  const open = (d?.bookings || []).filter((b) => b.status === 'angefragt').length;

  return (
    <Screen kicker="Kalender" title="Termine" refreshing={busy} onRefresh={load}>
      <Seg items={[['offen', `Anfragen${open ? ` (${open})` : ''}`], ['kommend', 'Bestätigt'], ['alle', 'Alle']]} value={f} onChange={setF} />
      {d && !d.graph?.mode ? <Card style={{ backgroundColor: C.warnBg }}><Text style={{ color: C.warn }}>Microsoft Teams ist nicht verbunden – Bestätigungen gehen ohne Teams-Link raus. Verbinden im Web-Admin unter Termine.</Text></Card> : null}
      {err ? <ErrorBox text={err} onRetry={load} /> : !d ? <Loading /> : list.length ? list.map((b) => {
        const [sl, tone] = ST[b.status] || [b.status, 'neutral'];
        return (
          <Card key={b.id}>
            <View style={[s.row, { justifyContent: 'space-between' }]}><Text style={{ fontSize: 16, fontWeight: '800', color: C.navy, flex: 1 }}>{b.name}{b.company ? ` · ${b.company}` : ''}</Text><Badge text={sl} tone={tone} /></View>
            <Text style={{ marginTop: 6, fontWeight: '700', color: C.text }}>{dtt(b.starts_at)} · {Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000)} Min.</Text>
            <Note>{b.topic || 'Gespräch'} · {b.email}{b.phone ? ` · ${b.phone}` : ''}</Note>
            {b.message ? <Text style={{ marginTop: 8, color: C.sub }}>{b.message}</Text> : null}
            {b.teams_url ? <Btn small kind="ghost" title="Teams-Besprechung öffnen" onPress={() => Linking.openURL(b.teams_url)} style={{ alignSelf: 'flex-start', marginTop: 6 }} /> : null}
            {b.status === 'angefragt' ? (
              <View style={{ gap: 8, marginTop: 12 }}>
                <Btn title="Bestätigen & Teams-Link senden" onPress={() => run(b, 'accept')} busy={act === b.id + 'accept'} />
                <TextInput style={[s.input, { minHeight: 44 }]} placeholder="Grund bei Ablehnung (optional)" value={note[b.id] || ''} onChangeText={(t) => setNote((n) => ({ ...n, [b.id]: t }))} />
                <Btn kind="outline" title="Ablehnen" onPress={() => run(b, 'decline')} busy={act === b.id + 'decline'} />
              </View>
            ) : b.status === 'bestaetigt' && Date.parse(b.ends_at) > now ? <Btn small kind="outline" title="Termin absagen" onPress={() => run(b, 'cancel')} busy={act === b.id + 'cancel'} style={{ marginTop: 10, alignSelf: 'flex-start' }} /> : null}
          </Card>
        );
      }) : <Empty title={f === 'offen' ? 'Keine offenen Anfragen' : 'Keine Termine'} text={f === 'offen' ? 'Neue Terminanfragen kommen als Mitteilung aufs Handy.' : undefined} />}
      <H2 style={{ marginTop: 6 }}> </H2>
    </Screen>
  );
}
