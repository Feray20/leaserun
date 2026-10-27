import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { api, post } from '../../src/api';
import { Badge, Btn, C, Card, dt, Empty, ErrorBox, Loading, Note, s, Screen } from '../../src/ui';

const TIER = { BASIC: 'Basic', PRO: 'Pro', ENTERPRISE: 'Enterprise' };
// Unternehmen: Konten, Prüfung freigeben, Zugriff freischalten (Enterprise + alle Module) – wie im Web-Admin.
export default function Unternehmen() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => { const r = await api('/api/admin/b2b', { scope: 'b2b' }); if (r.ok) { setD(r.data.accounts || []); setErr(''); } else setErr(r.data?.error || 'Nicht verfügbar.'); }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (a, label, bodies) => {
    const ok = await new Promise((res) => Alert.alert(label, a.company_name, [{ text: 'Abbrechen', style: 'cancel', onPress: () => res(false) }, { text: 'Ja', onPress: () => res(true) }]));
    if (!ok) return;
    setBusy(a.id);
    for (const b of bodies) { const r = await post('/api/admin/b2b', { id: a.id, ...b }, { scope: 'b2b' }); if (!r.ok) { setBusy(''); Alert.alert('Fehler', r.data?.error || 'Nicht möglich'); return; } }
    setBusy(''); load();
  };
  const all = { action: 'modules', modules: { schnellrechner: 'on', kreditmappe: 'on', stresstest: 'on', whitelabel: 'on', crm: 'on' } };
  const list = (d || []).filter((a) => !q || `${a.company_name} ${a.email} ${a.customer_number}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen inStack kicker="B2B" title="Unternehmen" onRefresh={load}>
      <TextInput value={q} onChangeText={setQ} placeholder="Firma, E-Mail oder Kundennummer" style={s.input} autoCapitalize="none" />
      {err ? <ErrorBox text={err} onRetry={load} /> : !d ? <Loading /> : list.length ? list.map((a) => (
        <Card key={a.id}>
          <View style={[s.row, { justifyContent: 'space-between' }]}><Text style={{ flex: 1, fontWeight: '800', color: C.navy, fontSize: 16 }}>{a.company_name}</Text>{a.tier ? <Badge text={TIER[a.tier] || a.tier} tone="ok" /> : <Badge text="kein Tarif" />}</View>
          <Note selectable>{a.email} · {a.customer_number}</Note>
          <Note>{a.city || ''} · seit {dt(a.created_at)} · {a.leads || 0} Anfragen</Note>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {a.verified_at ? <Badge text="geprüft" tone="ok" /> : <Badge text={a.verification_status === 'eingereicht' ? 'wartet auf Prüfung' : 'nicht geprüft'} tone="warn" />}
            {a.status === 'locked' ? <Badge text="gesperrt" tone="bad" /> : null}
            {a.plan_source === 'manual' ? <Badge text="manuell freigeschaltet" tone="info" /> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {!a.verified_at ? <Btn small title="Prüfung freigeben" busy={busy === a.id} onPress={() => act(a, 'Unternehmen freischalten? Es erhält eine E-Mail.', [{ action: 'approve' }])} /> : null}
            {a.plan_source !== 'stripe' ? <Btn small kind="outline" title="Alles freischalten" busy={busy === a.id} onPress={() => act(a, 'Enterprise und alle Module freischalten?', [...(a.verified_at ? [] : [{ action: 'approve' }]), { action: 'plan', tier: 'ENTERPRISE', until: null }, all])} /> : null}
          </View>
        </Card>
      )) : <Empty title="Keine Unternehmen" />}
    </Screen>
  );
}
