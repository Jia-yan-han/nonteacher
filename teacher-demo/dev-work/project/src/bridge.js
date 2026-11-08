"use strict";

/**
 * 眼镜桥（文件版）。WSL 里直接读写 Windows 上的共享目录。
 *
 * 为什么不用 HTTP：眼镜端在 WSL（NAT 网络）里，电脑端服务绑在 Windows 的 127.0.0.1，
 * 往 Windows 回连要过防火墙，教室里不可靠。/mnt/c 这条路零配置。
 *
 * 读：lesson-card.json   这节课怎么上
 * 写：events.jsonl       课堂上发生了什么（只追加）
 * 写：status.json        心跳，让电脑端知道眼镜在线
 */

const fs = require("node:fs");
const path = require("node:path");

const BRIDGE = process.env.NT_BRIDGE_DIR ||
  "/mnt/c/Users/YanHang/Desktop/黑客松/agent/bridge";

const cardFile = () => path.join(BRIDGE, "lesson-card.json");
const eventsFile = () => path.join(BRIDGE, "events.jsonl");
const statusFile = () => path.join(BRIDGE, "status.json");

function readCard() {
  try {
    const raw = fs.readFileSync(cardFile(), "utf8");
    const card = JSON.parse(raw);
    return card && card.courseId ? card : null;
  } catch (e) {
    return null;
  }
}

function appendEvent(event) {
  try {
    fs.mkdirSync(BRIDGE, { recursive: true });
    fs.appendFileSync(eventsFile(), JSON.stringify(event) + "\n", "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

function beat(info) {
  try {
    fs.mkdirSync(BRIDGE, { recursive: true });
    fs.writeFileSync(statusFile(), JSON.stringify(Object.assign({
      at: new Date().toISOString(),
      device: "irisview-simulator"
    }, info || {})), "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

function available() {
  try { fs.mkdirSync(BRIDGE, { recursive: true }); return true; }
  catch (e) { return false; }
}

/** 电脑端推给眼镜的话（旁听者判断后写的） */
function readOutbox() {
  try {
    return fs.readFileSync(path.join(BRIDGE, "outbox.jsonl"), "utf8")
      .split("\n").filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch (e) { return null; }
      }).filter(Boolean);
  } catch (e) { return []; }
}

module.exports = { BRIDGE, readCard, appendEvent, beat, available, readOutbox };
