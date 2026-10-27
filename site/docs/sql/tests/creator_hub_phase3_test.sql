-- Tests Creator Hub Phase 3 (Regeln, Monatsabschluss, Abrechnungen, Provisionen, Anpassungen, Dokumente, Auszahlungen).
-- Voraussetzung: Phase 1–3 angewendet. Läuft in einer Transaktion und wird zurückgerollt.
begin;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a3', 'c3a@test.invalid'), ('00000000-0000-4000-8000-0000000000b3', 'c3b@test.invalid'), ('00000000-0000-4000-8000-0000000000c3', 'k3@test.invalid');
insert into public.lr_creators (id, user_id, status, ref_code) values
  ('10000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a3', 'ACTIVE', 'aaaaaaaaaa'),
  ('10000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b3', 'ACTIVE', 'bbbbbbbbbb');
insert into public.lr_creator_payout_accounts (id, creator_id, holder_name, iban_enc, iban_last4, iban_country, iban_fingerprint, status, confirmed_at)
values ('20000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000a3', 'Anna', 'v1:A:B:C', '3000', 'DE', repeat('3', 64), 'VERIFIED', now());
insert into public.lr_creator_conversions (id, creator_id, user_id, source, stripe_session_id, amount_net_cents, occurred_at) values
  ('60000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000c3', 'link', 'cs_p3_1', 4118, '2026-10-10T10:00:00Z'),
  ('60000000-0000-4000-8000-0000000000b3', '10000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000c3', 'code', 'cs_p3_2', 2437, '2026-10-12T10:00:00Z');
insert into public.lr_creator_adjustments (id, creator_id, period, kind, amount_cents, reason, created_by) values
  ('70000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000a3', '2026-10', 'BONUS', 1000, 'Launch-Bonus', 'test');

-- Regeln: Standardregel aus der Migration vorhanden; Änderung nur durch Beenden
do $$ declare n int; begin
  select count(*) into n from public.lr_creator_commission_rules; if n < 1 then raise exception 'FAIL: Standardregel fehlt'; end if;
  raise notice 'ok: Standardregel angelegt';
end $$;
do $$ begin update public.lr_creator_commission_rules set percent_bps = 9000; raise exception 'FAIL: Regel überschreibbar';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Regeln unveränderbar (nur beenden)'; end $$;
update public.lr_creator_commission_rules set valid_to = now() + interval '1 day' where valid_to is null;
do $$ begin update public.lr_creator_commission_rules set valid_to = now() + interval '2 day'; raise exception 'FAIL: Ende änderbar';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Beendete Regel bleibt beendet'; end $$;

-- Monatsabschluss: Summenprüfung in der Datenbank
do $$ begin
  perform public.lr_creator_close_period('2026-10', 'test', '[{"creator_id":"10000000-0000-4000-8000-0000000000a3","status":"READY","billing_mode":"INVOICE","conversions":2,"revenue_net_cents":6555,"commission_cents":9999,"adjustments_cents":1000,"net_cents":10999,"vat_rate_bps":0,"vat_cents":0,"gross_cents":10999,"payout_cents":10999,"tax_mode":"SMALL_BUSINESS","tax_note":"§ 19","billing_snapshot":{},"adjustment_ids":["70000000-0000-4000-8000-0000000000a3"],"lines":[{"conversion_id":"60000000-0000-4000-8000-0000000000a3","rule_id":"","rule_version":"","base_cents":4118,"commission_cents":824},{"conversion_id":"60000000-0000-4000-8000-0000000000b3","rule_id":"","rule_version":"","base_cents":2437,"commission_cents":487}]}]'::jsonb);
  raise exception 'FAIL: Falsche Summe akzeptiert';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Summenprüfung beim Abschluss'; end $$;

select public.lr_creator_close_period('2026-10', 'test', '[{"creator_id":"10000000-0000-4000-8000-0000000000a3","status":"READY","billing_mode":"INVOICE","conversions":2,"revenue_net_cents":6555,"commission_cents":1311,"adjustments_cents":1000,"net_cents":2311,"vat_rate_bps":0,"vat_cents":0,"gross_cents":2311,"payout_cents":2311,"tax_mode":"SMALL_BUSINESS","tax_note":"§ 19","billing_snapshot":{"legal_name":"A"},"adjustment_ids":["70000000-0000-4000-8000-0000000000a3"],"lines":[{"conversion_id":"60000000-0000-4000-8000-0000000000a3","rule_id":"","rule_version":"","base_cents":4118,"commission_cents":824},{"conversion_id":"60000000-0000-4000-8000-0000000000b3","rule_id":"","rule_version":"","base_cents":2437,"commission_cents":487}]}]'::jsonb) as closed;

