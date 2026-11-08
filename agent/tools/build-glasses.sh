#!/usr/bin/env bash
# 把眼镜端工程同步到 WSL 并构建打包（含眼镜桥）
set -uo pipefail

export PATH="/home/yanhang/IrisView/toolchains/node-v24.13.0-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

SRC="/mnt/c/Users/YanHang/Desktop/黑客松/teacher-demo/dev-work/project/src"
APP="$HOME/IrisView/nonteacher-local-20261107"
OUT="$HOME/IrisView/nonteacher-bridge.fuiapp"

export FUSIONUI_DEVELOPER_KIT_ROOT="$HOME/IrisView/LLVISION/IrisView-Developer-Kit-v1.0.0"
CLI="$FUSIONUI_DEVELOPER_KIT_ROOT/sdk/fusionui-app-sdk/fusionui_sdk.py"

echo "=== 0. sync ==="
cp "$SRC"/*.js "$APP/src/" && echo "js synced"
cp "$SRC"/XRManifest.xml "$APP/src/" 2>/dev/null || true

echo "=== 0.1 node ==="
node -v

echo "=== 0.2 git identity（打包要求有提交） ==="
cd "$APP" || exit 1

# IrisView 不允许同一个 versionCode 装不同内容，每次构建自动加一
python3 - "$APP/FusionUIApp.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
old = int(d.get("versionCode", 0))
d["versionCode"] = old + 1
json.dump(d, open(p, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("versionCode: %d -> %d" % (old, d["versionCode"]))
PY
if [ ! -d .git ]; then git init -q; fi
git add -A
git -c user.email=nonteacher@local -c user.name=nonteacher commit -qm "bridge integration" 2>/dev/null || true
git log --oneline -1

echo "=== 1. test ==="
python3 "$CLI" test "$APP" 2>&1 | tail -4

echo "=== 2. build ==="
python3 "$CLI" build "$APP" 2>&1 | tail -3

echo "=== 3. package ==="
python3 "$CLI" package "$APP" --output "$OUT" --debug-unsigned 2>&1 | tail -3

echo "=== 4. result ==="
ls -la "$OUT" 2>/dev/null && sha256sum "$OUT" 2>/dev/null
