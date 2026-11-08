"use strict";
const fs = require("node:fs");
const path = require("node:path");
const store = require("./store");
const engine = require("./engine");
const bridge = require("./bridge");

/**
 * 旁听者（watcher）。
 *
 * 不是对话。老师一直在说，它一直在听，绝大多数时候什么都不输出。
 * 每一轮它只做两件事，而且两件都可以是"不做"：
 *   1. 往观察笔记里落一条事实（页码、活动、时长、学生的反应）
 *   2. 判断此刻开口是否值得 —— 值得才往眼镜推一句
 *
 * 三个硬约束，防止它变成话痨：
 *   · 只在有新输入时才调模型（没说话就不花钱）
 *   · 两次判断之间至少隔 cooldownMs
 *   · 一节课最多推 maxPushes 条
 */

const STATE = new Map();
const TICK_MS = 2000;

const JUDGE_SYSTEM = `你在教室后排旁听。你不和任何人对话，也不回答问题。
你收到的是一小段刚发生的话，以及这堂课的计划。
语音转写没有可靠说话人标识时，只能记为课堂中听到的话，不得推断学生回答、课堂反应或教师情绪；不能凭空表扬或声称某种教学效果。

只做两件事，两件都可以什么都不做：
1. note：这段里有没有值得记下来的事实？有就写一句（页码、在做什么活动、给了多久、学生说了什么）。没有就 null。
2. speak：给老师简短、善意、及时的支持，可以是有依据的肯定、环节提示词或可执行建议；缺乏依据时返回 null，不编造学生反应。

什么时候该写 speak：
- 他问完一个问题停了很久没人应
- 同一个问题重复了第三遍
- 他给的时长和刚才说的对不上，正在按错的走
- 他讲到某个点，而课前卡里标了那是难点

什么时候不该写：
- 没有具体依据，或提醒与眼前课堂无关
- 刚才已经推过类似的话
- 你不确定他是否需要帮忙

输出严格 JSON，不要任何解释文字：
{"note": "一句话或 null", "speak": "一句话或 null", "why": "为什么这么判断，一句话"}

speak 不超过 18 个字，写给他自己看，不是命令句。`;

function notesFile(courseId) {
  return path.join(store.courseDir(courseId), "notes.md");
}
function outboxFile() {
  return path.join(bridge.BRIDGE, "outbox.jsonl");
}
function queueFile(courseId) {
  return path.join(store.courseDir(courseId), "classroom", "watcher-queue.json");
}
function saveQueue(courseId, s) {
  const file = queueFile(courseId);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ sessionId: s.sessionId, pending: s.pending }), "utf8");
  fs.renameSync(tmp, file);
}

function readNotes(courseId, limit) {
  try {
    const raw = fs.readFileSync(notesFile(courseId), "utf8");
    return raw.split("\n").filter(l => l.trim().startsWith("-")).slice(-(limit || 8));
  } catch (e) { return []; }
}

// Only feed observations from this session back to the model. notes.md is a
// course-wide display history and may include earlier runs of the same lesson.
function sessionNotes(courseId, sessionId, limit) {
  const events = store.getClassroom(courseId).events;
  return events.filter(e => e.type === "note" && e.source === "agent" && e.sessionId === sessionId && e.text)
    .slice(-(limit || 5)).map(e => String(e.text));
}

function stateOf(courseId) {
  if (!STATE.has(courseId)) {
    STATE.set(courseId, {
      running: false, busy: false, cooldownMs: 12000, maxPushes: 20,
      pushed: [], pending: [], lastCallAt: 0, judged: 0, errors: 0,
      lastWhy: "", lastError: "", timer: null, sessionId: null, generation: 0, ending: false,
      recent: [], triggeredQuestions: []
    });
  }
  return STATE.get(courseId);
}

