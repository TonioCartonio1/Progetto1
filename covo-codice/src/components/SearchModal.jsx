import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorText, formatDay, formatTime } from '../lib/format'
import { Avatar, Icon, Modal } from './ui'

// Cerca nei messaggi di tutte le sale del server che puoi vedere
// (le sale private restano escluse grazie alle regole del database).
export default function SearchModal({ server, onClose, onOpen }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reqRef = useRef(0)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults(null); setError(''); return }
    const id = ++reqRef.current
    const t = setTimeout(async () => {
      setBusy(true)
      // togliamo i caratteri che hanno un significato speciale nella ricerca
      const safe = term.replace(/[%_*\\",()]/g, ' ').replace(/\s+/g, ' ').trim()
      if (!safe) { setBusy(false); setResults([]); return }
      const like = `%${safe}%`
      const { data, error } = await supabase
        .from('messages')
        .select('id, content, file_name, created_at, user_id, channel_id, profiles(display_name, avatar_url), channels!inner(name, server_id)')
        .eq('channels.server_id', server.id)
        .or(`content.ilike.${quote(like)},file_name.ilike.${quote(like)}`)
        .order('created_at', { ascending: false })
        .limit(50)
      if (id !== reqRef.current) return
      setBusy(false)
      if (error) { setError(errorText(error)); setResults([]); return }
      setError('')
      setResults(data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [q, server.id])

  const term = q.trim()

  return (
    <Modal title={`Cerca in ${server.name}`} onClose={onClose} wide>
      <div className="stack">
        <div className="input-prefix">
          <Icon name="search" size={16} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca parole nei messaggi o nomi di file…"
            maxLength={100}
          />
        </div>

        {error && <div className="alert error">{error}</div>}
        {term.length < 2 && <p className="muted small">Scrivi almeno 2 lettere. La ricerca guarda in tutte le sale che puoi vedere.</p>}
        {busy && results === null && <p className="muted small">Cerco…</p>}
        {results && results.length === 0 && !busy && !error && <p className="muted small">Nessun messaggio trovato per “{term}”.</p>}

        {results && results.length > 0 && (
          <>
            <p className="muted small">{results.length === 50 ? 'Primi 50 risultati' : `${results.length} ${results.length === 1 ? 'risultato' : 'risultati'}`}</p>
            <ul className="search-results">
              {results.map((m) => (
                <li key={m.id}>
                  <button className="search-hit" onClick={() => onOpen(m)}>
                    <Avatar id={m.user_id} name={m.profiles?.display_name} url={m.profiles?.avatar_url} size={32} />
                    <div className="search-body">
                      <div className="search-meta">
                        <strong>{m.profiles?.display_name || 'Utente'}</strong>
                        <span className="muted small"># {m.channels?.name} · {formatDay(m.created_at)} {formatTime(m.created_at)}</span>
                      </div>
                      {m.content && <p className="search-text">{highlight(m.content, term)}</p>}
                      {m.file_name && <p className="search-file"><Icon name="file" size={14} /> {highlight(m.file_name, term)}</p>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  )
}

// per i filtri "or" di Supabase i valori con punti o spazi vanno tra virgolette
const quote = (v) => `"${v}"`

function highlight(text, term) {
  // mostra un pezzo di testo attorno alla parola trovata, con la parola evidenziata
  const lower = text.toLowerCase()
  const i = lower.indexOf(term.toLowerCase())
  if (i < 0) return text.length > 220 ? text.slice(0, 220) + '…' : text
  const start = Math.max(0, i - 80)
  const end = Math.min(text.length, i + term.length + 120)
  return (
    <>
      {start > 0 && '…'}
      {text.slice(start, i)}
      <mark>{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length, end)}
      {end < text.length && '…'}
    </>
  )
}
