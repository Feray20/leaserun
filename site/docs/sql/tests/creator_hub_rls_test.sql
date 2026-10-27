-- RLS-, Isolations- und Unveränderbarkeits-Tests für den Creator Hub (Phase 1).
-- Läuft in einer Transaktion und wird am Ende vollständig zurückgerollt.
-- Voraussetzung: 2026-10-22_creator_hub.sql ist angewendet. Ausführen als Datenbank-Eigentümer (postgres):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/sql/tests/creator_hub_rls_test.sql
-- Jeder fehlgeschlagene Test bricht mit einer Meldung „FAIL: …“ ab.

begin;

-- Testdaten: zwei Creator-Konten (A, B)
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'creator-a@test.invalid'),
  ('00000000-0000-4000-8000-00000000000b', 'creator-b@test.invalid');

insert into public.lr_creators (id, user_id, status, first_name, last_name, country, display_name)
values ('10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'DRAFT', 'Anna', 'A', 'DE', 'Anna A'),
       ('10000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000b', 'DRAFT', 'Ben', 'B', 'DE', 'Ben B');

insert into public.lr_creator_socials (creator_id, platform, handle, url) values
  ('10000000-0000-4000-8000-00000000000a', 'youtube', '@anna', 'https://youtube.com/@anna'),
  ('10000000-0000-4000-8000-00000000000b', 'tiktok', '@ben', 'https://tiktok.com/@ben');

insert into public.lr_creator_business (creator_id, entity_type, legal_name, street, postal_code, city, country, vat_status, billing_email) values
  ('10000000-0000-4000-8000-00000000000a', 'individual', 'Anna A', 'Teststraße 1', '64807', 'Dieburg', 'DE', 'small_business', 'anna@test.invalid'),
  ('10000000-0000-4000-8000-00000000000b', 'individual', 'Ben B', 'Teststraße 2', '64807', 'Dieburg', 'DE', 'small_business', 'ben@test.invalid');

insert into public.lr_creator_payout_accounts (id, creator_id, holder_name, iban_enc, iban_last4, iban_country, iban_fingerprint, status, confirmed_at) values
  ('20000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Anna A', 'v1:AAAA:BBBB:CCCC', '3000', 'DE', repeat('a', 64), 'PROVIDED', now());

insert into public.lr_creator_reviews (creator_id, action, message, visible_to_creator, actor_ref) values
  ('10000000-0000-4000-8000-00000000000a', 'REQUEST_INFO', 'Bitte Website ergänzen.', true, 'ps:admin'),
  ('10000000-0000-4000-8000-00000000000a', 'NOTE', 'Interne Notiz', false, 'ps:admin');

insert into public.lr_creator_audit (event_type, creator_id, actor_kind, actor_ref, actor_role, result)
values ('CREATOR_CREATED', '10000000-0000-4000-8000-00000000000a', 'creator', 'ps:a', 'CREATOR', 'SUCCESS');

-- ---------------------------------------------------------------------------
-- Als Creator A (authenticated, ohne zweiten Faktor eingerichtet)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal1"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.lr_creators;
  if n <> 1 then raise exception 'FAIL: Creator A sieht % Creator-Zeilen (erwartet 1)', n; end if;
  select count(*) into n from public.lr_creators where user_id = '00000000-0000-4000-8000-00000000000b';
  if n <> 0 then raise exception 'FAIL: Creator A sieht Creator B'; end if;
  select count(*) into n from public.lr_creator_socials;
  if n <> 1 then raise exception 'FAIL: Creator A sieht % Social-Zeilen (erwartet 1)', n; end if;
  select count(*) into n from public.lr_creator_business;
  if n <> 1 then raise exception 'FAIL: Creator A sieht % Business-Zeilen (erwartet 1)', n; end if;
  select count(*) into n from public.lr_creator_reviews;
  if n <> 1 then raise exception 'FAIL: Creator A sieht % Prüfeinträge (erwartet 1, interne Notiz verborgen)', n; end if;
  select count(*) into n from public.lr_creator_agreements;
  if n < 1 then raise exception 'FAIL: Veröffentlichte Vereinbarung nicht lesbar'; end if;
  raise notice 'ok: Creator A sieht nur eigene Daten';
end $$;

-- Zahlungsdaten, Audit und Rollen: kein Zugriff, auch nicht auf eigene Zeilen
do $$ begin
  perform 1 from public.lr_creator_payout_accounts;
  raise exception 'FAIL: Creator kann Zahlungsdaten-Tabelle lesen';
exception when insufficient_privilege then raise notice 'ok: Zahlungsdaten für Creator gesperrt'; end $$;

do $$ begin
  perform 1 from public.lr_creator_audit;
  raise exception 'FAIL: Creator kann Audit lesen';
exception when insufficient_privilege then raise notice 'ok: Audit für Creator gesperrt'; end $$;

do $$ begin
  perform 1 from public.lr_creator_admin_roles;
  raise exception 'FAIL: Creator kann Admin-Rollen lesen';
exception when insufficient_privilege then raise notice 'ok: Admin-Rollen für Creator gesperrt'; end $$;

-- Keine direkten Schreibzugriffe (nur über die Server-Schnittstellen)
do $$ begin
  update public.lr_creators set status = 'ACTIVE' where user_id = '00000000-0000-4000-8000-00000000000a';
  raise exception 'FAIL: Creator kann eigenen Status direkt setzen';
exception when insufficient_privilege then raise notice 'ok: Creator kann Status nicht selbst setzen'; end $$;

do $$ begin
  insert into public.lr_creators (user_id) values ('00000000-0000-4000-8000-00000000000a');
  raise exception 'FAIL: Creator kann direkt einfügen';
exception when insufficient_privilege then raise notice 'ok: Kein direktes Einfügen'; end $$;

do $$ begin
  delete from public.lr_creator_socials;
  raise exception 'FAIL: Creator kann direkt löschen';
exception when insufficient_privilege then raise notice 'ok: Kein direktes Löschen'; end $$;

do $$ begin
  perform public.lr_creator_payout_replace('10000000-0000-4000-8000-00000000000a', 'X', 'v1:A:B:C', '0000', 'DE', repeat('d', 64), null, 'PROVIDED');
  raise exception 'FAIL: Creator kann Kontowechsel-Funktion direkt aufrufen';
exception when insufficient_privilege then raise notice 'ok: Kontowechsel nur über den Server'; end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Zweiter Faktor: Hat Creator A einen bestätigten Faktor, aber nur aal1 → keine Zeilen
-- ---------------------------------------------------------------------------
insert into auth.mfa_factors (id, user_id, status, factor_type, friendly_name, created_at, updated_at)
values ('30000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'verified', 'totp', 'test', now(), now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal1"}', true);
do $$ declare n int; begin
  select count(*) into n from public.lr_creators;
  if n <> 0 then raise exception 'FAIL: Ohne zweiten Faktor (aal1) sichtbar: %', n; end if;
  raise notice 'ok: Mit eingerichtetem zweiten Faktor ist aal2 nötig';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal2"}', true);
do $$ declare n int; begin
  select count(*) into n from public.lr_creators;
  if n <> 1 then raise exception 'FAIL: Mit aal2 nicht sichtbar'; end if;
  raise notice 'ok: aal2 sieht eigene Zeile';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Anonym: nichts
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  perform 1 from public.lr_creators;
  raise exception 'FAIL: anon kann Creator lesen';
exception when insufficient_privilege then raise notice 'ok: anon gesperrt'; end $$;
do $$ begin
  perform 1 from public.lr_creator_agreements;
  raise exception 'FAIL: anon kann Vereinbarungen lesen';
exception when insufficient_privilege then raise notice 'ok: anon ohne Vereinbarungen'; end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Unveränderbarkeit (auch für den Eigentümer / Server)
-- ---------------------------------------------------------------------------
do $$ begin
  update public.lr_creator_audit set result = 'FAILED';
  raise exception 'FAIL: Audit änderbar';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok: Audit nicht änderbar';
end $$;

do $$ begin
  delete from public.lr_creator_audit;
  raise exception 'FAIL: Audit löschbar';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok: Audit nicht löschbar';
end $$;

do $$ begin
  update public.lr_creator_payout_accounts set iban_last4 = '9999';
  raise exception 'FAIL: IBAN-Daten änderbar';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok: IBAN-Daten unveränderbar';
end $$;

do $$ begin
  delete from public.lr_creator_payout_accounts;
  raise exception 'FAIL: Zahlungsdaten direkt löschbar';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok: Zahlungsdaten nicht direkt löschbar';
end $$;

-- Status darf sich ändern (Ablösung), aber nicht zurück
update public.lr_creator_payout_accounts set status = 'SUPERSEDED', superseded_at = now() where id = '20000000-0000-4000-8000-00000000000a';
do $$ begin
  update public.lr_creator_payout_accounts set status = 'PROVIDED' where id = '20000000-0000-4000-8000-00000000000a';
  raise exception 'FAIL: Abgelöste Zahlungsdaten reaktivierbar';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok: Ablösung endgültig';
end $$;

-- Nur ein aktuelles Konto je Creator
insert into public.lr_creator_payout_accounts (creator_id, holder_name, iban_enc, iban_last4, iban_country, iban_fingerprint, status, confirmed_at)
values ('10000000-0000-4000-8000-00000000000a', 'Anna A', 'v1:AAAA:BBBB:DDDD', '3001', 'DE', repeat('b', 64), 'PROVIDED', now());
do $$ begin
  insert into public.lr_creator_payout_accounts (creator_id, holder_name, iban_enc, iban_last4, iban_country, iban_fingerprint, status, confirmed_at)
  values ('10000000-0000-4000-8000-00000000000a', 'Anna A', 'v1:AAAA:BBBB:EEEE', '3002', 'DE', repeat('c', 64), 'PROVIDED', now());
  raise exception 'FAIL: Zwei aktuelle Konten möglich';
exception when unique_violation then raise notice 'ok: Nur ein aktuelles Konto je Creator'; end $$;

-- Atomarer Kontowechsel: altes Konto wird abgelöst, genau ein aktuelles bleibt
do $$ declare nid uuid; n int; s text; begin
  nid := public.lr_creator_payout_replace('10000000-0000-4000-8000-00000000000a', 'Anna A', 'v1:AAAA:BBBB:FFFF', '3003', 'DE', repeat('e', 64), null, 'VERIFICATION_REQUIRED');
  select count(*) into n from public.lr_creator_payout_accounts where creator_id = '10000000-0000-4000-8000-00000000000a' and status <> 'SUPERSEDED';
  select status into s from public.lr_creator_payout_accounts where id = nid;
  if n <> 1 or s <> 'VERIFICATION_REQUIRED' then raise exception 'FAIL: Kontowechsel (% aktuelle, Status %)', n, s; end if;
  select count(*) into n from public.lr_creator_payout_accounts where creator_id = '10000000-0000-4000-8000-00000000000a';
  if n <> 3 then raise exception 'FAIL: Historie unvollständig (% Zeilen)', n; end if;
  raise notice 'ok: Kontowechsel atomar, Historie bleibt';
end $$;
do $$ begin
  perform public.lr_creator_payout_replace('10000000-0000-4000-8000-00000000000a', 'Anna A', 'v1:A:B:C', '3004', 'DE', repeat('f', 64), null, 'VERIFIED');
  raise exception 'FAIL: Kontowechsel darf nicht direkt als geprüft angelegt werden';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok: Neues Konto nie direkt „geprüft“';
end $$;

-- Veröffentlichte Vereinbarung unveränderbar
do $$ begin
  update public.lr_creator_agreements set body = body || ' geändert' where published_at is not null;
  raise exception 'FAIL: Veröffentlichte Vereinbarung änderbar';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok: Vereinbarung unveränderbar';
end $$;

-- Zustimmung unveränderbar
insert into public.lr_creator_agreement_acceptances (creator_id, agreement_id, body_sha256)
select '10000000-0000-4000-8000-00000000000a', id, body_sha256 from public.lr_creator_agreements order by created_at desc limit 1;
do $$ begin
  delete from public.lr_creator_agreement_acceptances;
  raise exception 'FAIL: Zustimmung löschbar';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok: Zustimmung unveränderbar';
end $$;

-- Prüfverlauf unveränderbar
do $$ begin
  update public.lr_creator_reviews set message = 'x';
  raise exception 'FAIL: Prüfverlauf änderbar';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok: Prüfverlauf unveränderbar';
end $$;

-- Ungültige Werte werden abgewiesen
do $$ begin
  update public.lr_creators set status = 'GODMODE' where id = '10000000-0000-4000-8000-00000000000b';
  raise exception 'FAIL: Ungültiger Status akzeptiert';
exception when check_violation then raise notice 'ok: Statusprüfung'; end $$;
do $$ begin
  insert into public.lr_creator_socials (creator_id, platform, url) values ('10000000-0000-4000-8000-00000000000b', 'youtube', 'javascript:alert(1)');
  raise exception 'FAIL: Unsichere URL akzeptiert';
exception when check_violation then raise notice 'ok: Nur https-URLs'; end $$;

-- Kontolöschung (DSGVO): Kaskade entfernt Creator inkl. Zahlungsdaten, Zustimmungen, Prüfverlauf; Audit bleibt
delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
do $$ declare n int; m int; begin
  select count(*) into n from public.lr_creator_payout_accounts where creator_id = '10000000-0000-4000-8000-00000000000a';
  select count(*) into m from public.lr_creator_audit where creator_id = '10000000-0000-4000-8000-00000000000a';
  if n <> 0 then raise exception 'FAIL: Zahlungsdaten nach Kontolöschung noch vorhanden'; end if;
  if m <> 1 then raise exception 'FAIL: Audit nach Kontolöschung verloren'; end if;
  raise notice 'ok: Kontolöschung kaskadiert, Audit bleibt';
end $$;

select 'ALL CREATOR HUB RLS TESTS PASSED' as result;
rollback;
