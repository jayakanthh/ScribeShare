import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import readline from 'readline'

type VoskMessage =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; error: string }

export type VoskTranscriber = {
  pushAudio: (pcm16le: Buffer) => void
  stop: () => void
  isReady: () => boolean
}

export function createVoskTranscriber({
  modelPath,
  sampleRate,
  onPartial,
  onFinal,
  onError,
}: {
  modelPath: string
  sampleRate: number
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onError: (error: string) => void
}): VoskTranscriber {
  const scriptPath = path.resolve(__dirname, '../../python/vosk_stream.py')
  const resolvedModelPath = path.resolve(modelPath)

  if (!fs.existsSync(scriptPath)) {
    onError(`Missing transcriber script: ${scriptPath}`)
  }

  if (!fs.existsSync(resolvedModelPath)) {
    onError(`Missing Vosk model folder: ${resolvedModelPath}`)
  }

  const proc = spawn(
    'python3',
    ['-u', scriptPath, resolvedModelPath, String(sampleRate)],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )

  let ready = true

  const rl = readline.createInterface({ input: proc.stdout })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const msg = JSON.parse(trimmed) as VoskMessage
      if (msg.type === 'partial') onPartial(msg.text)
      if (msg.type === 'final') onFinal(msg.text)
      if (msg.type === 'error') onError(msg.error)
    } catch {
      return
    }
  })

  proc.stderr.on('data', (chunk) => {
    const text = String(chunk).trim()
    if (!text) return
    if (text.startsWith('LOG')) return
    onError(text)
  })

  proc.on('exit', (code) => {
    ready = false
    if (code && code !== 0) onError(`transcriber exited with code ${code}`)
  })

  const pushAudio = (pcm16le: Buffer) => {
    if (!ready) return
    const header = Buffer.alloc(4)
    header.writeUInt32LE(pcm16le.length, 0)
    proc.stdin.write(header)
    proc.stdin.write(pcm16le)
  }

  const stop = () => {
    if (!ready) return
    ready = false
    try {
      const header = Buffer.alloc(4)
      header.writeUInt32LE(0, 0)
      proc.stdin.write(header)
      proc.stdin.end()
    } catch {
      return
    }
    try {
      proc.kill()
    } catch {
      return
    }
  }

  return {
    pushAudio,
    stop,
    isReady: () => ready,
  }
}
