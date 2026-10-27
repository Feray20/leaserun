-- Not-Aus Stufe 2: alle Anmeldungen außer denen der Administratoren beenden (Sitzungen und Refresh-Tokens).
-- Einmalig im Supabase-SQL-Editor ausführen (oder per Migration). Aufruf nur mit dem Service-Schlüssel.
create or replace function public.lr_revoke_sessions(keep_emails text[])
returns integer
language plpgsql
security definer
set search_path = auth, public
as $$
declare n integer;
begin
  with gone as (
    delete from auth.sessions s
    using auth.users u
    where s.user_id = u.id and lower(coalesce(u.email, '')) <> all (select lower(e) from unnest(keep_emails) e)
    returning s.id
  ) select count(*) into n from gone;
  delete from auth.refresh_tokens r
    using auth.users u
    where r.user_id::uuid = u.id and lower(coalesce(u.email, '')) <> all (select lower(e) from unnest(keep_emails) e);
  return n;
end;
$$;
revoke all on function public.lr_revoke_sessions(text[]) from public, anon, authenticated;
grant execute on function public.lr_revoke_sessions(text[]) to service_role;
