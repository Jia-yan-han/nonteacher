"use strict";
// 知识库专项：本机目录浏览 / 按路径导入 / 清单 / 预览 / AI 沉淀
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
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(url + " -> " + r.status + " " + JSON.stringify(d));
  return d;
}

(async () => {
  const roots = await get("/api/fs/list?path=");
  console.log("1) 盘符:", roots.entries.map(e => e.name).join(" "));

  const dir = await get("/api/fs/list?path=" + encodeURIComponent(path.join(__dirname, "..", "samples")));
  console.log("2) samples 目录:", dir.entries.map(e => e.name + "(" + e.type + ")").join(" "));

  const target = path.join(__dirname, "..", "samples", "课堂转写-认识分数.txt");
  const imp = await post("/api/fs/import", { path: target, category: "资料" });
  console.log("3) 导入:", JSON.stringify(imp));

  const list = await get("/api/kb/list");
  console.log("4) 清单:", list.files.map(f => `${f.name}[${f.category}/${f.source}/${f.size}B/${f.chunks}段]`).join(" | "));

  const one = list.files.find(f => f.name.includes("课堂转写"));
  const file = await get("/api/kb/file?file=" + encodeURIComponent(one.file));
  console.log("5) 预览前 40 字:", JSON.stringify(file.text.slice(0, 40)));

  // 对话沉淀：建一段对话，塞一句话，再沉淀
  const course = await post("/api/course", { name: "沉淀测试课" });
  const conv = await post("/api/conversation", { title: "聊导入", type: "prepare", courseId: course.id });
  const r = await fetch(BASE + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ convId: conv.id, text: "我想用苹果平均分导入" }) });
  await r.text().catch(() => {});
  const dis = await post("/api/distill", { convId: conv.id });
  console.log("6) 沉淀:", dis.file, "|", dis.chunks, "段");

  // 清理
  const fs = require("node:fs");
  const dataDir = path.join(__dirname, "..", "data", "teachers", "demo");
  fs.rmSync(path.join(dataDir, "courses", course.id), { recursive: true, force: true });
  fs.rmSync(path.join(dataDir, "conversations", conv.id + ".json"), { force: true });
  fs.rmSync(path.join(dataDir, "conversations", conv.id + ".jsonl"), { force: true });
  await post("/api/kb/delete", { file: imp.file });
  await post("/api/kb/delete", { file: dis.file });

  console.log("\nKB OK（测试数据已清理）");
})().catch(e => { console.error("KB FAIL:", e.message); process.exit(1); });
