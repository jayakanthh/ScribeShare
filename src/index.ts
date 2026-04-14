import cors from 'cors'
import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import path from 'path'
import { createVoskTranscriber } from './transcription/vosk'

const PORT = Number(process.env.PORT ?? 3001)

const app = express()
app.use(cors())

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

const httpServer = http.createServer(app)

const io = new Server(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
})

type Role = 'speaker' | 'viewer'

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, role }: { roomId: string; role: Role }) => {
    if (!roomId || (role !== 'speaker' && role !== 'viewer')) return
    socket.data.roomId = roomId
    socket.data.role = role
    socket.join(roomId)

    const members = io.sockets.adapter.rooms.get(roomId)?.size ?? 0
    io.to(roomId).emit('room-members', { roomId, members })
  })

  socket.on(
    'transcript',
    ({
      roomId,
      text,
      isFinal,
    }: {
      roomId: string
      text: string
      isFinal: boolean
    }) => {
      if (!roomId || typeof text !== 'string') return
      if (socket.data.role !== 'speaker') return
      if (socket.data.roomId !== roomId) return
      const trimmed = text.trim()
      if (!trimmed) return
      io.to(roomId).emit('transcript', {
        text: trimmed,
        isFinal: Boolean(isFinal),
        at: Date.now(),
      })
    },
  )

  socket.on('start-local-transcription', ({ roomId }: { roomId: string }) => {
    if (!roomId) return
    if (socket.data.role !== 'speaker') return
    if (socket.data.roomId !== roomId) return
    if (socket.data.transcriber) return

    const modelPath =
      process.env.VOSK_MODEL_PATH ??
      path.resolve(process.cwd(), 'models/vosk-model-small-en-us-0.15')

    socket.data.transcriber = createVoskTranscriber({
      modelPath,
      sampleRate: 16000,
      onPartial: (text) => {
        io.to(roomId).emit('transcript', { text, isFinal: false, at: Date.now() })
      },
      onFinal: (text) => {
        io.to(roomId).emit('transcript', { text, isFinal: true, at: Date.now() })
      },
      onError: (error) => {
        socket.emit('local-transcription-status', { ok: false, message: error })
      },
    })

    socket.emit('local-transcription-status', { ok: true, message: 'started' })
  })

  socket.on('stop-local-transcription', () => {
    const transcriber = socket.data.transcriber as { stop: () => void } | undefined
    if (!transcriber) return
    transcriber.stop()
    socket.data.transcriber = undefined
    socket.emit('local-transcription-status', { ok: true, message: 'stopped' })
  })

  socket.on('audio-chunk', ({ roomId, audio }: { roomId: string; audio: Buffer }) => {
    if (!roomId) return
    if (socket.data.role !== 'speaker') return
    if (socket.data.roomId !== roomId) return
    const transcriber = socket.data.transcriber as { pushAudio: (b: Buffer) => void } | undefined
    if (!transcriber) return
    if (!audio || !Buffer.isBuffer(audio)) return
    transcriber.pushAudio(audio)
  })

  socket.on('disconnect', () => {
    const transcriber = socket.data.transcriber as { stop: () => void } | undefined
    if (transcriber) {
      transcriber.stop()
      socket.data.transcriber = undefined
    }
    const roomId = socket.data.roomId as string | undefined
    if (!roomId) return
    const members = io.sockets.adapter.rooms.get(roomId)?.size ?? 0
    io.to(roomId).emit('room-members', { roomId, members })
  })
})

httpServer.listen(PORT, () => {
  console.log(`server listening on ${PORT}`)
})
