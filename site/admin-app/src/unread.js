// Anzahl ungelesener E-Mails im Posteingang – für das Abzeichen am Reiter „Postfach“ (gleicher Stand wie im Web-Admin).
import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';

let count = 0;
const subs = new Set();
export function setUnread(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v === count) return;
  count = v;
  subs.forEach((fn) => { try { fn(v); } catch { /* ignore */ } });
  Notifications.setBadgeCountAsync?.(v).catch(() => null);
}
export const adjustUnread = (d) => setUnread(count + d);
export function useUnread() {
  const [n, setN] = useState(count);
  useEffect(() => { subs.add(setN); return () => subs.delete(setN); }, []);
  return n;
}
