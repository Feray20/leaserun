// All requests and business notifications (contact, business inquiries, verifications, bookings, suggestions, support) go to
// the support mailbox – they land in the LeaseRun mailbox (Web-Admin and app). Security alerts still go to the admins.
export const supportInbox = (): string => (process.env.SUPPORT_INBOX || 'support@leaserun.com').trim().toLowerCase();
