-- Tests Creator Hub Phase 2 (Kampagnen, Assets, Vorteile, Content, Attribution, Conversions, Kennzahlen).
-- Voraussetzung: beide Migrationen angewendet. Läuft in einer Transaktion und wird zurückgerollt.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'ca@test.invalid'), ('00000000-0000-4000-8000-0000000000b1', 'cb@test.invalid'),
  ('00000000-0000-4000-8000-0000000000c1', 'kunde1@test.invalid'), ('00000000-0000-4000-8000-0000000000c2', 'kunde2@test.invalid');
insert into public.lr_creators (id, user_id, status, ref_code) values
  ('10000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', 'ACTIVE', 'abcdefghjk'),
  ('10000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b1', 'ACTIVE', 'mnpqrstuvw');

insert into public.lr_creator_campaigns (id, slug, name, audience, status) values
  ('40000000-0000-4000-8000-000000000001', 'herbst-alle', 'Herbst für alle', 'ALL', 'ACTIVE'),
  ('40000000-0000-4000-8000-000000000002', 'nur-b', 'Nur für B', 'SELECTED', 'ACTIVE'),
  ('40000000-0000-4000-8000-000000000003', 'entwurf', 'Entwurf', 'ALL', 'DRAFT');
insert into public.lr_creator_campaign_members (campaign_id, creator_id, added_by) values ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000b1', 'test');

insert into public.lr_creator_assets (campaign_id, title, kind, storage_path, active, created_by) values
  (null, 'Logo', 'logo', 'assets/50000000-0000-4000-8000-000000000001/logo.png', true, 'test'),
  ('40000000-0000-4000-8000-000000000002', 'Nur B', 'image', 'assets/50000000-0000-4000-8000-000000000002/b.png', true, 'test'),
  (null, 'Inaktiv', 'image', 'assets/50000000-0000-4000-8000-000000000003/x.png', false, 'test');
insert into public.lr_creator_assets (title, kind, text_body, active, created_by) values ('Caption', 'text', 'Werbung: …', true, 'test');

insert into public.lr_creator_benefits (creator_id, code, benefit) values
  ('10000000-0000-4000-8000-0000000000a1', 'ANNA', '10 % auf den Käufer-Pass'), ('10000000-0000-4000-8000-0000000000b1', 'BEN', '10 % auf Investor Pro');
insert into public.lr_creator_content (creator_id, platform, url, published_on, ad_disclosure) values
  ('10000000-0000-4000-8000-0000000000a1', 'youtube', 'https://youtube.com/watch?v=a', current_date, true),
  ('10000000-0000-4000-8000-0000000000b1', 'tiktok', 'https://tiktok.com/@b/1', current_date, true);
insert into public.lr_creator_attributions (user_id, creator_id, campaign_slug) values ('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000a1', 'herbst-alle');
insert into public.lr_creator_conversions (id, creator_id, user_id, campaign_slug, source, stripe_session_id, stripe_payment_intent, amount_net_cents, occurred_at) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'herbst-alle', 'link', 'cs_test_1', 'pi_1', 4118, now()),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c2', null, 'code', 'cs_test_2', 'pi_2', 2437, now());
insert into public.lr_analytics (ev, visitor, src, camp) values ('pv', 'v1', 'partnerabcdefghjk', 'herbst-alle'), ('pv', 'v1', 'partnerabcdefghjk', 'herbst-alle'), ('pv', 'v2', 'partnerabcdefghjk', null), ('pv', 'v3', 'partnermnpqrstuvw', null);

-- Creator A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
do $$ declare n int; begin
  select count(*) into n from public.lr_creator_campaigns;
  if n <> 1 then raise exception 'FAIL: A sieht % Kampagnen (erwartet 1: aktiv + für alle)', n; end if;
  select count(*) into n from public.lr_creator_assets;
  if n <> 2 then raise exception 'FAIL: A sieht % Assets (erwartet 2: Logo + Caption)', n; end if;
  select count(*) into n from public.lr_creator_benefits;
  if n <> 1 then raise exception 'FAIL: A sieht % Vorteile', n; end if;
  select count(*) into n from public.lr_creator_content;
  if n <> 1 then raise exception 'FAIL: A sieht % Inhalte', n; end if;
  raise notice 'ok: A sieht nur sichtbare Kampagnen/Assets und eigene Vorteile/Inhalte';
