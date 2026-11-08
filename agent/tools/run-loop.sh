#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
KIT="$HOME/IrisView/LLVISION/IrisView-Developer-Kit-v1.0.0"
PACKAGE="$ROOT/agent/build/nonteacher-loop.fuiapp"
exec "$KIT/bin/irisview" run "$PACKAGE" --state-dir "$HOME/IrisView/nonteacher-loop-state" --port 45735 --allow-debug-unsigned --allow-debug-replace --display-mode mono
