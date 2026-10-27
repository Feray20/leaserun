// Mitteilungen: Gerät bei leaserun.com anmelden (Expo Push). Kategorien: Zahlung, Postfach/Anfragen, Termin, Sicherheit/Angriff, Support.
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { post } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

export async function registerPush() {
  if (!Device.isDevice) return null;
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true, allowCriticalAlerts: false } }));
  if (status !== 'granted') return null;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'LeaseRun', importance: Notifications.AndroidImportance.HIGH, lightColor: '#0F2C59' });
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await post('/api/admin/push', { action: 'register', token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
  return token;
}

// Ziel in der App je Mitteilung.
export function routeFor(data) {
  const k = data?.kind, e = data?.event;
  if (k === 'payment') return '/zahlungen';
  if (k === 'mail') return '/postfach';
  if (k === 'booking') return '/termine';
  if (k === 'support' || e === 'support_ticket') return '/mehr/probleme';
  if (k === 'security') return '/mehr/aktivitaet';
  return '/zahlungen';
}
