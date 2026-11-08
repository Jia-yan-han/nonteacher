"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..");
const DATA = process.env.AGENT_DATA ? path.resolve(process.env.AGENT_DATA) : path.join(ROOT, "data");
const TEACHER = process.env.AGENT_TEACHER || "demo";
const PORT = Number(process.env.AGENT_PORT || 4321);

/* ---------- 模型接入配置 ----------
   优先级：环境变量 > 页面里保存的 provider.json > 本地密钥文件 > 默认值。
   密钥只落在本机文件里，不进代码、不进日志。 */

const PROVIDER_FILE = () => path.join(DATA, "provider.json");

function readJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { return fallback; }
}

function readKeyFromFiles() {
  const candidates = [
    path.join(os.homedir(), ".nonteacher", "llm.key"),
    path.join(os.homedir(), ".nonteacher", "deepseek.key"),
    path.join(ROOT, ".env.local")
  ];
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      if (file.endsWith(".env.local")) {
        const m = raw.match(/^\s*(?:LLM_API_KEY|DEEPSEEK_API_KEY)\s*=\s*(.+)$/m);
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
        continue;
      }
      if (raw.trim()) return raw.trim();
    } catch (e) { /* 没有就往下走 */ }
  }
  return "";
}

function loadProvider() {
  const saved = readJsonSafe(PROVIDER_FILE(), {});
  const env = process.env;
  return {
    baseUrl: env.LLM_BASE_URL || saved.baseUrl || env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    model: env.LLM_MODEL || saved.model || env.DEEPSEEK_MODEL || "deepseek-chat",
    query: env.LLM_QUERY || saved.query || "",
    reasoningEffort: env.LLM_REASONING_EFFORT || saved.reasoningEffort || "low",
    key: env.LLM_API_KEY || saved.key || readKeyFromFiles() || "",
    savedAt: saved.savedAt || ""
  };
}

function saveProvider(patch) {
  const current = loadProvider();
  // 密钥留空表示"不改"，避免页面回填时把已有密钥覆盖成空
  const next = {
    baseUrl: String(patch.baseUrl ?? current.baseUrl).trim(),
    model: String(patch.model ?? current.model).trim(),
    query: String(patch.query ?? current.query).trim(),
    reasoningEffort: String(patch.reasoningEffort ?? current.reasoningEffort ?? "low").trim(),
    key: patch.key === undefined || patch.key === null || patch.key === "" ? current.key : String(patch.key).trim(),
    savedAt: new Date().toISOString()
  };
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(PROVIDER_FILE(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** 拼出完整的 chat completions 地址：兼容有人只填域名、有人填到 /v1、有人填全路径。 */
function chatEndpoint(provider) {
  let base = String(provider.baseUrl || "").trim().replace(/\/+$/, "");
  if (!/\/chat\/completions$/.test(base)) {
    if (/\/v\d+$/.test(base)) base += "/chat/completions";
    else base += "/v1/chat/completions";
  }
  const q = String(provider.query || "").replace(/^\?/, "");
  return q ? base + (base.includes("?") ? "&" : "?") + q : base;
}

const provider = loadProvider();

const config = {
  ROOT,
  DATA,
  TEACHER,
  PORT,
  provider,
  get key() { return loadProvider().key; },
  get baseUrl() { return loadProvider().baseUrl; },
  get model() { return loadProvider().model; },
  engine: process.env.AGENT_ENGINE || "direct"
};

function teacherDir(teacherId) {
  return path.join(DATA, "teachers", teacherId || config.TEACHER);
}
function sessionsDir(teacherId) {
  return path.join(teacherDir(teacherId), "sessions");
}
function kbDir(teacherId) {
  return path.join(teacherDir(teacherId), "kb");
}

function ensureTeacher(teacherId) {
  const id = teacherId || config.TEACHER;
  for (const dir of [teacherDir(id), sessionsDir(id), kbDir(id), path.join(teacherDir(id), "memory")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const profile = path.join(teacherDir(id), "profile.json");
  if (!fs.existsSync(profile)) {
    fs.writeFileSync(profile, JSON.stringify({
      teacherId: id, name: "演示教师", subject: "小学数学", grade: "三年级",
      preferences: {}, createdAt: new Date().toISOString()
    }, null, 2), "utf8");
  }
  return teacherDir(id);
}

module.exports = {
  config, teacherDir, sessionsDir, kbDir, ensureTeacher,
  loadProvider, saveProvider, chatEndpoint
};
