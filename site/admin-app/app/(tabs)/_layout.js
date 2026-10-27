import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../src/ui';
import { api } from '../../src/api';
import { setUnread, useUnread } from '../../src/unread';

// Hauptbereiche: HQ (Entscheidungen wie im Web), Zahlungen, Termine, Postfach, Statistik – alles Weitere unter „Mehr“.
const ICON = { hq: 'planet', zahlungen: 'card', termine: 'calendar', postfach: 'mail', statistik: 'stats-chart', mehr: 'ellipsis-horizontal-circle' };
export default function TabsLayout() {
  const unread = useUnread();
  useEffect(() => {
    const pull = () => api('/api/admin/mail?folder=inbox').then((r) => { if (r.ok) setUnread(r.data?.counts?.inbox || 0); }).catch(() => null);
    pull();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') pull(); });
    return () => sub.remove();
  }, []);
  return (
    <Tabs screenOptions={({ route }) => ({
      headerShown: false,
      tabBarActiveTintColor: C.navy,
      tabBarInactiveTintColor: '#94A3B8',
      tabBarLabelStyle: { fontSize: 11.5, fontWeight: '700' },
      tabBarStyle: { borderTopColor: C.line, backgroundColor: '#fff' },
      tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? ICON[route.name] : `${ICON[route.name]}-outline`} size={size} color={color} />,
    })}>
      <Tabs.Screen name="hq" options={{ title: 'HQ' }} />
      <Tabs.Screen name="zahlungen" options={{ title: 'Zahlungen' }} />
      <Tabs.Screen name="termine" options={{ title: 'Termine' }} />
      <Tabs.Screen name="postfach" options={{ title: 'Postfach', tabBarBadge: unread ? (unread > 99 ? '99+' : unread) : undefined, tabBarBadgeStyle: { backgroundColor: '#0284C7', color: '#fff', fontSize: 11, fontWeight: '700' } }} />
      <Tabs.Screen name="statistik" options={{ title: 'Statistik' }} />
      <Tabs.Screen name="mehr" options={{ title: 'Mehr' }} />
    </Tabs>
  );
}
