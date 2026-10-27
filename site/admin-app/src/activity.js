import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ago, C, Card, Note } from './ui';

const IC = { payment: ['card', '#047857'], payment_failed: ['alert-circle', '#B91C1C'], booking: ['calendar', '#0369A1'], lead: ['chatbubbles', '#0369A1'], company: ['business', '#0F2C59'], security: ['shield', '#B91C1C'], device: ['phone-portrait', '#475569'], admin: ['person', '#475569'], check: ['checkmark-done', '#047857'] };
export function Activity({ items }) {
  if (!items?.length) return <Note>Noch keine Aktivität.</Note>;
  return (
    <Card style={{ padding: 0 }}>{items.map((a, i) => { const [ic, col] = IC[a.kind] || ['ellipse', '#64748B']; return (
      <View key={a.id || i} style={{ flexDirection: 'row', gap: 12, padding: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
        <Ionicons name={ic} size={18} color={col} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.text }}>{a.title}</Text>{a.detail ? <Note numberOfLines={2}>{a.detail}</Note> : null}</View>
        <Note>{ago(a.at)}</Note>
      </View>); })}</Card>
  );
}
