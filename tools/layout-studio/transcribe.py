"""Local-only transcription. No audio is sent to an external service."""
import base64
import io
import json
import sys
from pathlib import Path
import os
import threading

first = sys.stdin.buffer.readline(2 * 1024 * 1024 + 1)
if len(first) > 2 * 1024 * 1024:
    raise ValueError("Audio request exceeds its bound")
try:
    request = json.loads(first)
except ValueError:
    rest = sys.stdin.buffer.read(2 * 1024 * 1024 + 1 - len(first))
    if len(first) + len(rest) > 2 * 1024 * 1024:
        raise ValueError("Audio request exceeds its bound")
    request = json.loads(first + rest)
if request.get("supervised") is True:
    def watch_owner():
        sys.stdin.buffer.read(1)
        os._exit(0)
    threading.Thread(target=watch_owner, daemon=True).start()
audio = base64.b64decode(request["audio"], validate=True)
if not 1 <= len(audio) <= 1024 * 1024:
    raise ValueError("Audio segment exceeds the bounded local limit")
model_dir = Path(sys.argv[1])
from faster_whisper import WhisperModel

model = WhisperModel(str(model_dir), device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True)
segments, info = model.transcribe(io.BytesIO(audio), beam_size=3, language="en", vad_filter=True)
transcript = " ".join(segment.text.strip() for segment in segments)
print(json.dumps({"text": transcript[:16000], "language": info.language, "destination": "local CPU; no uploads"}))
