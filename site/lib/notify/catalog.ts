// Every email LeaseRun can send – with sample data, for the "Send all templates to me" test in the Web-Admin.
// Texts mirror the real templates in the respective routes (the file is noted per group). Attachments (PDF) are not
// included in the test. When a template changes, please update it here too.
import type { MailOptions } from '@/lib/notify/mail';
import { readyMail, reminderMail } from '@/lib/creator/mails';

export type SampleMail = { group: string; label: string; subject: string; text: string; opts?: MailOptions };

const S = 'https://leaserun.com';
const N = 'Jane Sample', F = 'Jane', CO = 'Sample Mortgage Advisors LLC', MAIL = 'customer@example.com', PW = 'Sample-Password-123';
const LINK = `${S}/auth/confirm?th=SAMPLE&type=magiclink`;
const AT = 'Oct 23, 2026 at 9:00 PM ET';

const cancelText = ['Cancellation', '', `Received: ${AT}`, `Name: ${N}`, `Email: ${MAIL}`, 'Plan: LeaseRun Investor Pro (monthly)', 'Type: cancel at the end of the current billing period'].join('\n');
const refundText = ['Refund request', '', 'I would like a refund for my purchase.', '', `Received: ${AT}`, `Name: ${N}`, `Email: ${MAIL}`, 'Purchase: Lender Package', 'Receipt / order number: LR-2026-0042'].join('\n');

const CREATOR_STATUS: [string, string, string, string][] = [
  ['Approved', 'Welcome to the LeaseRun Creator Program', "You're approved", `your application to the LeaseRun Creator Program has been approved. Your creator portal is active now:\n\n${S}/creators`],
  ['More info needed', 'LeaseRun needs one more detail from you', 'Add a detail', `we need one more detail for your creator application:\n\nPlease add the link to your Instagram profile.\n\nAdd it in the creator area and resubmit your application:\n\n${S}/creators`],
  ['Declined', 'Your LeaseRun creator application', 'Application not approved', 'thanks for your interest. Unfortunately we cannot approve your application to the Creator Program at this time.\n\nSample reason.'],
  ['Paused', 'Your LeaseRun creator access has been paused', 'Access paused', 'your creator access has been paused for now.\n\nSample reason.\n\nQuestions: support@leaserun.com'],
  ['Active again', 'Your LeaseRun creator access is active again', 'Access active again', `your creator access is active again:\n\n${S}/creators`],
];

