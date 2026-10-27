-- 2026-10-27 Qualitäts-Audit
-- 1) Backup-Tabellen der Mail-Entwürfe waren über die öffentliche API lesbar (RLS aus / Grants für anon).
--    Nichts gelöscht: nur Zugriff gesperrt. Server (service_role) liest weiter.
alter table public.lr_mail_drafts_backup_20261026c enable row level security;
revoke all on table public.lr_mail_drafts_backup_20261026c from anon, authenticated;
revoke all on table public.lr_mail_drafts_backup_20261026b from anon, authenticated;

-- 2) Fehlende Indizes auf Fremdschlüsseln (Supabase-Advisor „unindexed_foreign_keys“): schnellere Abfragen/Joins.
create index if not exists api_cases_created_by_key_fk_idx on public.api_cases (created_by_key);
create index if not exists api_documents_case_id_fk_idx on public.api_documents (case_id);
create index if not exists api_keys_rotated_from_fk_idx on public.api_keys (rotated_from);
create index if not exists api_reports_case_id_fk_idx on public.api_reports (case_id);
create index if not exists api_reports_validation_id_fk_idx on public.api_reports (validation_id);
create index if not exists api_validation_runs_case_id_fk_idx on public.api_validation_runs (case_id);
create index if not exists lr_card_transactions_parent_id_fk_idx on public.lr_card_transactions (parent_id);
create index if not exists lr_creator_adjustments_statement_id_fk_idx on public.lr_creator_adjustments (statement_id);
create index if not exists lr_creator_agreement_acceptances_agreement_id_fk_idx on public.lr_creator_agreement_acceptances (agreement_id);
create index if not exists lr_creator_benefits_campaign_id_fk_idx on public.lr_creator_benefits (campaign_id);
create index if not exists lr_creator_commissions_rule_id_fk_idx on public.lr_creator_commissions (rule_id);
create index if not exists lr_creator_commissions_statement_id_fk_idx on public.lr_creator_commissions (statement_id);
create index if not exists lr_creator_content_campaign_id_fk_idx on public.lr_creator_content (campaign_id);
create index if not exists lr_creator_conversions_benefit_id_fk_idx on public.lr_creator_conversions (benefit_id);
create index if not exists lr_creator_conversions_user_id_fk_idx on public.lr_creator_conversions (user_id);
create index if not exists lr_creator_documents_refers_to_fk_idx on public.lr_creator_documents (refers_to);
create index if not exists lr_creator_payouts_creator_id_fk_idx on public.lr_creator_payouts (creator_id);
create index if not exists lr_creator_payouts_payout_account_id_fk_idx on public.lr_creator_payouts (payout_account_id);
create index if not exists lr_creator_refunds_creator_id_fk_idx on public.lr_creator_refunds (creator_id);
create index if not exists lr_mail_messages_token_fk_idx on public.lr_mail_messages (token);
create index if not exists lr_outreach_mails_token_fk_idx on public.lr_outreach_mails (token);
create index if not exists lr_support_tickets_account_id_fk_idx on public.lr_support_tickets (account_id);

-- 3) Alte Backup-Tabellen der Mail-Entwürfe in privates Archiv verschoben (nicht über die API erreichbar, nichts gelöscht).
create schema if not exists archiv;
revoke all on schema archiv from public, anon, authenticated;
grant usage on schema archiv to service_role;
alter table public.lr_mail_drafts_backup_20261025 set schema archiv;
alter table public.lr_mail_drafts_backup_20261026 set schema archiv;
alter table public.lr_mail_drafts_backup_20261026b set schema archiv;
alter table public.lr_mail_drafts_backup_20261026c set schema archiv;
grant select on all tables in schema archiv to service_role;
