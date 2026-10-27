-- Rückbau Creator Hub Phase 1. ACHTUNG: entfernt alle Creator-Daten inkl. Audit-Protokoll.
-- Nur in Test-/Branch-Datenbanken oder vor dem ersten echten Creator verwenden.
begin;
drop table if exists public.lr_creator_audit cascade;
drop table if exists public.lr_creator_admin_roles cascade;
drop table if exists public.lr_creator_reviews cascade;
drop table if exists public.lr_creator_agreement_acceptances cascade;
drop table if exists public.lr_creator_agreements cascade;
drop table if exists public.lr_creator_payout_accounts cascade;
drop table if exists public.lr_creator_business cascade;
drop table if exists public.lr_creator_socials cascade;
drop table if exists public.lr_creators cascade;
drop function if exists public.lr_creator_payout_replace(uuid, text, text, text, text, text, text, text);
drop function if exists public.lr_creator_payout_guard();
drop function if exists public.lr_creator_payout_guard_delete();
drop function if exists public.lr_creator_agreement_guard();
drop function if exists public.lr_creator_audit_immutable();
drop function if exists public.lr_creator_acceptance_immutable();
drop function if exists public.lr_creator_review_immutable();
delete from public.lr_settings where key = 'creator_bank_change_requires_review';
commit;
