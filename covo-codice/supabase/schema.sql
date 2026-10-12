-- =====================================================================
-- COVO — schema del database
-- Incolla TUTTO questo file in Supabase → SQL Editor → "Run".
-- Crea tabelle, permessi (ruoli + sala privata), tempo reale e spazio file.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- TABELLE
-- ---------------------------------------------------------------------

-- Profilo pubblico di ogni utente (nome e foto)
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Nuovo utente' check (char_length(display_name) between 1 and 40),
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- Server (come quelli di Discord)
create table if not exists public.servers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 50),
  icon_url    text,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_at  timestamptz not null default now()
);

-- Chi è dentro a quale server, e con quale ruolo
create table if not exists public.server_members (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('admin', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

-- Sale. private_role = null → tutti; 'moderator' → moderatori e admin; 'admin' → solo admin
create table if not exists public.channels (
  id           uuid primary key default gen_random_uuid(),
  server_id    uuid not null references public.servers(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 40),
  private_role text check (private_role in ('admin', 'moderator')),
  created_at   timestamptz not null default now()
);

-- Messaggi (con eventuale file allegato)
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  content    text not null default '' check (char_length(content) <= 4000),
  file_path  text,
  file_name  text,
  file_size  bigint,
  file_type  text,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  check (content <> '' or file_path is not null)
);

-- Tipo di sala: 'text' (chat) o 'voice' (vocale)
alter table public.channels add column if not exists kind text not null default 'text';
do $$ begin
  alter table public.channels add constraint channels_kind_check check (kind in ('text', 'voice'));
exception when duplicate_object then null; end $$;

create index if not exists messages_channel_time on public.messages (channel_id, created_at desc);
create index if not exists channels_server on public.channels (server_id);
create index if not exists members_user on public.server_members (user_id);

alter table public.messages replica identity full;

-- ---------------------------------------------------------------------
-- PROFILO AUTOMATICO ALLA REGISTRAZIONE
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1), 'Utente'), 40)
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- FUNZIONI DI SUPPORTO PER I PERMESSI
-- ---------------------------------------------------------------------
create or replace function public.role_rank(r text)
returns int language sql immutable as $$
  select case r when 'admin' then 3 when 'moderator' then 2 when 'member' then 1 else 0 end
$$;

