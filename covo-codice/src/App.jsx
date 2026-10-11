import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import { AuthProvider, useAuth } from './lib/auth'
import Login from './pages/Login'
import Invite from './pages/Invite'
import Shell from './pages/Shell'
import { Logo } from './components/ui'

export default function App() {
  if (!isConfigured) return <SetupMissing />
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </AuthProvider>
  )
}

function Gate() {
  const { session, loading } = useAuth()
  if (loading) return <Splash />
  if (!session) return <Login />
  return (
    <Routes>
      <Route path="/invite/:code" element={<Invite />} />
      <Route path="/s/:serverId/:channelId?" element={<Shell />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  )
}

function Splash() {
  return <div className="splash"><Logo size={56} /></div>
}

function SetupMissing() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo size={44} />
        <h1>Manca il collegamento a Supabase</h1>
        <p className="muted">
          Imposta le variabili <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>
          {' '}(in locale nel file <code>.env</code>, online nelle impostazioni di Vercel) e ricarica la pagina.
        </p>
      </div>
    </div>
  )
}
