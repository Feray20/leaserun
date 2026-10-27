-- Rückbau Creator Hub Phase 3. ACHTUNG: entfernt Abrechnungen, Dokument-Einträge und Auszahlungen (Aufbewahrungspflicht beachten!).
-- Nur in Test-/Branch-Datenbanken verwenden. Die Unveränderbarkeits-Trigger werden zuerst entfernt.
begin;
drop table if exists public.lr_creator_payouts cascade;
drop table if exists public.lr_creator_documents cascade;
drop table if exists public.lr_creator_commissions cascade;
drop table if exists public.lr_creator_adjustments cascade;
drop table if exists public.lr_creator_statements cascade;
drop table if exists public.lr_creator_commission_rules cascade;
drop function if exists public.lr_creator_close_period(text, text, jsonb);
drop function if exists public.lr_creator_billing_overview(text);
drop function if exists public.lr_creator_next_number(text);
drop function if exists public.lr_creator_account_deleted(uuid);
-- user_id bleibt nullable, falls bereits archivierte Creator existieren (sonst: alter column user_id set not null).
drop function if exists public.lr_creator_rule_guard();
drop function if exists public.lr_creator_statement_guard();
drop function if exists public.lr_creator_commission_guard();
drop function if exists public.lr_creator_adjustment_guard();
drop function if exists public.lr_creator_document_immutable();
drop function if exists public.lr_creator_payout_status_guard();
alter table public.lr_creators drop constraint if exists lr_creators_billing_mode_check;
alter table public.lr_creators drop column if exists billing_mode;
delete from public.lr_settings where key in ('creator_close_delay_days', 'creator_payout_four_eyes');
commit;
