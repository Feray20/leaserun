import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, Linking, Text, TextInput, View } from 'react-native';
import { api, post } from '../../src/api';
import { useScope } from '../../src/scope';
import { Badge, Btn, C, Card, dtt, Empty, ErrorBox, Loading, Note, s, Screen, Seg } from '../../src/ui';

const SEV = { blockiert: ['Blockiert', 'bad'], stoert: ['Stört', 'warn'], klein: ['Kleinigkeit', 'neutral'] };
const STATUS = [['neu', 'Neu'], ['in_arbeit', 'In Arbeit'], ['rueckfrage', 'Rückfrage'], ['geloest', 'Gelöst']];
const OPEN = ['neu', 'in_arbeit', 'rueckfrage'];
// Technische Probleme der Kunden mit Screenshots – Ziel: Antwort in 12 Stunden.
export default function Probleme() {
  const [sc, , scopeSeg] = useScope();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState('open');
  const [ans, setAns] = useState({});
  const [st, setSt] = useState({});
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => { const r = await api(`/api/admin/tickets?area=${sc}`, { scope: sc }); if (r.ok) { setD(r.data); setErr(''); } else setErr(r.data?.error || 'Nicht verfügbar.'); }, [sc]);
  useEffect(() => { setD(null); load(); }, [load]);
  const save = async (t) => {
    const answer = (ans[t.id] ?? t.answer ?? '').trim(); let status = st[t.id] || t.status; if (answer && status === 'neu') status = 'in_arbeit';
    setBusy(t.id); const r = await post('/api/admin/tickets', { id: t.id, status, answer: answer || null, notify: Boolean(answer) }, { scope: sc }); setBusy('');
    if (!r.ok) { Alert.alert('Fehler', r.data?.error || 'Nicht gespeichert'); return; }
    Alert.alert('Gespeichert', r.data.mailed ? 'Antwort per E-Mail an den Kunden gesendet.' : 'Status gespeichert.'); load();
  };
  const now = Date.now();
  const items = (d?.items || []).filter((t) => (f === 'open' ? OPEN.includes(t.status) : true));
  return (
    <Screen inStack kicker="Support" title="Probleme" onRefresh={load}>
      {scopeSeg}
      <Seg items={[['open', `Offen${d ? ` (${d.open})` : ''}`], ['all', 'Alle']]} value={f} onChange={setF} />
      {err ? <ErrorBox text={err} onRetry={load} /> : !d ? <Loading /> : items.length ? items.map((t) => {
        const late = OPEN.includes(t.status) && Date.parse(t.due_at) < now; const [sl, tone] = SEV[t.severity] || ['', 'neutral'];
        return (
          <Card key={t.id} style={late ? { borderColor: '#FCA5A5', borderLeftWidth: 4, borderLeftColor: C.bad } : null}>
            <View style={[s.row, { justifyContent: 'space-between' }]}><Text style={{ flex: 1, fontWeight: '800', color: C.navy }}>{t.ref} · {t.title}</Text><Badge text={sl} tone={tone} /></View>
            <Note>{t.company ? `${t.company} · ` : ''}{t.user_email} · {dtt(t.created_at)}</Note>
            <Note style={late ? { color: C.bad, fontWeight: '700' } : null}>{OPEN.includes(t.status) ? `Antwort fällig ${dtt(t.due_at)}` : `Status: ${t.status}`}{t.page ? ` · Seite ${t.page}` : ''}</Note>
            <Text style={{ marginTop: 8, color: C.text, lineHeight: 21 }}>{t.text}</Text>
            {t.expected ? <Note style={{ marginTop: 6 }}>Erwartet: {t.expected}</Note> : null}
            {(t.shotUrls || []).length ? <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>{t.shotUrls.map((u, i) => <Pressable key={i} onPress={() => Linking.openURL(u)}><Image source={{ uri: u }} style={{ width: 110, height: 80, borderRadius: 8, borderWidth: 1, borderColor: C.line }} /></Pressable>)}</View> : null}
            {t.device?.ua ? <Note style={{ marginTop: 8 }} numberOfLines={3}>{t.device.ua}{t.device.vw ? ` · ${t.device.vw}×${t.device.vh}` : ''}{(t.device.errors || []).length ? ` · Fehler: ${t.device.errors.join(' | ')}` : ''}</Note> : null}
            <TextInput multiline placeholder="Antwort an den Kunden (kommt per E-Mail)" value={ans[t.id] ?? t.answer ?? ''} onChangeText={(x) => setAns((a) => ({ ...a, [t.id]: x }))} style={[s.input, { minHeight: 70, marginTop: 10, textAlignVertical: 'top' }]} />
            <View style={{ marginTop: 8 }}><Seg items={STATUS} value={st[t.id] || t.status} onChange={(v) => setSt((x) => ({ ...x, [t.id]: v }))} /></View>
            <Btn title="Speichern" onPress={() => save(t)} busy={busy === t.id} style={{ marginTop: 10 }} />
          </Card>
        );
      }) : <Empty title="Keine offenen Meldungen" text="Neue Meldungen kommen sofort als Mitteilung." />}
    </Screen>
  );
}
