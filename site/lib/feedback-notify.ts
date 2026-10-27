import { sendMail, mailConfigured } from '@/lib/notify/mail';
import { supportInbox } from '@/lib/notify/inbox';
import { TOPICS } from '@/lib/feedback';

// Short notification to the support mailbox – without the content of the suggestion.
export async function notifyAdmin(area: 'b2c' | 'b2b', topic: keyof typeof TOPICS, importance: number): Promise<void> {
  const to = supportInbox();
  if (!to || !mailConfigured()) return;
  await sendMail(to, `New improvement suggestion (${area.toUpperCase()})`, `A new improvement suggestion came in.\n\nArea: ${area === 'b2b' ? 'Business (B2B)' : 'Consumers (B2C)'}\nTopic: ${TOPICS[topic]}\nImportance to the customer: ${importance} of 5`, [], {
    title: 'New improvement suggestion', button: { label: 'View in Web-Admin', url: 'https://leaserun.com/internal/web-admin#vorschlaege' },
  });
}
