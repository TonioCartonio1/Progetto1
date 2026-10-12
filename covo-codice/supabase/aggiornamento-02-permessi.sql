-- =====================================================================
-- CONV — aggiornamento 2: permessi e link d'invito
-- Incolla TUTTO questo file in Supabase → SQL Editor → "Run".
-- Si può lanciare più volte senza problemi.
-- =====================================================================

-- Codici d'invito generati senza estensioni esterne
alter table public.servers
  alter column invite_code set default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

create or replace function public.reset_invite(p_server uuid)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if my_role(p_server) is distinct from 'admin' then raise exception 'Solo gli admin'; end if;
  update servers set invite_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
    where id = p_server returning invite_code into code;
  return code;
end; $$;
revoke execute on function public.reset_invite(uuid) from anon;

-- ---------------------------------------------------------------------
-- PERMESSI DI ACCESSO ALLE TABELLE
-- Nei progetti Supabase nuovi le tabelle non sono sempre aperte al sito:
-- queste righe le aprono agli utenti registrati. Chi vede cosa resta
-- deciso dalle regole di sicurezza (RLS) qui sopra.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