function start(courseId) {
  const s = stateOf(courseId);
  if (s.running) return status(courseId);
  const card = store.readJson(bridge.files.card(), null);
  if (!card || card.courseId !== courseId) throw new Error("请先为当前课程下发课次卡");
  const saved = store.readJson(queueFile(courseId), {});
  const sessionId = card.sessionId || card.dispatchedAt;
  if (s.sessionId !== sessionId) {
    s.sessionId = sessionId;
    s.pending = saved.sessionId === sessionId && Array.isArray(saved.pending) ? saved.pending : [];
    s.pushed = [];
    s.recent = [];
    s.triggeredQuestions = [];
  }
  s.running = true;
  s.generation += 1;
  s.ending = false;
  s.lastCallAt = 0;
  s.lastError = "";
  s.timer = setInterval(() => { tick(courseId); }, TICK_MS);
  return status(courseId);
}

function stop(courseId) {
  const s = stateOf(courseId);
  s.running = false;
  s.generation += 1;
  if (s.timer) { clearInterval(s.timer); s.timer = null; }
  return status(courseId);
}

function status(courseId) {
  const s = stateOf(courseId);
  return {
    running: s.running,
    judged: s.judged,
    pushed: s.pushed.length,
    maxPushes: s.maxPushes,
    pending: s.pending.length,
    lastWhy: s.lastWhy,
    lastError: s.lastError,
    notes: readNotes(courseId, 6)
  };
}

function canSpeak(s) {
  if (s.pushed.length >= s.maxPushes) return false;
  return true;
}

const CN = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cn2num(t) {
  if (/^\d+$/.test(t)) return Number(t);
  if (t === "十") return 10;
  if (t.includes("十")) { const [a, b] = t.split("十"); return (a ? CN[a] : 1) * 10 + (b ? CN[b] : 0); }
  return CN[t];
}
const ASK = /[?？]|吗|呢|什么|为什么|怎么|几|多少|谁|哪/;

/**
 * 硬触发：这些情况不需要模型点头，规则先认定"该开口"，模型只负责写那句话。
 * 为什么：把"何时说话"交给模型，它会过于保守——宁可不说。而课上最需要的是不漏。
 */
