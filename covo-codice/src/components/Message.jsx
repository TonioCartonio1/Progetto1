import { useEffect, useRef, useState } from 'react'
import { formatBytes, formatTime } from '../lib/format'
import { signedUrl } from '../lib/upload'
import { Avatar, Icon } from './ui'

export default function Message({ message: m, grouped, mine, canDelete, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false)
  const name = m.profiles?.display_name || 'Utente'

  return (
    <article className={`msg ${grouped ? 'grouped' : ''}`}>
      <div className="msg-gutter">
        {grouped ? (
          <time className="msg-hover-time">{formatTime(m.created_at)}</time>
        ) : (
          <Avatar id={m.user_id} name={name} url={m.profiles?.avatar_url} size={38} />
        )}
      </div>
      <div className="msg-body">
        {!grouped && (
          <header className="msg-head">
            <strong>{name}</strong>
            <time dateTime={m.created_at}>{formatTime(m.created_at)}</time>
          </header>
        )}
        {editing ? (
          <EditBox
            initial={m.content}
            onCancel={() => setEditing(false)}
            onSave={async (t) => { await onEdit(m.id, t); setEditing(false) }}
          />
        ) : (
          m.content && (
            <p className="msg-text">
              {m.content}
              {m.edited_at && <span className="edited"> (modificato)</span>}
            </p>
          )
        )}
        {m.file_path && <Attachment message={m} />}
      </div>

      {!editing && (mine || canDelete) && (
        <div className="msg-actions">
          {mine && m.content !== undefined && (
            <button className="icon-btn small" title="Modifica" onClick={() => setEditing(true)}><Icon name="pencil" size={15} /></button>
          )}
          {canDelete && (
            <button className="icon-btn small danger" title="Elimina" onClick={() => onDelete(m)}><Icon name="trash" size={15} /></button>
          )}
        </div>
      )}
    </article>
  )
}

function EditBox({ initial, onSave, onCancel }) {
  const [text, setText] = useState(initial)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  const save = () => {
    const t = text.trim()
    if (t === initial.trim()) return onCancel()
    onSave(t)
  }
  return (
    <div className="edit-box">
      <textarea
        ref={ref}
        value={text}
        rows={2}
        maxLength={4000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() }
        }}
      />
      <div className="edit-hint">
        Esc per <button className="link" onClick={onCancel}>annullare</button> · Invio per <button className="link" onClick={save}>salvare</button>
      </div>
    </div>
  )
}

function Attachment({ message: m }) {
  const isImage = m.file_type?.startsWith('image/')
  const isVideo = m.file_type?.startsWith('video/')
  const [url, setUrl] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isImage && !isVideo) return
    let alive = true
    signedUrl(m.file_path).then((u) => alive && setUrl(u)).catch(() => {})
    return () => { alive = false }
  }, [m.file_path, isImage, isVideo])

  async function download() {
    setBusy(true)
    try {
      const u = await signedUrl(m.file_path, m.file_name || true)
      const a = document.createElement('a')
      a.href = u
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="attachment">
      {isImage && url && (
        <a href={url} target="_blank" rel="noreferrer" className="attach-preview">
          <img src={url} alt={m.file_name} loading="lazy" />
        </a>
      )}
      {isVideo && url && <video className="attach-preview" src={url} controls preload="metadata" />}
      <div className="file-card">
        <Icon name="file" size={26} />
        <div className="file-meta">
          <strong className="ellipsis" title={m.file_name}>{m.file_name}</strong>
          <span className="muted small">{formatBytes(m.file_size)}</span>
        </div>
        <button className="icon-btn" onClick={download} disabled={busy} title="Scarica">
          <Icon name="download" />
        </button>
      </div>
    </div>
  )
}
