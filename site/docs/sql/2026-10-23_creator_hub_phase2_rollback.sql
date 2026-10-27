-- Rückbau Creator Hub Phase 2. ACHTUNG: entfernt Kampagnen, Assets (Einträge), Vorteile, Inhalte, Zuordnungen und Conversions.
begin;
drop table if exists public.lr_creator_conversions cascade;
drop table if exists public.lr_creator_attributions cascade;
drop table if exists public.lr_creator_content cascade;
drop table if exists public.lr_creator_benefits cascade;
drop table if exists public.lr_creator_assets cascade;
drop table if exists public.lr_creator_campaign_members cascade;
drop table if exists public.lr_creator_campaigns cascade;
drop function if exists public.lr_creator_performance(uuid, timestamptz, timestamptz);
drop function if exists public.lr_creator_campaign_stats(timestamptz, timestamptz);
drop function if exists public.lr_creator_can_see_campaign(uuid, uuid);
drop function if exists public.lr_creator_conversion_guard();
delete from public.lr_settings where key = 'creator_attribution_window_days';
-- Bucket „creator-assets“ bleibt bestehen (Dateien darin ggf. vorher im Supabase-Dashboard leeren).
commit;
