#!/usr/bin/env bash
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
exec "$HOME/IrisView/nonteacher-asr/venv/bin/python" "$DIR/local-asr.py"
