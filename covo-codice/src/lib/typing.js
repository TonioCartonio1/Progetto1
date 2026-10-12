import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

// "Sta scrivendo…": un piccolo segnale che passa solo in diretta (non si salva nel database).
// Usa un canale privato "room:<id sala>": ci entra solo chi può vedere la sala.
const SHOW_FOR = 4000
const SEND_EVERY = 2500

export function useTyping(channelId, user, profile) {
  const [typers, setTypers] = useState([]) // [{ id, name }]
  const rtRef = useRef(null)
  const readyRef = useRef(false)
  const lastSent = useRef(0)
  const seen = useRef(new Map()) // id -> { name, until }

  useEffect(() => {
    let alive = true
    seen.current = new Map()
    setTypers([])
    readyRef.current = false

    const refresh = () => {
      const now = Date.now()
      for (const [id, v] of seen.current) if (v.until < now) seen.current.delete(id)
      const list = [...seen.current.entries()].map(([id, v]) => ({ id, name: v.name }))
      setTypers((prev) => (prev.length === list.length && prev.every((p, i) => p.id === list[i].id) ? prev : list))
    }
    const timer = setInterval(refresh, 800)

    ;(async () => {
      try { await supabase.realtime.setAuth() } catch { /* usa il token della sessione */ }
      if (!alive) return
      const rt = supabase.channel(`room:${channelId}`, { config: { private: true, broadcast: { self: false } } })
      rt.on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload || payload.id === user.id) return
        if (payload.stop) seen.current.delete(payload.id)
        else seen.current.set(payload.id, { name: payload.name, until: Date.now() + SHOW_FOR })
        refresh()
      }).subscribe((status) => { readyRef.current = status === 'SUBSCRIBED' })
      rtRef.current = rt
    })()

    return () => {
      alive = false
      clearInterval(timer)
      if (rtRef.current) supabase.removeChannel(rtRef.current)
      rtRef.current = null
    }
  }, [channelId, user.id])

  const send = (payload) => {
    if (!readyRef.current || !rtRef.current) return
    rtRef.current.send({ type: 'broadcast', event: 'typing', payload }).catch?.(() => {})
  }

  // da chiamare mentre si scrive: manda il segnale al massimo ogni 2,5 secondi
  const ping = useCallback(() => {
    const now = Date.now()
    if (now - lastSent.current < SEND_EVERY) return
    lastSent.current = now
    send({ id: user.id, name: profile?.display_name || 'Qualcuno' })
  }, [user.id, profile?.display_name]) // eslint-disable-line react-hooks/exhaustive-deps

  // da chiamare quando si invia o si cancella tutto
  const stop = useCallback(() => {
    if (!lastSent.current) return
    lastSent.current = 0
    send({ id: user.id, stop: true })
  }, [user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return { typers, ping, stop }
}

export function typingText(typers) {
  if (!typers.length) return ''
  if (typers.length === 1) return `${typers[0].name} sta scrivendo`
  if (typers.length === 2) return `${typers[0].name} e ${typers[1].name} stanno scrivendo`
  return 'Diverse persone stanno scrivendo'
}
