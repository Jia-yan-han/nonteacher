"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { kbDir, teacherDir } = require("./config");
const { readJsonl } = require("./store");

/**
 * 知识库。
 * 原件原样存进 kb/<分类>/，切片后写进 kb-index.jsonl 供检索。
 * 检索用关键词（中文二元切分），可解释：老师说"你凭什么引用这段"，能直接指回原文。
 */

const INDEX_FILE = () => path.join(teacherDir(), "kb-index.jsonl");
const TEXT_EXT = new Set([".md", ".txt", ".json", ".csv", ".html", ".htm", ".js", ".ts", ".py", ".xml", ".yml", ".yaml", ".log"]);
const DOC_EXT = new Set([".pdf", ".pptx", ".docx", ".ppt", ".doc"]);

/* ---------- 工具 ---------- */

function safeName(name) {
  return String(name || "未命名").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
}

function isTextFile(file) {
  const ext = path.extname(file).toLowerCase();
  return TEXT_EXT.has(ext);
}

function readTextIfPossible(file) {
  if (!isTextFile(file)) return null;
  try {
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return null;
    return buf.toString("utf8");
  } catch (e) { return null; }
}

function chunk(text, maxChars) {
  const limit = maxChars || 240;
  const paras = String(text || "").split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean);
  const out = [];
  let buf = "";
  for (const p of paras) {
    if ((buf + p).length > limit && buf) { out.push(buf); buf = p; }
    else buf = buf ? buf + "\n" + p : p;
  }
  if (buf) out.push(buf);
  return out;
}

/** 写入原件并重建索引条目（同一份文件重传会替换旧切片）。 */
function extractFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (!DOC_EXT.has(ext)) {
    const text = readTextIfPossible(file);
    return { units: text ? [{label:"正文", text}] : [], warnings: text ? [] : ["不支持此格式或文件没有可读取的文字"] };
  }
  const script = path.join(__dirname, "../tools/extract-document.py");
  const python = process.env.NT_DOC_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(python, [script, file], {encoding:"utf8", timeout:150000, maxBuffer:12*1024*1024, windowsHide:true});
  if (result.error) return {units:[], warnings:["文档解析器不可用或超时：" + result.error.message]};
  try { return JSON.parse(result.stdout); }
  catch (_) { return {units:[], warnings:["文档解析失败，请检查本地 Python 和解析依赖"]}; }
}