-- Il mio ruolo in un server (null se non sono membro)
create or replace function public.my_role(sid uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from server_members where server_id = sid and user_id = auth.uid()
$$;

-- Posso vedere questa sala?
create or replace function public.can_view_channel(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from channels c
    join server_members m on m.server_id = c.server_id and m.user_id = auth.uid()
    where c.id = cid
      and (c.private_role is null or role_rank(m.role) >= role_rank(c.private_role))
  )
$$;

-- Posso vedere una sala con questi dati? (controlla i valori della riga, così vale anche per sale appena create)
create or replace function public.can_see_channel_row(sid uuid, prole text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from server_members m
    where m.server_id = sid and m.user_id = auth.uid()
      and (prole is null or role_rank(m.role) >= role_rank(prole))
  )
$$;

create or replace function public.channel_server(cid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select server_id from channels where id = cid
$$;

create or replace function public.server_owner(sid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select owner_id from servers where id = sid
$$;

-- ---------------------------------------------------------------------
-- AZIONI (chiamate dal sito)
-- ---------------------------------------------------------------------

-- Crea un server: chi lo crea è admin, con 3 sale di testo (1 privata) e 1 sala vocale
create or replace function public.create_server(p_name text, p_icon_url text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'Devi accedere'; end if;
  insert into servers (name, icon_url, owner_id) values (trim(p_name), p_icon_url, auth.uid()) returning id into sid;
  insert into server_members (server_id, user_id, role) values (sid, auth.uid(), 'admin');
  insert into channels (server_id, name) values (sid, 'generale'), (sid, 'off-topic');
  insert into channels (server_id, name, private_role) values (sid, 'staff', 'moderator');
  insert into channels (server_id, name, kind) values (sid, 'Vocale', 'voice');
  return sid;
end; $$;

-- Entra con un link d'invito (come membro)
create or replace function public.join_server(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'Devi accedere'; end if;
  select id into sid from servers where invite_code = p_code;
  if sid is null then raise exception 'Invito non valido o scaduto'; end if;
  insert into server_members (server_id, user_id) values (sid, auth.uid()) on conflict do nothing;
  return sid;
end; $$;

-- Anteprima dell'invito (nome, icona, numero membri)
create or replace function public.invite_preview(p_code text)
returns table (id uuid, name text, icon_url text, members bigint)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.icon_url, (select count(*) from server_members m where m.server_id = s.id)
  from servers s where s.invite_code = p_code
$$;

-- Nuovo link d'invito (solo admin): quello vecchio smette di funzionare
create or replace function public.reset_invite(p_server uuid)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if my_role(p_server) is distinct from 'admin' then raise exception 'Solo gli admin'; end if;
  update servers set invite_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) where id = p_server returning invite_code into code;
  return code;
end; $$;

revoke execute on function public.create_server(text, text) from anon;
revoke execute on function public.join_server(text) from anon;
revoke execute on function public.reset_invite(uuid) from anon;

-- Quando si modifica un messaggio si può cambiare solo il testo
create or replace function public.protect_message_update()
returns trigger language plpgsql as $$
begin
  new.channel_id := old.channel_id;
  new.user_id    := old.user_id;
  new.file_path  := old.file_path;
  new.file_name  := old.file_name;
  new.file_size  := old.file_size;
  new.file_type  := old.file_type;
  new.created_at := old.created_at;
  new.edited_at  := now();
  return new;
end; $$;

drop trigger if exists messages_protect on public.messages;
create trigger messages_protect before update on public.messages
  for each row execute function public.protect_message_update();

-- ---------------------------------------------------------------------
-- REGOLE DI SICUREZZA (Row Level Security)
-- Sono nel database: valgono anche se qualcuno prova a "forzare" il sito.
-- ---------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.servers        enable row level security;
alter table public.server_members enable row level security;
alter table public.channels       enable row level security;
alter table public.messages       enable row level security;

-- Profili: tutti gli utenti registrati li vedono, ognuno modifica il suo
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Server: li vede chi è membro, li modifica l'admin, li elimina il proprietario
drop policy if exists servers_select on public.servers;
create policy servers_select on public.servers for select to authenticated using (my_role(id) is not null);
drop policy if exists servers_update on public.servers;
create policy servers_update on public.servers for update to authenticated
  using (my_role(id) = 'admin') with check (my_role(id) = 'admin');
drop policy if exists servers_delete on public.servers;
create policy servers_delete on public.servers for delete to authenticated using (owner_id = auth.uid());

-- Membri: li vede chi è nello stesso server; l'admin cambia i ruoli (non il proprio, non del proprietario)
drop policy if exists members_select on public.server_members;
create policy members_select on public.server_members for select to authenticated
  using (my_role(server_id) is not null);
drop policy if exists members_update on public.server_members;
create policy members_update on public.server_members for update to authenticated
  using (my_role(server_id) = 'admin' and user_id <> auth.uid() and user_id <> server_owner(server_id))
  with check (my_role(server_id) = 'admin' and user_id <> server_owner(server_id));
drop policy if exists members_delete on public.server_members;
create policy members_delete on public.server_members for delete to authenticated
  using (
    user_id <> server_owner(server_id)
    and (user_id = auth.uid() or my_role(server_id) = 'admin')
  );

-- Sale: le vede chi ha il ruolo giusto; le gestiscono moderatori e admin
drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels for select to authenticated using (can_see_channel_row(server_id, private_role));
drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check (
    role_rank(my_role(server_id)) >= 2
    and (private_role is null or role_rank(my_role(server_id)) >= role_rank(private_role))
  );
drop policy if exists channels_update on public.channels;
create policy channels_update on public.channels for update to authenticated
  using (role_rank(my_role(server_id)) >= 2 and can_view_channel(id))
  with check (
    role_rank(my_role(server_id)) >= 2
    and (private_role is null or role_rank(my_role(server_id)) >= role_rank(private_role))
  );
drop policy if exists channels_delete on public.channels;
create policy channels_delete on public.channels for delete to authenticated
  using (role_rank(my_role(server_id)) >= 2 and can_view_channel(id));

-- Messaggi: li legge e scrive chi vede la sala; si modificano solo i propri;
-- si eliminano i propri, oppure quelli altrui se moderatore o admin
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated using (can_view_channel(channel_id));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (user_id = auth.uid() and can_view_channel(channel_id));
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete to authenticated
  using (
    can_view_channel(channel_id)
    and (user_id = auth.uid() or role_rank(my_role(channel_server(channel_id))) >= 2)
  );

-- ---------------------------------------------------------------------
-- TEMPO REALE (messaggi istantanei)
-- ---------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.messages;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.channels;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.server_members; exception when duplicate_object then null; end;
end $$;

-- ---------------------------------------------------------------------
-- SPAZIO FILE
--  images      → foto profilo e icone server (pubbliche)
--  attachments → file delle sale (privati: li vede solo chi vede la sala)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('images', 'images', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false)
  on conflict (id) do nothing;

drop policy if exists "covo images insert" on storage.objects;
create policy "covo images insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "covo images select" on storage.objects;
create policy "covo images select" on storage.objects for select
  using (bucket_id = 'images');

-- I file allegati stanno in: <id sala>/<id utente>/<nome file>
drop policy if exists "covo attachments insert" on storage.objects;
create policy "covo attachments insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.can_view_channel(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "covo attachments select" on storage.objects;
create policy "covo attachments select" on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.can_view_channel(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------
-- SALE VOCALI
-- La voce viaggia direttamente tra i browser (WebRTC). Supabase fa solo da
-- "centralino" su canali privati chiamati voice:<id sala>, e queste regole
-- fanno entrare solo chi può vedere la sala (le sale private restano private).
-- ---------------------------------------------------------------------
create or replace function public.can_use_voice_topic(topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if topic !~ '^voice:[0-9a-f-]{36}$' then return false; end if;
  return exists (
    select 1 from channels c
    where c.id = split_part(topic, ':', 2)::uuid and c.kind = 'voice'
  ) and can_view_channel(split_part(topic, ':', 2)::uuid);
end; $$;

drop policy if exists "conv voice read" on realtime.messages;
create policy "conv voice read" on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and public.can_use_voice_topic(realtime.topic()));

drop policy if exists "conv voice write" on realtime.messages;
create policy "conv voice write" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and public.can_use_voice_topic(realtime.topic()));

-- Chi ha caricato un file (o un moderatore) può cancellarlo
drop policy if exists "conv attachments delete" on storage.objects;
create policy "conv attachments delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.role_rank(public.my_role(public.channel_server(((storage.foldername(name))[1])::uuid))) >= 2
    )
  );

-- ---------------------------------------------------------------------
-- "STA SCRIVENDO…" (canali privati room:<id sala>)
-- ---------------------------------------------------------------------
create or replace function public.can_use_room_topic(topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if topic !~ '^room:[0-9a-f-]{36}$' then return false; end if;
  return can_view_channel(split_part(topic, ':', 2)::uuid);
end; $$;
grant execute on function public.can_use_room_topic(text) to authenticated;

drop policy if exists "conv room read" on realtime.messages;
create policy "conv room read" on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.can_use_room_topic(realtime.topic()));

drop policy if exists "conv room write" on realtime.messages;
create policy "conv room write" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and public.can_use_room_topic(realtime.topic()));

-- ---------------------------------------------------------------------
-- REAZIONI AI MESSAGGI
-- ---------------------------------------------------------------------
create table if not exists public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🎉')),
  channel_id uuid not null references public.channels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists reactions_channel on public.reactions (channel_id);

-- la sala della reazione è sempre quella del messaggio (non la decide il sito)
create or replace function public.reaction_set_channel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.channel_id := (select channel_id from messages where id = new.message_id);
  return new;
end; $$;
drop trigger if exists reactions_channel on public.reactions;
create trigger reactions_channel before insert on public.reactions
  for each row execute function public.reaction_set_channel();

alter table public.reactions enable row level security;

-- le vede chi vede la sala; ognuno aggiunge e toglie solo le proprie
drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions for select to authenticated
  using (can_view_channel(channel_id));
drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and can_view_channel(channel_id));
drop policy if exists reactions_delete on public.reactions;
create policy reactions_delete on public.reactions for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.reactions to authenticated;

-- in tempo reale
do $$ begin
  alter publication supabase_realtime add table public.reactions;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- EVENTI DEL GRUPPO (Ci sono / Forse / No)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- PERMESSI DI ACCESSO ALLE TABELLE
-- Nei progetti Supabase nuovi le tabelle non sono sempre aperte al sito:
-- queste righe le aprono agli utenti registrati. Chi vede cosa resta
-- deciso dalle regole di sicurezza (RLS) qui sopra.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Fa rileggere subito le tabelle al sito
notify pgrst, 'reload schema';
