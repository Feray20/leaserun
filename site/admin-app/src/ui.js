// LeaseRun-Stil für die App: Navy #0F2C59, Blau #0369A1, Akzent #38BDF8, ruhige Flächen, runde Karten.
import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

export const C = { navy: '#0F2C59', blue: '#0369A1', sky: '#38BDF8', bg: '#F1F5F9', card: '#FFFFFF', line: '#E2E8F0', text: '#0F172A', sub: '#475569', mute: '#64748B', ok: '#047857', okBg: '#D1FAE5', warn: '#92400E', warnBg: '#FEF3C7', bad: '#B91C1C', badBg: '#FEE2E2', infoBg: '#DBEAFE', info: '#1E40AF' };

export const eur = (c) => (Number(c || 0) / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
export const num = (n) => Number(n || 0).toLocaleString('de-DE');
export const dt = (s) => (s ? new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–');
export const dtt = (s) => (s ? new Date(s).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
export const ago = (s) => { if (!s) return ''; const m = Math.round((Date.now() - new Date(s)) / 60000); return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} Min.` : m < 1440 ? `vor ${Math.round(m / 60)} Std.` : dt(s); };

// LeaseRun-Verlauf wie auf leaserun.com (Navy → Blau → Himmelblau).
export const GRAD = ['#0F2C59', '#0B3B73', '#0369A1', '#0284C7'];
export function Bar() {
  return <LinearGradient colors={[C.navy, C.blue, C.sky]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 4 }} />;
}

// Kopfbereich im LeaseRun-Stil: Verlauf bis unter die Statusleiste, weiche Rundung unten, weiße Schrift.
export function Hero({ kicker, title, right, children, compact }) {
  const ins = useSafeAreaInsets();
  return (
    <LinearGradient colors={GRAD} locations={[0, 0.35, 0.75, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.hero, { paddingTop: ins.top + (compact ? 8 : 14) }]}>
      <View pointerEvents="none" style={s.heroGlow} />
      <View style={s.heroIn}>
        <View style={s.heroRow}>
          <View style={{ flex: 1, minWidth: 0 }}>{kicker ? <Text style={s.heroK} numberOfLines={1}>{kicker}</Text> : null}<Text style={s.heroT} numberOfLines={1}>{title}</Text></View>
          {right}
        </View>
        {children}
      </View>
    </LinearGradient>
  );
}

// Knopf auf dem Verlauf (hell, halbtransparent).
export function HeroBtn({ title, icon, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [s.heroBtn, pressed && { opacity: 0.75 }]}>
      {icon}{title ? <Text style={s.heroBtnT}>{title}</Text> : null}
    </Pressable>
  );
}

// inStack: Seite mit eigener Navigationsleiste (Verlauf kommt dann aus der Leiste) – nur Inhalt.
export function Screen({ title, kicker, children, refreshing, onRefresh, right, scroll = true, inStack }) {
  const head = inStack ? null : <Hero kicker={kicker} title={title} right={right} />;
  const body = <View style={s.body}>{children}</View>;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={inStack ? C.blue : '#fff'} progressViewOffset={inStack ? 0 : 40} /> : undefined} keyboardShouldPersistTaps="handled" style={{ backgroundColor: C.bg }}>
          {!inStack ? <View style={s.bounce} /> : null}
          {head}{body}
        </ScrollView>
      ) : <View style={{ flex: 1 }}>{head}{children}</View>}
    </View>
  );
}

// Navigationsleiste (Unterseiten) im selben Verlauf – für Stack.Screen options.headerBackground.
export const headerGradient = () => <LinearGradient colors={GRAD} locations={[0, 0.35, 0.75, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }} />;
export const stackHeader = { headerShown: true, headerBackground: headerGradient, headerTintColor: '#fff', headerTitleStyle: { color: '#fff', fontWeight: '700' }, headerShadowVisible: false };

export const Card = ({ children, style, onPress }) => (onPress
  ? <Pressable onPress={onPress} style={({ pressed }) => [s.card, style, pressed && { opacity: 0.75 }]}>{children}</Pressable>
  : <View style={[s.card, style]}>{children}</View>);

export const H2 = ({ children, style }) => <Text style={[s.h2, style]}>{children}</Text>;
export const Note = ({ children, style }) => <Text style={[s.note, style]}>{children}</Text>;

export function Btn({ title, onPress, kind = 'dark', disabled, busy, small, style }) {
  const k = { dark: [C.navy, '#fff'], pay: ['#000', '#fff'], blue: [C.blue, '#fff'], outline: ['#fff', C.navy], danger: [C.bad, '#fff'], ghost: ['transparent', C.blue] }[kind];
  return (
    <Pressable disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [s.btn, small && s.btnSm, { backgroundColor: k[0], borderColor: kind === 'outline' ? C.line : k[0] }, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.8 }, style]}>
      {busy ? <ActivityIndicator color={k[1]} /> : <Text style={[s.btnT, small && { fontSize: 14 }, { color: k[1] }]}>{title}</Text>}
    </Pressable>
  );
}

export function Badge({ text, tone = 'neutral' }) {
  const t = { ok: [C.okBg, C.ok], warn: [C.warnBg, C.warn], bad: [C.badBg, C.bad], info: [C.infoBg, C.info], neutral: ['#F1F5F9', C.sub] }[tone] || ['#F1F5F9', C.sub];
  return <View style={[s.badge, { backgroundColor: t[0] }]}><Text style={[s.badgeT, { color: t[1] }]}>{text}</Text></View>;
}

export function Seg({ items, value, onChange }) {
  return (
    <View style={s.seg}>{items.map(([k, l]) => (
      <Pressable key={k} onPress={() => onChange(k)} style={[s.segB, value === k && s.segOn]}><Text style={[s.segT, value === k && { color: '#fff' }]}>{l}</Text></Pressable>
    ))}</View>
  );
}

export function Kpi({ label, value, sub, tone }) {
  return (
    <View style={s.kpi}><Text style={s.kpiL}>{label}</Text><Text style={[s.kpiV, tone === 'bad' && { color: C.bad }, tone === 'ok' && { color: C.ok }]}>{value}</Text>{sub ? <Text style={s.kpiS}>{sub}</Text> : null}</View>
  );
}

export const Loading = ({ text = 'Wird geladen …' }) => <View style={{ padding: 30, alignItems: 'center' }}><ActivityIndicator color={C.blue} /><Text style={[s.note, { marginTop: 10 }]}>{text}</Text></View>;
export const Empty = ({ title, text }) => <View style={s.empty}><Text style={s.emptyT}>{title}</Text>{text ? <Text style={[s.note, { textAlign: 'center' }]}>{text}</Text> : null}</View>;
export const ErrorBox = ({ text, onRetry }) => <Card style={{ borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' }}><Text style={{ color: C.bad, fontWeight: '600' }}>{text}</Text>{onRetry ? <Btn small kind="outline" title="Erneut versuchen" onPress={onRetry} style={{ marginTop: 10, alignSelf: 'flex-start' }} /> : null}</Card>;

export const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginBottom: 14, marginTop: 6 },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: C.blue, textTransform: 'uppercase' },
  h1: { fontSize: 28, fontWeight: '800', color: C.navy, letterSpacing: -0.4 },
  h2: { fontSize: 17, fontWeight: '800', color: C.navy, marginBottom: 8 },
  body: { padding: 16, paddingBottom: 24, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' },
  hero: { paddingBottom: 22, paddingHorizontal: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, overflow: 'hidden' },
  heroGlow: { position: 'absolute', right: -80, top: -90, width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(56,189,248,0.28)' },
  heroIn: { maxWidth: 900, width: '100%', alignSelf: 'center', gap: 12 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  heroK: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: '#BAE6FD', textTransform: 'uppercase' },
  heroT: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: -0.4, marginTop: 2 },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  heroBtnT: { color: '#fff', fontWeight: '700', fontSize: 15 },
  bounce: { position: 'absolute', top: -600, left: 0, right: 0, height: 620, backgroundColor: '#0F2C59' },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16, shadowColor: '#0F172A', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  note: { fontSize: 13.5, color: C.mute, lineHeight: 19 },
  btn: { minHeight: 48, borderRadius: 999, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  btnSm: { minHeight: 38, paddingHorizontal: 14 },
  btnT: { fontSize: 16, fontWeight: '700' },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeT: { fontSize: 12, fontWeight: '700' },
  seg: { flexDirection: 'row', backgroundColor: '#E2E8F0', borderRadius: 999, padding: 3 },
  segB: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center' },
  segOn: { backgroundColor: C.navy },
  segT: { fontSize: 14, fontWeight: '700', color: C.sub },
  kpi: { flexBasis: '47%', flexGrow: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14 },
  kpiL: { fontSize: 12.5, color: C.mute, fontWeight: '600' },
  kpiV: { fontSize: 22, fontWeight: '800', color: C.navy, marginTop: 4 },
  kpiS: { fontSize: 12, color: C.mute, marginTop: 2 },
  empty: { alignItems: 'center', padding: 28, gap: 6 },
  emptyT: { fontSize: 16, fontWeight: '700', color: C.navy },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.text, backgroundColor: '#fff' },
  label: { fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 6 },
});