do $$ declare n int; s text; begin
  select count(*) into n from public.lr_creator_commissions where period = '2026-10'; if n <> 2 then raise exception 'FAIL: % Provisionszeilen', n; end if;
  select count(*) into n from public.lr_creator_adjustments where statement_id is not null; if n <> 1 then raise exception 'FAIL: Bonus nicht verrechnet'; end if;
  raise notice 'ok: Monatsabschluss legt Abrechnung, Provisionen und Verrechnung an';
end $$;
do $$ begin
  perform public.lr_creator_close_period('2026-10', 'test', '[{"creator_id":"10000000-0000-4000-8000-0000000000a3","status":"READY","billing_mode":"INVOICE","conversions":0,"revenue_net_cents":0,"commission_cents":0,"adjustments_cents":0,"net_cents":0,"vat_rate_bps":0,"vat_cents":0,"gross_cents":0,"payout_cents":0,"tax_mode":"SMALL_BUSINESS","tax_note":"x","billing_snapshot":{},"adjustment_ids":[],"lines":[]}]'::jsonb);
  raise exception 'FAIL: Monat doppelt abgeschlossen';
exception when unique_violation then raise notice 'ok: Ein Abschluss je Creator und Monat'; end $$;
do $$ begin
  insert into public.lr_creator_commissions (conversion_id, creator_id, statement_id, period, base_cents, commission_cents)
  select '60000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000a3', id, '2026-11', 1, 1 from public.lr_creator_statements limit 1;
  raise exception 'FAIL: Conversion doppelt provisioniert';
exception when unique_violation then raise notice 'ok: Jede Conversion wird höchstens einmal provisioniert'; end $$;

-- Unveränderbarkeit
do $$ begin update public.lr_creator_statements set payout_cents = 999999; raise exception 'FAIL: Abrechnung änderbar';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Abrechnungsbeträge unveränderbar'; end $$;
do $$ begin update public.lr_creator_commissions set commission_cents = 1; raise exception 'FAIL: Provision änderbar';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Provisionsbeträge unveränderbar'; end $$;
do $$ begin delete from public.lr_creator_adjustments where id = '70000000-0000-4000-8000-0000000000a3'; raise exception 'FAIL: verrechnete Anpassung löschbar';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Verrechnete Anpassungen bleiben'; end $$;
update public.lr_creator_statements set status = 'INVOICED' where period = '2026-10';
do $$ begin update public.lr_creator_statements set status = 'READY' where period = '2026-10'; raise exception 'FAIL: Status zurücksetzbar';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Status läuft nur vorwärts'; end $$;

-- Dokumente
insert into public.lr_creator_documents (creator_id, statement_id, doc_type, number, storage_path, sha256, totals, created_by)
select '10000000-0000-4000-8000-0000000000a3', id, 'INVOICE', 'CR-2026-001', 'docs/80000000-0000-4000-8000-0000000000a3/re.pdf', repeat('a', 64), '{}'::jsonb, 'creator' from public.lr_creator_statements where period = '2026-10';
do $$ begin update public.lr_creator_documents set number = 'X-1'; raise exception 'FAIL: Dokument änderbar';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Dokumente unveränderbar'; end $$;
do $$ begin
  insert into public.lr_creator_documents (creator_id, statement_id, doc_type, number, storage_path, sha256, totals, created_by)
  select '10000000-0000-4000-8000-0000000000a3', id, 'INVOICE', 'CR-2026-002', 'docs/80000000-0000-4000-8000-0000000000b3/re.pdf', repeat('b', 64), '{}'::jsonb, 'creator' from public.lr_creator_statements where period = '2026-10';
  raise exception 'FAIL: zweite Rechnung';
exception when unique_violation then raise notice 'ok: Eine gültige Rechnung je Abrechnung'; end $$;

-- Auszahlungen
insert into public.lr_creator_payouts (id, statement_id, creator_id, amount_cents, payout_account_id, iban_country, iban_last4, reference, created_by)
select '90000000-0000-4000-8000-0000000000a3', id, '10000000-0000-4000-8000-0000000000a3', 2311, '20000000-0000-4000-8000-0000000000a3', 'DE', '3000', 'LeaseRun Creator 2026-10', 'test' from public.lr_creator_statements where period = '2026-10';
do $$ begin update public.lr_creator_payouts set status = 'PAID'; raise exception 'FAIL: ohne Freigabe bezahlt';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Bezahlt nur nach Freigabe'; end $$;
do $$ begin update public.lr_creator_payouts set amount_cents = 1; raise exception 'FAIL: Betrag änderbar';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Auszahlungsbetrag unveränderbar'; end $$;
update public.lr_creator_payouts set status = 'APPROVED', approved_at = now(), approved_by = 'x';
update public.lr_creator_payouts set status = 'PAID', paid_at = now(), paid_by = 'x';
do $$ begin update public.lr_creator_payouts set status = 'FAILED'; raise exception 'FAIL: bezahlt änderbar';
exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Bezahlte Auszahlung abgeschlossen'; end $$;

