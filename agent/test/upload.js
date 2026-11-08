"use strict";
// 上传接口专项（对应界面上的「从电脑导入」）
const fs = require("node:fs");
const path = require("node:path");
const BASE = "http://127.0.0.1:4321";

async function post(url, body) {
  const r = await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(url + " -> " + r.status + " " + JSON.stringify(d));
  return d;
}
async function get(url) { const r = await fetch(BASE + url); return r.json(); }

(async () => {
  const src = path.join(__dirname, "..", "samples", "课堂转写-认识分数.txt");
  const data = fs.readFileSync(src).toString("base64");
  const up = await post("/api/kb/upload", { name: "课堂转写-认识分数.txt", data, category: "资料" });
  console.log("1) upload:", JSON.stringify(up));

  const list = await get("/api/kb/list");
  console.log("2) list:", list.files.map(f => `${f.name}[${f.category}/${f.source}/${f.size}B/${f.chunks}段]`).join(" | "));

  const f = list.files.find(x => x.name === "课堂转写-认识分数.txt");
  const doc = await get("/api/kb/file?file=" + encodeURIComponent(f.file));
  console.log("3) preview:", JSON.stringify(doc.text.slice(0, 30)));
  console.log("4) search:", JSON.stringify((await get("/api/kb/search?q=" + encodeURIComponent("平均分给两个人"))).hits.map(h => h.file)));

  await post("/api/kb/delete", { file: f.file });
  console.log("5) deleted ->", JSON.stringify(await get("/api/kb/list")));
  console.log("\nUPLOAD OK");
})().catch(e => { console.error("UPLOAD FAIL:", e.message); process.exit(1); });
