import { useState } from 'react'
import { rank } from '../lib/roles'
import {
  CATEGORIES, STATUS, categoryOf, countdown, eventState, formatWhen, useEventsContext, useNow,
} from '../lib/events'
import { Avatar, Icon, Modal } from './ui'

// ---------------------------------------------------------------------
// Scheda di un evento (nella sezione Eventi e, più piccola, nella chat)
// ---------------------------------------------------------------------
export function EventCard({ ev, compact }) {
  const ctx = useEventsContext()
  const now = useNow(30000)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!ctx) return null
  const { rsvps, me, membersMap, myRole, setRsvp, onEdit, onDelete } = ctx

  const cat = categoryOf(ev.category)
  const answers = rsvps[ev.id] || {}
  const mine = answers[me]
  const byStatus = { yes: [], maybe: [], no: [] }
  for (const [uid, st] of Object.entries(answers)) byStatus[st]?.push(uid)
  const state = eventState(ev, now)
  const full = ev.max_people && byStatus.yes.length >= ev.max_people
  const canManage = ev.created_by === me || rank(myRole) >= 2
  const creator = membersMap[ev.created_by]?.profiles?.display_name

  async function answer(st) {
    setError(''); setBusy(true)
    try { await setRsvp(ev.id, st) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <article className={`event-card ${compact ? 'compact' : ''} ${state}`} style={{ '--cat': cat.color }}>
      <div className="event-top">
        <span className="event-emoji" aria-hidden="true">{cat.emoji}</span>
        <div className="event-main">
          <div className="event-kicker">
            <span className="event-cat">{cat.label}</span>
            <span className={`event-count ${state}`}>{countdown(ev, now)}</span>
          </div>
          <h3 className="event-title">{ev.title}</h3>
          <p className="event-when"><Icon name="calendar" size={14} /> {formatWhen(ev.starts_at)}</p>
          {ev.place && <p className="event-place"><Icon name="pin" size={14} /> {ev.place}</p>}
          {!compact && ev.notes && <p className="event-notes">{ev.notes}</p>}
        </div>
        {!compact && canManage && (
          <div className="event-tools">
            <button className="icon-btn small" title="Modifica evento" onClick={() => onEdit(ev)}><Icon name="pencil" size={15} /></button>
            <button className="icon-btn small danger" title="Elimina evento" onClick={() => onDelete(ev)}><Icon name="trash" size={15} /></button>
          </div>
        )}
      </div>

      <div className="event-people">
        <div className="avatar-stack" aria-label={`${byStatus.yes.length} ci sono`}>
          {byStatus.yes.slice(0, 6).map((uid) => (
            <Avatar key={uid} id={uid} name={membersMap[uid]?.profiles?.display_name} url={membersMap[uid]?.profiles?.avatar_url} size={26} />
          ))}
        </div>
        <span className="event-tally">
          <b>{byStatus.yes.length}</b>{ev.max_people ? `/${ev.max_people}` : ''} ci sono
          {byStatus.maybe.length > 0 && <>, {byStatus.maybe.length} forse</>}
          {byStatus.no.length > 0 && <>, {byStatus.no.length} no</>}
          {full && <span className="event-full">al completo</span>}
        </span>
      </div>

      {state !== 'past' && (
        <div className="rsvp" role="group" aria-label="Partecipi?">
          {STATUS.map((s) => (
            <button
              key={s.id}
              className={`rsvp-btn ${s.id} ${mine === s.id ? 'on' : ''}`}
              aria-pressed={mine === s.id}
              disabled={busy || (s.id === 'yes' && full && mine !== 'yes')}
              onClick={() => answer(s.id)}
            >
              {s.id === 'yes' && <Icon name="check" size={15} />}
              {s.label}
            </button>
          ))}
        </div>
      )}
      {error && <p className="event-error">{error}</p>}
      {!compact && (byStatus.yes.length + byStatus.maybe.length > 0) && (
        <details className="event-who">
          <summary>Chi partecipa</summary>
          <ul>
            {['yes', 'maybe', 'no'].flatMap((st) => byStatus[st].map((uid) => (
              <li key={uid}>
                <Avatar id={uid} name={membersMap[uid]?.profiles?.display_name} url={membersMap[uid]?.profiles?.avatar_url} size={22} />
                <span className="grow ellipsis">{membersMap[uid]?.profiles?.display_name || 'Utente'}{uid === me ? ' (tu)' : ''}</span>
                <span className={`who-status ${st}`}>{STATUS.find((x) => x.id === st).label}</span>
              </li>
            )))}
          </ul>
        </details>
      )}
      {!compact && creator && <p className="event-by">Creato da {ev.created_by === me ? 'te' : creator}</p>}
    </article>
  )
}

