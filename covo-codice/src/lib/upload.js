import * as tus from 'tus-js-client'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'

// Endpoint per caricare file grandi a pezzi (con ripresa automatica se cade la rete)
function resumableEndpoint() {
  const m = SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/i)
  if (m) return `https://${m[1]}.storage.supabase.co/storage/v1/upload/resumable`
  return `${SUPABASE_URL}/storage/v1/upload/resumable`
}

const safeName = (name) => name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-120) || 'file'

/** Carica un file in una sala, con avanzamento. Ritorna { promise, abort }. */
export function uploadAttachment({ file, channelId, userId, onProgress }) {
  const objectName = `${channelId}/${userId}/${crypto.randomUUID()}-${safeName(file.name)}`
  let upload
  let aborted = false

  const promise = (async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Sessione scaduta: accedi di nuovo.')
    return new Promise((resolve, reject) => {
      upload = new tus.Upload(file, {
        endpoint: resumableEndpoint(),
        retryDelays: [0, 2000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, 'x-upsert': 'false' },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: 'attachments',
          objectName,
          contentType: file.type || 'application/octet-stream',
          cacheControl: '3600',
        },
        chunkSize: 6 * 1024 * 1024, // Supabase richiede pezzi da 6 MB
        onError: (err) => reject(err),
        onProgress: (sent, total) => onProgress?.(total ? sent / total : 0),
        onSuccess: () => resolve(objectName),
      })
      if (!aborted) upload.start()
    })
  })()

  return {
    promise,
    abort: () => { aborted = true; upload?.abort(true) },
  }
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
