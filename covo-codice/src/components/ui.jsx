import { useEffect } from 'react'

export function Logo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="var(--accent)" />
      <path d="M44 22.5A15 15 0 1 0 44 41.5" fill="none" stroke="var(--bg-0)" strokeWidth="7" strokeLinecap="round" />
      <circle cx="32" cy="32" r="4.5" fill="var(--bg-0)" />
    </svg>
  )
}

const PALETTE = ['#ff8a3d', '#5ac8a8', '#7c9cff', '#f06292', '#ffc94d', '#b388ff', '#4dd0e1', '#ef6c57']
export function colorFor(id = '') {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
const initials = (name = '?') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?'

export function Avatar({ id, name, url, size = 36, online }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span className="avatar-fallback" style={{ background: colorFor(id) }}>{initials(name)}</span>
      )}
      {online !== undefined && <span className={`presence ${online ? 'on' : ''}`} />}
    </span>
  )
}

export function ServerIcon({ server, size = 48 }) {
  return (
    <span className="server-icon" style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {server.icon_url ? (
        <img src={server.icon_url} alt="" />
      ) : (
        <span style={{ background: colorFor(server.id) }}>{initials(server.name)}</span>
      )}
    </span>
  )
}

const PATHS = {
  hash: 'M5 9h14M5 15h14M10 3 8 21M16 3l-2 18',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6z',
  plus: 'M12 5v14M5 12h14',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  clip: 'M21 12.5 12.5 21a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3',
  send: 'M4 12 20 4l-6 16-3-7-7-1Z',
  file: 'M14 3H6v18h12V7l-4-4ZM14 3v4h4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  menu: 'M4 6h16M4 12h16M4 18h16',
  users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  x: 'M6 6l12 12M18 6 6 18',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  check: 'M5 12l5 5 9-10',
}

export function Icon({ name, size = 18, className = '' }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi"><Icon name="x" /></button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function ProgressBar({ value }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(2, value * 100)}%` }} />
    </div>
  )
}
