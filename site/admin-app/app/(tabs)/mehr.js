import React, { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { api, getSession, signOut } from '../../src/api';
import { Activity } from '../../src/activity';
import { Badge, C, Card, H2, Note, Screen } from '../../src/ui';

const LINKS = [
  ['/mehr/aktivitaet', 'pulse-outline', 'Aktivität & Hinweise', 'Was zuletzt passiert ist, was Aufmerksamkeit braucht'],
  ['/mehr/probleme', 'construct-outline', 'Technische Probleme', 'Meldungen von Kunden mit Screenshots'],
  ['/mehr/unternehmen', 'business-outline', 'Unternehmen', 'B2B-Konten, Prüfungen, Tarife'],
  ['/mehr/system', 'server-outline', 'Systemstatus', 'Website, Datenbank, Zahlungen, E-Mail'],
  ['/mehr/mitteilungen', 'notifications-outline', 'Mitteilungen', 'Welche Benachrichtigungen Sie bekommen'],
];

export default function Mehr() {
  const router = useRouter();
  const [o, setO] = useState(null);
  const load = useCallback(async () => { const r = await api('/api/admin/app/overview'); if (r.ok) setO(r.data); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const att = (o?.alerts || []).filter((a) => a.attention).length;
  return (
    <Screen kicker={getSession()?.user?.email || 'Administrator'} title="Mehr" onRefresh={load}>
      {o?.status ? <Card style={{ borderLeftWidth: 4, borderLeftColor: o.status.level === 'ok' ? '#16A34A' : o.status.level === 'warn' ? '#F59E0B' : C.bad }}><Text style={{ fontWeight: '800', color: C.navy, fontSize: 16 }}>{o.status.title}</Text><Note>{o.status.detail}</Note></Card> : null}
      <Card style={{ padding: 0 }}>
        {LINKS.map(([href, ic, t, sub], i) => (
          <Pressable key={href} onPress={() => router.push(href)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, backgroundColor: pressed ? '#F8FAFC' : 'transparent' })}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }}><Ionicons name={ic} size={20} color={C.blue} /></View>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.text, fontSize: 15.5 }}>{t}</Text><Note>{sub}</Note></View>
            {href === '/mehr/aktivitaet' && att ? <Badge text={String(att)} tone="warn" /> : null}
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </Pressable>
        ))}
      </Card>
      <H2 style={{ marginTop: 4 }}>Letzte Aktivität</H2>
      <Activity items={(o?.activity || []).slice(0, 6)} />
      <Card onPress={() => Linking.openURL('https://leaserun.com/internal/web-admin')}><Text style={{ fontWeight: '700', color: C.blue }}>Web-Admin im Browser öffnen</Text><Note>Für Einrichtung, Rechnungen-Export und große Auswertungen.</Note></Card>
      <Card onPress={() => Alert.alert('Abmelden?', 'Mitteilungen bleiben für dieses Gerät aktiv, bis Sie sich wieder anmelden.', [{ text: 'Abbrechen', style: 'cancel' }, { text: 'Abmelden', style: 'destructive', onPress: () => signOut() }])}><Text style={{ fontWeight: '700', color: C.bad }}>Abmelden</Text></Card>
      <Note style={{ textAlign: 'center' }}>LeaseRun Admin {Constants.expoConfig?.version} · {o?.deploy?.commit ? `Server ${o.deploy.commit}` : ''}</Note>
    </Screen>
  );
}
