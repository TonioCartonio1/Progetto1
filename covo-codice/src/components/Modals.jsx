import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/format'
import { uploadPublicImage } from '../lib/upload'
import { PRIVACY_OPTIONS, ROLE_LABEL, rank } from '../lib/roles'
import { Avatar, Icon, Modal, ServerIcon } from './ui'

// ---------------------------------------------------------------------
// Scegli un'immagine (icona server / foto profilo)
// ---------------------------------------------------------------------
function ImagePicker({ preview, onPick, children }) {
  return (
    <label className="image-picker">
      {preview}
      <span className="image-picker-label">{children}</span>
      <input type="file" accept="image/*" hidden onChange={(e) => onPick(e.target.files?.[0])} />
    </label>
  )
}

function useLocalPreview() {
  const [file, setFile] = useState(null)
  const [url, setUrl] = useState(null)
  const pick = (f) => {
    if (!f) return
    setFile(f)
    setUrl(URL.createObjectURL(f))
  }
  return { file, url, pick }
}

// ---------------------------------------------------------------------
// Crea un server / entra con un link
// ---------------------------------------------------------------------
export function CreateServerModal({ onClose, onCreated }) {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState(profile?.display_name ? `Il server di ${profile.display_name}` : '')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const icon = useLocalPreview()

  async function create(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true); setError('')
    try {
      const iconUrl = icon.file ? await uploadPublicImage(icon.file, user.id) : null
      const { data, error } = await supabase.rpc('create_server', { p_name: name.trim(), p_icon_url: iconUrl })
      if (error) throw error
      onClose()
      await onCreated(data)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  function join(e) {
    e.preventDefault()
    const code = link.trim().split('/invite/').pop().split(/[?#/]/)[0]
    if (!code) return
    onClose()
    navigate(`/invite/${code}`)
  }

  return (
    <Modal title="Crea il tuo server" onClose={onClose}>
      <form onSubmit={create} className="stack">
        <ImagePicker
          onPick={icon.pick}
          preview={icon.url ? <img className="picker-img round-lg" src={icon.url} alt="" /> : <span className="picker-empty round-lg"><Icon name="plus" size={26} /></span>}
        >
          Icona del server <small className="muted">(facoltativa)</small>
        </ImagePicker>
        <label className="field">
          <span>Nome del server</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required autoFocus />
        </label>
        <p className="muted small">Partirai con tre sale: <b>#generale</b>, <b>#off-topic</b> e <b>🔒 staff</b> (privata per moderatori e admin).</p>
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Creo…' : 'Crea server'}</button>
      </form>

      <div className="divider"><span>oppure</span></div>

      <form onSubmit={join} className="stack">
        <label className="field">
          <span>Hai un link d'invito?</span>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Incolla il link qui" />
        </label>
        <button className="btn block" disabled={!link.trim()}>Entra nel server</button>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------
// Profilo: nome e foto
// ---------------------------------------------------------------------
export function ProfileModal({ onClose, onSaved }) {
  const { user, profile, refreshProfile, signOut } = useAuth()
  const [name, setName] = useState(profile?.display_name || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const avatar = useLocalPreview()

  async function save(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const patch = { display_name: name.trim() }
      if (avatar.file) patch.avatar_url = await uploadPublicImage(avatar.file, user.id)
      const { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
      if (error) throw error
      await refreshProfile()
      onSaved?.()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Il tuo profilo" onClose={onClose}>
      <form onSubmit={save} className="stack">
        <ImagePicker
          onPick={avatar.pick}
          preview={avatar.url
            ? <img className="picker-img round" src={avatar.url} alt="" />
            : <Avatar id={user.id} name={name} url={profile?.avatar_url} size={72} />}
        >
          Cambia foto
        </ImagePicker>
        <label className="field">
          <span>Nome da mostrare</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
        </label>
        <label className="field">
          <span>Email</span>
          <input value={user.email} disabled />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary block" disabled={busy || !name.trim()}>{busy ? 'Salvo…' : 'Salva'}</button>
        <button type="button" className="btn block ghost-danger" onClick={signOut}>
          <Icon name="logout" size={16} /> Esci
        </button>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------
// Sala: crea, rinomina, rendi privata, elimina
// ---------------------------------------------------------------------
export function ChannelModal({ server, channel, myRole, onClose, onDone }) {
  const editing = Boolean(channel)
  const [name, setName] = useState(channel?.name || '')
  const [privacy, setPrivacy] = useState(channel?.private_role || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const options = PRIVACY_OPTIONS.filter((o) => !o.value || rank(myRole) >= rank(o.value))
  const clean = (s) => s.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40)

  async function save(e) {
    e.preventDefault()
    const n = clean(name)
    if (!n) return
    setBusy(true); setError('')
    const row = { name: n, private_role: privacy || null }
    const res = editing
      ? await supabase.from('channels').update(row).eq('id', channel.id).select().single()
      : await supabase.from('channels').insert({ ...row, server_id: server.id }).select().single()
    setBusy(false)
    if (res.error) return setError(errorText(res.error))
    onClose()
    onDone(editing ? null : res.data.id)
  }

  async function remove() {
    if (!window.confirm(`Eliminare #${channel.name} e tutti i suoi messaggi?`)) return
    setBusy(true)
    const { error } = await supabase.from('channels').delete().eq('id', channel.id)
    setBusy(false)
    if (error) return setError(errorText(error))
    onClose()
    onDone(null)
  }

  return (
    <Modal title={editing ? `Modifica #${channel.name}` : 'Nuova sala'} onClose={onClose}>
      <form onSubmit={save} className="stack">
        <label className="field">
          <span>Nome della sala</span>
          <div className="input-prefix">
            <Icon name={privacy ? 'lock' : 'hash'} size={16} />
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="nuova-sala" required autoFocus />
          </div>
        </label>
        <label className="field">
          <span>Chi può vederla</span>
          <select value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {privacy && <p className="muted small">I membri non vedranno questa sala né i suoi messaggi e file.</p>}
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary block" disabled={busy}>{editing ? 'Salva modifiche' : 'Crea sala'}</button>
        {editing && (
          <button type="button" className="btn block ghost-danger" onClick={remove} disabled={busy}>
            <Icon name="trash" size={16} /> Elimina sala
          </button>
        )}
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------
// Impostazioni server: invito, nome/icona, ruoli, esci/elimina
// ---------------------------------------------------------------------
export function ServerSettingsModal({ server, myRole, members, onClose, onChanged, onLeft }) {
  const { user } = useAuth()
  const isAdmin = myRole === 'admin'
  const isOwner = server.owner_id === user.id
  const [code, setCode] = useState(server.invite_code)
  const [copied, setCopied] = useState(false)
  const [name, setName] = useState(server.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const icon = useLocalPreview()
  const inviteUrl = `${window.location.origin}/invite/${code}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
    } catch {
      window.prompt('Copia il link:', inviteUrl)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function resetInvite() {
    if (!window.confirm('Creare un nuovo link? Quello vecchio smetterà di funzionare.')) return
    const { data, error } = await supabase.rpc('reset_invite', { p_server: server.id })
    if (error) return setError(errorText(error))
    setCode(data)
    onChanged()
  }

  async function saveServer(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const patch = { name: name.trim() }
      if (icon.file) patch.icon_url = await uploadPublicImage(icon.file, user.id)
      const { error } = await supabase.from('servers').update(patch).eq('id', server.id)
      if (error) throw error
      await onChanged()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function setRole(uid, role) {
    setError('')
    const { error } = await supabase.from('server_members').update({ role }).eq('server_id', server.id).eq('user_id', uid)
    if (error) return setError(errorText(error))
    onChanged()
  }

  async function kick(m) {
    if (!window.confirm(`Rimuovere ${m.profiles?.display_name} dal server?`)) return
    const { error } = await supabase.from('server_members').delete().eq('server_id', server.id).eq('user_id', m.user_id)
    if (error) return setError(errorText(error))
    onChanged()
  }

  async function leave() {
    if (!window.confirm(`Uscire da ${server.name}?`)) return
    const { error } = await supabase.from('server_members').delete().eq('server_id', server.id).eq('user_id', user.id)
    if (error) return setError(errorText(error))
    onLeft()
  }

  async function destroy() {
    const typed = window.prompt(`Per eliminare il server scrivi il suo nome: ${server.name}`)
    if (typed !== server.name) return
    const { error } = await supabase.from('servers').delete().eq('id', server.id)
    if (error) return setError(errorText(error))
    onLeft()
  }

  return (
    <Modal title={server.name} onClose={onClose} wide>
      <div className="stack">
        <section className="settings-block">
          <h3>Invita persone</h3>
          <p className="muted small">Chi apre questo link entra nel server come membro.</p>
          <div className="copy-row">
            <input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
            <button className="btn primary" onClick={copy}>
              <Icon name={copied ? 'check' : 'link'} size={16} /> {copied ? 'Copiato!' : 'Copia'}
            </button>
          </div>
          {isAdmin && <button className="link small" onClick={resetInvite}>Genera un nuovo link</button>}
        </section>

        {isAdmin && (
          <form className="settings-block" onSubmit={saveServer}>
            <h3>Nome e icona</h3>
            <div className="row">
              <ImagePicker
                onPick={icon.pick}
                preview={icon.url ? <img className="picker-img round-lg" src={icon.url} alt="" /> : <ServerIcon server={server} size={64} />}
              >
                Cambia
              </ImagePicker>
              <label className="field grow">
                <span>Nome</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
              </label>
            </div>
            <button className="btn" disabled={busy}>{busy ? 'Salvo…' : 'Salva'}</button>
          </form>
        )}

        <section className="settings-block">
          <h3>Membri e ruoli</h3>
          <p className="muted small">
            <b>Admin</b>: gestisce tutto. <b>Moderatore</b>: gestisce le sale ed elimina i messaggi altrui. <b>Membro</b>: scrive e carica file, non entra nelle sale private.
          </p>
          <ul className="role-list">
            {members.map((m) => {
              const owner = m.user_id === server.owner_id
              const editable = isAdmin && !owner && m.user_id !== user.id
              return (
                <li key={m.user_id}>
                  <Avatar id={m.user_id} name={m.profiles?.display_name} url={m.profiles?.avatar_url} size={32} />
                  <span className="grow ellipsis">
                    {m.profiles?.display_name}
                    {owner && <small className="muted"> · proprietario</small>}
                    {m.user_id === user.id && <small className="muted"> · tu</small>}
                  </span>
                  {editable ? (
                    <>
                      <select value={m.role} onChange={(e) => setRole(m.user_id, e.target.value)}>
                        {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <button className="icon-btn small danger" title="Rimuovi dal server" onClick={() => kick(m)}><Icon name="x" size={15} /></button>
                    </>
                  ) : (
                    <span className={`role-pill wide ${m.role}`}>{ROLE_LABEL[m.role]}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        {error && <div className="alert error">{error}</div>}

        <section className="settings-block danger-zone">
          {isOwner ? (
            <button className="btn ghost-danger" onClick={destroy}><Icon name="trash" size={16} /> Elimina server</button>
          ) : (
            <button className="btn ghost-danger" onClick={leave}><Icon name="logout" size={16} /> Esci dal server</button>
          )}
        </section>
      </div>
    </Modal>
  )
}
