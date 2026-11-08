"use strict";
// 旁听者端到端：模拟老师在眼镜上一路说下去，看它会不会自己记笔记、自己判断要不要开口
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const course = await post("/api/course", { name: "旁听测试 · 认识三角形", subject: "小学数学", grade: "四年级" });
  const conv = await post("/api/conversation", { title: "备一节课", type: "prepare", courseId: course.id });
  await fetch(BASE + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ convId: conv.id, text: "四年级三角形，重点是三条边能不能围成三角形，四十分钟" }) }).then(r => r.text()).catch(() => {});
  await post("/api/import", { convId: conv.id });
  console.log("1) 课已就绪");

  await post("/api/bridge/dispatch", { courseId: course.id });
  console.log("2) 本课卡已下发");

  // 老师在眼镜上连说几句（模拟）
  const said = [
    { t: 0.0, text: "同学们，翻到第十二页，先看看这幅图。" },
    { t: 8.2, text: "这个图形三条边能围成三角形吗？" },
    { t: 16.0, text: "这个图形三条边能围成三角形吗？" },
    { t: 24.0, text: "这个图形三条边能围成三角形吗？" },
    { t: 33.0, text: "给大家五分钟讨论一下。" },
    { t: 41.0, text: "刚才说错了，改成三十分钟。" }
  ];
  const lines = said.map(s => JSON.stringify({ type: "utterance", t: s.t, text: s.text, courseId: course.id, source: "glasses" }));
  fs.appendFileSync(path.join(BRIDGE, "events.jsonl"), lines.join("\n") + "\n");
  console.log("3) 眼镜已写入", said.length, "句");

  await post("/api/watch/start", { courseId: course.id });
  console.log("4) 旁听已开");

  for (let i = 0; i < 8; i += 1) {
    await sleep(6000);
    const s = await get("/api/watch/status?courseId=" + course.id);
    console.log(`   [${(i + 1) * 6}s] 判断 ${s.judged} 次 · 推送 ${s.pushed} 句 · 笔记 ${s.notes.length} 条${s.lastError ? " · 错：" + s.lastError.slice(0, 60) : ""}`);
    if (s.judged >= 2 && s.pushed >= 1) break;
  }

  await post("/api/watch/stop", { courseId: course.id });

  const st = await get("/api/watch/status?courseId=" + course.id);
  console.log("\n=== 观察笔记 ===");
  console.log(st.notes.join("\n") || "（空）");

  const outboxPath = path.join(BRIDGE, "outbox.jsonl");
  const outbox = fs.existsSync(outboxPath) ? fs.readFileSync(outboxPath, "utf8").trim() : "";
  console.log("\n=== 推给眼镜的话 ===");
  console.log(outbox || "（一句都没推 —— 这也可能是对的）");

  const full = await get("/api/course/" + course.id);
  console.log("\n=== 入课事件 ===");
  console.log(full.classroom.events.map(e => `${e.type}:${(e.text || "").slice(0, 16)}`).join(" | "));

  // 清理
  const dataDir = path.join(__dirname, "..", "data", "teachers", "demo");
  fs.rmSync(path.join(dataDir, "courses", course.id), { recursive: true, force: true });
  fs.rmSync(path.join(dataDir, "conversations", conv.id + ".json"), { force: true });
  fs.rmSync(path.join(dataDir, "conversations", conv.id + ".jsonl"), { force: true });
  for (const f of ["lesson-card.json", "status.json", "_sync.json", "outbox.jsonl"]) {
    try { fs.unlinkSync(path.join(BRIDGE, f)); } catch (e) {}
  }
  fs.writeFileSync(path.join(BRIDGE, "events.jsonl"), "", "utf8");
  console.log("\nWATCH OK（测试数据已清理）");
})().catch(e => { console.error("WATCH FAIL:", e.message); process.exit(1); });