export function sampleMails(): SampleMail[] {
  const out: SampleMail[] = [];
  const add = (group: string, label: string, subject: string, text: string, opts?: MailOptions) => out.push({ group, label, subject, text, opts });

  // ---------- Consumers / Business: account (app/api/auth/mail) ----------
  for (const biz of [false, true]) {
    const g = biz ? 'Business · Account' : 'Consumers · Account', area = biz ? 'b2b' as const : 'b2c' as const, sfx = biz ? ' – LeaseRun Business Portal' : ' – LeaseRun';
    add(g, 'Confirm signup', `Confirm your email address${sfx}`,
      biz ? 'Hi there,\n\nplease confirm your email address. After that you can set up your business account; you will need your company details and proof of business registration.'
        : 'Hi there,\n\nplease confirm your email address. After that your account is active and you can run the numbers on your first property right away.',
      { area, title: 'Confirm your email address', button: { label: 'Confirm email address', url: LINK }, note: "The link is valid for 24 hours and works once. If you didn't sign up, you can safely ignore this email." });
    add(g, 'Account already exists', 'You already have a LeaseRun account',
      "Hi there,\n\nsomeone (probably you) just tried to sign up with this email address. There's already an account for it.\n\nJust sign in. If you forgot your password, you can reset it.",
      { area, title: 'Your account already exists', button: { label: 'Go to sign in', url: biz ? `${S}/business-portal` : `${S}/auth/login` }, note: `Forgot your password? ${S}/auth/forgot${biz ? '?bereich=b2b' : ''} – If this wasn't you, you can ignore this email.` });
    add(g, 'Reset password', `Reset your password${sfx}`,
      biz ? 'Hi there,\n\nyou asked to reset your password for the LeaseRun Business Portal. Use the button below to set a new one – you will be signed in to the portal right after.'
        : 'Hi there,\n\nyou asked to reset your LeaseRun password. Use the button below to set a new one.',
      { area, title: 'Set a new password', button: { label: 'Set new password', url: LINK }, note: "The link expires soon and works once. If you didn't request this, ignore this email – your password stays unchanged." });
    add(g, 'Sign-in link', `Your sign-in link${sfx}`,
      biz ? "Hi there,\n\nhere is your sign-in link for the LeaseRun Business Portal. One click and you're in." : "Hi there,\n\nhere is your sign-in link for LeaseRun. One click and you're in.",
      { area, title: 'Sign in now', button: { label: 'Sign in to LeaseRun', url: LINK }, note: "The link expires soon and works once. If you didn't request it, ignore this email – your account stays protected." });
    add(g, 'Confirmation link resent', `Your confirmation link${sfx}`,
      biz ? 'Hi there,\n\nhere is your new link. It confirms your email address and signs you in to the Business Portal.' : 'Hi there,\n\nhere is your new link. It confirms your email address and signs you in to LeaseRun.',
      { area, title: 'Confirm your email address', button: { label: 'Confirm and sign in', url: LINK }, note: 'The link expires soon and works once.' });
  }

  // ---------- Consumers: plans, data room, reminders ----------
  const P = 'Consumers';
  add(P, 'Cancellation – confirmation to customer', 'Your LeaseRun cancellation is confirmed', `Hi ${N},\n\nwe received your cancellation. This email is your confirmation. You keep access until the end of the current billing period and won't be charged again.\n\n${cancelText}`, { title: 'Your cancellation is confirmed' });
  add(P, 'Refund request – confirmation to customer', 'We received your refund request',
    `Hi ${N},\n\nwe received your refund request. This email is your confirmation. Approved refunds go back to your original payment method, usually within 5–10 business days.\n\n${refundText}`, { title: 'Refund request received' });
  add(P, 'Data room opened', 'LeaseRun: your data room was opened',
    'Your share link for "123 Main St, Austin, TX" was just opened for the first time.\n\nValid until: 10/30/2026, 9:00 PM\nViews left: 4\n\nYou can see every access in your account under "Documents & Data Room", where you can revoke the link instantly:\nhttps://leaserun.com/app/dashboard\n\nWasn\'t that you, or did you not share the link? Please revoke it right away.');
  add(P, 'Document requested', 'LeaseRun: a document was requested',
    'A document was requested through your share link:\n\nCategory: Proof of income\nNote: Please add your last two pay stubs.\n\nUpload it in your account under "Documents & Data Room" and mark the request as done there:\nhttps://leaserun.com/app/dashboard');
  add(P, 'Deadline reminder', 'Reminder: rate adjustment on your ARM (03/01/2027)', ['Hi there,', '', 'these dates are coming up for your properties on LeaseRun:', '',
    '• 123 Main St: ARM rate adjustment on 03/01/2027 (in 129 days)\n  Compare refinance options in time. Based on the loan details you entered.', '',
    `All deadlines at a glance: ${S}/deadlines`, `Run the new rate scenario: ${S}/scenarios`, '',
    `You're receiving this because you turned on deadline reminders in your account. Turn them off: ${S}/app/dashboard → "Data & Account".`,
    'Dates are based on your own entries and not guaranteed; your loan documents govern. Not legal or tax advice.', '', 'LeaseRun · leaserun.com'].join('\n'));
  add(P, 'Export (PDF) sent', 'Your Lender Package from LeaseRun', 'Hi there,\n\nattached is your Lender Package as a PDF. (No attachment in this test.)\n\nYou requested this email yourself in your LeaseRun account.\nLeaseRun · leaserun.com');
  add(P, 'Review request after purchase', 'Quick question about your LeaseRun purchase',
    "Hi there,\n\nthanks for your purchase. How was your experience with LeaseRun? A short, honest Google review helps other buyers – whether it's positive or critical.\n\nIf something wasn't right, just reply to this email.\n\nYou're receiving this one-time email because you agreed to it at checkout. We won't send further review requests.",
    { title: 'How did we do?', button: { label: 'Leave a Google review', url: 'https://g.page/r/leaserun/review' } });
  add(P, 'Confirm newsletter', 'Please confirm: updates from LeaseRun', `Hi ${N},\n\nplease confirm that you'd like to receive updates from LeaseRun by email. We won't send anything until you confirm.`,
    { title: 'Confirm your subscription', button: { label: 'Confirm subscription', url: `${S}/api/newsletter?confirm=SAMPLE` }, note: "Didn't sign up? Just ignore this email." });
  add(P, 'Newsletter / marketing (sample)', 'New at LeaseRun: sample newsletter', 'Hi there,\n\nthis is a sample newsletter from Web-Admin → Marketing.',
    { title: 'New at LeaseRun: sample newsletter', button: { label: 'Take a look', url: S }, note: `You're receiving this email because you signed up for LeaseRun updates. Unsubscribe: ${S}/api/newsletter/unsub?t=SAMPLE`, marketing: true });
  add(P, 'Account created by admin', 'Your LeaseRun account is ready',
    `Hi ${N},\n\nyour personal LeaseRun account is ready.\n\nSign in: https://leaserun.com/auth/login\nUsername: ${MAIL}\nPassword: ${PW}\n\nYou'll set your own password the first time you sign in. The temporary password stops working after that.`,
    { title: 'Your account is ready', button: { label: 'Sign in now', url: `${S}/auth/login` }, note: "Please don't share the temporary password. Questions: support@leaserun.com" });
  add(P, 'Invitation from an advisor', `${CO} invited you to LeaseRun`,
    `Hi ${N},\n\n${CO} is helping you with your home financing and invited you to LeaseRun. There you prepare your financial profile, property and documents step by step, all the way to a lender-ready Lender Package.\n\nIf you agree, your advisor only sees your progress (stage, lender readiness in percent, number of documents) – no documents and no content. You can disconnect at any time.\n\nThe link is valid for 14 days.`,
    { title: `Invitation from ${CO}`, button: { label: 'View invitation', url: `${S}/einladung?t=SAMPLE` }, note: "Free for you. Nothing is shared without your consent.", sender: CO });
  add(P, 'Advisor asks for documents', `${CO} is asking for your documents`,
    `Hi ${N},\n\nyour advisor at ${CO} is asking you to add the missing documents in LeaseRun so your financing can move forward.\n\nStill missing:\n• Proof of income\n• Bank statements (last 2 months)\n\nMessage from your advisor:\nPlease upload by Friday.`,
    { title: 'Add missing documents', button: { label: 'Add documents', url: `${S}/app/dashboard#objekte` }, note: 'Your advisor does not see your documents – only which types are still missing. You can disconnect in your account under "Advisor access".' });
  add(P, 'Financing request received', `Your request to ${CO}`,
    `Hi ${N},\n\nyour financing request has reached ${CO}. ${CO} will contact you directly.\n\n${CO} is responsible for your data; LeaseRun only processes it on their behalf. You can withdraw your consent at any time by contacting ${CO} (info@samplemortgage.com).\n\nThe figures shown are estimates, not a loan approval or rate quote.`);

  // ---------- Business ----------
  const B = 'Business', b2b = { area: 'b2b' as const };
  add(B, 'Access created by admin', 'Your access to the LeaseRun Business Portal',
    `Hi ${N},\n\nyour business account for ${CO} is ready (customer ID K-10042).\n\nPortal: https://partner.leaserun.com\nUsername: ${MAIL}\nPassword: ${PW}\n\nThe first time you sign in you'll set your own password and accept the contract documents (business customer terms, Data Processing Addendum). The temporary password stops working after that.`,
    { area: 'b2b', title: 'Your access is ready', button: { label: 'Go to the Business Portal', url: 'https://partner.leaserun.com' }, note: "Please don't share the temporary password. Questions: support@leaserun.com" });
  add(B, 'Registration – record', 'Your LeaseRun registration – record RN-SAMPLE',
    `Hi ${N},\n\nyour business account for ${CO} has been created (customer ID K-10042). Attached is a record of the details and statements you provided. Please review it and let us know right away at support@leaserun.com if anything is wrong.\n\nNext step: upload proof of business registration in the portal (https://leaserun.com/business-portal#verifizierung). You can download the Data Processing Addendum any time at https://leaserun.com/business-portal#profil.\n\n(No attachment and no record text in this test.)\n\nThe LeaseRun team`, b2b);
  add(B, 'Account approved', 'Your LeaseRun business account is approved',
    `Hi ${N},\n\nwe reviewed your documents and approved your business account for ${CO}. Partner page, widget, leads, Lender Packages and plans are now available:\nhttps://leaserun.com/business-portal\n\nLeaseRun · support@leaserun.com`, b2b);
  add(B, 'Documents needed', 'Your LeaseRun business account: please add documents',
    `Hi ${N},\n\nwe couldn't approve your business account for ${CO} yet.\n\nReason: the proof of business registration is not readable.\n\nPlease upload the missing documents in the portal under "Verification" and submit again:\nhttps://leaserun.com/business-portal#verifizierung\n\nLeaseRun · support@leaserun.com`, b2b);
  add(B, 'Advisor access (team)', `Your access for ${CO} on LeaseRun`,
    `Hi there,\n\n${N} set up advisor access for you in the LeaseRun Business Portal of ${CO}.\n\nPortal: https://partner.leaserun.com\nUsername: ${MAIL}\nTemporary password: ${PW}\n\nYou'll set your own password the first time you sign in.`,
    { area: 'b2b', title: 'Your advisor access', button: { label: 'Go to the Business Portal', url: 'https://partner.leaserun.com' }, note: "Please don't share the temporary password." });
  add(B, 'New financing lead', 'New financing lead via LeaseRun (widget)',
    `New lead for ${CO}\n\nName: ${N}\nEmail: ${MAIL}\nPhone: (512) 555-0142\nProperty: 123 Main St, Austin, TX\nPurchase price: $350,000 · Monthly rent: $2,100 · Down payment: $70,000\nTotal cost: $361,500 · Loan: $280,000 · DSCR: 1.12\n\nMessage: Please call me back.\n\nAll details in the portal: https://leaserun.com/business-portal#anfragen\n\nEstimates only, not a credit decision.`, b2b);
  add(B, 'New submission (to lender)', `New submission from ${CO}`,
    `Hi there,\n\n${CO} submitted a Lender Package for pre-review: 123 Main St, Austin, TX.\nNote: Please share a quick assessment.\n\nView in your inbox: https://leaserun.com/business-portal#einreichungen\n\nThe Lender Package is a calculated summary; the credit decision is made by your institution.`, b2b);
  add(B, 'Submission status', 'Submission "123 Main St": in review',
    'Hi there,\n\nSample Community Bank set the status of your submission "123 Main St" to "In review".\n\nMessage: We will get back to you by Wednesday.\n\nhttps://leaserun.com/business-portal#einreichungen', b2b);
  add(B, 'Invoice', 'Invoice LR-2026-0042',
    `Hi ${N},\n\nattached is invoice LR-2026-0042 for $149.00.\nDue by 11/06/2026. Pay by card or ACH bank transfer via the payment link on the invoice.\n\nAll invoices are also in the Business Portal: https://leaserun.com/business-portal#tarif\n\n(No PDF in this test.)\n\nBest regards,\nLeaseRun`, b2b);
  add(B, 'Payment reminder', 'Payment reminder: invoice LR-2026-0042',
    `Hi ${N},\n\nour records show that invoice LR-2026-0042 from 10/23/2026 for $149.00 (due 11/06/2026) is still open.\nThis is probably just an oversight. Please pay within the next 7 days; the invoice is attached again.\nIf your payment crossed with this email, please disregard it.\n\nBest regards,\nLeaseRun`, b2b);
  add(B, 'Client radar', 'Client radar 2026-11: 2 rate resets coming up',
    `Hi ${N},\n\nthese clients have a rate reset or refinance window coming up (only clients who opted in to the radar):\n\n• Anna Example – ARM reset 03/2027\n• Ben Sample – ARM reset 05/2027\n\nAll details in the portal under "Clients".`,
    { area: 'b2b', title: 'Client radar', button: { label: 'Open clients in the portal', url: `${S}/business-portal#kunden` } });

  // ---------- Creators ----------
  const C = 'Creators';
  add(C, 'Confirm signup', 'Confirm your email address – LeaseRun Creators', 'Hi there,\n\nplease confirm your email address. After that you can fill out your application right away.',
    { title: 'Confirm your email address', button: { label: 'Confirm email address', url: LINK }, note: "The link is valid for 24 hours and works once. If you didn't sign up, just ignore this email." });
  add(C, 'Account already exists', 'You already have a creator account', "Hi there,\n\nsomeone (probably you) just tried to sign up as a creator with this email address. There's already an account for it.\n\nJust sign in. If you forgot your password, you can reset it.",
    { title: 'Your creator account already exists', button: { label: 'Go to sign in', url: `${S}/creators` }, note: "If this wasn't you, you can ignore this email." });
  add(C, 'Reset password', 'Reset your password – LeaseRun Creators', 'Hi there,\n\nyou asked for a new password for your LeaseRun creator access.',
    { title: 'Set a new password', button: { label: 'Set new password', url: LINK }, note: "The link expires soon and works once. If you didn't request this, ignore this email." });
  add(C, 'Access created by admin', 'Your access to the LeaseRun creator area',
    `Hi ${F},\n\nyour access to the LeaseRun creator area is ready.\n\nSign in: ${S}/creators\nUsername: ${MAIL}\nPassword: ${PW}\n\nAfter signing in, fill out your application; we'll review it after that.\n\nYou can change your password any time via "Forgot password".`,
    { title: 'Your creator access is ready', button: { label: 'Sign in now', url: `${S}/creators` }, note: "Please don't share your password. Questions: support@leaserun.com" });
  add(C, 'Application received', 'We received your LeaseRun creator application',
    `Hi ${F},\n\nthanks for applying to the LeaseRun Creator Program. We'll review your details and let you know by email once the review is done.\n\nYou can check your status any time in the creator area: https://leaserun.com/creators`, { title: 'Application received' });
  for (const [l, subject, title, text] of CREATOR_STATUS) add(C, `Status: ${l}`, subject, `Hi ${F},\n\n${text}`, { title });
  add(C, 'Note on a post', 'A note on your post',
    `Hi ${F},\n\nLeaseRun has a note on your post https://instagram.com/p/SAMPLE:\n\nPlease add the paid-partnership disclosure (#ad or the platform's "Paid partnership" label) as required by the FTC.\n\nYou can update the post in Creator Studio: https://leaserun.com/creators#studio`, { title: 'A note on your post' });
  add(C, 'Payout details changed', 'Your LeaseRun payout details were changed',
    `Hi ${F},\n\nyour payout details in the LeaseRun creator portal were just changed. New bank account: •••• 1234 (via Stripe).\n\nIf this wasn't you, reply to this email right away or write to support@leaserun.com. We'll hold pending payouts until it's resolved.`, { title: 'Payout details changed' });
  for (const mode of ['INVOICE', 'CREDIT_NOTE'] as const) { const m = readyMail(mode, '2026-09', 12450, F); add(C, mode === 'INVOICE' ? 'Statement ready (invoice)' : 'Statement ready (self-billing)', m.subject, m.text, { title: m.title }); }
  { const m = reminderMail('2026-09', F); add(C, 'Reminder: invoice missing', m.subject, m.text, { title: m.title }); }
  add(C, 'Payout sent', 'Your payout from LeaseRun',
    `Hi ${F},\n\nwe sent $124.50 to your bank account •••• 1234 (reference LR-CR-2026-09-0001). Depending on your bank, it usually arrives within 1–2 business days.\n\nYour statements are in the creator portal: ${S}/creators#abrechnung\n\nPayouts are reported on Form 1099-NEC where required, based on the W-9 you provided.`, { title: 'Payout sent' });
  add(C, 'Payout returned', 'Your payout was returned',
    `Hi ${F},\n\nyour payout of $124.50 was returned by the bank. Please check your payout details (account holder, routing and account number) in the creator portal and update them if needed. Once they're verified, we'll pay out again – your statement doesn't change.\n\n${S}/creators#auszahlung`, { title: 'Payout returned' });

  // ---------- To LeaseRun (notifications to you) ----------
  const I = 'To LeaseRun';
  add(I, 'New cancellation', `Cancellation: LeaseRun Investor Pro (monthly) – ${N}`, cancelText, { title: 'New cancellation' });
  add(I, 'New refund request', `Refund request: Lender Package – ${N}`, refundText, { title: 'New refund request' });
  add(I, 'Contact form', 'Consumer contact: product question', `${N} · ${MAIL}\nTopic: Product question\nPage: /pricing\n\nSample message from the contact form.`, { replyTo: MAIL, title: 'New contact request' });
  add(I, 'Business inquiry', `Business inquiry (access): ${CO}`, `${N}, ${CO}\n${MAIL} · (512) 555-0142\n\nSample message from the business inquiry form.`);
  add(I, 'New business signup', `New business signup: ${CO} (mortgage broker)`, `${CO} signed up. (No record and no attachment in this test.)\n\nReview and approve: https://leaserun.com/internal/web-admin#partner`);
  add(I, 'Verification submitted', `Verification: ${CO}`, `New verification to review\n\n${CO} (LLC)\nCustomer ID: K-10042\nType: mortgage broker\nNMLS ID / EIN: 1234567 / 12-3456789\nContact: ${N}, ${MAIL}\nAddress: business address on file\nDocuments: business registration\n\nReview: https://leaserun.com/internal/web-admin#partner`);
  add(I, 'Improvement suggestion', 'New improvement suggestion (B2C)', 'A new improvement suggestion came in.\n\nArea: Consumers (B2C)\nTopic: Calculators\nImportance to the customer: 4 of 5',
    { title: 'New improvement suggestion', button: { label: 'View in Web-Admin', url: `${S}/internal/web-admin#vorschlaege` } });
  add(I, 'Security alert', '⚠ Security alert: many failed sign-ins (sample)', 'Sample: there were unusually many failed sign-ins to the Web-Admin in the last 15 minutes.',
    { title: 'Many failed sign-ins', button: { label: 'View in Web-Admin', url: `${S}/internal/web-admin#sicherheit` }, note: 'This email is sent automatically, at most every 15 minutes per type.' });
  return out;
}
