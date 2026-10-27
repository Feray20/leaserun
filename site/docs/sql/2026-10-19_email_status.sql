-- angewendet am 2026-10-19 (Migration auth_email_status)
create or replace function public.lr_email_status(p_email text)
returns jsonb language sql security definer set search_path = '' stable as $$
  select coalesce(
    (select jsonb_build_object('exists', true, 'confirmed', u.email_confirmed_at is not null,
        'password', u.encrypted_password is not null and u.encrypted_password <> '',
        'providers', coalesce((select jsonb_agg(distinct i.provider) from auth.identities i where i.user_id = u.id), '[]'::jsonb))
     from auth.users u where lower(u.email) = lower(trim(p_email)) and u.deleted_at is null limit 1),
    jsonb_build_object('exists', false));
$$;
revoke all on function public.lr_email_status(text) from public, anon, authenticated;
grant execute on function public.lr_email_status(text) to service_role;
