import { createHmac } from 'node:crypto';
import { secretFor, verifySecrets } from '@/lib/security/secrets';
// Consent texts for marketing emails (double opt-in). Stored with every signup.
export const CONSENT_B2B = 'I want to receive LeaseRun for Business updates by email (new features, practical know-how, offers). I can unsubscribe at any time using the link in every email or by writing to support@leaserun.com.';
export const CONSENT_B2C = 'I want to receive LeaseRun updates by email (new features, real estate know-how, offers). I can unsubscribe at any time using the link in every email or by writing to support@leaserun.com.';
// Signup box "Home-buying checklist + rate update" (public pages): exactly the checkbox text, plus the purpose from the heading.
export const CONSENT_B2C_BOX = 'I want to receive the LeaseRun newsletter. Unsubscribe any time via the link in every email. (Signup box: home-buying checklist PDF + monthly mortgage rate update)';

// Unsubscribe link per recipient: ID plus signature (no stored secret per recipient).
const tok = (id: string, key: string) => `${id}.${createHmac('sha256', key).update('unsub:' + id).digest('base64url').slice(0, 22)}`;
export const unsubToken = (id: string) => tok(id, secretFor('newsletter'));
export function unsubId(t: string): string | null {
  const [id, sig] = String(t).split('.');
  if (!/^[0-9a-f-]{36}$/.test(id || '') || !sig) return null;
  return verifySecrets('newsletter').some((k) => tok(id, k) === t) ? id : null;
}
