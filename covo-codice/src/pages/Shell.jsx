import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { canManageChannels, ROLE_LABEL } from '../lib/roles'
import { APP_NAME } from '../config'
import { errorText } from '../lib/format'
import { Avatar, Icon, Logo, ServerIcon } from '../components/ui'
import ChatView from '../components/ChatView'
import MembersPanel from '../components/MembersPanel'
import VoiceRoom from '../components/VoiceRoom'
import SearchModal from '../components/SearchModal'
import InstallApp from '../components/InstallApp'
import { VoiceSession } from '../lib/voice'
import { ChannelModal, CreateServerModal, ProfileModal, ServerSettingsModal } from '../components/Modals'

export default function Shell() {
  const { serverId, channelId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, profile } = useAuth()

  const [servers, setServers] = useState(null)
  const [channelsState, setChannelsState] = useState({ serverId: null, list: [] })
  const [members, setMembers] = useState([])
  const [presence, setPresence] = useState({}) // userId -> [{ since, voice }]
  const [modal, setModal] = useState(null) // {type, ...}
  const [loadError, setLoadError] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const [showMembers, setShowMembers] = useState(() => window.innerWidth > 1100)

  // sala vocale (resta attiva anche se cambi sala di testo)
  const [voice, setVoice] = useState(null)              // stato della sessione
  const [voiceChannelId, setVoiceChannelId] = useState(null)
  const [voiceError, setVoiceError] = useState('')
  const sessionRef = useRef(null)
  const serverRtRef = useRef(null)
  const voiceChannelRef = useRef(null)
  voiceChannelRef.current = voiceChannelId

  // ---------- caricamento dati ----------
  const loadServers = useCallback(async () => {
    const { data, error } = await supabase
      .from('server_members')
      .select('role, joined_at, servers(*)')
      .eq('user_id', user.id)
      .order('joined_at')
    if (error) {
      console.error('server', error)
      setLoadError(`Non riesco a caricare i server: ${errorText(error)}`)
      setServers((prev) => prev || [])
      return
    }
    setLoadError('')
    setServers(data.filter((r) => r.servers).map((r) => ({ ...r.servers, role: r.role })))
  }, [user.id])

  const loadChannels = useCallback(async (sid) => {
    const { data, error } = await supabase.from('channels').select('*').eq('server_id', sid).order('created_at')
    if (error) { console.error('sale', error); setLoadError(`Non riesco a caricare le sale: ${errorText(error)}`) }
    setChannelsState({ serverId: sid, list: data || [] })
  }, [])

  const loadMembers = useCallback(async (sid) => {
    const { data, error } = await supabase
      .from('server_members')
      .select('user_id, role, joined_at, profiles(display_name, avatar_url)')
      .eq('server_id', sid)
      .order('joined_at')
    if (error) { console.error('membri', error); setLoadError(`Non riesco a caricare i membri: ${errorText(error)}`) }
    setMembers(data || [])
  }, [])

  useEffect(() => { loadServers() }, [loadServers])

  const server = servers?.find((s) => s.id === serverId)
  const channels = channelsState.serverId === serverId ? channelsState.list : []
  const channelsReady = channelsState.serverId === serverId
  const channel = channels.find((c) => c.id === channelId)
  const myRole = members.find((m) => m.user_id === user.id)?.role || server?.role || 'member'
  const membersMap = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, m])), [members])

  // ---------- tempo reale per il server aperto (sale, membri, presenza) ----------
  useEffect(() => {
    if (!serverId) return
    loadChannels(serverId)
    loadMembers(serverId)
    const rt = supabase.channel(`server-${serverId}`, { config: { presence: { key: user.id } } })
    rt.on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, () => loadChannels(serverId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'server_members' }, () => {
        loadMembers(serverId)
        loadServers()
        loadChannels(serverId) // un cambio di ruolo può mostrare/nascondere la sala privata
      })
      .on('presence', { event: 'sync' }, () => setPresence({ ...rt.presenceState() }))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await rt.track({ since: Date.now(), voice: voiceChannelRef.current })
      })
    serverRtRef.current = rt
    return () => { serverRtRef.current = null; supabase.removeChannel(rt); setPresence({}) }
  }, [serverId, user.id, loadChannels, loadMembers, loadServers])

  // comunica agli altri in quale sala vocale sono (per mostrarlo nella lista)
  useEffect(() => {
    serverRtRef.current?.track({ since: Date.now(), voice: voiceChannelId }).catch?.(() => {})
  }, [voiceChannelId])

  const online = useMemo(() => new Set(Object.keys(presence)), [presence])
  const voiceByChannel = useMemo(() => {
    const out = {}
    for (const [uid, metas] of Object.entries(presence)) {
      const seen = new Set()
      for (const m of metas) {
        if (m.voice && !seen.has(m.voice)) {
          seen.add(m.voice)
          ;(out[m.voice] ||= []).push(uid)
        }
      }
    }
    return out
  }, [presence])

  // ---------- voce: entra / esci / microfono ----------
  const leaveVoice = useCallback(() => {
    const s = sessionRef.current
    sessionRef.current = null
    setVoice(null)
    setVoiceChannelId(null)
    s?.leave()
  }, [])

  const joinVoice = useCallback((ch) => {
    if (sessionRef.current) leaveVoice()
    setVoiceError('')
    const session = new VoiceSession({
      channelId: ch.id,
      user,
      profile,
      onChange: (st) => {
        if (sessionRef.current !== session) return
        if (st.status === 'error') {
          setVoiceError(st.error)
          leaveVoice()
          return
        }
        setVoice(st)
      },
    })
    sessionRef.current = session
    setVoiceChannelId(ch.id)
    session.join()
  }, [user, profile, leaveVoice])

  const toggleMute = () => sessionRef.current?.setMuted(!sessionRef.current.muted)

  // esci dalla voce se cambi server o chiudi la pagina
  useEffect(() => () => leaveVoice(), [serverId, leaveVoice])
  // se la sala vocale sparisce (eliminata o resa privata), esci
  useEffect(() => {
    if (voiceChannelId && channelsReady && !channels.some((c) => c.id === voiceChannelId)) leaveVoice()
  }, [voiceChannelId, channels, channelsReady, leaveVoice])

  // ---------- navigazione automatica ----------
  useEffect(() => {
    if (!servers) return
    if (!serverId && servers.length) navigate(`/s/${servers[0].id}`, { replace: true })
    else if (serverId && !server) navigate('/', { replace: true })
  }, [servers, serverId, server, navigate])

  useEffect(() => {
    if (!server || !channelsReady) return
    const first = channels.find((c) => c.kind !== 'voice') || channels[0]
    if ((!channelId || !channel) && first) navigate(`/s/${server.id}/${first.id}`, { replace: true })
  }, [server, channelsReady, channelId, channel, channels, navigate])

  useEffect(() => { setNavOpen(false) }, [channelId])

  const goChannel = (c) => navigate(`/s/${serverId}/${c.id}`)

  // ---------- schermata vuota (nessun server) ----------
  if (servers && servers.length === 0) {
    return (
      <div className="auth-page">
        <div className="auth-card center">
          <Logo size={56} />
          <h1>Benvenuto su {APP_NAME}, {profile?.display_name || 'amico'}!</h1>
          <p className="muted">Crea il tuo primo server, oppure apri un link d'invito che ti hanno mandato.</p>
          {loadError && <div className="alert error">{loadError}</div>}
          <button className="btn primary block" onClick={() => setModal({ type: 'createServer' })}>Crea un server</button>
          <button className="link-muted" onClick={() => supabase.auth.signOut()}>Esci</button>
        </div>
        {modal?.type === 'createServer' && (
          <CreateServerModal onClose={() => setModal(null)} onCreated={async (sid) => { await loadServers(); navigate(`/s/${sid}`) }} />
        )}
      </div>
    )
  }

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''} ${showMembers ? 'members-open' : ''}`}>
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />

      <aside className="sidebar">
        {/* barra dei server */}
        <nav className="rail" aria-label="Server">
          <div className="rail-logo" title={APP_NAME}><Logo size={40} /></div>
          <div className="rail-sep" />
          {(servers || []).map((s) => (
            <button
              key={s.id}
              className={`rail-item ${s.id === serverId ? 'active' : ''}`}
              onClick={() => navigate(`/s/${s.id}`)}
              title={s.name}
            >
              <ServerIcon server={s} size={46} />
            </button>
          ))}
          <button className="rail-item rail-add" onClick={() => setModal({ type: 'createServer' })} title="Crea o entra in un server">
            <Icon name="plus" size={22} />
          </button>
        </nav>

        {/* sale del server */}
        <div className="channels">
          <header className="channels-head">
            <h2 title={server?.name}>{server?.name || '…'}</h2>
            {server && (
              <button className="icon-btn" title="Impostazioni e invito" onClick={() => setModal({ type: 'serverSettings' })}>
                <Icon name="gear" />
              </button>
            )}
          </header>

          {server && (
            <button className="invite-cta" onClick={() => setModal({ type: 'serverSettings' })}>
              <Icon name="link" size={16} /> Invita amici
            </button>
          )}

          <div className="channels-section">
            <span>Sale</span>
            {canManageChannels(myRole) && (
              <button className="icon-btn small" title="Nuova sala" onClick={() => setModal({ type: 'channel' })}>
                <Icon name="plus" size={16} />
              </button>
            )}
          </div>
          <ul className="channel-list">
            {channels.map((c) => (
              <li key={c.id}>
                <button className={`channel-item ${c.id === channelId ? 'active' : ''}`} onClick={() => goChannel(c)}>
                  <Icon name={channelIcon(c)} size={17} />
                  <span className="channel-name">{c.name}</span>
                  {c.kind === 'voice' && c.private_role && <Icon name="lock" size={13} className="muted" />}
                  {canManageChannels(myRole) && (
                    <span
                      className="channel-edit"
                      role="button"
                      tabIndex={0}
                      title="Modifica sala"
                      onClick={(e) => { e.stopPropagation(); setModal({ type: 'channel', channel: c }) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setModal({ type: 'channel', channel: c }) } }}
                    >
                      <Icon name="pencil" size={15} />
                    </span>
                  )}
                </button>
                {c.kind === 'voice' && voiceByChannel[c.id]?.length > 0 && (
                  <ul className="voice-people">
                    {voiceByChannel[c.id].map((uid) => {
                      const m = membersMap[uid]
                      const speaking = voiceChannelId === c.id && voice?.participants.some((p) => p.userId === uid && p.speaking)
                      return (
                        <li key={uid} className={speaking ? 'speaking' : ''}>
                          <Avatar id={uid} name={m?.profiles?.display_name} url={m?.profiles?.avatar_url} size={22} />
                          <span className="ellipsis">{m?.profiles?.display_name || 'Utente'}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            ))}
            {channelsReady && channels.length === 0 && <li className="muted small pad">Nessuna sala visibile.</li>}
          </ul>

          <InstallApp />

          {/* barra della voce, visibile ovunque mentre sei connesso */}
          {voice && voiceChannelId && (
            <div className="voice-bar">
              <button className="voice-bar-info" onClick={() => navigate(`/s/${serverId}/${voiceChannelId}`)}>
                <strong className={voice.status === 'connected' ? 'ok' : ''}>
                  {voice.status === 'connected' ? 'Voce connessa' : 'Connessione…'}
                </strong>
                <small className="ellipsis">{channels.find((c) => c.id === voiceChannelId)?.name} · {voice.participants.length} {voice.participants.length === 1 ? 'persona' : 'persone'}</small>
              </button>
              <button className={`icon-btn ${voice.muted ? 'danger-on' : ''}`} onClick={toggleMute} title={voice.muted ? 'Riattiva microfono' : 'Silenzia microfono'}>
                <Icon name={voice.muted ? 'micOff' : 'mic'} />
              </button>
              <button className="icon-btn danger" onClick={leaveVoice} title="Esci dalla voce">
                <Icon name="phoneOff" />
              </button>
            </div>
          )}

          {/* utente in basso */}
          <button className="me" onClick={() => setModal({ type: 'profile' })} title="Il tuo profilo">
            <Avatar id={user.id} name={profile?.display_name} url={profile?.avatar_url} size={34} online />
            <span className="me-text">
              <strong>{profile?.display_name || '…'}</strong>
              <small>{ROLE_LABEL[myRole]}</small>
            </span>
            <Icon name="gear" size={16} />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setNavOpen(true)} aria-label="Apri menu">
            <Icon name="menu" />
          </button>
          {channel && (
            <>
              <Icon name={channelIcon(channel)} className="muted" />
              <h1 className="topbar-title">{channel.name}</h1>
              {channel.private_role && (
                <span className="tag">{channel.private_role === 'admin' ? 'Solo admin' : 'Staff'}</span>
              )}
            </>
          )}
          <div className="spacer" />
          <span className="online-count" title="Persone online ora">
            <span className="dot" /> {members.filter((m) => online.has(m.user_id)).length} online
          </span>
          {server && (
            <button className="icon-btn" onClick={() => setModal({ type: 'search' })} aria-label="Cerca nei messaggi" title="Cerca nei messaggi">
              <Icon name="search" />
            </button>
          )}
          <button className={`icon-btn ${showMembers ? 'on' : ''}`} onClick={() => setShowMembers((v) => !v)} aria-label="Mostra membri" title="Membri">
            <Icon name="users" />
          </button>
        </header>

        {loadError && (
          <div className="alert error load-alert">
            <span className="grow">{loadError}</span>
            <button className="btn small" onClick={() => { setLoadError(''); loadServers(); if (serverId) { loadChannels(serverId); loadMembers(serverId) } }}>Riprova</button>
          </div>
        )}
        <div className="main-body">
          {channel?.kind === 'voice' ? (
            <VoiceRoom
              channel={channel}
              voice={voiceChannelId === channel.id ? voice : null}
              connectedElsewhere={Boolean(voiceChannelId && voiceChannelId !== channel.id)}
              inRoom={(voiceByChannel[channel.id] || []).map((uid) => ({
                userId: uid,
                name: membersMap[uid]?.profiles?.display_name || 'Utente',
                avatarUrl: membersMap[uid]?.profiles?.avatar_url,
              }))}
              error={voiceError}
              onJoin={() => joinVoice(channel)}
              onLeave={leaveVoice}
              onToggleMute={toggleMute}
            />
          ) : channel ? (
            <ChatView key={channel.id} channel={channel} myRole={myRole} membersMap={membersMap} highlightId={location.state?.highlight} />
          ) : (
            <div className="empty-chat">
              <p className="muted">{channelsReady ? 'Scegli una sala.' : 'Caricamento…'}</p>
            </div>
          )}
          {showMembers && server && (
            <MembersPanel members={members} online={online} onClose={() => setShowMembers(false)} />
          )}
        </div>
      </main>

      {modal?.type === 'createServer' && (
        <CreateServerModal onClose={() => setModal(null)} onCreated={async (sid) => { await loadServers(); navigate(`/s/${sid}`) }} />
      )}
      {modal?.type === 'search' && server && (
        <SearchModal
          server={server}
          onClose={() => setModal(null)}
          onOpen={(m) => { setModal(null); navigate(`/s/${server.id}/${m.channel_id}`, { state: { highlight: m.id, t: Date.now() } }) }}
        />
      )}
      {modal?.type === 'profile' && <ProfileModal onClose={() => setModal(null)} onSaved={() => loadMembers(serverId)} />}
      {modal?.type === 'channel' && server && (
        <ChannelModal
          server={server}
          channel={modal.channel}
          myRole={myRole}
          onClose={() => setModal(null)}
          onDone={async (newId) => {
            await loadChannels(server.id)
            if (newId) navigate(`/s/${server.id}/${newId}`)
          }}
        />
      )}
      {modal?.type === 'serverSettings' && server && (
        <ServerSettingsModal
          server={server}
          myRole={myRole}
          members={members}
          onClose={() => setModal(null)}
          onChanged={async () => { await loadServers(); await loadMembers(server.id) }}
          onLeft={async () => { setModal(null); await loadServers(); navigate('/') }}
        />
      )}
    </div>
  )
}

function channelIcon(c) {
  if (c.kind === 'voice') return 'volume'
  return c.private_role ? 'lock' : 'hash'
}