function indexFile(file, rel, category, name, meta) {
  const extracted = extractFile(file);
  const at = new Date().toISOString();
  const rows = extracted.units.flatMap(unit => chunk(unit.text).map((text, i) => ({
    id: `${rel}#${unit.label}#${i}`, file: rel, category, label: unit.label, index:i, text, at
  })));
  const kept = readJsonl(INDEX_FILE()).filter(row => row.file !== rel);
  fs.writeFileSync(INDEX_FILE(), kept.concat(rows).map(r => JSON.stringify(r)).join("\n") + (kept.length + rows.length ? "\n" : ""), "utf8");
  const manifestFile = path.join(teacherDir(), "kb-manifest.jsonl");
  const prev = readJsonl(manifestFile).filter(r => r.file !== rel);
  const entry = { file:rel, category, name, size:fs.statSync(file).size, addedAt:at,
    source:(meta && meta.source) || "paste", from:(meta && meta.from) || "", readable:rows.length > 0,
    chunks:rows.length, warnings:extracted.warnings || [] };
  prev.push(entry);
  fs.writeFileSync(manifestFile, prev.map(r => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return {file:rel, chunks:rows.length, readable:entry.readable, warnings:entry.warnings};
}

function storeFile(category, name, buffer, meta) {
  const dir = path.join(kbDir(), safeName(category || "未分类"));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, safeName(name));
  fs.writeFileSync(file, buffer);

  const rel = safeName(category || "未分类") + "/" + safeName(name);
  return indexFile(file, rel, safeName(category || "未分类"), safeName(name), meta);
}

/* ---------- 对外 ---------- */

/** 粘贴文本入库 */
function ingest(options) {
  return storeFile(options.category || "未分类", options.name || "未命名.md", String(options.content || ""), { source: "paste" });
}

/** 从内存缓冲区存一份（浏览器上传走这条） */
function importFromBuffer(name, buffer, category) {
  return storeFile(category || "资料", name, buffer, { source: "local-file", from: "浏览器选择" });
}

/** 从本机路径复制一份原件进来 */
function importFromPath(srcPath, category, name) {
  const src = path.resolve(srcPath);
  if (!fs.existsSync(src)) throw new Error("文件不存在：" + src);
  const stat = fs.statSync(src);
  if (stat.isDirectory()) throw new Error("这是一个文件夹，请选具体文件");
  const buffer = fs.readFileSync(src);
  return storeFile(category || "资料", name || path.basename(src), buffer, { source: "local-file", from: src });
}

/** AI 生成的文档入库 */
function addGenerated(name, content, category, note) {
  return storeFile(category || "讨论沉淀", name, String(content || ""), { source: "generated", from: note || "" });
}

/** 文件清单（带元信息）。没有清单条目的旧文件也会被扫出来，不丢。 */
function listFiles() {
  const manifest = readJsonl(path.join(teacherDir(), "kb-manifest.jsonl"));
  const known = new Map(manifest.map(r => [r.file, r]));
  const found = [];
  (function walk(dir, prefix) {
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const it of items) {
      const rel = prefix ? prefix + "/" + it.name : it.name;
      if (it.isDirectory()) walk(path.join(dir, it.name), rel);
      else found.push(rel);
    }
  })(kbDir(), "");

  const rows = [];
  for (const rel of found) {
    if (known.has(rel)) { rows.push(known.get(rel)); continue; }
    let size = 0, at = "";
    try { const st = fs.statSync(path.join(kbDir(), rel)); size = st.size; at = st.mtime.toISOString(); } catch (e) { /* ignore */ }
    const parts = rel.split("/");
    rows.push({
      file: rel,
      category: parts.length > 1 ? parts[0] : "未分类",
      name: parts[parts.length - 1],
      size, addedAt: at,
      source: "unknown", from: "",
      readable: isTextFile(path.join(kbDir(), rel)),
      chunks: readJsonl(INDEX_FILE()).filter(r => r.file === rel).length
    });
  }
  return rows.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
}

function resolveInKb(rel) {
  const file = path.join(kbDir(), String(rel || "").split("/").join(path.sep));
  if (!file.startsWith(kbDir())) throw new Error("路径越界");
  return file;
}

function readFile(rel) {
  const file = resolveInKb(rel);
  if (!fs.existsSync(file)) throw new Error("文件不存在");
  const rows = readJsonl(INDEX_FILE()).filter(r => r.file === rel);
  const text = DOC_EXT.has(path.extname(file).toLowerCase()) ? rows.map(r => `[${r.label || "正文"}]\n${r.text}`).join("\n\n") : readTextIfPossible(file);
  if (!text) throw new Error("未提取到可预览的文字，请查看文件解析提示");
  return text;
}

function reindex(rel) {
  const file = resolveInKb(rel);
  if (!fs.existsSync(file)) throw new Error("文件不存在");
  const meta = readJsonl(path.join(teacherDir(), "kb-manifest.jsonl")).find(r => r.file === rel) || {};
  return indexFile(file, rel, meta.category || rel.split("/")[0], meta.name || path.basename(file), meta);
}

