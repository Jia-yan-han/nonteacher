"use strict";
// 眼镜桥：下发 → 眼镜写事件 → 收回
const fs = require("node:fs");
const path = require("node:path");
const BASE = "http://127.0.0.1:4321";
const BRIDGE = path.join(__dirname, "..", "bridge");

async function post(url, body) {
  const r = await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(url + " -> " + r.status + " " + JSON.stringify(d));
  return d;
}
async function get(url) { const r = await fetch(BASE + url); return r.json(); }

(async () => {
  // 建课 → 建对话 → 挂靠 → 导入课次卡（无密钥时走本地兜底）
  const course = await post("/api/course", { name: "桥测试课", subject: "小学数学", grade: "三年级" });
  const conv = await post("/api/conversation", { title: "备一节课", type: "prepare", courseId: course.id });
  await fetch(BASE + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ convId: conv.id, text: "三年级认识分数" }) }).then(r => r.text()).catch(() => {});
  const card = await post("/api/import", { convId: conv.id });
  console.log("1) 课次卡:", card.source, "| 重点:", JSON.stringify(card.keyPoints));

  const st0 = await get("/api/bridge/status");
  console.log("2) 桥状态:", JSON.stringify({ online: st0.online, dispatched: st0.dispatched, wslDir: st0.wslDir }));

  const d = await post("/api/bridge/dispatch", { courseId: course.id });
  console.log("3) 下发:", d.card.topic, "->", fs.existsSync(path.join(BRIDGE, "lesson-card.json")) ? "文件已写" : "文件缺失");

  // 模拟眼镜端：心跳 + 写三条事件
  fs.writeFileSync(path.join(BRIDGE, "status.json"), JSON.stringify({ at: new Date().toISOString(), device: "test", courseId: course.id, phase: "class" }));
  const lines = [
    { type: "class_started", t: 0, text: "", courseId: course.id, source: "glasses" },
    { type: "page", t: 6.4, text: "12", courseId: course.id, source: "glasses" },
    { type: "countdown_started", t: 41.2, text: "300", courseId: course.id, source: "glasses" }
  ];
  fs.appendFileSync(path.join(BRIDGE, "events.jsonl"), lines.map(l => JSON.stringify(l)).join("\n") + "\n");

  const st1 = await get("/api/bridge/status");
  console.log("4) 心跳后:", JSON.stringify({ online: st1.online, pending: st1.pendingEvents, total: st1.totalEvents }));

  const sync = await post("/api/bridge/sync", { courseId: course.id });
  console.log("5) 收事件:", sync.imported, "条 → 本节课共", sync.total);

  const again = await post("/api/bridge/sync", { courseId: course.id });
  console.log("6) 再收一次（应为 0）:", again.imported);

  const full = await get("/api/course/" + course.id);
  console.log("7) 落盘事件:", full.classroom.events.map(e => e.type + "@" + e.t + "s").join(" | "));

  // 清理
  const dataDir = path.join(__dirname, "..", "data", "teachers", "demo");
  fs.rmSync(path.join(dataDir, "courses", course.id), { recursive: true, force: true });
  fs.rmSync(path.join(dataDir, "conversations", conv.id + ".json"), { force: true });
  fs.rmSync(path.join(dataDir, "conversations", conv.id + ".jsonl"), { force: true });
  for (const f of ["lesson-card.json", "status.json", "_sync.json"]) {
    try { fs.unlinkSync(path.join(BRIDGE, f)); } catch (e) { /* ignore */ }
  }
  fs.writeFileSync(path.join(BRIDGE, "events.jsonl"), "", "utf8");

  console.log("\nBRIDGE OK（测试数据已清理）");
})().catch(e => { console.error("BRIDGE FAIL:", e.message); process.exit(1); });
