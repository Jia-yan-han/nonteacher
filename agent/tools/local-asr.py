"""Local-only Chinese speech recognition. POST 16 kHz mono s16le PCM to /transcribe."""
import json
import os
import numpy as np
from http.server import BaseHTTPRequestHandler, HTTPServer
from faster_whisper import WhisperModel

MODEL = os.environ.get("NT_ASR_MODEL", "tiny")
model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=4)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_json(200, {"ok": True, "service": "nonteacher-asr", "model": MODEL})

    def send_json(self, status, data):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if self.path != "/transcribe":
            return self.send_json(404, {"error": "not found"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 2 or size > 384000 or size % 2:
                return self.send_json(400, {"error": "invalid PCM length"})
            pcm = self.rfile.read(size)
            if len(pcm) != size:
                return self.send_json(400, {"error": "incomplete PCM"})
            samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
            segments, _ = model.transcribe(samples, language="zh", beam_size=1, vad_filter=False)
            text = "".join(segment.text for segment in segments).strip()
            self.send_json(200, {"text": text})
        except Exception as error:
            self.send_json(500, {"error": str(error)})

    def log_message(self, fmt, *args):
        pass  # no speech content in logs

print("Local ASR ready on 127.0.0.1:48721; model=" + MODEL, flush=True)
HTTPServer(("127.0.0.1", 48721), Handler).serve_forever()
