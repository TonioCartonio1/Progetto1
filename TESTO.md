# Conv — Missione 01: Costruisci il tuo Discord

**Squadra:** Tommaso Corradini (da solo)
**Livello:** Pro
**Link:** https://progetto1-omega.vercel.app

## Strumenti usati

- **Claude** (Anthropic): ha scritto il codice. Io ho deciso cosa costruire, provato ogni funzione e segnalato gli errori da correggere.
- **Supabase** (piano gratuito): database, account, messaggi in tempo reale, file e regole di sicurezza.
- **Vercel** (piano gratuito): mette il sito online e lo aggiorna a ogni modifica.
- **GitHub**: conserva il codice.
- Tecnologie: React + Vite; WebRTC per la voce.

## Cosa funziona

**I sei requisiti**
- **Account:** registrazione con email e password, profilo con nome e foto.
- **Server:** creazione con nome e icona, link d'invito (rigenerabile dall'admin).
- **Sale:** creare, rinominare, eliminare; ogni server parte con 3 sale di testo (una privata) e una vocale.
- **Messaggi:** arrivano agli altri in tempo reale senza ricaricare; si modificano ed eliminano i propri; restano dopo il riavvio.
- **File:** caricamento con barra di avanzamento, anteprima di immagini e video, download. Funzionano anche file da 100 MB e oltre (fino a 200 MB) con il piano gratuito: il sito li divide in pezzi da 45 MB e li riunisce al download.
- **Ruoli:** admin, moderatore, membro. I permessi sono applicati **nel database**, non solo nell'interfaccia: un membro non può leggere la sala privata né cancellare i messaggi altrui nemmeno "forzando" il sito.

**Funzioni Pro**
- **Presenza online/offline** in tempo reale (pallino verde e pannello membri).
- **Sala vocale** gratuita: l'audio va direttamente tra i browser; mostra chi parla e chi ha il microfono spento; si resta connessi anche cambiando sala di testo.
- **Ricerca nei messaggi** di tutto il server (anche nei nomi dei file), con salto al messaggio trovato. Rispetta le sale private.
- **Menzioni @nome con notifica:** scrivendo @ compare l'elenco dei membri; chi viene menzionato vede il messaggio evidenziato, un contatore sulla sala, un avviso sullo schermo e, se le ha attivate (campanella in alto), la notifica del sistema.

**Altro**
- Si usa anche da telefono (menu a scomparsa).
- **"Sta scrivendo…"** sotto la chat, in tempo reale (anche questo segnale rispetta le sale private).
- Trascina un file nella chat, o incollalo, per caricarlo.
- **Si installa come app** sul telefono e sul computer (icona sulla schermata Home, schermo intero), senza passare dagli store e senza costi.

## Cosa non funziona o è limitato

- **Sala vocale:** pensata per piccoli gruppi (fino a circa 5 persone). Su alcune reti molto chiuse (Wi-Fi aziendali o scolastici) il collegamento diretto può non riuscire.
- **File grandi:** quelli divisi in pezzi non hanno l'anteprima, solo il download. Lo spazio gratuito è 1 GB in tutto.
- **Accesso con Google:** non presente (solo email, come consentito dal regolamento).
- **Cronologia:** la chat mostra gli ultimi 200 messaggi di ogni sala; quelli più vecchi si trovano con la ricerca.

## Quanto costa al mese

**0 €.** Supabase e Vercel sono sul piano gratuito. I file da 100 MB funzionano senza il piano a pagamento di Supabase (25 $/mese) grazie al caricamento a pezzi. Eliminando un messaggio si cancella anche il suo file, così lo spazio non si riempie.

## Sicurezza

- Nessuna chiave segreta nel codice o nello zip. L'unica chiave usata è quella **pubblica** di Supabase, fatta apposta per stare nel browser.
- Ogni permesso è controllato da regole nel database (Row Level Security), anche per i file e per l'accesso alle sale vocali.
