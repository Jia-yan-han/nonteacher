"""Download and verify the official SenseVoice checkpoint from Hugging Face."""
import concurrent.futures
import hashlib
import os
import time
from pathlib import Path
import requests

URL = "https://huggingface.co/FunAudioLLM/SenseVoiceSmall/resolve/main/model.pt"
SIZE = 936291369
SHA256 = "833ca2dcfdf8ec91bd4f31cfac36d6124e0c459074d5e909aec9cabe6204a3ea"
directory = Path.home() / "IrisView/nonteacher-funasr-download"
directory.mkdir(parents=True, exist_ok=True)
parts = 16

def download(index):
    start = SIZE * index // parts
    end = SIZE * (index + 1) // parts - 1
    path = directory / (str(index) + ".part")
    for attempt in range(10):
        existing = path.stat().st_size if path.exists() else 0
        if existing == end - start + 1:
            break
        if existing > end - start + 1:
            existing = 0
        offset = start + existing
        try:
            with requests.get(URL, headers={"Range": f"bytes={offset}-{end}"}, stream=True, timeout=(30, 120)) as response:
                response.raise_for_status()
                if response.status_code != 206 or not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-{end}/"):
                    raise RuntimeError("server did not honor the requested range")
                with path.open("ab" if existing else "wb") as output:
                    for chunk in response.iter_content(1024 * 1024):
                        output.write(chunk)
            if path.stat().st_size != end - start + 1:
                raise RuntimeError("incomplete download")
            break
        except (requests.RequestException, OSError, RuntimeError) as error:
            if attempt == 9:
                raise
            print(f"Part {index + 1} interrupted ({error}); retrying", flush=True)
            time.sleep(min(5 * (attempt + 1), 30))
    print(f"Downloaded part {index + 1}/{parts}", flush=True)
    return path

with concurrent.futures.ThreadPoolExecutor(max_workers=parts) as pool:
    files = list(pool.map(download, range(parts)))
target = directory / "model.pt"
digest = hashlib.sha256()
with target.open("wb") as output:
    for path in files:
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
if digest.hexdigest() != SHA256:
    target.unlink()
    raise RuntimeError("checkpoint SHA-256 mismatch")
print("Verified checkpoint: " + str(target), flush=True)
