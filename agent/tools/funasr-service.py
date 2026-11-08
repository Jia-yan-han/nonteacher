"""Local SenseVoice ASR with the existing 16 kHz PCM HTTP contract."""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import torch
from funasr import AutoModel
from funasr.utils.postprocess_utils import rich_transcription_postprocess

MODEL = os.environ.get("NT_FUNASR_MODEL", "iic/SenseVoiceSmall")
PORT = int(os.environ.get("NT_ASR_PORT", "48722"))
torch.set_num_threads(4)
model = AutoModel(model=MODEL, device="cpu", disable_update=True)


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, data):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.send_json(200, {"ok": True, "service": "nonteacher-asr", "model": "FunASR/" + MODEL})

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
            result = model.generate(input=samples, language="zh", use_itn=True, disable_pbar=True)
            text = rich_transcription_postprocess(result[0].get("text", "")) if result else ""
            self.send_json(200, {"text": text.strip()})
        except Exception as error:
            self.send_json(500, {"error": str(error)})

    def log_message(self, fmt, *args):
        pass


print("Local FunASR ready on 127.0.0.1:" + str(PORT), flush=True)
HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
