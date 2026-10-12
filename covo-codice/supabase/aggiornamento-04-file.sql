-- =====================================================================
-- CONV — aggiornamento 4: cancellazione dei file
-- Quando si elimina un messaggio, si cancella anche il suo file
-- (così lo spazio gratuito di 1 GB non si riempie).
-- Incolla TUTTO questo file in Supabase → SQL Editor → "Run".
-- =====================================================================

drop policy if exists "conv attachments delete" on storage.objects;
create policy "conv attachments delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.role_rank(public.my_role(public.channel_server(((storage.foldername(name))[1])::uuid))) >= 2
    )
  );

-- Fa rileggere subito le tabelle al sito
notify pgrst, 'reload schema';
