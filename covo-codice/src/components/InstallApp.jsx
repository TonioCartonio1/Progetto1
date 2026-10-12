import { useState } from 'react'
import { useInstallApp } from '../lib/pwa'
import { APP_NAME } from '../config'
import { Icon, Logo, Modal } from './ui'

const KEY = 'conv-install-hidden'
const readHidden = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }

// Riga "Installa l'app" nella barra laterale: compare solo se il browser lo permette
export default function InstallApp() {
  const { canInstall, iosHint, install } = useInstallApp()
  const [hidden, setHidden] = useState(readHidden)
  const [showIos, setShowIos] = useState(false)
  if (hidden || (!canInstall && !iosHint)) return null

  const hide = () => {
    setHidden(true)
    try { localStorage.setItem(KEY, '1') } catch { /* niente */ }
  }

  return (
    <>
      <div className="install-row">
        <button className="install-btn" onClick={() => (canInstall ? install() : setShowIos(true))}>
          <Icon name="download" size={16} /> Installa {APP_NAME} come app
        </button>
        <button className="icon-btn small" onClick={hide} title="Nascondi" aria-label="Nascondi">
          <Icon name="x" size={14} />
        </button>
      </div>
      {showIos && (
        <Modal title="Installa su iPhone" onClose={() => setShowIos(false)}>
          <div className="stack ios-steps">
            <div className="ios-app"><Logo size={56} /><strong>{APP_NAME}</strong></div>
            <ol>
              <li>Apri questa pagina con <b>Safari</b>.</li>
              <li>Tocca il pulsante <b>Condividi</b> (il quadrato con la freccia in su).</li>
              <li>Scegli <b>Aggiungi alla schermata Home</b> e poi <b>Aggiungi</b>.</li>
            </ol>
            <p className="muted small">{APP_NAME} comparirà tra le tue app e si aprirà a schermo intero.</p>
            <button className="btn primary block" onClick={() => setShowIos(false)}>Ho capito</button>
          </div>
        </Modal>
      )}
    </>
  )
}
