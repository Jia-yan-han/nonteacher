#!/usr/bin/env bash
# 重启模拟器并把应用 stdout 落盘，便于诊断
set -uo pipefail
export PATH="/home/yanhang/IrisView/toolchains/node-v24.13.0-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
LOG=/tmp/nt_run.log

pkill -f "nonteacher-bridge.fuiapp" 2>/dev/null || true
pkill -f "run-client.sh" 2>/dev/null || true
pkill -f "fusionui-glasses-launcher" 2>/dev/null || true
pkill -f "fusionui-glasses-client" 2>/dev/null || true
pkill -f "fusionui-glasses-simulator" 2>/dev/null || true
pkill -f "irisnode --expose-gc" 2>/dev/null || true
pkill -f "fusionui_sdk.py run" 2>/dev/null || true
sleep 3
rm -f "$HOME/IrisView/nonteacher-bridge-state/.nonteacher.lock" 2>/dev/null || true
: > "$LOG"

nohup bash "/mnt/c/Users/YanHang/Desktop/黑客松/agent/tools/run-glasses.sh" >> "$LOG" 2>&1 &
echo "launched pid $!"
sleep 18

echo "=== stdout（前 80 行） ==="
head -80 "$LOG" 2>/dev/null || echo "（空）"
echo "=== 关键行 ==="
grep -a "NT_\|Error\|TypeError\|Uncaught\|throw" "$LOG" 2>/dev/null | head -20 || true
echo "=== 帧 ==="
grep -ac "application frame" "$HOME/IrisView/nonteacher-bridge-state/logs/simulator-release-off.log" 2>/dev/null || true
