# Conv — LEGGIMI

Conv è una piattaforma di chat come Discord: server, sale di testo e vocali, messaggi in tempo reale, file fino a 200 MB, ruoli e ricerca.

## 1. Aprila subito (consigliato)

Non serve installare nulla: è online.

**Link:** https://INSERIRE-LINK.vercel.app

Funziona da computer e da telefono, con qualsiasi browser recente (Chrome, Edge, Firefox, Safari).

### Account di prova

| Ruolo  | Email              | Password      |
|--------|--------------------|---------------|
| Admin  | admin@conv.test    | INSERIRE      |
| Membro | membro@conv.test   | INSERIRE      |

Tutti e due sono già nel server **Conv Demo**, che contiene alcuni messaggi, un file da 100 MB, la sala privata **staff** e una sala **Vocale**.

### Cosa provare (in 5 minuti)

1. Accedi come **admin** in una finestra normale e come **membro** in una finestra in incognito.
2. **Messaggi:** scrivi da una finestra e guarda l'altra: il messaggio arriva subito. Passa sopra un tuo messaggio per modificarlo o eliminarlo.
3. **File:** clicca la graffetta (o trascina un file nella chat). La barra mostra l'avanzamento; le immagini hanno l'anteprima. Prova a scaricare il file da 100 MB già presente.
4. **Ruoli:** il membro **non vede** la sala 🔒 staff e non può eliminare i messaggi altrui. Come admin: ingranaggio accanto al nome del server → *Membri e ruoli* → rendi il membro *Moderatore*: ora vede la sala staff e può eliminare i messaggi degli altri.
5. **Inviti:** ingranaggio → *Invita persone* → copia il link. Chi lo apre entra nel server.
6. **Sala vocale:** entra in *Vocale* da due dispositivi diversi (es. computer e telefono) e consenti il microfono. Chi parla si illumina di verde.
7. **Ricerca:** lente in alto a destra → cerca una parola. Cliccando un risultato si salta al messaggio.
8. **Online:** il pallino verde e il pannello *Membri* mostrano chi è online in quel momento.

## 2. Avviarla sul proprio computer (facoltativo)

Serve [Node.js](https://nodejs.org) 18 o più recente.

```bash
cd conv
npm install
cp .env.example .env
npm run dev
```

Nel file `.env` vanno inseriti indirizzo e chiave **pubblica** del database:

```
VITE_SUPABASE_URL=https://yoaspkbomypdludtvqew.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_x-76Aj3RI0PmM2xpPh32pg_unwOvJdp
```

Sono chiavi pubbliche (le stesse usate dal sito online): permettono solo quello che le regole di sicurezza del database consentono. Poi apri http://localhost:5173 e accedi con gli account di prova.

### Con un database nuovo

Per installarla da zero su un proprio progetto Supabase (gratuito):

1. Crea un progetto su supabase.com.
2. *SQL Editor* → incolla tutto `supabase/schema.sql` → *Run*.
3. *Authentication → Sign In / Providers → Email*: disattiva **Confirm email**.
4. Metti URL e chiave pubblica del nuovo progetto nel file `.env`.
