"use strict";
// 真实对话端到端：建课 → 建对话 → 发一句话 → 收流式回复
const BASE = "http://127.0.0.1:4321";
const fs = require("node:fs");
const path = require("node:path");

async function post(url, body) {
  const r = await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(url + " -> " + r.status + " " + JSON.stringify(d));
  return d;
}

(async () => {
  const course = await post("/api/course", { name: "端到端测试课", subject: "小学数学", grade: "三年级" });
  const conv = await post("/api/conversation", { title: "先聊导入", type: "prepare", courseId: course.id });

  const t0 = Date.now();
  const res = await fetch(BASE + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ convId: conv.id, text: "我想上一节三年级《认识分数》，四十分钟，用苹果平均分导入。" })
  });
  if (!res.ok) throw new Error("chat " + res.status + " " + (await res.text()).slice(0, 200));

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "", firstAt = 0, n = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      const ch = JSON.parse(payload);
      if (ch.type === "delta") { if (!firstAt) firstAt = Date.now() - t0; out += ch.text; n += 1; }
      if (ch.type === "error") { console.log("ERROR:", ch.message); }
    }
  }

  console.log("首字延迟:", firstAt, "ms | 总耗时:", Date.now() - t0, "ms | 分片:", n);
  console.log("含 <think>:", /<think|<\/think/i.test(out));
  console.log("---- 回复 ----");
  console.log(out.slice(0, 600));

  // 清理
  const dataDir = path.join(__dirname, "..", "data", "teachers", "demo");
  fs.rmSync(path.join(dataDir, "courses", course.id), { recursive: true, force: true });
  fs.rmSync(path.join(dataDir, "conversations", conv.id + ".json"), { force: true });
  fs.rmSync(path.join(dataDir, "conversations", conv.id + ".jsonl"), { force: true });
  console.log("\nE2E OK（测试数据已清理）");
})().catch(e => { console.error("E2E FAIL:", e.message); process.exit(1); });
