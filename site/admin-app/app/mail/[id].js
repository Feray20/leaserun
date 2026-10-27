import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { api, post } from '../../src/api';
import { Badge, Btn, C, Card, dtt, ErrorBox, Loading, Note, s } from '../../src/ui';
import { adjustUnread } from '../../src/unread';

const list = (t) => String(t || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const okMail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e);

const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// Höhe des E-Mail-Inhalts an den Rahmen melden, damit die Mail vollständig und ohne inneres Scrollen erscheint.
const FIT = `(() => { const send = () => window.ReactNativeWebView.postMessage(String(Math.ceil(document.documentElement.scrollHeight))); new ResizeObserver(send).observe(document.body); window.addEventListener('load', send); setTimeout(send, 300); setTimeout(send, 1200); })(); true;`;

function MailFrame({ html }) {
  const [h, setH] = useState(300);
  const loaded = useRef(false);
  const doc = /<meta name="viewport"/i.test(html) ? html : /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, '<head$1><meta name="viewport" content="width=device-width,initial-scale=1">') : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
  // Links aus der Mail öffnen im Browser bzw. Mail-Programm – nie innerhalb des Rahmens.
  const guard = (r) => {
    if (!loaded.current || /^(about:|data:)/.test(r.url) || r.url === 'https://leaserun.com/') return true;
    if (/^(https?:|mailto:|tel:)/.test(r.url)) Linking.openURL(r.url).catch(() => null);
    return false;
  };
  return (
    <WebView originWhitelist={['*']} source={{ html: doc, baseUrl: 'https://leaserun.com/' }} style={{ height: h, backgroundColor: 'transparent' }} scrollEnabled={false}
      injectedJavaScript={FIT} onMessage={(e) => { const n = Number(e.nativeEvent.data); if (n > 50) setH(Math.min(n + 8, 20000)); }}
      onLoadEnd={() => { loaded.current = true; }} javaScriptEnabled setSupportMultipleWindows={false} dataDetectorTypes="none" onShouldStartLoadWithRequest={guard} />
  );
}

