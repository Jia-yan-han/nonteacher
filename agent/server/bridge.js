"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { config } = require("./config");

/**
 * 眼镜桥（文件版）。
 *
 * 为什么不用网络：眼镜端跑在 WSL 里，电脑端服务绑在 Windows 的 127.0.0.1，
 * WSL2 是 NAT 网络，往 Windows 回连要过防火墙，教室里不可靠。
 * WSL 能直接读 /mnt/c/...，所以用共享目录做交换，稳且可复核。
 *
 *   lesson-card.json   电脑 → 眼镜：这节课怎么上
 *   events.jsonl       眼镜 → 电脑：课堂上发生了什么（只追加）
 *   status.json        眼镜 → 电脑：心跳
 */

const BRIDGE = process.env.AGENT_BRIDGE ? path.resolve(process.env.AGENT_BRIDGE) : path.join(config.ROOT, "bridge");

function ensure() {
  fs.mkdirSync(BRIDGE, { recursive: true });
  return BRIDGE;
}

const files = {
  card: () => path.join(BRIDGE, "lesson-card.json"),
  events: () => path.join(BRIDGE, "events.jsonl"),
  status: () => path.join(BRIDGE, "status.json"),
  outbox: () => path.join(BRIDGE, "outbox.jsonl"),
  sync: () => path.join(BRIDGE, "_sync.json")
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { return fallback; }
}
function writeJsonAtomic(file, value) {
  const tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

/** WSL 里能访问到的同一路径 */
function wslPath(winPath) {
  const p = winPath.replace(/\\/g, "/");
  const m = p.match(/^([A-Za-z]):\/(.*)$/);
  return m ? "/mnt/" + m[1].toLowerCase() + "/" + m[2] : p;
}

/** 把课次卡下发到桥目录 */
function dispatch(course, convId) {
  ensure();
  const card = course.classroom.card;
  if (!card) throw new Error("这堂课还没有课次卡，先从备课对话导入");

  const payload = Object.assign({}, card, {
    courseId: course.meta.id,
    sessionId: crypto.randomUUID(),
    courseName: course.meta.name,
    dispatchedAt: new Date().toISOString(),
    fromConversation: convId || card.sourceConversation || null
  });
  writeJsonAtomic(files.card(), payload);

  // 重新下发 = 重新开始计数，不把上节课的事件算进这节课
  const eventLines = countLines(files.events());
  writeJsonAtomic(files.sync(), {
    courseId: course.meta.id, sessionId: payload.sessionId,
    lines: eventLines,
    at: new Date().toISOString()
  });
  // 下发时清空上节课残留的提示，不把旧话说给新课堂
  try { fs.writeFileSync(files.outbox(), "", "utf8"); } catch (e) { /* ignore */ }

  return payload;
}

function countLines(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const lines = raw.split("\n");
    lines.pop();
    return lines.filter(l => l.trim()).length;
  } catch (e) { return 0; }
}

/** Accept a manually submitted utterance from an external dictation tool. */
function appendUtterance(courseId, text) {
  const card = readJson(files.card(), null);
  if (!card || card.courseId !== courseId) throw new Error("请先为当前课程下发课次卡");
  const value = String(text || "").trim();
  if (!value || Buffer.byteLength(value, "utf8") > 4096) throw new Error("口述文字须为 1 至 4096 字节");
  const row = { type: "utterance", text: value, courseId, sessionId: card.sessionId || card.dispatchedAt,
    source: "external-dictation", at: new Date().toISOString() };
  fs.appendFileSync(files.events(), JSON.stringify(row) + "\n", "utf8");
  return { ok: true, sessionId: row.sessionId };
}

function microphoneCommand(courseId, action) {
  const card = readJson(files.card(), null);
  if (!card || card.courseId !== courseId) throw new Error("请先为当前课程下发课次卡");
  if (!["start", "stop"].includes(action)) throw new Error("未知的麦克风操作");
  fs.appendFileSync(files.outbox(), JSON.stringify({ type: "mic." + action, courseId,
    sessionId: card.sessionId || card.dispatchedAt, at: new Date().toISOString() }) + "\n", "utf8");
}

function classCommand(courseId, action) {
  const card = readJson(files.card(), null);
  if (!card || card.courseId !== courseId) throw new Error("请先为当前课程下发课次卡");
  fs.appendFileSync(files.outbox(), JSON.stringify({type: "class." + action, courseId, sessionId: card.sessionId || card.dispatchedAt, at: new Date().toISOString()}) + "\n", "utf8");
}

/** 眼镜那边的在线状态（心跳 15 秒内算在线） */
function status() {
  ensure();
  const s = readJson(files.status(), null);
  const card = readJson(files.card(), null);
  const total = countLines(files.events());
  const synced = (readJson(files.sync(), { lines: 0 }).lines) || 0;
  const age = s && s.at ? Date.now() - new Date(s.at).getTime() : null;
  return {
    online: age !== null && age < 15000,
    lastBeatAt: s ? s.at : "",
    ageMs: age,
    device: s ? (s.device || "") : "",
    phase: s ? (s.phase || "") : "",
    microphone: s && s.microphone ? s.microphone : { state: "unknown", reason: "" },
    activeCourseId: s ? (s.courseId || "") : "",
    activeSessionId: s ? (s.sessionId || "") : "",
    dispatched: Boolean(card),
    cardCourseId: card ? (card.courseId || "") : "",
    sessionId: card ? (card.sessionId || card.dispatchedAt || "") : "",
    cardTopic: card ? (card.topic || "") : "",
    dispatchedAt: card ? (card.dispatchedAt || "") : "",
    pendingEvents: Math.max(0, total - synced),
    totalEvents: total,
    dir: BRIDGE,
    wslDir: wslPath(BRIDGE)
  };
}

/** 把眼镜新产生的事件收进这节课 */
function pull(courseId, consume) {
  ensure();
  const file = files.events();
  if (!fs.existsSync(file)) return { imported: 0, events: [] };

  const raw = fs.readFileSync(file, "utf8");
  // A writer may be halfway through a line. Do not checkpoint its bytes.
  const lines = raw.split("\n");
  lines.pop();
  const complete = lines.filter(l => l.trim());
  const state = readJson(files.sync(), { courseId, lines: 0 });

  // 换了课就从当前末尾开始，别把上节课的事件搬进来
  const start = state.courseId === courseId ? (state.lines || 0) : complete.length;

  const fresh = [];
  let next = start;
  for (let i = start; i < complete.length; i += 1) {
    let event;
    try { event = JSON.parse(complete[i]); }
    catch (e) { throw new Error(`桥事件第 ${i + 1} 行格式错误，已停止读取`); }
    // Legacy producers may omit a session ID; still reject explicit mismatches.
    if ((!event.courseId || event.courseId === courseId) &&
        (!event.sessionId || !state.sessionId || event.sessionId === state.sessionId)) {
      event.bridgeId = event.bridgeId || `${state.sessionId || courseId}:${i}`;
      if (consume) consume(event);
      fresh.push(event);
    }
    next = i + 1;
    writeJsonAtomic(files.sync(), {
      courseId, sessionId: state.sessionId || null, lines: next, at: new Date().toISOString()
    });
  }
  return { imported: fresh.length, events: fresh };
}

/** 清掉上一次性分发的课次卡（下课或换课时用） */
function clearCard() {
  ensure();
  try { fs.unlinkSync(files.card()); } catch (e) { /* 没有就算了 */ }
}

module.exports = { BRIDGE, ensure, dispatch, status, pull, clearCard, wslPath, files, appendUtterance, microphoneCommand, classCommand };
