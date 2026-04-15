import './App.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getSocket } from './lib/socket'
import type { LocalTranscriptionStatusPayload, Role, TranscriptPayload } from './lib/socket'
import { startPcmStream } from './lib/pcmStream'
import { startSpeechRecognition } from './lib/speech'
import type { SpeechStatus } from './lib/speech'

function getInitialRoomId() {
  return new URLSearchParams(window.location.search).get('room') ?? ''
}

function getInitialRole(): Role {
  const roleParam = new URLSearchParams(window.location.search).get('role')
  return roleParam === 'viewer' ? 'viewer' : 'speaker'
}

function getMicErrorMessage(error: unknown) {
  if (!window.isSecureContext) {
    return 'Microphone access requires HTTPS or localhost. Open the Speaker on localhost, or serve over HTTPS.'
  }

  if (typeof error === 'object' && error && 'name' in error) {
    const name = String((error as { name: unknown }).name)
    if (name === 'NotAllowedError') return 'Microphone permission blocked. Allow mic access in the browser and try again.'
    if (name === 'NotFoundError') return 'No microphone found on this device.'
    if (name === 'NotReadableError') return 'Microphone is busy or unavailable. Close other apps using the mic and retry.'
    if (name === 'NotSupportedError') return 'Microphone is not supported in this context. Try Chrome on desktop.'
    if (name === 'SecurityError') return 'Microphone blocked by security policy. Use HTTPS or localhost.'
  }

  return 'Could not access microphone. Try Chrome on desktop, and ensure you allowed mic permissions.'
}

