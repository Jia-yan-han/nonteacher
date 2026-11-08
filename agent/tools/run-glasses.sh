#!/usr/bin/env bash
# 启动含眼镜桥的模拟器
set -uo pipefail
export PATH="/home/yanhang/IrisView/toolchains/node-v24.13.0-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
KIT="/home/yanhang/IrisView/LLVISION/IrisView-Developer-Kit-v1.0.0"
PKG="$HOME/IrisView/nonteacher-bridge.fuiapp"
STATE="$HOME/IrisView/nonteacher-bridge-state"

# 清掉上一次残留，否则会报 close the IrisView Client 或 versionCode 冲突
pkill -f "nonteacher-bridge.fuiapp" 2>/dev/null || true
pkill -f "run-client.sh" 2>/dev/null || true
pkill -f "fusionui-glasses-launcher" 2>/dev/null || true
pkill -f "fusionui-glasses-client" 2>/dev/null || true
pkill -f "fusionui-glasses-simulator" 2>/dev/null || true
pkill -f "irisnode --expose-gc" 2>/dev/null || true
pkill -f "fusionui_sdk.py run" 2>/dev/null || true
sleep 3
rm -f "$STATE"/.nonteacher.lock 2>/dev/null || true

exec "$KIT/bin/irisview" run "$PKG" \
  --state-dir "$STATE" \
  --port 45734 \
  --allow-debug-unsigned \
  --audio-mode silent
