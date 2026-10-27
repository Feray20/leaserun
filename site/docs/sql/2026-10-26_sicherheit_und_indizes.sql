-- Sicherheits- und Performance-Korrekturen aus der Prüfung vom 23.10.2026 (Supabase Advisors + Policy-Prüfung).
-- Anwenden: Supabase → SQL Editor → Inhalt einfügen → Run. Idempotent, läuft in einer Transaktion.
--
-- 1) Zu offene Zugriffsregeln: Auf neun älteren Tabellen durfte jeder angemeldete Nutzer ALLE Zeilen lesen, anlegen
--    (und teils ändern) – auch fremde. Die Tabellen sind derzeit leer und werden von der Website nicht aus dem Browser
--    genutzt (nur der Server mit Service-Schlüssel greift zu, z. B. Kontolöschung). Daher: offene Regeln entfernen,
--    Browser-Rechte entziehen. RLS bleibt aktiv → Standard „kein Zugriff“ für Browser, Server unverändert.
-- 2) Elf doppelte Indizes entfernen (jeweils ein identischer bleibt bestehen).
-- 3) Fehlenden Index für den Fremdschlüssel lr_feedback.account_id anlegen.
begin;

-- 1) Offene Regeln schließen
drop policy if exists authenticated_evidence_insert on public.evidence_refs;
drop policy if exists authenticated_evidence_select on public.evidence_refs;
drop policy if exists lr_audit_auth_insert on public.lr_audit_log;
drop policy if exists lr_audit_auth_select on public.lr_audit_log;
drop policy if exists lr_bank_score_auth_insert on public.lr_bank_ready_scores;
drop policy if exists lr_bank_score_auth_select on public.lr_bank_ready_scores;
drop policy if exists lr_decision_auth_insert on public.lr_decision_scenarios;
drop policy if exists lr_decision_auth_select on public.lr_decision_scenarios;
drop policy if exists lr_stress_auth_insert on public.lr_stress_scenarios;
drop policy if exists lr_stress_auth_select on public.lr_stress_scenarios;
drop policy if exists lr_underwriting_auth_insert on public.lr_underwriting_cases;
drop policy if exists lr_underwriting_auth_select on public.lr_underwriting_cases;
drop policy if exists lr_underwriting_auth_update on public.lr_underwriting_cases;
drop policy if exists lr_veto_auth_insert on public.lr_veto_findings;
drop policy if exists lr_veto_auth_select on public.lr_veto_findings;
drop policy if exists authenticated_properties_insert on public.properties;
drop policy if exists authenticated_properties_select on public.properties;
drop policy if exists authenticated_properties_update on public.properties;
drop policy if exists authenticated_documents_insert on public.property_documents;
drop policy if exists authenticated_documents_select on public.property_documents;

alter table public.evidence_refs enable row level security;
alter table public.lr_audit_log enable row level security;
alter table public.lr_bank_ready_scores enable row level security;
alter table public.lr_decision_scenarios enable row level security;
alter table public.lr_stress_scenarios enable row level security;
alter table public.lr_underwriting_cases enable row level security;
alter table public.lr_veto_findings enable row level security;
alter table public.properties enable row level security;
alter table public.property_documents enable row level security;

revoke all on public.evidence_refs, public.lr_audit_log, public.lr_bank_ready_scores, public.lr_decision_scenarios,
  public.lr_stress_scenarios, public.lr_underwriting_cases, public.lr_veto_findings, public.properties, public.property_documents
  from anon, authenticated;

-- 2) Doppelte Indizes (der jeweils gleichwertige *_id_idx bzw. *_created bleibt)
drop index if exists public.evidence_refs_document_idx;
drop index if exists public.idx_immo_audit_deal;
drop index if exists public.lr_bank_score_property_idx;
drop index if exists public.lr_decision_scenario_property_idx;
drop index if exists public.idx_immo_ingestion_document;
drop index if exists public.idx_immo_documents_deal;
drop index if exists public.idx_seclog_time;
drop index if exists public.lr_stress_case_idx;
drop index if exists public.lr_underwriting_property_idx;
drop index if exists public.idx_immo_veto_deal;
drop index if exists public.lr_veto_property_idx;

-- 3) Index für Fremdschlüssel
create index if not exists lr_feedback_account_id_idx on public.lr_feedback (account_id);

commit;

-- Kontrolle: sollte 0 Zeilen liefern (keine offenen Regeln mehr)
select tablename, policyname from pg_policies
where schemaname = 'public' and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true');
