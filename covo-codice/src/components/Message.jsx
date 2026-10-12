import { useEffect, useRef, useState } from 'react'
import { formatBytes, formatTime } from '../lib/format'
import { downloadParts, parseFilePath, saveBlob, signedUrl } from '../lib/upload'
import { Avatar, Icon, ProgressBar } from './ui'
import { decodeMentions, encodeMentions, nameOf, splitMentions } from '../lib/mentions'

export default function Message({ message: m, grouped, mine, canDelete, onEdit, onDelete, flash, mentioned, membersMap }) {
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false) // su telefono: tocca il messaggio per vedere modifica/elimina
  const name = m.profiles?.display_name || 'Utente'

  return (
    <article
      id={`msg-${m.id}`}
      className={`msg ${grouped ? 'grouped' : ''} ${flash ? 'flash' : ''} ${open ? 'open' : ''} ${mentioned ? 'mentioned' : ''}`}
      onClick={(e) => {
        if (e.target.closest('button, a, video, textarea, input')) return
        if (window.getSelection?.().toString()) return
        setOpen((o) => !o)
      }}
    >
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
            membersMap={membersMap}
            onCancel={() => setEditing(false)}
            onSave={async (t) => { await onEdit(m.id, t); setEditing(false) }}
          />
        ) : (
          m.content && (
            <p className="msg-text">
              {splitMentions(m.content).map((part, i) =>
                typeof part === 'string'
                  ? part
                  : <span key={i} className="mention-chip">@{nameOf(membersMap, part.id)}</span>
              )}
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

function EditBox({ initial: raw, membersMap, onSave: save0, onCancel }) {
  // nella casella le menzioni si vedono come "@Nome"; al salvataggio tornano <@id>
  const [{ text: initial, map }] = useState(() => decodeMentions(raw, membersMap))
  const onSave = (t) => save0(encodeMentions(t, map))
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
  const { parted } = parseFilePath(m.file_path)
  // i file divisi in pezzi non hanno anteprima (andrebbero scaricati tutti prima)
  const isImage = !parted && m.file_type?.startsWith('image/')
  const isVideo = !parted && m.file_type?.startsWith('video/')
  const [url, setUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [dlError, setDlError] = useState('')

  useEffect(() => {
    if (!isImage && !isVideo) return
    let alive = true
    signedUrl(m.file_path).then((u) => alive && setUrl(u)).catch(() => {})
    return () => { alive = false }
  }, [m.file_path, isImage, isVideo])

  async function download() {
    setBusy(true)
    setDlError('')
    try {
      if (parted) {
        setProgress(0)
        const blob = await downloadParts(m.file_path, m.file_size, m.file_type, setProgress)
        saveBlob(blob, m.file_name)
        return
      }
      const u = await signedUrl(m.file_path, m.file_name || true)
      const a = document.createElement('a')
      a.href = u
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (err) {
      setDlError(err?.message || 'Download non riuscito.')
    } finally {
      setBusy(false)
      setProgress(null)
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
          <span className="muted small">
            {progress !== null
              ? `Scarico… ${formatBytes(m.file_size * progress)} / ${formatBytes(m.file_size)}`
              : formatBytes(m.file_size)}
          </span>
          {progress !== null && <ProgressBar value={progress} />}
          {dlError && <span className="small" style={{ color: 'var(--danger)' }}>{dlError}</span>}
        </div>
        <button className="icon-btn" onClick={download} disabled={busy} title="Scarica">
          <Icon name="download" />
        </button>
      </div>
    </div>
  )
}
