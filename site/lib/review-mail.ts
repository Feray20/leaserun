import type Stripe from 'stripe';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { reviewCfg } from '@/lib/reviews';

// Nach einem bezahlten Kauf: einmalig um eine ehrliche Google-Bewertung bitten – nur wenn der Kunde im Kaufdialog
// ausdrücklich eingewilligt hat (metadata.review_ok = '1'), ohne Gegenleistung und an alle Käufer gleich.
export async function sendReviewRequest(s: Stripe.Checkout.Session): Promise<void> {
  if (s.payment_status !== 'paid' || s.metadata?.review_ok !== '1' || s.metadata?.leaserun_test === '1') return;
  const to = s.customer_details?.email || s.customer_email;
  if (!to || !adminConfigured() || !mailConfigured()) return;
  const { reviewUrl } = await reviewCfg();
  if (!reviewUrl) return;
  const db = supabaseAdmin();
  const ins = await db.from('lr_review_requests').insert({ session_id: s.id, user_id: s.metadata?.supabase_user_id || null, area: s.metadata?.b2b_account_id ? 'b2b' : 'b2c' });
  if (ins.error) return; // bereits gesendet (doppelte Zustellung des Webhooks)
  await sendMail(to, 'Kurze Frage zu Ihrem Kauf bei LeaseRun',
    'Guten Tag,\n\ndanke für Ihren Kauf. Wie war Ihre Erfahrung mit LeaseRun? Eine kurze, ehrliche Bewertung bei Google hilft anderen Käufern, egal ob sie gut oder kritisch ausfällt.\n\nWenn etwas nicht gepasst hat, können Sie mir auch direkt auf diese E-Mail antworten.\n\nDiese einmalige E-Mail erhalten Sie, weil Sie beim Kauf eingewilligt haben. Weitere Bitten um Bewertungen senden wir nicht.',
    [], { title: 'Wie zufrieden sind Sie?', button: { label: 'Kurz bei Google bewerten', url: reviewUrl }, area: s.metadata?.b2b_account_id ? 'b2b' : 'b2c' });
}
