import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, post } from '../../src/api';
import { Btn, C, Note, s } from '../../src/ui';

const list = (t) => String(t || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const okMail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e);
const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const toHtml = (t) => t.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
const fromHtml = (h) => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

// Neue E-Mail / Antwort / Weiterleitung – mit An, Cc, Bcc. Versand über leaserun.com mit denselben Einstellungen wie im
// Web-Admin: Absender support@leaserun.com, Logo, Signatur, Abmeldelink, DKIM-Signatur. Vorschau zeigt exakt die Kunden-Ansicht.
export default function Compose() {
  const p = useLocalSearchParams();
  const router = useRouter();
  const [to, setTo] = useState(String(p.to || ''));
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(String(p.subject || ''));
  const [text, setText] = useState('');
  const [unsub, setUnsub] = useState(!p.replyTo);
  const [id, setId] = useState(p.edit ? String(p.edit) : null);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null);

  useEffect(() => { if (!p.edit) return; api(`/api/admin/mail?id=${p.edit}`).then((r) => { const m = r.data?.message; if (!m) return; setTo((m.to_emails || []).join(', ')); setCc((m.cc_emails || []).join(', ')); setBcc((m.bcc_emails || []).join(', ')); setShowCc(Boolean((m.cc_emails || []).length || (m.bcc_emails || []).length)); setSubject(m.subject || ''); setText(fromHtml(m.html)); setUnsub(Boolean(m.with_unsub)); }); }, [p.edit]);

  const payload = (extra) => ({ action: 'save', ...(id ? { id } : {}), to: list(to), cc: list(cc), bcc: list(bcc), subject, body: toHtml(text), withUnsub: unsub, ...(p.replyTo && !id ? { replyTo: String(p.replyTo) } : {}), ...(p.forward && !id ? { forward: String(p.forward) } : {}), ...extra });
  const check = () => {
    const bad = [...list(to), ...list(cc), ...list(bcc)].filter((e) => !okMail(e));
    if (!list(to).length) return 'Bitte mindestens einen Empfänger eintragen.';
    if (bad.length) return `Ungültige Adresse: ${bad.join(', ')}`;
    if (!subject.trim()) return 'Bitte einen Betreff eingeben.';
    if (!text.trim()) return 'Bitte einen Text schreiben.';
    return '';
  };

  const save = async () => {
    setBusy('save'); const r = await post('/api/admin/mail', payload({})); setBusy('');
    if (!r.ok) { Alert.alert('Nicht gespeichert', r.data?.error || 'Fehler'); return; }
    setId(r.data.id); Alert.alert('Gespeichert', 'Der Entwurf liegt im Postfach unter „Entwürfe“ – auch im Web-Admin.');
  };
  const showPreview = async () => {
    setBusy('pv'); const r = await post('/api/admin/mail', payload({ preview: true })); setBusy('');
    if (r.ok) setPreview(r.data.preview); else Alert.alert('Vorschau', r.data?.error || 'Fehler');
  };
  const send = async () => {
    const e = check(); if (e) { Alert.alert('Bitte prüfen', e); return; }
    const ok = await new Promise((res) => Alert.alert('Jetzt senden?', `An: ${list(to).join(', ')}${list(cc).length ? `\nCc: ${list(cc).join(', ')}` : ''}${list(bcc).length ? `\nBcc: ${list(bcc).join(', ')}` : ''}`, [{ text: 'Abbrechen', style: 'cancel', onPress: () => res(false) }, { text: 'Senden', onPress: () => res(true) }]));
    if (!ok) return;
    setBusy('send'); const r = await post('/api/admin/mail', payload({ send: true })); setBusy('');
    if (r.data?.id) setId(r.data.id);
    if (!r.ok) { Alert.alert('Nicht gesendet', r.data?.error || (r.status ? `Fehler ${r.status} – bitte erneut versuchen.` : 'Keine Verbindung. Bitte Netz prüfen.')); return; }
    Alert.alert('Gesendet', 'Die E-Mail ist unterwegs.'); router.back();
  };

  const F = ({ label, value, onChange, ph, kb = 'email-address' }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 4 }}>
      <Text style={{ width: 54, color: C.mute, fontWeight: '600' }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={ph} autoCapitalize="none" autoCorrect={false} keyboardType={kb} style={{ flex: 1, paddingVertical: 10, fontSize: 16, color: C.text }} />
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#fff' }} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 6, maxWidth: 800, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Note>Von: LeaseRun &lt;support@leaserun.com&gt;</Note>
        {F({ label: 'An', value: to, onChange: setTo, ph: 'name@firma.de' })}
        {showCc ? (<>{F({ label: 'Cc', value: cc, onChange: setCc, ph: 'optional' })}{F({ label: 'Bcc', value: bcc, onChange: setBcc, ph: 'unsichtbar für alle anderen' })}</>)
          : <Btn small kind="ghost" title="Cc / Bcc hinzufügen" onPress={() => setShowCc(true)} style={{ alignSelf: 'flex-start' }} />}
        {F({ label: 'Betreff', value: subject, onChange: setSubject, ph: '', kb: 'default' })}
        <TextInput value={text} onChangeText={setText} multiline placeholder="Ihre Nachricht – Anrede, Text. Signatur, Logo und Fußzeile im LeaseRun-Design kommen automatisch dazu." style={{ minHeight: 220, fontSize: 16, lineHeight: 23, paddingVertical: 12, textAlignVertical: 'top', color: C.text }} />
        <View style={[s.row, { paddingVertical: 6 }]}><Text style={{ flex: 1, color: C.sub }}>Abmeldelink in der Fußzeile (für Akquise-Mails)</Text><Switch value={unsub} onValueChange={setUnsub} /></View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          <Btn title="Senden" onPress={send} busy={busy === 'send'} style={{ flexGrow: 2 }} />
          <Btn kind="outline" title="Vorschau" onPress={showPreview} busy={busy === 'pv'} style={{ flexGrow: 1 }} />
          <Btn kind="outline" title="Entwurf" onPress={save} busy={busy === 'save'} style={{ flexGrow: 1 }} />
        </View>
      </ScrollView>
      <Modal visible={!!preview} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPreview(null)}>
        <View style={{ flex: 1, backgroundColor: '#EEF2F7' }}>
          <View style={[s.row, { padding: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line }]}><Text style={{ flex: 1, fontWeight: '800', color: C.navy, fontSize: 16 }}>So sieht der Empfänger die E-Mail</Text><Btn small kind="outline" title="Schließen" onPress={() => setPreview(null)} /></View>
          {preview ? <WebView originWhitelist={['*']} source={{ html: preview, baseUrl: 'https://leaserun.com/' }} style={{ flex: 1 }} /> : null}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