function removeFile(rel) {
  const file = resolveInKb(rel);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const strip = rows => rows.filter(r => r.file !== rel);
  const idx = INDEX_FILE();
  fs.writeFileSync(idx, strip(readJsonl(idx)).map(r => JSON.stringify(r)).join("\n") + "\n", "utf8");
  const mf = path.join(teacherDir(), "kb-manifest.jsonl");
  fs.writeFileSync(mf, strip(readJsonl(mf)).map(r => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

/* ---------- 检索 ---------- */

const STOP = new Set("的了是和就在有我你他她它这那也要会不个上下来去到说很都还只把被让给对于与或".split(""));

function tokens(text) {
  const s = String(text || "");
  const out = new Set();
  (s.match(/[a-zA-Z][a-zA-Z0-9_]{1,}/g) || []).forEach(w => out.add(w.toLowerCase()));
  const han = s.replace(/[^\u4e00-\u9fa5]/g, "");
  for (let i = 0; i < han.length - 1; i += 1) {
    const bi = han.slice(i, i + 2);
    if (!STOP.has(bi[0]) && !STOP.has(bi[1])) out.add(bi);
  }
  return out;
}

function search(query, limit) {
  const q = tokens(query);
  if (!q.size) return [];
  const rows = readJsonl(INDEX_FILE());
  const scored = rows.map(row => {
    const t = tokens(row.text);
    let hit = 0;
    for (const tk of q) if (t.has(tk)) hit += 1;
    return { row, score: hit / q.size };
  }).filter(x => x.score > 0.15);
  scored.sort((a, b) => b.score - a.score || String(b.row.at).localeCompare(String(a.row.at)));
  if (/课件|文档|资料|材料|上传|文件/.test(String(query))) {
    const files = listFiles().filter(f => f.readable);
    const named = files.find(f => String(query).includes(f.name) || String(query).includes(f.name.replace(/\.[^.]+$/, "")));
    const selected = named || files[0];
    if (selected) {
      const additional = rows.filter(r => r.file === selected.file).slice(0, limit || 5);
      for (const row of additional.reverse()) if (!scored.some(x => x.row === row)) scored.unshift({row, score:0});
    }
  }
  return scored.slice(0, limit || 5).map(x => ({
    text: x.row.text, file: x.row.file, label: x.row.label || "", category: x.row.category, score: Number(x.score.toFixed(2))
  }));
}

function documentContext(query) {
  if (!/课件|文档|资料|材料|上传|文件/.test(String(query))) return null;
  const files = listFiles().filter(f => f.readable);
  const selected = files.find(f => String(query).includes(f.name) || String(query).includes(f.name.replace(/\.[^.]+$/, ""))) || files[0];
  if (!selected) return null;
  const rows = readJsonl(INDEX_FILE()).filter(r => r.file === selected.file);
  let length = 0, truncated = false;
  const parts = [];
  for (const row of rows) {
    const remaining = 12000 - length;
    if (remaining <= 0) { truncated = true; break; }
    const part = String(row.text).slice(0, remaining);
    parts.push(`[${row.label || "正文"}] ${part}`);
    length += part.length;
    if (part.length < row.text.length) { truncated = true; break; }
  }
  return {file:selected.file, text:parts.join("\n\n"), warnings:selected.warnings || [], truncated};
}

/* ---------- 本机目录浏览（服务端跑在本机，所以能列真实路径） ---------- */

function roots() {
  if (process.platform !== "win32") return ["/"];
  const drives = [];
  for (let i = 67; i <= 90; i += 1) {
    const d = String.fromCharCode(i) + ":\\";
    try { fs.accessSync(d); drives.push(d); } catch (e) { /* 没有这个盘 */ }
  }
  return drives;
}

function listDir(target) {
  const dir = target ? path.resolve(target) : "";
  if (!dir) return { path: "", parent: null, entries: roots().map(r => ({ name: r, path: r, type: "drive" })) };
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) throw new Error("不是文件夹");
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { throw new Error("没有权限读这个目录"); }
  const entries = names
    .filter(e => !e.name.startsWith("."))
    .map(e => {
      const full = path.join(dir, e.name);
      let size = 0;
      try { size = e.isDirectory() ? 0 : fs.statSync(full).size; } catch (x) { size = 0; }
      return { name: e.name, path: full, type: e.isDirectory() ? "dir" : "file", size };
    })
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? "" : parent, entries };
}
/* ---------- 启动清理：丢掉指向已不存在文件的索引行 ---------- */
function prune() {
  const alive = rows => rows.filter(r => { try { return fs.existsSync(resolveInKb(r.file)); } catch (e) { return false; } });
  const idx = INDEX_FILE();
  fs.writeFileSync(idx, alive(readJsonl(idx)).map(r => JSON.stringify(r)).join("\n") + "\n", "utf8");
  const mf = path.join(teacherDir(), "kb-manifest.jsonl");
  fs.writeFileSync(mf, alive(readJsonl(mf)).map(r => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

module.exports = {
  ingest, importFromPath, importFromBuffer, addGenerated,
  listFiles, readFile, removeFile, reindex, prune,
  search, documentContext, chunk, roots, listDir
};
