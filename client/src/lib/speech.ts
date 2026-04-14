export type SpeechStatus = 'idle' | 'listening' | 'error' | 'unsupported'

type SpeechRecognitionConstructor = new () => SpeechRecognition

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export type SpeechCallbacks = {
  onInterim: (text: string) => void
  onFinal: (delta: string) => void
  onStatus: (status: SpeechStatus, error?: string) => void
}

export function startSpeechRecognition(lang: string, callbacks: SpeechCallbacks) {
  const Ctor = getSpeechRecognitionConstructor()
  if (!Ctor) {
    callbacks.onStatus('unsupported')
    return () => {}
  }

  const recognition = new Ctor()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = lang

  let shouldRun = true
  let lastStatus: SpeechStatus = 'idle'

  const setStatus = (status: SpeechStatus, error?: string) => {
    lastStatus = status
    callbacks.onStatus(status, error)
  }

  const safeStart = () => {
    if (!shouldRun) return
    try {
      recognition.start()
    } catch {
      return
    }
  }

  recognition.onstart = () => setStatus('listening')
  recognition.onerror = (ev) => {
    setStatus('error', ev.error)
    if (!shouldRun) return
    if (ev.error === 'no-speech' || ev.error === 'aborted') {
      setTimeout(() => safeStart(), 200)
    }
  }
  recognition.onend = () => {
    if (!shouldRun) {
      setStatus('idle')
      return
    }
    if (lastStatus === 'listening') {
      setTimeout(() => safeStart(), 150)
    }
  }

  recognition.onresult = (event) => {
    let interim = ''
    let finalDelta = ''

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const res = event.results[i]
      const text = res[0]?.transcript ?? ''
      if (res.isFinal) finalDelta += text
      else interim += text
    }

    if (interim.trim()) callbacks.onInterim(interim.trim())
    if (finalDelta.trim()) callbacks.onFinal(finalDelta.trim())
  }

  safeStart()

  return () => {
    shouldRun = false
    try {
      recognition.stop()
    } catch {
      return
    }
  }
}
