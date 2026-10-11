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
  invite_code text not null unique default encode(gen_random_bytes(6), 'hex'),
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

-- Crea un server: chi lo crea è admin, con 3 sale di partenza (1 privata)
create or replace function public.create_server(p_name text, p_icon_url text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'Devi accedere'; end if;
  insert into servers (name, icon_url, owner_id) values (trim(p_name), p_icon_url, auth.uid()) returning id into sid;
  insert into server_members (server_id, user_id, role) values (sid, auth.uid(), 'admin');
  insert into channels (server_id, name) values (sid, 'generale'), (sid, 'off-topic');
  insert into channels (server_id, name, private_role) values (sid, 'staff', 'moderator');
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
  update servers set invite_code = encode(gen_random_bytes(6), 'hex') where id = p_server returning invite_code into code;
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
create policy channels_select on public.channels for select to authenticated using (can_view_channel(id));
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