function detectTrigger(batch) {
  const key = t => String(t || "").replace(/[^\u4e00-\u9fa5]/g, "").slice(0, 14);
  const asks = batch.filter(b => ASK.test(b.text) && !/是不是|对不对|好不好|行不行|可以吗|对吧/.test(b.text));
  const counts = {};
  asks.forEach(b => { const k = key(b.text); if (k) counts[k] = (counts[k] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 3) {
    const sample = asks.find(b => key(b.text) === top[0]);
    return { kind: "repeat", detail: `同一个问题问到第 ${top[1]} 遍`, question: sample ? sample.text : "" };
  }

  for (const b of batch) {
    const m = b.text.match(/(\d+|[一二两三四五六七八九十]+)\s*分钟/);
    if (!m) continue;
    const n = cn2num(m[1]);
    if (n >= 20 && /改成|改为|调整|变成/.test(b.text)) {
      return { kind: "duration", detail: `活动时长改成了 ${n} 分钟`, question: b.text };
    }
  }
  return null;
}

async function tick(courseId) {
  const s = stateOf(courseId);
  if (!s.running || s.busy) return;

  s.busy = true;
  const generation = s.generation;
  try {
    // 1. 把眼镜那边新产生的内容收进来（顺便入课）
    const cardBefore = store.readJson(bridge.files.card(), null);
    if (!cardBefore || cardBefore.courseId !== courseId || (cardBefore.sessionId || cardBefore.dispatchedAt) !== s.sessionId) {
      s.lastError = "当前课次已切换，请重新启动旁听";
      stop(courseId);
      return;
    }
    const collect = ev => {
      store.appendEvent(courseId, Object.assign({}, ev, { source: ev.source || "glasses" }));
      if (ev.type === "class_started") store.setClassroom(courseId, { state: "live", stateAt: new Date().toISOString() });
      if (ev.type === "class_ended") {
        store.setClassroom(courseId, { state: "ended", stateAt: new Date().toISOString() });
        s.ending = true;
      }
      if (ev.type === "utterance" && ev.text && !s.pending.some(item => item.bridgeId === ev.bridgeId)) {
        s.pending.push(ev);
        saveQueue(courseId, s);
      }
    };
    bridge.pull(courseId, collect);
    if (!s.pending.length) { if (s.ending) stop(courseId); return; }

    // 2. 冷却中就先攒着，攒够了再一次性看
    const now = Date.now();
    if (s.lastCallAt && now - s.lastCallAt < s.cooldownMs) return;

    const batch = s.pending.slice(0, 12);
    s.lastCallAt = now;

    const course = store.getCourse(courseId);
    const card = course.classroom.card || {};
    const payload = {
      lesson: {
        topic: card.topic || course.meta.name,
        keyPoints: card.keyPoints || [],
        difficulties: card.focusWords || [],
        stages: card.stages || []
      },
      said: batch.map(b => b.text),
      notesSoFar: sessionNotes(courseId, s.sessionId, 5),
      alreadySaid: s.pushed.slice(-4)
    };

    s.judged += 1;
    const acrossBatches = detectTrigger([...s.recent, ...batch]);
    let trigger = detectTrigger(batch) || (acrossBatches && acrossBatches.kind === "repeat" ? acrossBatches : null);
    if (trigger && trigger.kind === "repeat" && s.triggeredQuestions.includes(trigger.question)) trigger = null;
    const raw = await engine.complete({
      system: trigger
        ? JUDGE_SYSTEM + `\n\n【硬触发】已确认：${trigger.detail}。\n这一次 speak 字段必须给出一句话（不能是 null）；note 照常判断。仍然只输出 JSON，不要任何额外文字。`
        : JUDGE_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
      maxTokens: 400,
      temperature: 0.3
    });
    const cardAfter = store.readJson(bridge.files.card(), null);
    if (!s.running || generation !== s.generation || !cardAfter || (cardAfter.sessionId || cardAfter.dispatchedAt) !== s.sessionId) return;
    // New classroom input may have arrived while the model was responding.
    // Keep its history, but never show an older suggestion as the latest one.
    bridge.pull(courseId, collect);
    const superseded = s.pending.length > batch.length;

    let out = null;
    try {
      out = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    } catch (e) {
      s.lastError = "模型返回的不是 JSON：" + String(raw).slice(0, 120);
      return;
    }

    s.lastWhy = out.why || "";
    const at = new Date().toISOString();

    if (out.note && String(out.note) !== "null") {
      fs.appendFileSync(notesFile(courseId), `- ${out.note}\n`, "utf8");
      store.appendEvent(courseId, { t: batch[batch.length - 1].t, type: "note", text: out.note, source: "agent", sessionId: s.sessionId, at });
    }

    const fallback = trigger && trigger.kind === "repeat" ? "可以换一种方式提问" : trigger ? "核对活动时间与计划" : "";
    const suggestion = out.speak && String(out.speak) !== "null" ? out.speak : fallback;
    if (!s.ending && !superseded && suggestion && canSpeak(s)) {
      const chars = Array.from(String(suggestion));
      const text = chars.length > 24 ? chars.slice(0, 23).join("") + "…" : chars.join("");
      fs.appendFileSync(outboxFile(), JSON.stringify({ type: "speak", text, at, courseId, sessionId: s.sessionId, why: out.why || "", trigger: trigger ? trigger.kind : "model" }) + "\n", "utf8");
      s.pushed.push(text);
      if (trigger && trigger.kind === "repeat") s.triggeredQuestions.push(trigger.question);
      store.appendEvent(courseId, { t: batch[batch.length - 1].t, type: "advice", text, source: "agent", sessionId: s.sessionId, at });
    } else if (!s.ending && !superseded && trigger && canSpeak(s)) {
      s.lastError = `规则判定该开口（${trigger.detail}），但模型没给话术`;
    }
    s.pending.splice(0, batch.length);
    s.recent = [...s.recent, ...batch].slice(-30);
    saveQueue(courseId, s);
    if (s.ending && !s.pending.length) stop(courseId);
  } catch (e) {
    s.errors += 1;
    s.lastError = String((e && e.message) || e);
  } finally {
    s.busy = false;
  }
}

function readOutbox() {
  try {
    return fs.readFileSync(outboxFile(), "utf8").split("\n").filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch (e) { return null; }
    }).filter(Boolean);
  } catch (e) { return []; }
}

module.exports = { start, stop, status, tick, readNotes, readOutbox, outboxFile };
