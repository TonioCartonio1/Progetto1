-- =====================================================================
-- CONV — aggiornamento 3: creazione delle sale
-- Incolla TUTTO questo file in Supabase → SQL Editor → "Run".
-- Si può lanciare più volte senza problemi.
-- =====================================================================

-- Posso vedere una sala con questi dati? (controlla i valori della riga, così vale anche per sale appena create)
create or replace function public.can_see_channel_row(sid uuid, prole text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from server_members m
    where m.server_id = sid and m.user_id = auth.uid()
      and (prole is null or role_rank(m.role) >= role_rank(prole))
  )
$$;
grant execute on function public.can_see_channel_row(uuid, text) to authenticated;

drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels for select to authenticated
  using (can_see_channel_row(server_id, private_role));

-- Fa rileggere subito le tabelle al sito
notify pgrst, 'reload schema';
