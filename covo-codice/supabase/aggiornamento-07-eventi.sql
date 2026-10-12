-- =====================================================================
-- CONV — aggiornamento 7: eventi del gruppo con "Ci sono / Forse / No"
-- Incolla TUTTO questo file in Supabase → SQL Editor → "Run".
-- Si può lanciare più volte senza problemi.
-- =====================================================================

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references public.servers(id) on delete cascade,
  created_by  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  category    text not null default 'altro' check (category in ('sport', 'uscita', 'studio', 'gioco', 'riunione', 'altro')),
  starts_at   timestamptz not null,
  place       text check (char_length(place) <= 120),
  notes       text check (char_length(notes) <= 500),
  max_people  int check (max_people is null or max_people between 2 and 500),
  created_at  timestamptz not null default now()
);
create index if not exists events_server_time on public.events (server_id, starts_at);

create table if not exists public.event_rsvps (
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  status     text not null check (status in ('yes', 'maybe', 'no')),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create or replace function public.event_server(eid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select server_id from events where id = eid
$$;

-- chi crea l'evento è sempre chi è collegato; il server non si può spostare
create or replace function public.event_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
    new.server_id  := old.server_id;
    new.created_at := old.created_at;
  end if;
  return new;
end; $$;
drop trigger if exists events_guard on public.events;
create trigger events_guard before insert or update on public.events
  for each row execute function public.event_guard();

-- posti limitati: se l'evento è al completo non si può più dire "Ci sono"
create or replace function public.rsvp_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare cap int; taken int;
begin
  new.user_id := auth.uid();
  new.updated_at := now();
  if new.status = 'yes' and (tg_op = 'INSERT' or old.status is distinct from 'yes') then
    select max_people into cap from events where id = new.event_id;
    if cap is not null then
      select count(*) into taken from event_rsvps where event_id = new.event_id and status = 'yes';
      if taken >= cap then raise exception 'Evento al completo'; end if;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists rsvps_guard on public.event_rsvps;
create trigger rsvps_guard before insert or update on public.event_rsvps
  for each row execute function public.rsvp_guard();

alter table public.events      enable row level security;
alter table public.event_rsvps enable row level security;

-- eventi: li vedono e li creano i membri del server;
-- li modifica o cancella chi li ha creati, oppure un moderatore/admin
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (my_role(server_id) is not null);
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
  with check (my_role(server_id) is not null);
drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (created_by = auth.uid() or role_rank(my_role(server_id)) >= 2)
  with check (my_role(server_id) is not null);
drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete to authenticated
  using (created_by = auth.uid() or role_rank(my_role(server_id)) >= 2);

-- risposte: le vedono i membri del server; ognuno gestisce solo la propria
drop policy if exists rsvps_select on public.event_rsvps;
create policy rsvps_select on public.event_rsvps for select to authenticated
  using (my_role(event_server(event_id)) is not null);
drop policy if exists rsvps_insert on public.event_rsvps;
create policy rsvps_insert on public.event_rsvps for insert to authenticated
  with check (user_id = auth.uid() and my_role(event_server(event_id)) is not null);
drop policy if exists rsvps_update on public.event_rsvps;
create policy rsvps_update on public.event_rsvps for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists rsvps_delete on public.event_rsvps;
create policy rsvps_delete on public.event_rsvps for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.events, public.event_rsvps to authenticated;
grant execute on function public.event_server(uuid) to authenticated;

-- in tempo reale
do $$ begin alter publication supabase_realtime add table public.events;      exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.event_rsvps; exception when duplicate_object then null; end $$;

-- Fa rileggere subito le tabelle al sito
notify pgrst, 'reload schema';
