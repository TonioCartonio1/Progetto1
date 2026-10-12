-- =====================================================================
-- CONV — aggiornamento 1: sale vocali
-- Incolla TUTTO questo file in Supabase → SQL Editor → "Run".
-- Si può lanciare più volte senza problemi.
-- =====================================================================

-- Tipo di sala: 'text' (chat) o 'voice' (vocale)
alter table public.channels add column if not exists kind text not null default 'text';
do $$ begin
  alter table public.channels add constraint channels_kind_check check (kind in ('text', 'voice'));
exception when duplicate_object then null; end $$;

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

-- Aggiunge una sala vocale ai server che già esistono
insert into public.channels (server_id, name, kind)
select s.id, 'Vocale', 'voice' from public.servers s
where not exists (select 1 from public.channels c where c.server_id = s.id and c.kind = 'voice');



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
