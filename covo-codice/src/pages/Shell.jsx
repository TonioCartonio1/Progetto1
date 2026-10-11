import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { canManageChannels, ROLE_LABEL } from '../lib/roles'
import { APP_NAME } from '../config'
import { Avatar, Icon, Logo, ServerIcon } from '../components/ui'
import ChatView from '../components/ChatView'
import MembersPanel from '../components/MembersPanel'
import { ChannelModal, CreateServerModal, ProfileModal, ServerSettingsModal } from '../components/Modals'

export default function Shell() {
  const { serverId, channelId } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()

  const [servers, setServers] = useState(null)
  const [channelsState, setChannelsState] = useState({ serverId: null, list: [] })
  const [members, setMembers] = useState([])
  const [online, setOnline] = useState(() => new Set())
  const [modal, setModal] = useState(null) // {type, ...}
  const [navOpen, setNavOpen] = useState(false)
  const [showMembers, setShowMembers] = useState(() => window.innerWidth > 1100)

  // ---------- caricamento dati ----------
  const loadServers = useCallback(async () => {
    const { data, error } = await supabase
      .from('server_members')
      .select('role, joined_at, servers(*)')
      .eq('user_id', user.id)
      .order('joined_at')
    if (!error) setServers(data.filter((r) => r.servers).map((r) => ({ ...r.servers, role: r.role })))
  }, [user.id])

  const loadChannels = useCallback(async (sid) => {
    const { data } = await supabase.from('channels').select('*').eq('server_id', sid).order('created_at')
    setChannelsState({ serverId: sid, list: data || [] })
  }, [])

  const loadMembers = useCallback(async (sid) => {
    const { data } = await supabase
      .from('server_members')
      .select('user_id, role, joined_at, profiles(display_name, avatar_url)')
      .eq('server_id', sid)
      .order('joined_at')
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
      .on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(rt.presenceState()))))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await rt.track({ since: Date.now() })
      })
    return () => { supabase.removeChannel(rt) }
  }, [serverId, user.id, loadChannels, loadMembers, loadServers])

  // ---------- navigazione automatica ----------
  useEffect(() => {
    if (!servers) return
    if (!serverId && servers.length) navigate(`/s/${servers[0].id}`, { replace: true })
    else if (serverId && !server) navigate('/', { replace: true })
  }, [servers, serverId, server, navigate])

  useEffect(() => {
    if (!server || !channelsReady) return
    if ((!channelId || !channel) && channels.length) navigate(`/s/${server.id}/${channels[0].id}`, { replace: true })
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
                  <Icon name={c.private_role ? 'lock' : 'hash'} size={17} />
                  <span className="channel-name">{c.name}</span>
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
              </li>
            ))}
            {channelsReady && channels.length === 0 && <li className="muted small pad">Nessuna sala visibile.</li>}
          </ul>

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
              <Icon name={channel.private_role ? 'lock' : 'hash'} className="muted" />
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
          <button className={`icon-btn ${showMembers ? 'on' : ''}`} onClick={() => setShowMembers((v) => !v)} aria-label="Mostra membri" title="Membri">
            <Icon name="users" />
          </button>
        </header>

        <div className="main-body">
          {channel ? (
            <ChatView key={channel.id} channel={channel} myRole={myRole} membersMap={membersMap} />
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
