-- =====================================================================
-- CONV — aggiornamento 5: "sta scrivendo…"
-- Il segnale passa su canali privati "room:<id sala>": queste regole
-- lo fanno ricevere solo a chi può vedere la sala (le private restano private).
-- Incolla TUTTO questo file in Supabase → SQL Editor → "Run".
-- =====================================================================

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

-- Fa rileggere subito le tabelle al sito
notify pgrst, 'reload schema';
