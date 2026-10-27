import React, { useCallback, useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, FlatList, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, post } from '../../src/api';
import { setUnread } from '../../src/unread';
import { Badge, Btn, C, Empty, ErrorBox, Hero, HeroBtn, Loading, s } from '../../src/ui';

const FOLDERS = [['inbox', 'Posteingang'], ['belege', 'Belege'], ['drafts', 'Entwürfe'], ['sent', 'Gesendet'], ['starred', 'Markiert'], ['archive', 'Archiv'], ['spam', 'Spam'], ['trash', 'Papierkorb']];
const when = (m) => { const d = new Date(m.received_at || m.sent_at || m.created_at); const t = new Date(); return d.toDateString() === t.toDateString() ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }); };

// Postfach – exakt dasselbe wie im Web-Admin (gleiche Ordner, Entwürfe, Gesendet, BCC, Anhänge), synchron über leaserun.com.
export default function Postfach() {
  const router = useRouter();
  const [folder, setFolder] = useState('inbox');
  const [q, setQ] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (sync = false) => {
    setBusy(true); setErr('');
    const r = await api(`/api/admin/mail?folder=${folder}${q ? `&q=${encodeURIComponent(q)}` : ''}${sync ? '&sync=1' : ''}`);
    setBusy(false);
    if (!r.ok) { setErr(r.data?.error || 'Postfach konnte nicht geladen werden.'); return; }
    setD(r.data);
    setUnread(r.data?.counts?.inbox || 0);
  }, [folder, q]);

  // Gelesen/ungelesen sofort in der Liste zeigen und mit leaserun.com abgleichen (gleicher Stand wie im Web-Admin).
  const patch = (ids, up) => setD((x) => {
    if (!x) return x;
    const items = (x.items || []).map((m) => (ids.includes(m.id) ? { ...m, ...up } : m));
    const inbox = items.filter((m) => m.folder === 'inbox' && m.direction === 'in' && !m.read_at).length;
    const counts = folder === 'inbox' ? { ...x.counts, inbox } : x.counts;
    if (folder === 'inbox') setUnread(inbox);
    return { ...x, items, counts };
  });
  const markRead = async (ids, read) => {
    patch(ids, { read_at: read ? new Date().toISOString() : null });
    const r = await post('/api/admin/mail', { action: 'mark', ids, read });
    if (!r.ok) { Alert.alert('Nicht möglich', r.data?.error || 'Bitte erneut versuchen.'); load(); }
  };
  const moveTo = async (ids, f) => {
    setD((x) => (x ? { ...x, items: (x.items || []).filter((m) => !ids.includes(m.id)) } : x));
    const r = await post('/api/admin/mail', { action: 'mark', ids, folder: f });
    if (!r.ok) Alert.alert('Nicht möglich', r.data?.error || 'Bitte erneut versuchen.');
    load();
  };
  const open = (m) => {
    if (m.direction === 'in' && !m.read_at) patch([m.id], { read_at: new Date().toISOString() });
    router.push({ pathname: '/mail/[id]', params: { id: m.id } });
  };
  const menu = (m) => {
    const unread = m.direction === 'in' && !m.read_at;
    const acts = [
      ...(m.direction === 'in' ? [[unread ? 'Als gelesen markieren' : 'Als ungelesen markieren', () => markRead([m.id], unread)]] : []),
      ...(m.folder !== 'archive' ? [['Archivieren', () => moveTo([m.id], 'archive')]] : [['In den Posteingang', () => moveTo([m.id], 'inbox')]]),
      [m.folder === 'trash' ? 'Wiederherstellen' : 'Löschen', () => moveTo([m.id], m.folder === 'trash' ? 'inbox' : 'trash')],
    ];
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ options: [...acts.map((a) => a[0]), 'Abbrechen'], cancelButtonIndex: acts.length, destructiveButtonIndex: acts.length - 1, title: m.subject || '(ohne Betreff)' }, (i) => { if (i < acts.length) acts[i][1](); });
    else Alert.alert(m.subject || 'E-Mail', '', [...acts.map(([t, fn]) => ({ text: t, onPress: fn })), { text: 'Abbrechen', style: 'cancel' }]);
  };
  useEffect(() => { const t = setTimeout(() => load(), q ? 350 : 0); return () => clearTimeout(t); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const cnt = d?.counts || {};
  const row = ({ item: m }) => {
    const unread = m.direction === 'in' && !m.read_at;
    const name = m.direction === 'in' ? (m.from_name || m.from_email) : `An: ${(m.to_emails || []).join(', ') || '–'}`;
    const addr = m.direction === 'in' && m.from_name && m.from_name.toLowerCase() !== String(m.from_email).toLowerCase() ? m.from_email : null;
    const threat = m.auth?.threat?.score >= 5;
    return (
      <Pressable onPress={() => open(m)} onLongPress={() => menu(m)} delayLongPress={350} style={({ pressed }) => [{ backgroundColor: pressed ? '#F8FAFC' : '#fff', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', gap: 10 }]}>
        <View style={{ width: 8, paddingTop: 7 }}>{unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.blue }} /> : null}</View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={[s.row, { gap: 6 }]}>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 15.5, fontWeight: unread ? '800' : '600', color: C.text }}>{name}</Text>
            {m.starred ? <Ionicons name="star" size={14} color="#F59E0B" /> : null}
            {(m.attachments || []).some((a) => !a.inline) ? <Ionicons name="attach" size={15} color={C.mute} /> : null}
            <Text style={{ fontSize: 12.5, color: C.mute }}>{when(m)}</Text>
          </View>
          {addr ? <Text numberOfLines={1} style={{ fontSize: 12.5, color: C.mute }}>{addr}</Text> : null}
          <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: unread ? '700' : '500', color: C.navy }}>{m.subject || '(ohne Betreff)'}</Text>
          <Text numberOfLines={2} style={{ fontSize: 13.5, color: C.sub }}>{m.snippet || ''}</Text>
          <View style={[s.row, { gap: 6, marginTop: 2 }]}>
            {threat ? <Badge text="Phishing-Verdacht" tone="bad" /> : null}
            {m.status === 'entwurf' ? <Badge text={m.design === 'fertig' ? 'Fertige Vorlage' : 'Entwurf'} tone="info" /> : null}
            {m.status === 'fehler' ? <Badge text="Senden fehlgeschlagen" tone="bad" /> : null}
            {m.status === 'gesperrt' ? <Badge text="Empfänger abgemeldet" tone="warn" /> : null}
            {m.direction === 'out' && m.status === 'gesendet' ? <Badge text={m.auth?.delivery?.bounced_at ? 'Nicht zustellbar' : m.auth?.delivery?.opened_at ? 'Geöffnet' : m.auth?.delivery?.delivered_at ? 'Zugestellt' : 'Gesendet'} tone={m.auth?.delivery?.bounced_at ? 'bad' : m.auth?.delivery?.opened_at || m.auth?.delivery?.delivered_at ? 'ok' : 'neutral'} /> : null}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Hero kicker={d?.mailbox || 'support@leaserun.com'} title="Postfach" right={<HeroBtn title="Neu" icon={<Ionicons name="create-outline" size={18} color="#fff" />} onPress={() => router.push('/mail/compose')} />}>
        <View style={[s.row, { backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 12, paddingHorizontal: 12 }]}>
          <Ionicons name="search" size={17} color={C.mute} />
          <TextInput value={q} onChangeText={setQ} placeholder="E-Mails durchsuchen" placeholderTextColor="#94A3B8" style={{ flex: 1, paddingVertical: 10, fontSize: 16, color: C.text }} autoCapitalize="none" clearButtonMode="while-editing" />
        </View>
      </Hero>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
          {FOLDERS.map(([k, l]) => {
            const n = k === 'inbox' ? cnt.inbox : k === 'drafts' ? cnt.drafts : k === 'spam' ? cnt.spam : 0;
            const on = folder === k;
            return <Pressable key={k} onPress={() => setFolder(k)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: on ? C.navy : '#fff', borderWidth: 1, borderColor: on ? C.navy : C.line }}><Text style={{ fontWeight: '700', color: on ? '#fff' : C.sub }}>{l}{n ? ` ${n}` : ''}</Text></Pressable>;
          })}
        </ScrollView>
        {folder === 'inbox' && cnt.inbox ? (
          <View style={[s.row, { justifyContent: 'space-between', paddingBottom: 8 }]}>
            <Text style={{ color: C.sub, fontWeight: '600' }}>{cnt.inbox} ungelesen</Text>
            <Btn small kind="ghost" title="Alle als gelesen markieren" onPress={() => markRead((d?.items || []).filter((m) => m.direction === 'in' && !m.read_at).map((m) => m.id), true)} />
          </View>
        ) : null}
      </View>
      {err ? <View style={{ padding: 16 }}><ErrorBox text={err} onRetry={() => load()} /></View> : !d ? <Loading /> : (
        <FlatList data={d.items || []} keyExtractor={(m) => m.id} renderItem={row} refreshControl={<RefreshControl refreshing={busy} onRefresh={() => load(true)} tintColor={C.blue} />}
          ListEmptyComponent={<Empty title="Keine E-Mails" text={folder === 'inbox' ? 'Neue E-Mails kommen auch als Mitteilung aufs Handy.' : undefined} />}
          ListFooterComponent={(d.items || []).length ? <Text style={[s.note, { textAlign: 'center', padding: 14 }]}>Tipp: E-Mail lange drücken für gelesen/ungelesen, Archiv und Löschen.</Text> : null} contentContainerStyle={{ paddingBottom: 30 }} />
      )}
    </View>
  );
}
