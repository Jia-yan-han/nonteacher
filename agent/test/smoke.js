"use strict";
// 冒烟测试：课程库 / 待整理 / 挂靠 / 导入 / 课堂 / 事件
const fs = require("node:fs");
const path = require("node:path");
const BASE = "http://127.0.0.1:4321";

async function post(url, body) {
  const r = await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(url + " -> " + r.status + " " + JSON.stringify(d));
  return d;
}
async function get(url) {
  const r = await fetch(BASE + url);
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return r.json();
}

(async () => {
  const st0 = await get("/api/state");
  console.log("1) state: courses=", st0.courses.length, "inbox=", st0.inbox.length, "hasKey=", st0.hasKey);

  const course = await post("/api/course", { name: "三年级《认识分数》", subject: "小学数学", grade: "三年级" });
  console.log("2) course:", course.id, course.name);

  // 待整理：不挂靠的对话
  const loose = await post("/api/conversation", { title: "聊一下分数的导入", type: "prepare", courseId: null });
  console.log("3) inbox conv:", loose.id, "courseId=", loose.courseId);

  // 给它塞两句话，让分析有东西可看
  await post("/api/chat", { convId: loose.id, text: "我想上三年级《认识分数》，用苹果平均分导入" }).catch(() => {});
  const sug = await post("/api/analyze", { convId: loose.id });
  console.log("4) analyze:", JSON.stringify({ courseId: sug.courseId, name: sug.name, reason: sug.reason }));

  // 挂靠
  const linked = await post("/api/link", { convId: loose.id, courseId: course.id });
  console.log("5) linked ->", linked.courseId);

  // 导入到课堂（无密钥时走 local-fallback）
  const card = await post("/api/import", { convId: loose.id });
  console.log("6) card source=", card.source, "waitSeconds=", card.waitSeconds, "keyPoints=", JSON.stringify(card.keyPoints));

  // 推转写
  const text = fs.readFileSync(path.join(__dirname, "..", "samples", "课堂转写-认识分数.txt"), "utf8");
  const ing = await post("/api/ingest", { courseId: course.id, text });
  console.log("7) ingest:", JSON.stringify(ing.summary));

  // 课程全貌 + 计数
  const full = await get("/api/course/" + course.id);
  console.log("8) course: prepare=", full.conversations.prepare.length,
    "classroom=", full.conversations.classroom.length,
    "review=", full.conversations.review.length,
    "events=", full.classroom.events.length);
  const st = await get("/api/state");
  const row = st.courses.find(c => c.id === course.id);
  console.log("9) list row:", JSON.stringify({ name: row.name, counts: row.counts, stage: row.stage }));

  // 未挂靠的对话不允许导入
  const loose2 = await post("/api/conversation", { title: "另一段", type: "prepare", courseId: null });
  const r = await fetch(BASE + "/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ convId: loose2.id }) });
  console.log("10) import without link:", r.status, (await r.json()).error);

  // 自己清干净，不污染真实数据
  const dataDir = path.join(__dirname, "..", "data", "teachers", "demo");
  fs.rmSync(path.join(dataDir, "courses", course.id), { recursive: true, force: true });
  for (const v of [loose, loose2]) {
    fs.rmSync(path.join(dataDir, "conversations", v.id + ".json"), { force: true });
    fs.rmSync(path.join(dataDir, "conversations", v.id + ".jsonl"), { force: true });
  }

  console.log("\nSMOKE OK（测试数据已清理）");
})().catch(e => { console.error("SMOKE FAIL:", e.message); process.exit(1); });
