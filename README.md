# Live Teleprompter (Room-based)

Two people join the same room:

- Speaker: talks into mic, gets realtime transcription
- Viewer: sees the transcript live like a teleprompter

## Run locally

1) Start the server:

```bash
cd server
npm install
npm run dev
```

2) Start the client:

```bash
cd client
npm install
npm run dev
```

Open the client URL printed by Vite.
To open it from another device on the same Wi‑Fi/LAN, run:

```bash
cd client
npm run dev:host
```

## Local model transcription (no cloud)

This project can run speech-to-text locally using a streaming Vosk model (Python), and then it relays the transcript to the Viewer via Socket.IO.

1) Install Python dependency:

```bash
cd server
python3 -m pip install -r requirements.txt
```

2) Download a Vosk model and unzip it into `server/models`:

```bash
cd server
mkdir -p models
curl -L -o models/vosk-model-small-en-us-0.15.zip https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
cd models
unzip vosk-model-small-en-us-0.15.zip
```

If you use a different model folder name, set:

```bash
export VOSK_MODEL_PATH=/absolute/path/to/your/vosk-model-folder
```

## How to use

1) On the Speaker device: choose Speaker, generate or enter a room code, Join, then Start.
2) Click "Copy viewer link" and open it on the Viewer device.

## Notes

- Speech recognition uses the browser Web Speech API, so it works best on Chrome-based browsers (desktop). Many mobile browsers (especially iOS) do not support it.
- Microphone access requires a secure context (HTTPS) or localhost. If the Speaker is on another device using an `http://LAN-IP:5175` URL, the mic may be blocked by the browser.
- The server only relays transcripts; audio is not sent to the viewer.
