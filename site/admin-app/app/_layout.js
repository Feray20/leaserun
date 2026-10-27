import React, { useEffect, useRef, useState } from 'react';
import { AppState, Image, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import { getSession, loadSession, onSession } from '../src/api';
import { registerPush, routeFor } from '../src/push';
import { LinearGradient } from 'expo-linear-gradient';
import { Btn, C, GRAD, stackHeader } from '../src/ui';

// Wurzel: Anmeldung prüfen, Face ID beim Öffnen, Mitteilungen anmelden und beim Antippen direkt in den passenden Bereich.
export default function Root() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [locked, setLocked] = useState(false);
  const router = useRouter();
  const seg = useSegments();
  const bg = useRef(0);

  const unlock = async () => {
    const has = await LocalAuthentication.hasHardwareAsync().catch(() => false);
    const enrolled = has && (await LocalAuthentication.isEnrolledAsync().catch(() => false));
    if (!enrolled) { setLocked(false); return; }
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'LeaseRun Admin entsperren', cancelLabel: 'Abbrechen', disableDeviceFallback: false });
    setLocked(!r.success);
  };

  useEffect(() => {
    loadSession().then((s) => { setAuthed(Boolean(s)); setReady(true); if (s) { setLocked(true); unlock(); } });
    const off = onSession((s) => setAuthed(Boolean(s)));
    // Nach mehr als 5 Minuten im Hintergrund erneut mit Face ID entsperren.
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') bg.current = Date.now();
      if (st === 'active' && bg.current && Date.now() - bg.current > 5 * 60_000 && getSession()) { setLocked(true); unlock(); }
    });
    return () => { off(); sub.remove(); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const inLogin = seg[0] === 'login';
    if (!authed && !inLogin) router.replace('/login');
    if (authed && inLogin) router.replace('/hq');
    if (authed) registerPush().catch(() => null);
  }, [ready, authed, seg[0]]);

  useEffect(() => {
    const go = (resp) => { const d = resp?.notification?.request?.content?.data; if (d && getSession()) router.push(routeFor(d)); };
    Notifications.getLastNotificationResponseAsync().then(go).catch(() => null);
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" options={{ gestureEnabled: false }} />
        <Stack.Screen name="mail/[id]" options={{ ...stackHeader, title: 'E-Mail', headerBackTitle: 'Postfach' }} />
        <Stack.Screen name="mail/compose" options={{ presentation: 'modal', headerShown: true, title: 'Neue E-Mail' }} />
        <Stack.Screen name="mehr/aktivitaet" options={{ ...stackHeader, title: 'Aktivität & Hinweise', headerBackTitle: 'Mehr' }} />
        <Stack.Screen name="mehr/system" options={{ ...stackHeader, title: 'Systemstatus', headerBackTitle: 'Mehr' }} />
        <Stack.Screen name="mehr/probleme" options={{ ...stackHeader, title: 'Technische Probleme', headerBackTitle: 'Mehr' }} />
        <Stack.Screen name="mehr/unternehmen" options={{ ...stackHeader, title: 'Unternehmen', headerBackTitle: 'Mehr' }} />
        <Stack.Screen name="mehr/mitteilungen" options={{ ...stackHeader, title: 'Mitteilungen', headerBackTitle: 'Mehr' }} />
      </Stack>
      {locked && authed ? (
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 18 }}>
          <View style={{ width: 104, height: 104, borderRadius: 26, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } }}>
            <Image source={require('../assets/icon.png')} style={{ width: 104, height: 104, borderRadius: 26 }} />
          </View>
          <Text style={{ fontSize: 24, fontWeight: '800', color: '#fff' }}>LeaseRun Admin</Text>
          <Text style={{ color: '#DBEAFE', textAlign: 'center' }}>Gesperrt – bitte mit Face ID entsperren.</Text>
          <Btn kind="outline" title="Entsperren" onPress={unlock} style={{ alignSelf: 'stretch', maxWidth: 420, width: '100%' }} />
        </LinearGradient>
      ) : null}
    </SafeAreaProvider>
  );
}
