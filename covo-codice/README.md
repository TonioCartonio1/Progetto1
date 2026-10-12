# Covo

Piattaforma di chat con server, sale, messaggi in tempo reale, file fino a 100 MB e ruoli
(admin, moderatore, membro) e sale vocali gratuite (WebRTC, fino a ~5 persone). Costruita con React + Vite, Supabase (database, accesso, tempo reale, file) e Vercel.

## Messa in funzione

1. **Supabase** → crea un progetto → *SQL Editor* → incolla tutto `supabase/schema.sql` → *Run*.
   (Se il database esisteva già prima delle sale vocali, lancia anche `supabase/aggiornamento-01-voce.sql`.)
2. **Supabase** → *Authentication → Sign In / Providers → Email*: disattiva **Confirm email** (registrazione immediata).
3. **File grandi**: funziona anche con il piano gratuito di Supabase (limite 50 MB per oggetto). I file oltre 45 MB vengono divisi in pezzi al caricamento e riuniti nel browser al download. Limite per file: 200 MB (`src/config.js`).
4. **Vercel** → importa questo repository → nelle *Environment Variables* aggiungi:
   - `VITE_SUPABASE_URL` = Project URL di Supabase
   - `VITE_SUPABASE_ANON_KEY` = chiave *anon public* (o *publishable*)
5. **Supabase** → *Authentication → URL Configuration*: metti il link di Vercel come *Site URL*.

## Avvio in locale

```bash
npm install
cp .env.example .env   # poi incolla URL e chiave
npm run dev
```