end $$;
do $$ begin perform 1 from public.lr_creator_conversions; raise exception 'FAIL: Conversions lesbar';
exception when insufficient_privilege then raise notice 'ok: Conversions (Kundenbezug) für Creator gesperrt'; end $$;
do $$ begin perform 1 from public.lr_creator_attributions; raise exception 'FAIL: Attributionen lesbar';
exception when insufficient_privilege then raise notice 'ok: Kundenzuordnungen für Creator gesperrt'; end $$;
do $$ begin perform 1 from public.lr_creator_campaign_members; raise exception 'FAIL: Mitgliederliste lesbar';
exception when insufficient_privilege then raise notice 'ok: Kampagnen-Mitglieder für Creator gesperrt'; end $$;
do $$ begin perform public.lr_creator_performance('10000000-0000-4000-8000-0000000000b1', now() - interval '1 day', now() + interval '1 day'); raise exception 'FAIL: Kennzahlen fremder Creator abrufbar';
exception when insufficient_privilege then raise notice 'ok: Kennzahlen-Funktion nur für den Server'; end $$;
do $$ begin insert into public.lr_creator_content (creator_id, platform, url, published_on, ad_disclosure) values ('10000000-0000-4000-8000-0000000000a1', 'x', 'https://x.com/a', current_date, true); raise exception 'FAIL: Direktes Einfügen';
exception when insufficient_privilege then raise notice 'ok: Inhalte nur über den Server'; end $$;

-- Creator B sieht die zugeordnete Kampagne und ihr Asset
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
do $$ declare n int; begin
  select count(*) into n from public.lr_creator_campaigns; if n <> 2 then raise exception 'FAIL: B sieht % Kampagnen (erwartet 2)', n; end if;
  select count(*) into n from public.lr_creator_assets; if n <> 3 then raise exception 'FAIL: B sieht % Assets (erwartet 3)', n; end if;
  raise notice 'ok: Zuordnung zu Kampagne gibt Zugriff auf Kampagne und Assets';
end $$;
reset role;

-- Pausierter Creator sieht keine Kampagnen/Assets mehr
update public.lr_creators set status = 'SUSPENDED' where id = '10000000-0000-4000-8000-0000000000b1';
set local role authenticated;
do $$ declare n int; begin
  select count(*) into n from public.lr_creator_campaigns; if n <> 0 then raise exception 'FAIL: pausierter Creator sieht Kampagnen'; end if;
  select count(*) into n from public.lr_creator_assets; if n <> 0 then raise exception 'FAIL: pausierter Creator sieht Assets'; end if;
  raise notice 'ok: Pausierter Creator ohne Kampagnen/Assets';
end $$;
reset role;
update public.lr_creators set status = 'ACTIVE' where id = '10000000-0000-4000-8000-0000000000b1';

-- Kennzahlen
do $$ declare p jsonb; begin
  p := public.lr_creator_performance('10000000-0000-4000-8000-0000000000a1', now() - interval '1 day', now() + interval '1 day');
  if (p->>'visits')::int <> 3 or (p->>'visitors')::int <> 2 or (p->>'registrations')::int <> 1 or (p->>'conversions')::int <> 2 or (p->>'revenue_net_cents')::int <> 6555 or (p->>'via_code')::int <> 1 then
    raise exception 'FAIL: Kennzahlen falsch: %', p; end if;
  if jsonb_array_length(p->'by_campaign') <> 2 then raise exception 'FAIL: Aufteilung nach Kampagne: %', p->'by_campaign'; end if;
  raise notice 'ok: Kennzahlen (Besuche, Registrierungen, Conversions, Umsatz, Kampagnen)';
end $$;

