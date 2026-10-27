import React, { useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { BASE, afterTokens, oauthUrl, providers, signIn, tokensFromUrl, verifyMfa } from '../src/api';
import { LinearGradient } from 'expo-linear-gradient';
import { Btn, C, GRAD, Note, s } from '../src/ui';

WebBrowser.maybeCompleteAuthSession();
const LAST = 'lr-admin-last-login';
const SSO = { apple: 'Apple', google: 'Google' };

// Anmeldung: E-Mail zuerst – die App erkennt, ob ein Konto besteht und ob es mit Apple/Google oder Passwort genutzt wird.
export default function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email'); // email | password | mfa
  const [mfa, setMfa] = useState(null);
  const [prov, setProv] = useState({});
  const [hint, setHint] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pwRef = useRef(null);

  useEffect(() => {
    providers().then(setProv);
    SecureStore.getItemAsync(LAST).then((x) => { try { const l = JSON.parse(x || 'null'); if (l?.email) { setEmail(l.email); if (l.method && SSO[l.method]) setHint(`Zuletzt auf diesem Gerät mit ${SSO[l.method]} angemeldet.`); } } catch { /* ignore */ } });
  }, []);

  const remember = (method) => SecureStore.setItemAsync(LAST, JSON.stringify({ email: email.trim().toLowerCase(), method })).catch(() => null);

  const next = async () => {
    setErr(''); const em = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(em)) { setErr('Bitte eine gültige E-Mail-Adresse eingeben.'); return; }
    setBusy(true);
    try {
      const r = await fetch(`${BASE}/api/auth/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: em }) });
      const d = await r.json().catch(() => ({}));
      if (d.known && !d.exists) { setErr('Zu dieser E-Mail gibt es kein Konto. Die Admin-App ist nur für Administratoren von leaserun.com.'); return; }
      const sso = (d.sso || []).filter((p) => SSO[p] && prov[p]);
      if (d.known && d.exists && !d.password && sso.length) { setHint(`Dieses Konto nutzt die Anmeldung mit ${sso.map((p) => SSO[p]).join(' oder ')}.`); return oauth(sso[0]); }
      setStep('password'); setTimeout(() => pwRef.current?.focus(), 150);
    } finally { setBusy(false); }
  };

  const login = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await signIn(email, pw);
      await remember('password');
      if (r.mfa) { setMfa(r); setStep('mfa'); }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const confirmMfa = async () => {
    setErr(''); setBusy(true);
    try { await verifyMfa(mfa.mfa, code, mfa.tmp); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const oauth = async (p) => {
    setErr(''); setBusy(true);
    try {
      const redirect = 'leaserun-admin://auth';
      const res = await WebBrowser.openAuthSessionAsync(await oauthUrl(p, redirect), redirect);
      if (res.type !== 'success') return;
      const t = tokensFromUrl(res.url);
      if (!t) { setErr('Anmeldung abgebrochen.'); return; }
      await remember(p);
      const r = await afterTokens(t);
      if (r.mfa) { setMfa(r); setStep('mfa'); }
    } catch (e) { setErr(e.message || 'Anmeldung fehlgeschlagen.'); } finally { setBusy(false); }
  };

  const ssoOn = Object.keys(SSO).filter((p) => prov[p]);
  return (
    <LinearGradient colors={GRAD} locations={[0, 0.35, 0.75, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 16, maxWidth: 480, width: '100%', alignSelf: 'center', flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Image source={require('../assets/icon.png')} style={{ width: 88, height: 88, borderRadius: 22 }} />
            <Text style={{ fontSize: 26, fontWeight: '800', color: '#fff' }}>Immo<Text style={{ color: '#7DD3FC' }}>Adv</Text> Admin</Text>
            <Note style={{ textAlign: 'center', color: '#DBEAFE' }}>Nur für Administratoren · zweiter Faktor · alle Aktionen werden protokolliert</Note>
          </View>
          <View style={{ backgroundColor: '#fff', borderRadius: 22, padding: 20, gap: 12, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } }}>

          {step === 'mfa' ? (
            <View style={{ gap: 12 }}>
              <Text style={s.label}>Code aus Ihrer Authenticator-App</Text>
              <TextInput style={[s.input, { fontSize: 24, letterSpacing: 8, textAlign: 'center' }]} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoFocus maxLength={6} onSubmitEditing={confirmMfa} />
              <Btn title="Bestätigen" onPress={confirmMfa} busy={busy} disabled={code.length !== 6} />
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <View><Text style={s.label}>E-Mail</Text>
                <TextInput style={s.input} value={email} onChangeText={(t) => { setEmail(t); if (step !== 'email') setStep('email'); }} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" autoComplete="email" returnKeyType="next" onSubmitEditing={next} editable={!busy} /></View>
              {step === 'password' ? (
                <View><Text style={s.label}>Passwort</Text>
                  <TextInput ref={pwRef} style={s.input} value={pw} onChangeText={setPw} secureTextEntry textContentType="password" autoComplete="password" returnKeyType="go" onSubmitEditing={login} /></View>
              ) : null}
              {hint ? <Note style={{ color: C.blue }}>{hint}</Note> : null}
              <Btn title={step === 'password' ? 'Anmelden' : 'Weiter'} onPress={step === 'password' ? login : next} busy={busy} />
              {ssoOn.length ? (
                <View style={{ gap: 10, marginTop: 6 }}>
                  <Note style={{ textAlign: 'center' }}>oder</Note>
                  {ssoOn.map((p) => <Btn key={p} kind={p === 'apple' ? 'pay' : 'outline'} title={`Weiter mit ${SSO[p]}`} onPress={() => oauth(p)} disabled={busy} />)}
                </View>
              ) : null}
            </View>
          )}
          {err ? <Text style={{ color: C.bad, fontWeight: '600', textAlign: 'center' }}>{err}</Text> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </LinearGradient>
  );
}