// ---------------------------------------------------------------------
// Sezione "Eventi" del server
// ---------------------------------------------------------------------
export function EventsView({ onCreate }) {
  const ctx = useEventsContext()
  const now = useNow(30000)
  const [filter, setFilter] = useState('all')
  const [showPast, setShowPast] = useState(false)
  if (!ctx) return null

  const list = ctx.events.filter((e) => filter === 'all' || e.category === filter)
  const upcoming = list.filter((e) => eventState(e, now) !== 'past')
  const past = list.filter((e) => eventState(e, now) === 'past').reverse()

  return (
    <section className="events-view">
      <header className="events-head">
        <div>
          <h2>Eventi</h2>
          <p className="muted">Organizza partite, uscite e serate: ognuno risponde con un tocco.</p>
        </div>
        <button className="btn primary" onClick={onCreate}><Icon name="plus" size={16} /> Nuovo evento</button>
      </header>

      <div className="cat-filter" role="tablist" aria-label="Filtra per tipo">
        <button role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>Tutti</button>
        {CATEGORIES.map((c) => (
          <button key={c.id} role="tab" aria-selected={filter === c.id} className={filter === c.id ? 'on' : ''} onClick={() => setFilter(c.id)}>
            <span aria-hidden="true">{c.emoji}</span> {c.label}
          </button>
        ))}
      </div>

      {upcoming.length === 0 ? (
        <div className="events-empty">
          <span className="events-empty-emoji" aria-hidden="true">📅</span>
          <h3>{filter === 'all' ? 'Nessun evento in programma' : `Nessun evento di tipo ${categoryOf(filter).label.toLowerCase()}`}</h3>
          <p className="muted">Crea il primo: una partita, una pizza, una sessione di studio.</p>
          <button className="btn primary" onClick={onCreate}><Icon name="plus" size={16} /> Crea un evento</button>
        </div>
      ) : (
        <div className="events-grid">
          {upcoming.map((ev) => <EventCard key={ev.id} ev={ev} />)}
        </div>
      )}

      {past.length > 0 && (
        <div className="events-past">
          <button className="link-muted" onClick={() => setShowPast((v) => !v)}>
            {showPast ? 'Nascondi' : 'Mostra'} gli eventi passati ({past.length})
          </button>
          {showPast && <div className="events-grid">{past.map((ev) => <EventCard key={ev.id} ev={ev} />)}</div>}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------
// Crea o modifica un evento
// ---------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0')
const toDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const toTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

export function EventModal({ event, textChannels, onClose, onSaved }) {
  const ctx = useEventsContext()
  const editing = Boolean(event)
  const start = event ? new Date(event.starts_at) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(21, 0, 0, 0); return d })()
  const [title, setTitle] = useState(event?.title || '')
  const [category, setCategory] = useState(event?.category || 'sport')
  const [date, setDate] = useState(toDate(start))
  const [time, setTime] = useState(toTime(start))
  const [place, setPlace] = useState(event?.place || '')
  const [notes, setNotes] = useState(event?.notes || '')
  const [maxPeople, setMaxPeople] = useState(event?.max_people || '')
  const [announce, setAnnounce] = useState(editing ? '' : (textChannels[0]?.id || ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    const when = new Date(`${date}T${time}`)
    if (Number.isNaN(when.getTime())) return setError('Controlla data e ora.')
    if (!editing && when.getTime() < Date.now() - 60000) return setError('La data è già passata: scegline una futura.')
    if (maxPeople && (Number(maxPeople) < 2 || Number(maxPeople) > 500)) return setError('I posti devono essere tra 2 e 500.')
    setBusy(true)
    try {
      const saved = await ctx.save({ title, category, starts_at: when.toISOString(), place, notes, max_people: maxPeople || null }, event?.id)
      await onSaved(saved, announce)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={editing ? 'Modifica evento' : 'Nuovo evento'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <span>Tipo</span>
          <div className="cat-pick">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c.id}
                className={category === c.id ? 'on' : ''}
                style={{ '--cat': c.color }}
                onClick={() => setCategory(c.id)}
                aria-pressed={category === c.id}
              >
                <span aria-hidden="true">{c.emoji}</span> {c.label}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Titolo</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required autoFocus
            placeholder={category === 'sport' ? 'Calcetto del giovedì' : category === 'uscita' ? 'Pizza da Gino' : 'Cosa si fa?'} />
        </label>
        <div className="row-2">
          <label className="field">
            <span>Giorno</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="field">
            <span>Ora</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </label>
        </div>
        <label className="field">
          <span>Dove <small className="muted">(facoltativo)</small></span>
          <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} placeholder="Campo comunale, via Roma 10" />
        </label>
        <div className="row-2">
          <label className="field">
            <span>Posti <small className="muted">(facoltativo)</small></span>
            <input type="number" min={2} max={500} value={maxPeople} onChange={(e) => setMaxPeople(e.target.value)} placeholder="Nessun limite" />
          </label>
          {!editing && textChannels.length > 0 && (
            <label className="field">
              <span>Annuncia in</span>
              <select value={announce} onChange={(e) => setAnnounce(e.target.value)}>
                <option value="">Non annunciare</option>
                {textChannels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="field">
          <span>Note <small className="muted">(facoltativo)</small></span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Porta la pettorina, si divide il campo" />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary block" disabled={busy || !title.trim()}>
          {busy ? 'Salvo…' : editing ? 'Salva modifiche' : 'Crea evento'}
        </button>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------
// Striscia "prossimo evento" in cima alla chat
// ---------------------------------------------------------------------
export function NextEventStrip({ onOpen }) {
  const ctx = useEventsContext()
  const now = useNow(30000)
  if (!ctx) return null
  const next = ctx.events.find((e) => eventState(e, now) !== 'past' && new Date(e.starts_at).getTime() - now < 7 * 864e5)
  if (!next) return null
  const cat = categoryOf(next.category)
  const yes = Object.values(ctx.rsvps[next.id] || {}).filter((s) => s === 'yes').length
  const mine = ctx.rsvps[next.id]?.[ctx.me]
  return (
    <button className="next-event" style={{ '--cat': cat.color }} onClick={onOpen}>
      <span aria-hidden="true">{cat.emoji}</span>
      <strong className="ellipsis">{next.title}</strong>
      <span className="next-when">{countdown(next, now)}</span>
      <span className="next-yes">{yes} {yes === 1 ? 'c\'è' : 'ci sono'}</span>
      {!mine && eventState(next, now) === 'upcoming' && <span className="next-cta">Rispondi</span>}
    </button>
  )
}
