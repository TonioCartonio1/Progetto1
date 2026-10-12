import { useEffect, useState } from 'react'

// "Installa app": il browser ci avvisa quando Conv si può installare
let deferred = null
const listeners = new Set()
const notify = () => listeners.forEach((f) => f())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e
    notify()
  })
  window.addEventListener('appinstalled', () => { deferred = null; notify() })

  // il service worker serve solo per l'installazione; lo registriamo solo sul sito pubblicato
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
  }
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function useInstallApp() {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    listeners.add(f)
    return () => listeners.delete(f)
  }, [])

  const installed = isStandalone()
  return {
    installed,
    canInstall: !installed && Boolean(deferred),
    // su iPhone non c'è il pulsante automatico: si usa "Aggiungi alla schermata Home" di Safari
    iosHint: !installed && !deferred && isIOS(),
    install: async () => {
      if (!deferred) return
      deferred.prompt()
      try { await deferred.userChoice } finally { deferred = null; notify() }
    },
  }
}
