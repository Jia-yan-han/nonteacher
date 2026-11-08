"""Exercise local ASR with synthetic WAV; no microphone or real classroom data."""
import json
import sys
import time
import urllib.request
import urllib.error
import wave
import numpy as np

with wave.open(sys.argv[1], "rb") as f:
    assert f.getsampwidth() == 2
    channels, rate = f.getnchannels(), f.getframerate()
    samples = np.frombuffer(f.readframes(f.getnframes()), dtype="<i2").reshape(-1, channels).mean(axis=1)
    target = np.arange(round(len(samples) * 16000 / rate)) * rate / 16000
    pcm = np.interp(target, np.arange(len(samples)), samples).astype("<i2").tobytes()
start = time.monotonic()
req = urllib.request.Request("http://127.0.0.1:48721/transcribe", data=pcm, headers={"Content-Type":"audio/pcm"})
try:
    with urllib.request.urlopen(req, timeout=120) as res:
        output = json.load(res)
except urllib.error.HTTPError as error:
    print(error.read().decode("utf-8"))
    raise
print(json.dumps({"text": output.get("text"), "seconds": round(time.monotonic()-start, 2)}, ensure_ascii=False))
assert output.get("text"), "no transcript"
