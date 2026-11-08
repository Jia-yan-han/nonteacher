"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { config, teacherDir, ensureTeacher } = require("./config");

/* ---------- 基础 IO ---------- */

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}
function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + "\n", "utf8");
}
function readJsonl(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch (e) { return null; }
    }).filter(Boolean);
  } catch (e) { return []; }
}
function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* ---------- 对话（全局存放，用 courseId 表达归属） ---------- */

const convRoot = () => path.join(teacherDir(), "conversations");
const convMeta = id => path.join(convRoot(), id + ".json");
const convMsgs = id => path.join(convRoot(), id + ".jsonl");
const TYPES = ["prepare", "classroom", "review"];

function createConversation(options) {
  ensureTeacher();
  const opts = options || {};
  const id = "v-" + stamp() + "-" + Math.floor(Math.random() * 900 + 100);
  const type = TYPES.includes(opts.type) ? opts.type : "prepare";
  const meta = {
    id,
    courseId: opts.courseId || null,
    title: opts.title || (type === "review" ? "复盘对话" : type === "classroom" ? "课堂" : "备课对话"),
    type,
    createdAt: new Date().toISOString(),
    importedToClassroom: false
  };
  writeJson(convMeta(id), meta);
  fs.mkdirSync(convRoot(), { recursive: true });
  fs.writeFileSync(convMsgs(id), "", "utf8");
  return meta;
}

function getConversation(id) {
  const meta = readJson(convMeta(id), null);
  if (!meta) throw new Error("对话不存在：" + id);
  return { meta, messages: readJsonl(convMsgs(id)) };
}

function updateConversation(id, patch) {
  const meta = Object.assign(readJson(convMeta(id), {}), patch);
  writeJson(convMeta(id), meta);
  return meta;
}

function appendMessage(id, role, content, extra) {
  const row = Object.assign({ role, content, at: new Date().toISOString() }, extra || {});
  appendJsonl(convMsgs(id), row);
  return row;
}

function listConversations(options) {
  ensureTeacher();
  const opts = options || {};
  let names = [];
  try { names = fs.readdirSync(convRoot()).filter(n => n.endsWith(".json")); } catch (e) { return []; }
  const all = names.map(n => readJson(path.join(convRoot(), n), null)).filter(Boolean);
  const filtered = "courseId" in opts ? all.filter(c => (c.courseId || null) === (opts.courseId || null)) : all;
  return filtered.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/* ---------- 课程 ---------- */

const coursesRoot = () => path.join(teacherDir(), "courses");
const courseDir = id => {
  const dir = path.join(coursesRoot(), id);
  if (!fs.existsSync(dir)) throw new Error("课程不存在：" + id);
  return dir;
};

function createCourse(meta) {
  ensureTeacher();
  const id = "c-" + stamp();
  fs.mkdirSync(path.join(coursesRoot(), id, "classroom"), { recursive: true });
  const record = {
    id,
    name: meta.name || "未命名一课",
    subject: meta.subject || "",
    grade: meta.grade || "",
    createdAt: new Date().toISOString(),
    note: meta.note || ""
  };
  writeJson(path.join(coursesRoot(), id, "course.json"), record);
  return record;
}

function updateCourse(id, patch) {
  const file = path.join(courseDir(id), "course.json");
  const record = readJson(file, null);
  if (!record) throw new Error("课程不存在：" + id);
  for (const field of ["subject", "grade"]) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      if (typeof patch[field] !== "string" || patch[field].trim().length > 50) throw new Error("学科和年级须为不超过 50 字的文字");
      record[field] = patch[field].trim();
    }
  }
  writeJson(file, record);
  return record;
}

function getClassroom(courseId) {
  const dir = path.join(courseDir(courseId), "classroom");
  return {
    meta: readJson(path.join(dir, "meta.json"), { state: "idle" }),
    card: readJson(path.join(dir, "lesson-card.json"), null),
    events: readJsonl(path.join(dir, "events.jsonl")),
    transcript: readJsonl(path.join(dir, "transcript.jsonl"))
  };
}