function App() {
  const socket = useMemo(() => getSocket(), [])
  const [roomId, setRoomId] = useState(() => getInitialRoomId())
  const [role, setRole] = useState<Role>(() => getInitialRole())
  const [joined, setJoined] = useState(false)
  const [members, setMembers] = useState<number | null>(null)

  const [finalText, setFinalText] = useState('')
  const [interimText, setInterimText] = useState('')

  const [engine, setEngine] = useState<'local' | 'browser'>('local')
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>('idle')
  const [speechError, setSpeechError] = useState<string | null>(null)
  const [lang, setLang] = useState('en-US')
  const [localStatus, setLocalStatus] = useState<LocalTranscriptionStatusPayload | null>(null)

  const stopSpeechRef = useRef<null | (() => void)>(null)
  const stopPcmRef = useRef<null | (() => void)>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onMembers = (payload: { roomId: string; members: number }) => {
      if (payload.roomId !== roomId) return
      setMembers(payload.members)
    }

    const onTranscript = (payload: TranscriptPayload) => {
      if (payload.isFinal) {
        setFinalText((prev) => (prev ? `${prev} ${payload.text}` : payload.text))
        setInterimText('')
      } else {
        setInterimText(payload.text)
      }
    }

    socket.on('room-members', onMembers)
    socket.on('transcript', onTranscript)
    const onLocalStatus = (payload: LocalTranscriptionStatusPayload) => setLocalStatus(payload)
    socket.on('local-transcription-status', onLocalStatus)
    return () => {
      socket.off('room-members', onMembers)
      socket.off('transcript', onTranscript)
      socket.off('local-transcription-status', onLocalStatus)
    }
  }, [roomId, socket])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [finalText])

  useEffect(() => {
    return () => {
      stopSpeechRef.current?.()
      stopSpeechRef.current = null
      stopPcmRef.current?.()
      stopPcmRef.current = null
    }
  }, [])

  const join = () => {
    const trimmed = roomId.trim()
    if (!trimmed) return
    setRoomId(trimmed)
    setJoined(true)
    socket.emit('join-room', { roomId: trimmed, role })
    const url = new URL(window.location.href)
    url.searchParams.set('room', trimmed)
    url.searchParams.set('role', role)
    window.history.replaceState({}, '', url.toString())
  }

  const leave = () => {
    stopSpeechRef.current?.()
    stopSpeechRef.current = null
    stopPcmRef.current?.()
    stopPcmRef.current = null
    setSpeechStatus('idle')
    setSpeechError(null)
    setLocalStatus(null)
    setFinalText('')
    setInterimText('')
    setJoined(false)
    setMembers(null)
  }

  const start = async () => {
    setSpeechError(null)
    stopSpeechRef.current?.()
    stopPcmRef.current?.()
    stopSpeechRef.current = null
    stopPcmRef.current = null
    if (!navigator.mediaDevices?.getUserMedia) {
      setSpeechStatus('unsupported')
      setSpeechError('Microphone APIs are not available in this browser.')
      return
    }

    if (engine === 'local') {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (e) {
        setSpeechStatus('error')
        setSpeechError(getMicErrorMessage(e))
        return
      }
      socket.emit('start-local-transcription', { roomId })
      setSpeechStatus('listening')
      try {
        const pcm = await startPcmStream({
          targetSampleRate: 16000,
          onChunk: (audio) => socket.emit('audio-chunk', { roomId, audio }),
          stream,
        })
        stopPcmRef.current = pcm.stop
      } catch (e) {
        setSpeechStatus('error')
        setSpeechError(getMicErrorMessage(e))
      }
      return
    }

    stopSpeechRef.current = startSpeechRecognition(lang, {
      onInterim: (text) => socket.emit('transcript', { roomId, text, isFinal: false }),
      onFinal: (delta) => socket.emit('transcript', { roomId, text: delta, isFinal: true }),
      onStatus: (status, error) => {
        setSpeechStatus(status)
        if (status === 'unsupported') {
          setSpeechError('Speech recognition is not supported in this browser. Try Chrome on desktop.')
        } else if (status === 'error') {
          const silentErrors = new Set(['no-speech', 'aborted'])
          const friendlyMessages: Record<string, string> = {
            'not-allowed': 'Microphone permission blocked. Allow mic access in your browser settings and try again.',
            'service-not-allowed': 'Speech service is not allowed. Check your browser settings.',
            'network': 'Network error during speech recognition. Check your internet connection.',
          }
          if (!error || silentErrors.has(error)) {
            setSpeechError(null)
          } else {
            setSpeechError(friendlyMessages[error] ?? `Speech recognition error: ${error}`)
          }
        } else {
          setSpeechError(null)
        }
      },
    })
  }

  const stop = () => {
    stopSpeechRef.current?.()
    stopSpeechRef.current = null
    stopPcmRef.current?.()
    stopPcmRef.current = null
    socket.emit('stop-local-transcription')
    setSpeechStatus('idle')
  }

  const copyViewerLink = async () => {
    const url = new URL(window.location.href)
    url.searchParams.set('room', roomId)
    url.searchParams.set('role', 'viewer')
    await navigator.clipboard.writeText(url.toString())
  }

  const resetTranscript = () => {
    setFinalText('')
    setInterimText('')
  }

  const generateRoom = () => {
    const code = crypto.randomUUID().slice(0, 6).toUpperCase()
    setRoomId(code)
  }

  return (
    <div className={joined ? 'app app--room' : 'app'}>
      <header className="topbar">
        <div className="brand"><span>Scribe</span><span className="brand-accent">Share</span></div>
        {joined ? (
          <div className="topbar__right">
            <div className="pill">
              Room <b>{roomId}</b>
              {members !== null ? <span className="muted"> · {members} online</span> : null}
            </div>
            {role === 'speaker' ? (
              <button className="btn" onClick={copyViewerLink}>
                Copy viewer link
              </button>
            ) : null}
            <button className="btn btn--ghost" onClick={leave}>
              Leave
            </button>
          </div>
        ) : null}
      </header>

      {!joined ? (
        <main className="join">
          <div className="join__hero">
            <div className="join__logo"><span>Scribe</span><span className="join__logo-accent">Share</span></div>
            <p className="join__tagline">Live captions, streamed to any screen in real time.</p>
          </div>

          <div className="join__card">
            <div className="join__field">
              <div className="label">Room code</div>
              <div className="join__room-row">
                <input
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && join()}
                  placeholder="e.g. ABC123"
                  inputMode="text"
                  autoCapitalize="characters"
                  className="join__room-input"
                />
                <button className="btn btn--ghost btn--sm" onClick={generateRoom} type="button">
                  Generate
                </button>
              </div>
            </div>

            <div className="join__field">
              <div className="label">I am</div>
              <div className="role-toggle">
                <button
                  type="button"
                  className={`role-toggle__btn${role === 'speaker' ? ' role-toggle__btn--active' : ''}`}
                  onClick={() => setRole('speaker')}
                >
                  <span className="role-toggle__icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                  </span>
                  Speaker
                  <span className="role-toggle__sub">transcribes</span>
                </button>
                <button
                  type="button"
                  className={`role-toggle__btn${role === 'viewer' ? ' role-toggle__btn--active' : ''}`}
                  onClick={() => setRole('viewer')}
                >
                  <span className="role-toggle__icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  </span>
                  Viewer
                  <span className="role-toggle__sub">teleprompter</span>
                </button>
              </div>
            </div>

            <button className="btn join__submit" onClick={join} type="button">
              Join Room
            </button>
          </div>
        </main>
      ) : null}

      {joined && role === 'speaker' ? (
        <main className="panel">
          <h2>Speaker</h2>
          <div className="row">
            <label className="field">
              <div className="label">Language</div>
              <input value={lang} onChange={(e) => setLang(e.target.value)} placeholder="en-US" />
            </label>
            <label className="field">
              <div className="label">Engine</div>
              <select value={engine} onChange={(e) => setEngine(e.target.value as 'local' | 'browser')}>
                <option value="local">Local model (Vosk)</option>
                <option value="browser">Browser engine (Web Speech API)</option>
              </select>
            </label>
            {speechStatus !== 'listening' ? (
              <button className="btn" onClick={start} type="button">
                Start
              </button>
            ) : (
              <button className="btn btn--danger" onClick={stop} type="button">
                Stop
              </button>
            )}
            <button className="btn btn--ghost" onClick={resetTranscript} type="button">
              Clear
            </button>
          </div>

          <div className="status">
            <span className={`pill${speechStatus === 'listening' ? ' pill--ok' : ''}`}>
              Status <b>{speechStatus}</b>
            </span>
            {engine === 'local' && localStatus && !localStatus.ok ? (
              <span className="pill pill--warn">{localStatus.message}</span>
            ) : null}
            {speechError ? <span className="pill pill--warn">{speechError}</span> : null}
          </div>

          <div className="preview">
            <div className="preview__title">What the viewer sees</div>
            <div className="preview__box">
              <span>{finalText}</span>
              {interimText ? <span className="interim"> {interimText}</span> : null}
            </div>
          </div>
        </main>
      ) : null}

      {joined && role === 'viewer' ? (
        <main className="teleprompter" ref={scrollRef}>
          <div className="teleprompter__text">
            <span>{finalText}</span>
            {interimText ? <span className="interim"> {interimText}</span> : null}
          </div>
          <div className="teleprompter__actions">
            <button className="teleprompter__clear" onClick={resetTranscript} type="button">
              Clear
            </button>
          </div>
        </main>
      ) : null}
    </div>
  )
}

export default App
