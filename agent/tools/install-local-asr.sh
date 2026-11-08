#!/usr/bin/env bash
set -euo pipefail
ASR_HOME="$HOME/IrisView/nonteacher-asr"
python3 -m venv "$ASR_HOME/venv"
"$ASR_HOME/venv/bin/python" -m pip install 'faster-whisper==1.2.1' 'ctranslate2==4.8.5'