// E-Mail anzeigen – genau so, wie der Kunde sie bekommt (gleiches HTML wie im Web-Admin), mit Anhängen und Aktionen.
export default function Mail() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const nav = useNavigation();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [rc, setRc] = useState({ to: '', cc: '', bcc: '' });

  const load = useCallback(async () => {
    setErr('');
    const r = await api(`/api/admin/mail?id=${id}`);
    if (!r.ok) { setErr(r.data?.error || 'E-Mail konnte nicht geladen werden.'); return; }
    setD(r.data);
    const mm = r.data.message || {};
    setRc({ to: (mm.to_emails || []).join(', '), cc: (mm.cc_emails || []).join(', '), bcc: (mm.bcc_emails || []).join(', ') });
    nav.setOptions({ title: r.data.message?.subject || 'E-Mail' });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const move = async (folder) => { setBusy(folder); const r = await post('/api/admin/mail', { action: 'mark', ids: [id], folder }); setBusy(''); if (r.ok) router.back(); else Alert.alert('Fehler', r.data?.error || 'Nicht möglich'); };
  const star = async () => { await post('/api/admin/mail', { action: 'mark', ids: [id], starred: !d.message.starred }); load(); };

  const openFile = async (msgId, i, a) => {
    setBusy('f' + i);
    try {
      const r = await api(`/api/admin/mail?file=${encodeURIComponent(`${msgId}:${i}`)}`);
      if (!r.ok) throw new Error(r.data?.error || 'Anhang nicht verfügbar.');
      const safe = String(a.name || 'anhang').replace(/[^\w.\- ]+/g, '_');
      const target = new File(Paths.cache, `${Date.now()}-${safe}`);
      const f = await File.downloadFileAsync(r.data.url, target);
      const isImg = /^image\//.test(a.type || '') || /\.(jpe?g|png|heic|gif|webp)$/i.test(safe);
      const share = () => Sharing.shareAsync(f.uri, { dialogTitle: safe, mimeType: a.type || undefined });
      const toPhotos = async () => { const p = await MediaLibrary.requestPermissionsAsync(true); if (!p.granted) { Alert.alert('Keine Berechtigung', 'Bitte in den Einstellungen den Zugriff auf Fotos erlauben.'); return; } await MediaLibrary.saveToLibraryAsync(f.uri); Alert.alert('Gespeichert', 'Das Bild liegt jetzt in Ihren Fotos.'); };
      if (isImg && Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ options: ['In Fotos sichern', 'Teilen / in Dateien sichern', 'Abbrechen'], cancelButtonIndex: 2, title: safe }, (k) => { if (k === 0) toPhotos(); if (k === 1) share(); });
      else if (isImg) Alert.alert(safe, '', [{ text: 'In Fotos sichern', onPress: toPhotos }, { text: 'Teilen', onPress: share }, { text: 'Abbrechen', style: 'cancel' }]);
      else await share();
    } catch (e) { Alert.alert('Anhang', e.message || 'Download fehlgeschlagen.'); } finally { setBusy(''); }
  };

  const unsub = async () => {
    setBusy('unsub');
    const r = await post('/api/admin/mail', { action: 'unsubscribe', id });
    setBusy('');
    if (r.data?.open) { Linking.openURL(r.data.open); return; }
    Alert.alert(r.ok ? 'Abbestellt' : 'Nicht möglich', r.ok ? `Die Abmeldung wurde gesendet (${r.data.how}). Weitere Mails dieses Absenders kommen ins Archiv.` : r.data?.error || 'Fehler');
    load();
  };

  // Entwurf senden – Empfänger lassen sich bis zuletzt ändern (auch bei fertigen Vorlagen).
  // Schickt den Entwurf genau so an Feray, wie der Empfänger ihn sähe – nicht an den Empfänger.
  const previewToMe = async () => {
    setBusy('preview');
    const r = await post('/api/admin/mail', { action: 'preview', id: d.message.id });
    setBusy('');
    Alert.alert(r.ok ? 'Vorschau gesendet' : 'Nicht gesendet', r.ok ? `An ${r.data.to} – so sieht der Empfänger die Mail.` : r.data?.error || 'Bitte erneut versuchen.');
  };
  const sendDraft = async () => {
    const m = d.message;
    const to = list(rc.to), cc = list(rc.cc), bcc = list(rc.bcc);
    const bad = [...to, ...cc, ...bcc].filter((e) => !okMail(e));
    if (!to.length) { Alert.alert('Bitte prüfen', 'Bitte mindestens einen Empfänger eintragen.'); return; }
    if (bad.length) { Alert.alert('Bitte prüfen', `Ungültige Adresse: ${bad.join(', ')}`); return; }
    if (!String(m.subject || '').trim()) { Alert.alert('Bitte prüfen', 'Der Entwurf hat keinen Betreff.'); return; }
    const ok = await new Promise((res) => Alert.alert('Jetzt senden?', `An: ${to.join(', ')}${cc.length ? `\nCc: ${cc.join(', ')}` : ''}${bcc.length ? `\nBcc: ${bcc.join(', ')}` : ''}\n\n„${m.subject}“`, [{ text: 'Abbrechen', style: 'cancel', onPress: () => res(false) }, { text: 'Senden', onPress: () => res(true) }], { cancelable: true, onDismiss: () => res(false) }));
    if (!ok) return;
    setBusy('send');
    const r = await post('/api/admin/mail', { action: 'send', id: m.id, to, cc, bcc });
    setBusy('');
    if (r.ok) { Alert.alert('Gesendet', 'Die E-Mail ist raus – mit Absender, Logo und Signatur wie im Web-Admin.'); router.back(); return; }
    Alert.alert('Nicht gesendet', r.data?.error || (r.status ? `Fehler ${r.status} – bitte erneut versuchen.` : 'Keine Verbindung. Bitte Netz prüfen.'));
    load();
  };

  const markUnread = async () => {
    setBusy('unread');
    const r = await post('/api/admin/mail', { action: 'mark', ids: [id], read: false });
    setBusy('');
    if (!r.ok) { Alert.alert('Nicht möglich', r.data?.error || 'Fehler'); return; }
    adjustUnread(1); router.back();
  };

  if (err) return <View style={{ padding: 16 }}><ErrorBox text={err} onRetry={load} /></View>;
  if (!d) return <Loading />;
  const m = d.message;
  const draft = m.direction === 'out' && m.status !== 'gesendet';
  const last = [...(d.thread || [])].reverse().find((x) => x.direction === 'in') || m;
  const th = m.auth?.threat;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 40, maxWidth: 900, width: '100%', alignSelf: 'center' }}>
      <Text style={{ fontSize: 20, fontWeight: '800', color: C.navy, paddingHorizontal: 4 }}>{m.subject || '(ohne Betreff)'}</Text>
      {th?.score >= 5 ? <Card style={{ backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }}><Text style={{ color: C.bad, fontWeight: '800' }}>Vorsicht – vermutlich Phishing oder Schadsoftware</Text><Note style={{ color: '#991B1B' }}>{th.reasons.join(' · ')}. Links und Bilder wurden entfernt; keine Anhänge öffnen.</Note></Card> : null}
      {m.direction === 'in' && m.auth?.unsub ? (
        <Card><View style={s.row}><Note style={{ flex: 1 }}>{m.auth.unsubscribed_at ? `Abbestellt am ${dtt(m.auth.unsubscribed_at)}.` : 'Newsletter oder Abo? Mit einem Tipp abbestellen – die Abmeldung geht automatisch an den Absender.'}</Note>{m.auth.unsubscribed_at ? <Badge text="Abbestellt" tone="ok" /> : <Btn small kind="outline" title="Abbestellen" onPress={unsub} busy={busy === 'unsub'} />}</View></Card>
      ) : null}
      {m.direction === 'out' && (m.research_url || m.research_summary || m.research_flag) ? (
        <Card style={{ backgroundColor: '#F0F9FF', borderColor: '#BAE6FD', gap: 6 }}>
          <Text style={{ fontWeight: '800', color: C.navy }}>Recherche zum Empfänger</Text>
          <Note>Nur intern – wird nicht mitgesendet.</Note>
          {m.research_flag && draft ? <Badge text={m.research_flag} tone="bad" /> : null}
          {m.research_summary ? <Text style={{ color: C.text, fontSize: 14.5, lineHeight: 21 }} selectable>{m.research_summary}</Text> : null}
          {/^https:\/\//.test(m.research_url || '') ? (
            <Pressable onPress={() => Linking.openURL(m.research_url).catch(() => null)} accessibilityRole="link">
              <Note>Adresse gefunden auf: <Text style={{ color: C.blue, fontWeight: '700' }}>{m.research_url.replace(/^https:\/\/(www\.)?/, '').slice(0, 70)}</Text>{m.research_checked_at ? ` · geprüft ${dtt(m.research_checked_at)}` : ''}</Note>
            </Pressable>
          ) : null}
        </Card>
      ) : null}
      {(d.thread || []).map((x) => (
        <Card key={x.id} style={{ padding: 0, overflow: 'hidden' }}>
          <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: C.line, gap: 3 }}>
            {x.direction === 'in' ? (
              <><Text style={{ fontWeight: '800', color: C.text, fontSize: 15.5 }}>{x.from_name || x.from_email}</Text><Text style={{ color: C.blue, fontSize: 13.5 }} selectable>{x.from_email}</Text></>
            ) : <Text style={{ fontWeight: '800', color: C.text }}>LeaseRun · {x.from_email}</Text>}
            <Note selectable>an {(x.to_emails || []).join(', ')}{(x.cc_emails || []).length ? ` · Cc ${x.cc_emails.join(', ')}` : ''}{x.direction === 'out' && (x.bcc_emails || []).length ? ` · Bcc ${x.bcc_emails.join(', ')}` : ''}</Note>
            <Note>{dtt(x.received_at || x.sent_at || x.created_at)}{x.status && x.direction === 'out' ? ` · ${x.status === 'gesendet' ? 'gesendet' : x.status === 'entwurf' ? (x.design === 'fertig' ? 'fertige Vorlage – so sieht sie der Empfänger' : 'Entwurf – Vorschau wie beim Empfänger') : x.status}` : ''}</Note>
            <View style={[s.row, { gap: 6, flexWrap: 'wrap', marginTop: 2 }]}>
              {x.direction === 'in' && x.read_at ? <Badge text={`Gelesen ${dtt(x.read_at)}`} tone="neutral" /> : null}
              {x.direction === 'out' && x.status === 'gesendet' ? (x.auth?.delivery?.bounced_at ? <Badge text="Nicht zustellbar" tone="bad" /> : x.auth?.delivery?.opened_at ? <Badge text={`Geöffnet ${dtt(x.auth.delivery.opened_at)}`} tone="ok" /> : x.auth?.delivery?.delivered_at ? <Badge text={`Zugestellt ${dtt(x.auth.delivery.delivered_at)}`} tone="ok" /> : <Badge text="Gesendet" tone="neutral" />) : null}
              {x.status === 'fehler' && x.error ? <Badge text={`Fehler: ${String(x.error).slice(0, 80)}`} tone="bad" /> : null}
            </View>
          </View>
          {x.view ? <MailFrame html={x.view} /> : null}
          {(x.attachments || []).filter((a) => !a.inline || x.direction === 'out').length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: C.line }}>
              {x.attachments.map((a, i) => (a.inline && x.direction === 'in' ? null : (
                <Pressable key={i} onPress={() => openFile(x.id, i, a)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#F8FAFC' }}>
                  <Ionicons name={/^image\//.test(a.type || '') ? 'image-outline' : 'document-attach-outline'} size={16} color={C.navy} />
                  <Text style={{ fontWeight: '600', color: C.navy, maxWidth: 200 }} numberOfLines={1}>{a.name}</Text><Text style={{ color: C.mute, fontSize: 12 }}>{busy === 'f' + i ? 'lädt …' : kb(a.size)}</Text>
                </Pressable>)))}
            </View>
          ) : null}
        </Card>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {draft ? (
          <>
            <Card style={{ width: '100%', gap: 2, paddingVertical: 8 }}>
              {[['An', 'to', 'name@firma.de'], ['Cc', 'cc', 'optional'], ['Bcc', 'bcc', 'optional, unsichtbar']].map(([l, k, ph]) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: k === 'bcc' ? 0 : 1, borderBottomColor: C.line }}>
                  <Text style={{ width: 44, color: C.mute, fontWeight: '600' }}>{l}</Text>
                  <TextInput value={rc[k]} onChangeText={(t) => setRc((x) => ({ ...x, [k]: t }))} placeholder={ph} placeholderTextColor="#94A3B8" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={{ flex: 1, paddingVertical: 10, fontSize: 16, color: C.text }} />
                </View>
              ))}
            </Card>
            <Btn title="Senden" onPress={sendDraft} busy={busy === 'send'} style={{ flexGrow: 1 }} />
            <Btn kind="outline" title="Vorschau an mich" onPress={previewToMe} busy={busy === 'preview'} style={{ flexGrow: 1 }} />
            {m.design === 'frei' ? <Btn kind="outline" title="Bearbeiten" onPress={() => router.push({ pathname: '/mail/compose', params: { edit: m.id } })} style={{ flexGrow: 1 }} /> : null}
          </>
        ) : (
          <>
            <Btn title="Antworten" onPress={() => router.push({ pathname: '/mail/compose', params: { replyTo: last.id, to: last.direction === 'in' ? last.from_email : (last.to_emails || [])[0] || '', subject: /^(re|aw):/i.test(m.subject) ? m.subject : `Re: ${m.subject}` } })} style={{ flexGrow: 1 }} />
            <Btn kind="outline" title="Weiterleiten" onPress={() => router.push({ pathname: '/mail/compose', params: { forward: m.id, subject: /^(wg|fwd?):/i.test(m.subject) ? m.subject : `WG: ${m.subject}` } })} style={{ flexGrow: 1 }} />
          </>
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Btn small kind="outline" title={m.starred ? 'Markierung entfernen' : 'Markieren'} onPress={star} />
        {m.direction === 'in' ? <Btn small kind="outline" title="Als ungelesen markieren" onPress={markUnread} busy={busy === 'unread'} /> : null}
        <Btn small kind="outline" title="Archivieren" onPress={() => move('archive')} busy={busy === 'archive'} />
        {m.folder === 'spam' ? <Btn small kind="outline" title="Kein Spam" onPress={() => move('inbox')} /> : m.direction === 'in' ? <Btn small kind="outline" title="Spam" onPress={() => move('spam')} /> : null}
        <Btn small kind="danger" title={m.folder === 'trash' ? 'Wiederherstellen' : 'Löschen'} onPress={() => move(m.folder === 'trash' ? 'inbox' : 'trash')} busy={busy === 'trash'} />
      </View>
      {m.direction === 'in' ? <Note style={{ paddingHorizontal: 4 }}>Bilder werden geschützt über leaserun.com geladen – der Absender sieht weder Ihre IP-Adresse noch Ihr Gerät.</Note> : null}
    </ScrollView>
  );
}
