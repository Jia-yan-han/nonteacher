#!/usr/bin/env bash
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
if curl -fsS --max-time 2 http://127.0.0.1:48721/ >/dev/null 2>&1; then
  echo "ASR port already in use; keeping existing service."
  exit 0
fi
exec "$HOME/IrisView/nonteacher-asr/venv/bin/python" "$DIR/local-asr.py"