-- Rücknahme zählt nicht mehr als Umsatz; Rücknahme endgültig; Beträge unveränderbar
update public.lr_creator_conversions set status = 'REVERSED', reversed_at = now() where id = '60000000-0000-4000-8000-000000000002';
do $$ declare p jsonb; begin
  p := public.lr_creator_performance('10000000-0000-4000-8000-0000000000a1', now() - interval '1 day', now() + interval '1 day');
  if (p->>'revenue_net_cents')::int <> 4118 or (p->>'reversed')::int <> 1 then raise exception 'FAIL: Rücknahme nicht berücksichtigt: %', p; end if;
  raise notice 'ok: Erstattete Käufe zählen nicht';
end $$;
do $$ begin update public.lr_creator_conversions set status = 'PENDING' where id = '60000000-0000-4000-8000-000000000002'; raise exception 'FAIL: Rücknahme umkehrbar';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Rücknahme endgültig'; end $$;
do $$ begin update public.lr_creator_conversions set amount_net_cents = 1 where id = '60000000-0000-4000-8000-000000000001'; raise exception 'FAIL: Betrag änderbar';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Conversion-Beträge unveränderbar'; end $$;
do $$ begin delete from public.lr_creator_conversions; raise exception 'FAIL: Conversion löschbar';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Conversions nicht löschbar'; end $$;
do $$ begin insert into public.lr_creator_conversions (creator_id, source, stripe_session_id, amount_net_cents, occurred_at) values ('10000000-0000-4000-8000-0000000000a1', 'link', 'cs_test_1', 1, now()); raise exception 'FAIL: Doppelte Sitzung';
exception when unique_violation then raise notice 'ok: Eine Conversion je Checkout-Sitzung'; end $$;

-- Eine Zuordnung je Kunde
do $$ begin insert into public.lr_creator_attributions (user_id, creator_id) values ('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000b1'); raise exception 'FAIL: Doppelte Zuordnung';
exception when unique_violation then raise notice 'ok: Erster Creator gewinnt (eine Zuordnung je Kunde)'; end $$;

-- Kundenkonto löschen: Zuordnung entfällt, Conversion bleibt ohne Personenbezug
delete from auth.users where id = '00000000-0000-4000-8000-0000000000c1';
do $$ declare u uuid; n int; begin
  select user_id into u from public.lr_creator_conversions where id = '60000000-0000-4000-8000-000000000001';
  select count(*) into n from public.lr_creator_attributions where creator_id = '10000000-0000-4000-8000-0000000000a1';
  if u is not null or n <> 0 then raise exception 'FAIL: Kontolöschung (user %, Zuordnungen %)', u, n; end if;
  raise notice 'ok: Kontolöschung entfernt Personenbezug, Conversion bleibt für die Abrechnung';
end $$;

-- Kampagnen-Kennzahlen gesamt
do $$ declare n int; begin
  select count(*) into n from public.lr_creator_campaign_stats(now() - interval '1 day', now() + interval '1 day');
  if n < 1 then raise exception 'FAIL: Kampagnen-Kennzahlen leer'; end if;
  raise notice 'ok: Kampagnen-Kennzahlen';
end $$;

-- Ungültige Werte
do $$ begin insert into public.lr_creator_benefits (creator_id, code, benefit) values ('10000000-0000-4000-8000-0000000000a1', 'klein', 'x x x'); raise exception 'FAIL: Code-Format';
exception when check_violation then raise notice 'ok: Vorteilscodes nur A–Z/0–9'; end $$;
do $$ begin insert into public.lr_creator_assets (title, kind, storage_path, created_by) values ('x', 'image', '../../etc/passwd', 't'); raise exception 'FAIL: Pfad';
exception when check_violation then raise notice 'ok: Asset-Pfade eingeschränkt'; end $$;
do $$ begin insert into public.lr_creator_campaigns (slug, name, target_path) values ('boese', 'Böse', 'https://evil.example'); raise exception 'FAIL: Zielpfad';
exception when check_violation then raise notice 'ok: Kampagnen-Ziel nur interner Pfad'; end $$;

select 'ALL CREATOR HUB PHASE 2 TESTS PASSED' as result;
rollback;
