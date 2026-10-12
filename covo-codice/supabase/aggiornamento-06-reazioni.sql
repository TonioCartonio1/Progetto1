-- =====================================================================
-- CONV — aggiornamento 6: reazioni ai messaggi (👍 ❤️ 😂 😮 😢 🎉)
-- Incolla TUTTO questo file in Supabase → SQL Editor → "Run".
-- Si può lanciare più volte senza problemi.
-- =====================================================================

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

-- Fa rileggere subito le tabelle al sito
notify pgrst, 'reload schema';
