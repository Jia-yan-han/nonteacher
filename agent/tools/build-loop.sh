#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
KIT="$HOME/IrisView/LLVISION/IrisView-Developer-Kit-v1.0.0"
export PATH="$HOME/IrisView/toolchains/node-v24.13.0-linux-x64/bin:$PATH"
WORK=$(mktemp -d "$HOME/IrisView/nonteacher-loop-build.XXXXXX")
cp -a "$ROOT/teacher-demo/dev-work/project/." "$WORK/"
cd "$WORK"
git init -q
git add src test FusionUIApp.json fusionui.config.json package.json package-lock.json
git -c user.name='Local Demo Build' -c user.email='demo@localhost' commit -qm 'Build classroom loop'
npm ci --offline --ignore-scripts --no-audit --no-fund
"$KIT/bin/irisview" test "$WORK"
"$KIT/bin/irisview" build "$WORK"
mkdir -p "$ROOT/agent/build"
"$KIT/bin/irisview" package "$WORK" --debug-unsigned --output "$ROOT/agent/build/nonteacher-loop.fuiapp"
"$KIT/bin/irisview" verify "$ROOT/agent/build/nonteacher-loop.fuiapp" --allow-debug-unsigned
printf 'BUILD_SOURCE=%s\n' "$WORK"
