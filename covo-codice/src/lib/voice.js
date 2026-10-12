import { supabase } from './supabase'

// Server pubblici e gratuiti che aiutano i browser a trovarsi su Internet
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

const SPEAK_THRESHOLD = 0.035

/**
 * Una sessione vocale: l'audio va direttamente da un browser all'altro (WebRTC).
 * Supabase Realtime serve solo a far "presentare" i partecipanti (segnalazione).
 *
 * onChange riceve: { status, error, muted, participants: [{ peerId, userId, name, avatarUrl, muted, speaking, self }] }
 */
export class VoiceSession {
  constructor({ channelId, user, profile, onChange }) {
    this.channelId = channelId
    this.user = user
    this.profile = profile
    this.onChange = onChange
    this.peerId = crypto.randomUUID()
    this.status = 'connecting' // connecting | connected | error | closed
    this.error = ''
    this.muted = false
    this.peers = new Map() // peerId -> { pc, audio, pendingIce, meta, speaking }
    this.metas = new Map() // peerId -> presenza
    this.localSpeaking = false
    this.analysers = new Map() // peerId -> analyser
  }

  // ---------- avvio ----------
  async join() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Questo browser non supporta l\'audio.')
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
    } catch (err) {
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
      return this.fail(denied
        ? 'Permesso microfono negato. Consentilo dalle impostazioni del browser (icona del lucchetto accanto all\'indirizzo) e riprova.'
        : err?.name === 'NotFoundError' ? 'Nessun microfono trovato.' : (err?.message || 'Impossibile usare il microfono.'))
    }
    if (this.status === 'closed') { this.stopLocal(); return }

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      this.audioCtx = Ctx ? new Ctx() : null
      this.audioCtx?.resume?.()
    } catch { this.audioCtx = null }
    this.watch('self', this.stream)
    this.meter = setInterval(() => this.measure(), 150)

    try { await supabase.realtime.setAuth() } catch { /* usa il token della sessione */ }

    this.rt = supabase.channel(`voice:${this.channelId}`, {
      config: { private: true, broadcast: { self: false }, presence: { key: this.peerId, enabled: true } },
    })
    this.rt
      .on('broadcast', { event: 'signal' }, ({ payload }) => this.onSignal(payload))
      .on('presence', { event: 'sync' }, () => this.onPresence())
      .subscribe(async (status, err) => {
        if (this.status === 'closed') return
        if (status === 'SUBSCRIBED') {
          await this.rt.track(this.presencePayload())
          this.status = 'connected'
          this.emit()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.fail(this.status === 'connected'
            ? 'Connessione persa. Esci e rientra nella sala vocale.'
            : 'Impossibile entrare nella sala vocale (permessi o rete). ' + (err?.message || ''))
        }
      })
    this.emit()
  }

  presencePayload() {
    return {
      user_id: this.user.id,
      name: this.profile?.display_name || 'Utente',
      avatar_url: this.profile?.avatar_url || null,
      muted: this.muted,
    }
  }

  // ---------- chi c'è nella sala ----------
  onPresence() {
    const state = this.rt.presenceState()
    const present = new Map()
    for (const [key, metas] of Object.entries(state)) {
      if (key !== this.peerId && metas[0]) present.set(key, metas[0])
    }
    this.metas = present

    // chiudi chi è uscito
    for (const id of [...this.peers.keys()]) if (!present.has(id)) this.dropPeer(id)

    // collega chi è entrato: inizia sempre chi ha l'id "più piccolo", così non ci si pesta i piedi
    for (const id of present.keys()) {
      if (!this.peers.has(id) && this.peerId < id) this.call(id)
    }
    this.emit()
  }

  makePeer(remoteId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const audio = new Audio()
    audio.autoplay = true
    audio.playsInline = true
    audio.setAttribute('playsinline', '')
    audio.style.display = 'none'
    document.body.appendChild(audio)
    const peer = { pc, audio, pendingIce: [], speaking: false }
    this.peers.set(remoteId, peer)

    this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream))

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.send(remoteId, { candidate: candidate.toJSON() })
    }
    pc.ontrack = ({ streams }) => {
      const remote = streams[0]
      if (!remote || audio.srcObject === remote) return
      audio.srcObject = remote
      audio.play().catch(() => {})
      this.watch(remoteId, remote)
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        // riprova da capo (solo chi aveva iniziato)
        this.dropPeer(remoteId)
        if (this.peerId < remoteId && this.metas.has(remoteId)) this.call(remoteId)
      }
      this.emit()
    }
    return peer
  }

  async call(remoteId) {
    const { pc } = this.makePeer(remoteId)
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.send(remoteId, { description: pc.localDescription.toJSON() })
    } catch (err) {
      console.warn('offer', err)
    }
  }

  async onSignal(msg) {
    if (!msg || msg.to !== this.peerId || this.status === 'closed') return
    const from = msg.from
    try {
      if (msg.description) {
        let peer = this.peers.get(from)
        if (msg.description.type === 'offer') {
          if (peer) this.dropPeer(from) // nuova offerta: ricomincia pulito
          peer = this.makePeer(from)
          await peer.pc.setRemoteDescription(msg.description)
          await this.flushIce(peer)
          const answer = await peer.pc.createAnswer()
          await peer.pc.setLocalDescription(answer)
          this.send(from, { description: peer.pc.localDescription.toJSON() })
        } else if (peer && peer.pc.signalingState === 'have-local-offer') {
          await peer.pc.setRemoteDescription(msg.description)
          await this.flushIce(peer)
        }
      } else if (msg.candidate) {
        const peer = this.peers.get(from)
        if (!peer) return
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(msg.candidate)
        else peer.pendingIce.push(msg.candidate)
      }
    } catch (err) {
      console.warn('signal', err)
    }
  }

  async flushIce(peer) {
    for (const c of peer.pendingIce.splice(0)) {
      try { await peer.pc.addIceCandidate(c) } catch { /* candidato scaduto */ }
    }
  }

  send(to, data) {
    this.rt?.send({ type: 'broadcast', event: 'signal', payload: { ...data, from: this.peerId, to } })
  }

  dropPeer(id) {
    const peer = this.peers.get(id)
    if (!peer) return
    try { peer.pc.close() } catch { /* già chiuso */ }
    peer.audio.srcObject = null
    peer.audio.remove()
    this.peers.delete(id)
    this.analysers.delete(id)
  }

  // ---------- chi sta parlando ----------
  watch(id, stream) {
    if (!this.audioCtx) return
    try {
      const src = this.audioCtx.createMediaStreamSource(stream)
      const analyser = this.audioCtx.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)
      this.analysers.set(id, { analyser, data: new Uint8Array(analyser.fftSize) })
    } catch { /* non supportato */ }
  }

  measure() {
    let changed = false
    for (const [id, { analyser, data }] of this.analysers) {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v }
      const loud = Math.sqrt(sum / data.length) > SPEAK_THRESHOLD
      if (id === 'self') {
        const speaking = loud && !this.muted
        if (speaking !== this.localSpeaking) { this.localSpeaking = speaking; changed = true }
      } else {
        const peer = this.peers.get(id)
        if (peer && peer.speaking !== loud) { peer.speaking = loud; changed = true }
      }
    }
    if (changed) this.emit()
  }

  // ---------- comandi ----------
  setMuted(muted) {
    this.muted = muted
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = !muted })
    if (this.status === 'connected') this.rt?.track(this.presencePayload())
    this.emit()
  }

  async leave() {
    this.status = 'closed'
    clearInterval(this.meter)
    for (const id of [...this.peers.keys()]) this.dropPeer(id)
    if (this.rt) {
      try { await this.rt.untrack() } catch { /* ignorato */ }
      supabase.removeChannel(this.rt)
      this.rt = null
    }
    this.stopLocal()
    try { await this.audioCtx?.close() } catch { /* ignorato */ }
    this.emit()
  }

  stopLocal() {
    this.stream?.getTracks().forEach((t) => t.stop())
  }

  fail(message) {
    this.error = message
    this.status = 'error'
    this.emit()
  }

  // ---------- stato per l'interfaccia ----------
  emit() {
    const self = {
      peerId: this.peerId,
      userId: this.user.id,
      name: this.profile?.display_name || 'Tu',
      avatarUrl: this.profile?.avatar_url,
      muted: this.muted,
      speaking: this.localSpeaking,
      self: true,
      linked: true,
    }
    const others = [...this.metas.entries()].map(([peerId, m]) => {
      const peer = this.peers.get(peerId)
      return {
        peerId,
        userId: m.user_id,
        name: m.name,
        avatarUrl: m.avatar_url,
        muted: Boolean(m.muted),
        speaking: Boolean(peer?.speaking),
        self: false,
        linked: peer?.pc.connectionState === 'connected',
      }
    })
    this.onChange?.({
      status: this.status,
      error: this.error,
      muted: this.muted,
      participants: this.status === 'closed' ? [] : [self, ...others],
    })
  }
}
