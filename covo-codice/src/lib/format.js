export function formatBytes(n) {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

const timeFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })

export const formatTime = (d) => timeFmt.format(new Date(d))

export function formatDay(d) {
  const date = new Date(d)
  const today = new Date()
  const yest = new Date(); yest.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Oggi'
  if (date.toDateString() === yest.toDateString()) return 'Ieri'
  return dayFmt.format(date)
}

export function errorText(err) {
  const msg = err?.message || String(err || 'Errore sconosciuto')
  if (/Invalid login credentials/i.test(msg)) return 'Email o password sbagliate.'
  if (/User already registered/i.test(msg)) return 'Esiste già un account con questa email.'
  if (/Password should be at least/i.test(msg)) return 'La password deve avere almeno 6 caratteri.'
  if (/Email not confirmed/i.test(msg)) return 'Devi prima confermare l\'email (controlla la posta).'
  if (/maximum allowed size|Payload too large|413/i.test(msg)) return 'File troppo grande per il piano attuale di Supabase.'
  return msg
}