function setClassroom(courseId, patch) {
  const dir = path.join(courseDir(courseId), "classroom");
  const meta = Object.assign(readJson(path.join(dir, "meta.json"), { state: "idle" }), patch);
  writeJson(path.join(dir, "meta.json"), meta);
  return meta;
}

function counts(courseId) {
  const convs = listConversations({ courseId });
  const classroom = getClassroom(courseId);
  const hasClass = classroom.events.length > 0 || Boolean(classroom.card) || classroom.meta.state !== "idle";
  return {
    prepare: convs.filter(c => c.type === "prepare").length,
    classroom: hasClass ? 1 : 0,
    review: convs.filter(c => c.type === "review").length,
    events: classroom.events.length
  };
}

function courseSummary(meta) {
  const c = counts(meta.id);
  let stage = "空壳";
  if (c.prepare > 0) stage = "备过课";
  if (c.classroom && getClassroom(meta.id).card) stage = "已就绪";
  if (c.events > 0) stage = "上过课";
  if (readReview(meta.id)) stage = "已复盘";
  return Object.assign({}, meta, { counts: c, stage });
}

function listCourses() {
  ensureTeacher();
  let names = [];
  try { names = fs.readdirSync(coursesRoot()); } catch (e) { return []; }
  return names.map(id => readJson(path.join(coursesRoot(), id, "course.json"), null))
    .filter(Boolean)
    .map(courseSummary)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function readReview(courseId) {
  try { return fs.readFileSync(path.join(courseDir(courseId), "review.md"), "utf8"); } catch (e) { return ""; }
}
function writeReview(courseId, md) {
  fs.writeFileSync(path.join(courseDir(courseId), "review.md"), md, "utf8");
  return md;
}

function getCourse(id) {
  const meta = readJson(path.join(courseDir(id), "course.json"), null);
  const conversations = listConversations({ courseId: id });
  return {
    meta,
    summary: courseSummary(meta),
    conversations: {
      prepare: conversations.filter(c => c.type === "prepare"),
      classroom: conversations.filter(c => c.type === "classroom"),
      review: conversations.filter(c => c.type === "review")
    },
    classroom: getClassroom(id),
    review: readReview(id)
  };
}

function saveCard(courseId, card, convId) {
  writeJson(path.join(courseDir(courseId), "classroom", "lesson-card.json"), card);
  setClassroom(courseId, { state: "ready", linkedConversation: convId || null, cardAt: new Date().toISOString() });
  if (convId) updateConversation(convId, { importedToClassroom: true, courseId });
  return card;
}
function appendEvent(courseId, ev) {
  const file = path.join(courseDir(courseId), "classroom", "events.jsonl");
  if (ev.bridgeId && readJsonl(file).some(row => row.bridgeId === ev.bridgeId)) return ev;
  appendJsonl(file, ev);
  return ev;
}
function appendTranscript(courseId, row) {
  appendJsonl(path.join(courseDir(courseId), "classroom", "transcript.jsonl"), row);
  return row;
}

/* ---------- 教师档案 ---------- */

function getProfile() {
  ensureTeacher();
  return readJson(path.join(teacherDir(), "profile.json"), {});
}
function saveProfile(patch) {
  const profile = Object.assign(getProfile(), patch);
  writeJson(path.join(teacherDir(), "profile.json"), profile);
  return profile;
}

module.exports = {
  readJson, writeJson, appendJsonl, readJsonl,
  createConversation, getConversation, updateConversation, appendMessage, listConversations,
  createCourse, updateCourse, listCourses, getCourse, courseDir, courseSummary, counts,
  getClassroom, setClassroom, saveCard, appendEvent, appendTranscript,
  readReview, writeReview, getProfile, saveProfile, config
};
