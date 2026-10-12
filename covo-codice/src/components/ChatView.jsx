import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { canModerate } from '../lib/roles'
import { errorText, formatBytes, formatDay } from '../lib/format'
import { removeAttachment, uploadAttachment } from '../lib/upload'
import { MAX_FILE_MB } from '../config'
import { Icon, ProgressBar } from './ui'
import Message from './Message'

const SELECT = '*, profiles(display_name, avatar_url)'

export default function ChatView({ channel, myRole, membersMap }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [upload, setUpload] = useState(null) // { name, size, progress, abort }
  const listRef = useRef(null)
  const stickRef = useRef(true)
  const membersRef = useRef(membersMap)
  membersRef.current = membersMap

  const addMessage = useCallback((m) => {
    setMessages((ms) => {
      if (!ms) return ms
      if (ms.some((x) => x.id === m.id)) return ms.map((x) => (x.id === m.id ? { ...x, ...m } : x))
      return [...ms, m]
    })
  }, [])

  // carica la cronologia + ascolta i nuovi messaggi in tempo reale
  useEffect(() => {
    let alive = true
    stickRef.current = true
    supabase
      .from('messages')
      .select(SELECT)
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setError(errorText(error))
        setMessages((data || []).reverse())
      })

    const filter = `channel_id=eq.${channel.id}`
    const rt = supabase
      .channel(`messages-${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, async ({ new: m }) => {
        let prof = membersRef.current[m.user_id]?.profiles
        if (!prof) {
          const { data } = await supabase.from('profiles').select('display_name, avatar_url').eq('id', m.user_id).maybeSingle()
          prof = data
        }
        addMessage({ ...m, profiles: prof })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, ({ new: m }) => {
        setMessages((ms) => ms && ms.map((x) => (x.id === m.id ? { ...x, ...m, profiles: x.profiles } : x)))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => {
        setMessages((ms) => ms && ms.filter((x) => x.id !== old.id))
      })
      .subscribe()

    return () => { alive = false; supabase.removeChannel(rt) }
  }, [channel.id, addMessage])

  // scorrimento automatico in fondo
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const onScroll = () => {
    const el = listRef.current
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  // ---------- azioni ----------
  async function send(content) {
    setError('')
    stickRef.current = true
    const { data, error } = await supabase
      .from('messages')
      .insert({ channel_id: channel.id, user_id: user.id, content })
      .select(SELECT)
      .single()
    if (error) { setError(errorText(error)); return false }
    addMessage(data)
    return true
  }

  async function edit(id, content) {
    const { data, error } = await supabase.from('messages').update({ content }).eq('id', id).select('id')
    if (error) return setError(errorText(error))
    if (!data?.length) return setError('Non hai il permesso di modificare questo messaggio.')
    setMessages((ms) => ms.map((x) => (x.id === id ? { ...x, content, edited_at: new Date().toISOString() } : x)))
  }

  async function remove(m) {
    if (!window.confirm('Eliminare questo messaggio?')) return
    const { data, error } = await supabase.from('messages').delete().eq('id', m.id).select('id')
    if (error) return setError(errorText(error))
    if (!data?.length) return setError('Non hai il permesso di eliminare questo messaggio.')
    removeAttachment(m.file_path)
    setMessages((ms) => ms.filter((x) => x.id !== m.id))
  }

  async function startUpload(file, caption = '') {
    if (!file) return
    if (upload) return setError('Aspetta che finisca il caricamento in corso.')
    if (file.size > MAX_FILE_MB * 1024 * 1024) return setError(`Il file supera il limite di ${MAX_FILE_MB} MB.`)
    setError('')
    const job = uploadAttachment({
      file,
      channelId: channel.id,
      userId: user.id,
      onProgress: (p) => setUpload((u) => (u ? { ...u, progress: p } : u)),
    })
    setUpload({ name: file.name, size: file.size, progress: 0, abort: job.abort })
    try {
      const path = await job.promise
      stickRef.current = true
      const { data, error } = await supabase
        .from('messages')
        .insert({
          channel_id: channel.id,
          user_id: user.id,
          content: caption,
          file_path: path,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type || 'application/octet-stream',
        })
        .select(SELECT)
        .single()
      if (error) { removeAttachment(path); throw error }
      addMessage(data)
    } catch (err) {
      if (!/abort/i.test(String(err?.message || err))) setError(errorText(err))
    } finally {
      setUpload(null)
    }
  }

  // ---------- trascina e rilascia ----------
  const onDragOver = (e) => {
    if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true) }
  }
  const onDrop = (e) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) startUpload(f)
  }

  const moderator = canModerate(myRole)

  return (
    <section
      className="chat"
      onDragOver={onDragOver}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget) || setDragging(false)}
      onDrop={onDrop}
    >
      <div className="messages" ref={listRef} onScroll={onScroll}>
        {messages === null && <p className="muted pad">Carico i messaggi…</p>}
        {messages?.length === 0 && (
          <div className="chat-welcome">
            <div className="welcome-badge"><Icon name={channel.private_role ? 'lock' : 'hash'} size={30} /></div>
            <h2>Benvenuto in #{channel.name}</h2>
            <p className="muted">È l'inizio della sala. Scrivi il primo messaggio{channel.private_role ? ': qui ti leggono solo lo staff.' : '!'}</p>
          </div>
        )}
        {messages?.map((m, i) => {
          const prev = messages[i - 1]
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
          const grouped = !newDay && prev.user_id === m.user_id && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60 * 1000
          return (
            <div key={m.id}>
              {newDay && <div className="day-sep"><span>{formatDay(m.created_at)}</span></div>}
              <Message
                message={m}
                grouped={grouped}
                mine={m.user_id === user.id}
                canDelete={m.user_id === user.id || moderator}
                onEdit={edit}
                onDelete={remove}
              />
            </div>
          )
        })}
      </div>

      {error && (
        <div className="alert error chat-alert">
          {error}
          <button className="icon-btn small" onClick={() => setError('')} aria-label="Chiudi"><Icon name="x" size={14} /></button>
        </div>
      )}

      {upload && (
        <div className="upload-card">
          <Icon name="file" />
          <div className="upload-info">
            <div className="upload-row">
              <strong className="ellipsis">{upload.name}</strong>
              <span className="muted small">
                {formatBytes(upload.size * upload.progress)} / {formatBytes(upload.size)} · {Math.round(upload.progress * 100)}%
              </span>
            </div>
            <ProgressBar value={upload.progress} />
          </div>
          <button className="btn small" onClick={() => upload.abort()}>Annulla</button>
        </div>
      )}

      <Composer channel={channel} onSend={send} onFile={startUpload} busy={Boolean(upload)} />

      {dragging && (
        <div className="drop-overlay">
          <div><Icon name="clip" size={36} /><p>Rilascia per caricare in #{channel.name}</p></div>
        </div>
      )}
    </section>
  )
}

function Composer({ channel, onSend, onFile, busy }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const fileRef = useRef(null)
  const taRef = useRef(null)

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'
  }, [text])

  async function submit() {
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    const ok = await onSend(content)
    setSending(false)
    if (ok) setText('')
    taRef.current?.focus()
  }

  return (
    <div className="composer">
      <button className="icon-btn" title="Carica un file" onClick={() => fileRef.current?.click()} disabled={busy}>
        <Icon name="clip" />
      </button>
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }}
      />
      <textarea
        ref={taRef}
        rows={1}
        value={text}
        maxLength={4000}
        placeholder={`Scrivi in #${channel.name}`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
        }}
        onPaste={(e) => {
          const f = e.clipboardData?.files?.[0]
          if (f) { e.preventDefault(); onFile(f) }
        }}
      />
      <button className="icon-btn send" title="Invia" onClick={submit} disabled={!text.trim() || sending}>
        <Icon name="send" />
      </button>
    </div>
  )
}
