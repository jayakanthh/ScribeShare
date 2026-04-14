import { io, Socket } from 'socket.io-client'

export type Role = 'speaker' | 'viewer'

export type RoomMembersPayload = { roomId: string; members: number }
export type TranscriptPayload = { text: string; isFinal: boolean; at: number }
export type LocalTranscriptionStatusPayload = { ok: boolean; message: string }

export type ClientToServerEvents = {
  'join-room': (payload: { roomId: string; role: Role }) => void
  transcript: (payload: { roomId: string; text: string; isFinal: boolean }) => void
  'start-local-transcription': (payload: { roomId: string }) => void
  'stop-local-transcription': () => void
  'audio-chunk': (payload: { roomId: string; audio: ArrayBuffer }) => void
}

export type ServerToClientEvents = {
  'room-members': (payload: RoomMembersPayload) => void
  transcript: (payload: TranscriptPayload) => void
  'local-transcription-status': (payload: LocalTranscriptionStatusPayload) => void
}

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null

export function getSocket() {
  if (socket) return socket
  const defaultServerUrl = window.location.origin
  socket = io(import.meta.env.VITE_SERVER_URL ?? defaultServerUrl, {
    transports: ['websocket'],
  })
  return socket
}
