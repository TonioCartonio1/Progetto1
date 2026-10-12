import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorText } from '../lib/format'
import { APP_NAME, APP_TAGLINE } from '../config'
import { Icon, Logo } from '../components/ui'

export default function Login() {
  const [mode, setMode] = useState('login') // login | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const inviting = window.location.pathname.startsWith('/invite/')

  async function submit(e) {
    e.preventDefault()
    setError(''); setNotice(''); setBusy(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      } else {
        if (!name.trim()) throw new Error('Scegli un nome da mostrare.')
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim() }, emailRedirectTo: window.location.href },
        })
        if (error) throw error
        if (!data.session) setNotice('Account creato! Ti abbiamo mandato un\'email: clicca il link per confermare, poi accedi.')
      }
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page login-page">
      <section className="login-hero" aria-hidden="true">
        <div className="hero-mark">
          <Logo size={56} />
          <span>{APP_NAME}</span>
        </div>
        <p className="hero-line">Server, sale e voce per il tuo gruppo. Gratis, dal browser.</p>
        <ol className="hero-thread">
          <li className="bubble">
            <span className="bubble-who" style={{ background: '#b388ff' }}>G</span>
            <span><b>Giulia</b>Stasera chiamata alle 21?</span>
          </li>
          <li className="bubble">
            <span className="bubble-who" style={{ background: '#4dd0e1' }}>M</span>
            <span><b>Marco</b>Ci sono. Intanto vi mando il video</span>
          </li>
          <li className="bubble bubble-file">
            <span className="bubble-who" style={{ background: '#4dd0e1' }}>M</span>
            <span className="bubble-filecard"><Icon name="file" size={20} /> presentazione.mp4 <small>100 MB</small></span>
          </li>
          <li className="bubble bubble-voice">
            <Icon name="volume" size={16} /> 3 persone nella sala vocale
          </li>
        </ol>
      </section>
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <Logo size={44} />
          <span className="brand-name">{APP_NAME}</span>
        </div>
        <h1>{mode === 'login' ? 'Bentornato' : 'Crea il tuo account'}</h1>
        <p className="muted">
          {inviting ? 'Accedi o registrati per accettare l\'invito.' : APP_TAGLINE}
        </p>

        <div className="segmented">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Accedi</button>
          <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>Registrati</button>
        </div>

        {mode === 'signup' && (
          <label className="field">
            <span>Nome da mostrare</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Es. Giulia" autoComplete="nickname" />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@esempio.it" autoComplete="email" />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Almeno 6 caratteri" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert ok">{notice}</div>}

        <button className="btn primary block" disabled={busy}>
          {busy ? 'Un attimo…' : mode === 'login' ? 'Accedi' : 'Crea account'}
        </button>
      </form>
    </div>
  )
}
