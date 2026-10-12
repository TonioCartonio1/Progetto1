import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { errorText } from './format'

export const CATEGORIES = [
  { id: 'sport', label: 'Sport', emoji: '⚽', color: '#5ac8a8' },
  { id: 'uscita', label: 'Uscita', emoji: '🍕', color: '#ff8a3d' },
  { id: 'studio', label: 'Studio', emoji: '📚', color: '#7c9cff' },
  { id: 'gioco', label: 'Gioco', emoji: '🎮', color: '#b388ff' },
  { id: 'riunione', label: 'Riunione', emoji: '💼', color: '#ffc94d' },
  { id: 'altro', label: 'Altro', emoji: '✨', color: '#f06292' },
]
export const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1]

export const STATUS = [
  { id: 'yes', label: 'Ci sono' },
  { id: 'maybe', label: 'Forse' },
  { id: 'no', label: 'No' },
]

// un evento si considera "in corso" per 3 ore dall'inizio
const RUNNING_MS = 3 * 60 * 60 * 1000

const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
const dayShortFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
export const formatWhen = (d) => `${dayFmt.format(new Date(d))}, ${timeFmt.format(new Date(d))}`
export const formatWhenShort = (d) => `${dayShortFmt.format(new Date(d))}, ${timeFmt.format(new Date(d))}`

export function eventState(ev, now = Date.now()) {
  const t = new Date(ev.starts_at).getTime()
  if (now < t) return 'upcoming'
  if (now < t + RUNNING_MS) return 'live'
  return 'past'
}

/** "tra 2 giorni e 4 ore", "tra 35 minuti", "in corso", "finito" */
export function countdown(ev, now = Date.now()) {
  const state = eventState(ev, now)
  if (state === 'live') return 'in corso'
  if (state === 'past') return 'finito'
  let s = Math.max(0, Math.round((new Date(ev.starts_at).getTime() - now) / 1000))
  const d = Math.floor(s / 86400); s -= d * 86400
  const h = Math.floor(s / 3600); s -= h * 3600
  const m = Math.max(1, Math.ceil(s / 60))
  const p = (n, one, many) => `${n} ${n === 1 ? one : many}`
  if (d >= 2) return `tra ${p(d, 'giorno', 'giorni')}`
  if (d === 1) return h ? `tra 1 giorno e ${p(h, 'ora', 'ore')}` : 'tra 1 giorno'
  if (h >= 1) return m && h < 6 ? `tra ${p(h, 'ora', 'ore')} e ${p(m === 60 ? 59 : m, 'minuto', 'minuti')}` : `tra ${p(h, 'ora', 'ore')}`
  return `tra ${p(m, 'minuto', 'minuti')}`
}

/** Ora corrente che si aggiorna da sola (per il conto alla rovescia) */
export function useNow(every = 30000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(t)
  }, [every])
  return now
}

/**
 * Eventi del server aperto, con le risposte, aggiornati in tempo reale.
 * enabled = false se il database non ha ancora le tabelle (aggiornamento 7 non lanciato).
 */
export function useServerEvents(serverId, userId, onNewEvent) {
  const [state, setState] = useState({ serverId: null, enabled: false, events: [], rsvps: {} })
  const newRef = useRef(onNewEvent)
  newRef.current = onNewEvent

  const load = useCallback(async () => {
    if (!serverId) return
    const since = new Date(Date.now() - 30 * 864e5).toISOString()
    const { data: events, error } = await supabase
      .from('events')
      .select('*')
      .eq('server_id', serverId)
      .gte('starts_at', since)
      .order('starts_at')
      .limit(200)
    if (error) { setState({ serverId, enabled: false, events: [], rsvps: {} }); return }
    let rsvps = {}
    if (events.length) {
      const { data } = await supabase
        .from('event_rsvps')
        .select('event_id, user_id, status')
        .in('event_id', events.map((e) => e.id))
      for (const r of data || []) (rsvps[r.event_id] ||= {})[r.user_id] = r.status
    }
    events.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    setState({ serverId, enabled: true, events, rsvps })
  }, [serverId])

  useEffect(() => {
    if (!serverId) return
    load()
    let timer
    const soon = () => { clearTimeout(timer); timer = setTimeout(load, 250) }
    const rt = supabase
      .channel(`events-${serverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `server_id=eq.${serverId}` }, (p) => {
        if (p.eventType === 'INSERT' && p.new?.created_by !== userId) newRef.current?.(p.new)
        soon()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_rsvps' }, soon)
      .subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(rt) }
  }, [serverId, userId, load])

  const ready = state.serverId === serverId

  async function setRsvp(eventId, status) {
    const prev = state.rsvps[eventId]?.[userId]
    const apply = (st) => setState((s) => {
      const forEv = { ...(s.rsvps[eventId] || {}) }
      if (st) forEv[userId] = st
      else delete forEv[userId]
      return { ...s, rsvps: { ...s.rsvps, [eventId]: forEv } }
    })
    // ripremere la stessa risposta la toglie
    const next = prev === status ? null : status
    apply(next)
    const { error } = next
      ? await supabase.from('event_rsvps').upsert({ event_id: eventId, user_id: userId, status: next }, { onConflict: 'event_id,user_id' })
      : await supabase.from('event_rsvps').delete().eq('event_id', eventId).eq('user_id', userId)
    if (error) {
      apply(prev || null)
      throw new Error(/completo/i.test(error.message) ? 'Evento al completo: non ci sono più posti.' : errorText(error))
    }
  }

  async function save(ev, id) {
    const row = {
      title: ev.title.trim(),
      category: ev.category,
      starts_at: ev.starts_at,
      place: ev.place?.trim() || null,
      notes: ev.notes?.trim() || null,
      max_people: ev.max_people ? Number(ev.max_people) : null,
    }
    const res = id
      ? await supabase.from('events').update(row).eq('id', id).select().single()
      : await supabase.from('events').insert({ ...row, server_id: serverId }).select().single()
    if (res.error) throw new Error(errorText(res.error))
    await load()
    return res.data
  }

  async function remove(id) {
    const { data, error } = await supabase.from('events').delete().eq('id', id).select('id')
    if (error) throw new Error(errorText(error))
    if (!data?.length) throw new Error('Non hai il permesso di eliminare questo evento.')
    await load()
  }

  return {
    enabled: ready && state.enabled,
    events: ready ? state.events : [],
    rsvps: ready ? state.rsvps : {},
    setRsvp,
    save,
    remove,
    reload: load,
  }
}

// gli eventi servono sia nella sezione Eventi sia dentro i messaggi della chat
export const EventsContext = createContext(null)
export const useEventsContext = () => useContext(EventsContext)
