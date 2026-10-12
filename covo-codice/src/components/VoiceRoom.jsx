import { Avatar, Icon } from './ui'

/**
 * Schermata di una sala vocale.
 * - voice: stato della sessione se sono connesso a QUESTA sala (altrimenti null)
 * - inRoom: chi è dentro secondo la presenza del server (per vederlo anche senza entrare)
 */
export default function VoiceRoom({ channel, voice, connectedElsewhere, inRoom, error, onJoin, onLeave, onToggleMute }) {
  const joined = Boolean(voice)
  const connecting = joined && voice.status === 'connecting'
  const people = joined ? voice.participants : inRoom

  return (
    <section className="voice-room">
      <div className="voice-stage">
        {people.length === 0 ? (
          <div className="voice-empty">
            <div className="welcome-badge"><Icon name="volume" size={30} /></div>
            <h2>{channel.name}</h2>
            <p className="muted">Non c'è ancora nessuno. Entra e aspetta gli altri, oppure manda il link del server a un amico.</p>
          </div>
        ) : (
          <ul className="voice-grid">
            {people.map((p) => (
              <li key={p.peerId || p.userId} className={`voice-tile ${p.speaking ? 'speaking' : ''}`}>
                <div className="voice-avatar">
                  <Avatar id={p.userId} name={p.name} url={p.avatarUrl} size={84} />
                  {p.muted && <span className="voice-muted" title="Microfono spento"><Icon name="micOff" size={15} /></span>}
                </div>
                <strong className="ellipsis">{p.name}{p.self ? ' (tu)' : ''}</strong>
                {joined && !p.self && !p.linked && <small className="muted">collegamento…</small>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && !joined && <div className="alert error chat-alert">{error}</div>}

      <div className="voice-controls">
        {!joined ? (
          <button className="btn primary voice-join" onClick={onJoin}>
            <Icon name="phone" size={18} />
            {connectedElsewhere ? 'Passa a questa sala' : 'Entra nella sala vocale'}
          </button>
        ) : (
          <>
            <span className="voice-status">
              <span className={`dot ${connecting ? 'wait' : ''}`} />
              {connecting ? 'Connessione…' : 'Connesso alla voce'}
            </span>
            <button
              className={`round-btn ${voice.muted ? 'off' : ''}`}
              onClick={onToggleMute}
              title={voice.muted ? 'Riattiva microfono' : 'Silenzia microfono'}
              aria-pressed={voice.muted}
            >
              <Icon name={voice.muted ? 'micOff' : 'mic'} size={22} />
            </button>
            <button className="round-btn hang" onClick={onLeave} title="Esci dalla sala vocale">
              <Icon name="phoneOff" size={22} />
            </button>
          </>
        )}
      </div>
      {!joined && <p className="voice-hint muted small">Il browser ti chiederà il permesso di usare il microfono. Funziona al meglio fino a 5 persone.</p>}
    </section>
  )
}
