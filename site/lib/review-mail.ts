import type Stripe from 'stripe';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { reviewCfg } from '@/lib/reviews';

// After a paid purchase: ask once for an honest Google review – only if the customer explicitly agreed at checkout
// (metadata.review_ok = '1'), with no incentive and the same for every buyer (FTC rules on reviews: no review gating,
// no incentives).
export async function sendReviewRequest(s: Stripe.Checkout.Session): Promise<void> {
  if (s.payment_status !== 'paid' || s.metadata?.review_ok !== '1' || s.metadata?.leaserun_test === '1') return;
  const to = s.customer_details?.email || s.customer_email;
  if (!to || !adminConfigured() || !mailConfigured()) return;
  const { reviewUrl } = await reviewCfg();
  if (!reviewUrl) return;
  const db = supabaseAdmin();
  const ins = await db.from('lr_review_requests').insert({ session_id: s.id, user_id: s.metadata?.supabase_user_id || null, area: s.metadata?.b2b_account_id ? 'b2b' : 'b2c' });
  if (ins.error) return; // already sent (webhook delivered twice)
  await sendMail(to, 'Quick question about your LeaseRun purchase',
    "Hi there,\n\nthanks for your purchase. How was your experience with LeaseRun? A short, honest Google review helps other buyers – whether it's positive or critical.\n\nIf something wasn't right, just reply to this email.\n\nYou're receiving this one-time email because you agreed to it at checkout. We won't send further review requests.",
    [], { title: 'How did we do?', button: { label: 'Leave a Google review', url: reviewUrl }, area: s.metadata?.b2b_account_id ? 'b2b' : 'b2c' });
}
