import * as tus from 'tus-js-client'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'

// Il piano gratuito di Supabase accetta file fino a 50 MB:
// i file più grandi vengono divisi in pezzi da 45 MB e riuniti quando si scaricano.
export const PART_SIZE = 45 * 1024 * 1024
const PARTS_PREFIX = 'parts:'

// Endpoint per caricare file a pezzi (con ripresa automatica se cade la rete)
function resumableEndpoint() {
  const m = SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/i)
  if (m) return `https://${m[1]}.storage.supabase.co/storage/v1/upload/resumable`
  return `${SUPABASE_URL}/storage/v1/upload/resumable`
}

const safeName = (name) => name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-120) || 'file'

// file_path salvato nel messaggio: "percorso" (file intero) oppure "parts:N:percorso" (file a pezzi)
export function parseFilePath(filePath = '') {
  if (filePath.startsWith(PARTS_PREFIX)) {
    const rest = filePath.slice(PARTS_PREFIX.length)
    const i = rest.indexOf(':')
    const count = Number(rest.slice(0, i))
    const base = rest.slice(i + 1)
    return { parted: true, base, objects: Array.from({ length: count }, (_, n) => `${base}.part${n}`) }
  }
  return { parted: false, base: filePath, objects: [filePath] }
}

function tusUpload(blob, objectName, contentType, token, onProgress, setCurrent) {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(blob, {
      endpoint: resumableEndpoint(),
      retryDelays: [0, 2000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, 'x-upsert': 'false' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: false,
      metadata: { bucketName: 'attachments', objectName, contentType, cacheControl: '3600' },
      chunkSize: 6 * 1024 * 1024, // Supabase richiede pezzi da 6 MB
      onError: reject,
      onProgress: (sent) => onProgress(sent),
      onSuccess: () => resolve(objectName),
    })
    // "Annulla": ferma il caricamento e chiude la promessa (tus da solo non la chiude)
    setCurrent({ abort: () => { upload.abort(true); reject(new Error('abort')) } })
    upload.start()
  })
}

/** Carica un file in una sala, con avanzamento. Ritorna { promise, abort }. promise → file_path da salvare. */
export function uploadAttachment({ file, channelId, userId, onProgress }) {
  const base = `${channelId}/${userId}/${crypto.randomUUID()}-${safeName(file.name)}`
  const contentType = file.type || 'application/octet-stream'
  const parted = file.size > PART_SIZE
  const count = parted ? Math.ceil(file.size / PART_SIZE) : 1
  const done = []
  let current = null
  let aborted = false

  const promise = (async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Sessione scaduta: accedi di nuovo.')
    if (aborted) throw new Error('abort')

    if (!parted) {
      await tusUpload(file, base, contentType, token, (sent) => onProgress?.(sent / file.size), (u) => { current = u })
      return base
    }

    for (let n = 0; n < count; n++) {
      if (aborted) throw new Error('abort')
      const start = n * PART_SIZE
      const blob = file.slice(start, Math.min(start + PART_SIZE, file.size))
      const name = `${base}.part${n}`
      await tusUpload(blob, name, 'application/octet-stream', token,
        (sent) => onProgress?.((start + sent) / file.size), (u) => { current = u })
      done.push(name)
    }
    return `${PARTS_PREFIX}${count}:${base}`
  })()

  // se qualcosa va storto, cancella i pezzi già caricati
  promise.catch(() => { if (done.length) supabase.storage.from('attachments').remove(done) })

  return {
    promise,
    abort: () => { aborted = true; current?.abort() },
  }
}

/** Cancella i file di un messaggio (anche tutti i pezzi). */
export function removeAttachment(filePath) {
  if (!filePath) return
  supabase.storage.from('attachments').remove(parseFilePath(filePath).objects).catch(() => {})
}

/** Carica una piccola immagine pubblica (foto profilo, icona server). Ritorna l'URL. */
export async function uploadPublicImage(file, userId) {
  if (!file.type.startsWith('image/')) throw new Error('Scegli un\'immagine.')
  if (file.size > 5 * 1024 * 1024) throw new Error('L\'immagine deve pesare meno di 5 MB.')
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('images').upload(path, file, { contentType: file.type })
  if (error) throw error
  return supabase.storage.from('images').getPublicUrl(path).data.publicUrl
}

// Link temporanei per vedere/scaricare gli allegati privati
const cache = new Map()
export async function signedUrl(path, download) {
  const key = `${path}|${download || ''}`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.url
  const { data, error } = await supabase.storage
    .from('attachments')
    .createSignedUrl(path, 3600, download ? { download } : undefined)
  if (error) throw error
  cache.set(key, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 })
  return data.signedUrl
}

/**
 * Scarica i pezzi di un file e li riunisce in un unico file nel browser.
 * onProgress(0..1). Ritorna un Blob.
 */
export async function downloadParts(filePath, totalSize, type, onProgress) {
  const { objects } = parseFilePath(filePath)
  const blobs = []
  let received = 0
  for (const obj of objects) {
    const url = await signedUrl(obj)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Download non riuscito (${res.status})`)
    if (res.body?.getReader) {
      const reader = res.body.getReader()
      const chunks = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        onProgress?.(totalSize ? Math.min(1, received / totalSize) : 0)
      }
      blobs.push(new Blob(chunks))
    } else {
      const b = await res.blob()
      received += b.size
      onProgress?.(totalSize ? Math.min(1, received / totalSize) : 0)
      blobs.push(b)
    }
  }
  return new Blob(blobs, { type: type || 'application/octet-stream' })
}

/** Fa partire il salvataggio di un Blob come file. */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name || 'file'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
