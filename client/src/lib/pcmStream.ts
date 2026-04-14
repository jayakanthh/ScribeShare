export type PcmStream = {
  stop: () => void
  inputSampleRate: number
}

function downsampleBuffer(input: Float32Array, inputRate: number, targetRate: number) {
  if (targetRate === inputRate) return input
  const ratio = inputRate / targetRate
  const newLength = Math.round(input.length / ratio)
  const result = new Float32Array(newLength)
  let offsetResult = 0
  let offsetBuffer = 0

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio)
    let accum = 0
    let count = 0
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i += 1) {
      accum += input[i] ?? 0
      count += 1
    }
    result[offsetResult] = count > 0 ? accum / count : 0
    offsetResult += 1
    offsetBuffer = nextOffsetBuffer
  }

  return result
}

function floatTo16BitPCM(input: Float32Array) {
  const output = new Int16Array(input.length)
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0))
    output[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return output
}

export async function startPcmStream({
  targetSampleRate,
  onChunk,
  chunkMs = 250,
  stream,
}: {
  targetSampleRate: number
  onChunk: (pcm16le: ArrayBuffer) => void
  chunkMs?: number
  stream?: MediaStream
}): Promise<PcmStream> {
  const mediaStream =
    stream ??
    (await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    }))

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const audioContext = new AudioCtx()
  const inputSampleRate = audioContext.sampleRate

  const source = audioContext.createMediaStreamSource(mediaStream)
  const bufferSize = Math.max(1024, Math.min(16384, Math.round((inputSampleRate * chunkMs) / 1000)))
  const processor = audioContext.createScriptProcessor(bufferSize, 1, 1)

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0)
    const downsampled = downsampleBuffer(input, inputSampleRate, targetSampleRate)
    const pcm16 = floatTo16BitPCM(downsampled)
    onChunk(pcm16.buffer)
  }

  source.connect(processor)
  processor.connect(audioContext.destination)

  const stop = () => {
    try {
      processor.disconnect()
      source.disconnect()
    } catch {
      return
    }
    for (const t of mediaStream.getTracks()) t.stop()
    void audioContext.close()
  }

  return { stop, inputSampleRate }
}
