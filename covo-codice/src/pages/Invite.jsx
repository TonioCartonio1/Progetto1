import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { errorText } from '../lib/format'
import { ServerIcon } from '../components/ui'

export default function Invite() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [info, setInfo] = useState(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.rpc('invite_preview', { p_code: code }).then(({ data, error }) => {
      if (error) setError(errorText(error))
      setInfo(data?.[0] || null)
    })
  }, [code])

  async function join() {
    setBusy(true); setError('')
    const { data, error } = await supabase.rpc('join_server', { p_code: code })
    setBusy(false)
    if (error) return setError(errorText(error))
    navigate(`/s/${data}`, { replace: true })
  }

  return (
    <div className="auth-page">
      <div className="auth-card center">
        {info === undefined && <p className="muted">Controllo l'invito…</p>}
        {info === null && (
          <>
            <h1>Invito non valido</h1>
            <p className="muted">Il link potrebbe essere scaduto o sbagliato. Chiedi un nuovo invito.</p>
            <Link className="btn" to="/">Vai ai tuoi server</Link>
          </>
        )}
        {info && (
          <>
            <p className="muted">Sei stato invitato a entrare in</p>
            <ServerIcon server={info} size={80} />
            <h1>{info.name}</h1>
            <p className="muted">{info.members} {info.members === 1 ? 'membro' : 'membri'}</p>
            <button className="btn primary block" onClick={join} disabled={busy}>
              {busy ? 'Entro…' : 'Accetta invito'}
            </button>
            <Link className="link-muted" to="/">No grazie</Link>
          </>
        )}
        {error && <div className="alert error">{error}</div>}
      </div>
    </div>
  )
}
