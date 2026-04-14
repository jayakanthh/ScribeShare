import json
import os
import sys


def read_exact(n: int):
    b = sys.stdin.buffer.read(n)
    if len(b) != n:
        return None
    return b


def main():
    try:
        from vosk import Model, KaldiRecognizer
    except Exception as e:
        sys.stdout.write(json.dumps({"type": "error", "error": f"vosk import failed: {e}"}) + "\n")
        sys.stdout.flush()
        return 2

    model_path = sys.argv[1] if len(sys.argv) > 1 else ""
    sample_rate = int(sys.argv[2]) if len(sys.argv) > 2 else 16000

    if not model_path or not os.path.isdir(model_path):
        sys.stdout.write(json.dumps({"type": "error", "error": f"model path not found: {model_path}"}) + "\n")
        sys.stdout.flush()
        return 2

    model = Model(model_path)
    rec = KaldiRecognizer(model, sample_rate)

    last_partial = ""

    while True:
        header = read_exact(4)
        if header is None:
            break
        length = int.from_bytes(header, byteorder="little", signed=False)
        if length == 0:
            break
        data = read_exact(length)
        if data is None:
            break

        accepted = rec.AcceptWaveform(data)
        if accepted:
            result = json.loads(rec.Result() or "{}")
            text = (result.get("text") or "").strip()
            if text:
                sys.stdout.write(json.dumps({"type": "final", "text": text}) + "\n")
                sys.stdout.flush()
            last_partial = ""
        else:
            partial = json.loads(rec.PartialResult() or "{}").get("partial") or ""
            partial = partial.strip()
            if partial and partial != last_partial:
                last_partial = partial
                sys.stdout.write(json.dumps({"type": "partial", "text": partial}) + "\n")
                sys.stdout.flush()

    result = json.loads(rec.FinalResult() or "{}")
    text = (result.get("text") or "").strip()
    if text:
        sys.stdout.write(json.dumps({"type": "final", "text": text}) + "\n")
        sys.stdout.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
