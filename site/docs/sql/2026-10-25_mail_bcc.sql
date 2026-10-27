-- Postfach: Bcc-Empfänger (für andere Empfänger unsichtbar)
alter table public.lr_mail_messages add column if not exists bcc_emails text[] not null default '{}';