-- Gutschriftnummern lückenlos
do $$ declare a bigint; b bigint; begin
  a := public.lr_creator_next_number('creator_credit_note_test'); b := public.lr_creator_next_number('creator_credit_note_test');
  if b <> a + 1 then raise exception 'FAIL: Nummern nicht fortlaufend'; end if;
  raise notice 'ok: Fortlaufende Gutschriftnummern';
end $$;

-- Kennzahlen
do $$ declare o jsonb; begin
  o := public.lr_creator_billing_overview('2026-10');
  if (o->>'commission_cents')::int <> 1311 or (o->>'paid_cents')::int <> 2311 or not (o->>'closed')::boolean then raise exception 'FAIL: Übersicht %', o; end if;
  raise notice 'ok: Billing-Übersicht';
end $$;

-- Creator-Sicht (RLS)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.lr_creator_statements; if n <> 0 then raise exception 'FAIL: B sieht Abrechnung von A'; end if;
  select count(*) into n from public.lr_creator_payouts; if n <> 0 then raise exception 'FAIL: B sieht Auszahlung von A'; end if;
  select count(*) into n from public.lr_creator_documents; if n <> 0 then raise exception 'FAIL: B sieht Dokument von A'; end if;
  raise notice 'ok: Creator B sieht keine Abrechnungsdaten von A';
end $$;
do $$ begin perform 1 from public.lr_creator_commission_rules; raise exception 'FAIL: Regeln lesbar';
exception when insufficient_privilege then raise notice 'ok: Provisionsregeln nur Server'; end $$;
do $$ begin perform public.lr_creator_close_period('2026-11', 'x', '[]'::jsonb); raise exception 'FAIL: Abschluss durch Creator';
exception when insufficient_privilege then raise notice 'ok: Monatsabschluss nur Server'; end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.lr_creator_statements; if n <> 1 then raise exception 'FAIL: A sieht eigene Abrechnung nicht'; end if;
  raise notice 'ok: Creator A sieht eigene Abrechnung';
end $$;
reset role;

-- Kontolöschung eines Creators mit Abrechnungen wird verhindert (Aufbewahrungspflicht)
do $$ begin delete from auth.users where id = '00000000-0000-4000-8000-0000000000a3'; raise exception 'FAIL: Creator mit Abrechnung löschbar';
exception when foreign_key_violation or raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'ok: Creator mit Abrechnungen nicht löschbar (Aufbewahrung)'; end $$;

-- Kontolöschung über die vorgesehene Funktion: Creator A (mit Abrechnung) wird gelöst und bereinigt,
-- Creator B (ohne Abrechnungsdaten) vollständig gelöscht; danach gelingt das Löschen der Logins.
do $$ declare r text; n int; begin
  r := public.lr_creator_account_deleted('00000000-0000-4000-8000-0000000000a3');
  if r <> 'archived' then raise exception 'FAIL: A nicht archiviert (%)', r; end if;
  delete from auth.users where id = '00000000-0000-4000-8000-0000000000a3';
  select count(*) into n from public.lr_creator_statements s join public.lr_creators c on c.id = s.creator_id
    where c.user_id is null and c.status = 'SUSPENDED';
  if n <> 1 then raise exception 'FAIL: Abrechnung nach Kontolöschung nicht erhalten'; end if;
  select count(*) into n from public.lr_creator_audit where event_type = 'CREATOR_ACCOUNT_DELETED';
  if n <> 1 then raise exception 'FAIL: Kontolöschung nicht protokolliert'; end if;
  raise notice 'ok: Kontolöschung mit Abrechnungen – Creator gelöst, Belege erhalten, protokolliert';
  r := public.lr_creator_account_deleted('00000000-0000-4000-8000-0000000000b3');
  if r <> 'deleted' then raise exception 'FAIL: B nicht gelöscht (%)', r; end if;
  delete from auth.users where id = '00000000-0000-4000-8000-0000000000b3';
  raise notice 'ok: Kontolöschung ohne Abrechnungen – Creator vollständig entfernt';
  if public.lr_creator_account_deleted('00000000-0000-4000-8000-0000000000ff') <> 'none' then raise exception 'FAIL: none'; end if;
end $$;
set local role authenticated;
do $$ begin perform public.lr_creator_account_deleted('00000000-0000-4000-8000-0000000000b3'); raise exception 'FAIL: Funktion für Nutzer aufrufbar';
exception when insufficient_privilege then raise notice 'ok: Kontolöschungs-Funktion nur Server'; end $$;
reset role;

select 'ALL CREATOR HUB PHASE 3 TESTS PASSED' as result;
rollback;
