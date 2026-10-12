// Menzioni: nel database una menzione è salvata come <@id-utente>,
// così resta giusta anche se la persona cambia nome. Sullo schermo diventa "@Nome".

export const MENTION_RE = /<@([0-9a-f-]{36})>/g

export const nameOf = (membersMap, id) => membersMap?.[id]?.profiles?.display_name || 'utente'

/** Il testo contiene una menzione per questo utente? */
export const mentionsUser = (text, userId) => Boolean(text && userId && text.includes(`<@${userId}>`))

/** "<@id>" → "@Nome" (per la casella di modifica e per la ricerca). Ritorna anche la mappa nome → id. */
export function decodeMentions(text, membersMap) {
  const map = {}
  const plain = (text || '').replace(MENTION_RE, (_, id) => {
    const name = nameOf(membersMap, id)
    map[name] = id
    return `@${name}`
  })
  return { text: plain, map }
}

/** "@Nome" → "<@id>" per i nomi scelti dal menu (map: nome → id). */
export function encodeMentions(text, map) {
  let out = text
  const names = Object.keys(map || {}).sort((a, b) => b.length - a.length)
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_])@${esc}(?![\\p{L}\\p{N}_])`, 'gu'), `<@${map[name]}>`)
  }
  return out
}

/** Divide il testo in pezzi: stringhe e menzioni { id } */
export function splitMentions(text) {
  const parts = []
  let last = 0
  for (const m of (text || '').matchAll(MENTION_RE)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push({ id: m[1] })
    last = m.index + m[0].length
  }
  if (last < (text || '').length) parts.push(text.slice(last))
  return parts
}

/** La parola "@qualcosa" che si sta scrivendo subito prima del cursore, se c'è */
export function mentionQuery(text, caret) {
  const before = text.slice(0, caret)
  const m = before.match(/(^|\s)@([\p{L}\p{N}_.\- ]{0,30})$/u)
  if (!m) return null
  const query = m[2]
  // al massimo uno spazio (per nomi come "Giulia Ferri"), e non finire con due spazi
  if ((query.match(/ /g) || []).length > 1 || / {2}/.test(query)) return null
  return { query, start: caret - query.length - 1 }
}
