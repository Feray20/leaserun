-- Rückbau Creator Hub Phase 4. Nur in Test-/Branch-Datenbanken verwenden (entfernt Erstattungs- und Importhistorie).
-- Monatsabschluss und Abrechnungs-Schutz werden auf den Stand von Phase 3 zurückgesetzt.
begin;
-- Monatsabschluss in der Fassung von Phase 3 (ohne Erstattungen)
create or replace function public.lr_creator_close_period(p_period text, p_actor text, p_statements jsonb)
returns integer language plpgsql set search_path to '' as $$
declare s jsonb; l jsonb; sid uuid; n integer := 0; sumc bigint;
begin
  if p_period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'Ungültiger Zeitraum.'; end if;
  perform pg_advisory_xact_lock(hashtext('lr_creator_close:' || p_period));
  for s in select * from jsonb_array_elements(coalesce(p_statements, '[]'::jsonb)) loop
    select coalesce(sum((x->>'commission_cents')::bigint), 0) into sumc from jsonb_array_elements(coalesce(s->'lines', '[]'::jsonb)) x;
    if sumc <> (s->>'commission_cents')::bigint then raise exception 'Summe der Provisionszeilen passt nicht.'; end if;
    if (s->>'net_cents')::bigint <> (s->>'commission_cents')::bigint + (s->>'adjustments_cents')::bigint then raise exception 'Nettobetrag passt nicht.'; end if;
    insert into public.lr_creator_statements (creator_id, period, status, billing_mode, conversions, revenue_net_cents, commission_cents, adjustments_cents,
      net_cents, vat_rate_bps, vat_cents, gross_cents, payout_cents, tax_mode, tax_note, billing_snapshot, closed_by)
    values ((s->>'creator_id')::uuid, p_period, s->>'status', s->>'billing_mode', (s->>'conversions')::int, (s->>'revenue_net_cents')::bigint,
      (s->>'commission_cents')::bigint, (s->>'adjustments_cents')::bigint, (s->>'net_cents')::bigint, (s->>'vat_rate_bps')::int, (s->>'vat_cents')::bigint,
      (s->>'gross_cents')::bigint, (s->>'payout_cents')::bigint, s->>'tax_mode', s->>'tax_note', s->'billing_snapshot', p_actor)
    returning id into sid;
    for l in select * from jsonb_array_elements(coalesce(s->'lines', '[]'::jsonb)) loop
      insert into public.lr_creator_commissions (conversion_id, creator_id, statement_id, period, rule_id, rule_version, base_cents, commission_cents)
      values ((l->>'conversion_id')::uuid, (s->>'creator_id')::uuid, sid, p_period, nullif(l->>'rule_id', '')::uuid, nullif(l->>'rule_version', '')::int,
        (l->>'base_cents')::bigint, (l->>'commission_cents')::bigint);
    end loop;
    update public.lr_creator_adjustments set statement_id = sid
      where id in (select (x#>>'{}')::uuid from jsonb_array_elements(coalesce(s->'adjustment_ids', '[]'::jsonb)) x)
        and creator_id = (s->>'creator_id')::uuid and statement_id is null;
    if (select count(*) from public.lr_creator_adjustments where statement_id = sid) <> jsonb_array_length(coalesce(s->'adjustment_ids', '[]'::jsonb)) then
      raise exception 'Anpassungen wurden inzwischen geändert. Bitte erneut abschließen.';
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lr_creator_close_period(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.lr_creator_close_period(text, text, jsonb) to service_role;
drop table if exists public.lr_creator_refunds cascade;
drop table if exists public.lr_creator_bank_imports cascade;
drop function if exists public.lr_creator_record_refund(text, text, bigint, bigint);
drop function if exists public.lr_creator_refund_guard();
drop function if exists public.lr_creator_bank_import_immutable();
drop function if exists public.lr_creator_payout_returned(uuid, text);
drop function if exists public.lr_creator_payout_reissue(uuid, text);
-- Hinweis: zurückgekommene Auszahlungen (RETURNED) müssen vor dem Rückbau erneut angestoßen oder geklärt sein.
create or replace function public.lr_creator_payout_status_guard() returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Auszahlungen werden nicht gelöscht.'; end if;
  if new.amount_cents is distinct from old.amount_cents or new.payout_account_id is distinct from old.payout_account_id
     or new.statement_id is distinct from old.statement_id or new.creator_id is distinct from old.creator_id or new.reference is distinct from old.reference then
    raise exception 'Betrag, Konto und Verwendungszweck einer Auszahlung sind unveränderbar.';
  end if;
  if old.status = 'PAID' then raise exception 'Bezahlte Auszahlungen sind abgeschlossen.'; end if;
  if new.status = 'PAID' and old.status not in ('APPROVED','EXPORTED') then raise exception 'Nur freigegebene Auszahlungen können als bezahlt markiert werden.'; end if;
  if new.status = 'EXPORTED' and old.status <> 'APPROVED' and old.status <> 'EXPORTED' then raise exception 'Nur freigegebene Auszahlungen können exportiert werden.'; end if;
  return new;
end $$;
alter table public.lr_creator_payouts drop constraint if exists lr_creator_payouts_status_check;
alter table public.lr_creator_payouts add constraint lr_creator_payouts_status_check check (status in ('READY','APPROVED','EXPORTED','PAID','FAILED'));
alter table public.lr_creator_payouts drop column if exists returned_at;
alter table public.lr_creator_payouts drop column if exists reissue_count;
alter table public.lr_creator_payouts drop constraint if exists lr_creator_payouts_paid_via_check;
alter table public.lr_creator_payouts drop constraint if exists lr_creator_payouts_bank_ref_check;
alter table public.lr_creator_payouts drop column if exists paid_via;
alter table public.lr_creator_payouts drop column if exists bank_ref;
create or replace function public.lr_creator_statement_guard() returns trigger language plpgsql set search_path to '' as $$
declare ord text[] := array['READY','INVOICED','APPROVED','PAID'];
begin
  if tg_op = 'DELETE' then raise exception 'Abrechnungen werden nicht gelöscht.'; end if;
  if (to_jsonb(new) - array['status','approved_at','approved_by','paid_at','carried_over']) is distinct from
     (to_jsonb(old) - array['status','approved_at','approved_by','paid_at','carried_over']) then
    raise exception 'Abgeschlossene Abrechnungen sind unveränderbar.';
  end if;
  if old.status = 'ZERO' and new.status <> 'ZERO' then raise exception 'Abrechnung ohne Betrag bleibt abgeschlossen.'; end if;
  if old.status <> 'ZERO' and array_position(ord, new.status) < array_position(ord, old.status) then raise exception 'Status kann nicht zurückgesetzt werden.'; end if;
  if old.carried_over and not new.carried_over then raise exception 'Übertrag ist endgültig.'; end if;
  return new;
end $$;
alter table public.lr_creator_statements drop column if exists notified_at;
alter table public.lr_creator_statements drop column if exists reminded_at;
delete from public.lr_settings where key in ('creator_auto_close', 'creator_invoice_reminder_days');
commit;
