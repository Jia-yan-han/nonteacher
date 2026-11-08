"use strict";
const os = require("@irisview/osx/os");
const ui = require("@irisview/osx/fusionui");
const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("./config");
const { Classroom, number } = require("./classroom");
const { PersonalMemory } = require("./personal");
const { createScene } = require("./scene");
const inputs = require("./inputs");
const bridge = require("./bridge");
const { VoiceActivityDetector, transcribe } = require("./asr");

const app = { window: null, scene: null, engine: null, memory: null, config: null,
  running: false, frame: null, lastRender: 0, record: false, error: "", view: "",
  card: null, classStartedAt: 0, lastBeat: 0,
  remoteAdvice: null, outboxSeen: 0, voice: null, voiceEpoch: 0, voiceBusy: false, voiceQueue: [],
  micState: "idle", micReason: "", micWanted: false, micRestart: false, lastInputAt: 0 };

function saveReview() {
  if (!app.record) return;
  if (!app.config.dataDir) throw new Error("没有可用的私有数据目录");
  const file = path.join(app.config.dataDir, "classroom-review.jsonl");
  fs.appendFileSync(file, JSON.stringify({ recordedAt: new Date().toISOString(), events: app.engine.events }) + "\n", { mode: 0o600 });
}
function endClass() {
  app.voiceEpoch += 1;
  app.micWanted = false;
  app.voiceQueue = [];
  if (app.voice && app.voice.session) app.voice.session.cancel();
  app.engine.end();
  try { saveReview(); } catch (e) { app.error = "复盘保存失败：" + e.message; }
}
function budgetDraft(text) {
  const items = [];
  const re = /([^\s，,、；;\d一二两三四五六七八九十分钟]{1,8})\s*(\d+|[一二两三四五六七八九十]+)\s*(?:分钟)?/g;
  let match;
  while ((match = re.exec(text))) items.push({ name: match[1], minutes: number(match[2]) });
  return items;
}
function matchesBudgetConfirmation(text, stages) {
  if (!stages || !/就按|按这个|确认/.test(text)) return false;
  return stages.every(s => {
    const i = text.indexOf(s.name);
    if (i < 0) return false;
    const m = text.slice(i + s.name.length).match(/^\s*(\d+|[一二两三四五六七八九十]+)\s*分钟/);
    return m && number(m[1]) === s.minutes;
  });
}
function recordUtterance(text, source) {
  if (!bridge.appendEvent({
    type: "utterance",
    t: Math.round(((Date.now() - (app.classStartedAt || Date.now())) / 1000) * 10) / 10,
    text,
    courseId: app.card ? app.card.courseId : "",
    sessionId: app.card ? app.card.sessionId : null,
    source: source || "glasses"
  })) app.error = "课堂文字未能写入电脑端，请检查连接";
}
function enqueueVoice(pcm) {
  if (!pcm || !pcm.length) return;
  if (app.voiceQueue.length >= 3) { app.error = "语音队列已满，请稍后重说"; return; }
  app.voiceQueue.push({ pcm, epoch: app.voiceEpoch, card: app.card && app.card.sessionId, started: Date.now() });
  processVoiceQueue();
}
function processVoiceQueue() {
  if (app.voiceBusy || !app.voiceQueue.length) return;
  const job = app.voiceQueue.shift();
  app.voiceBusy = true;
  transcribe({asr:{local:true}}, job.pcm).then(result => {
    if (job.epoch !== app.voiceEpoch || job.card !== (app.card && app.card.sessionId)) return;
    if (Date.now() - job.started > 20000) { app.error = "语音结果已过期，请重说"; return; }
    if (!result.ok) { app.error = "本地语音识别不可用：" + result.reason; return; }
    if (result.text) handleText(result.text, "voice");
  }).catch(() => { app.error = "本地语音识别失败"; }).finally(() => { app.voiceBusy = false; processVoiceQueue(); });
}
function handleText(raw, source) {
  const text = String(raw || "").trim();
  if (!text) return;
  app.lastInputAt = Date.now();
  // A newer explicit text instruction supersedes voice recognition already in flight.
  if (source !== "voice" && app.engine && app.engine.phase === "class") {
    app.voiceEpoch += 1;
    app.voiceQueue = [];
  }
  app.error = "";
  app.view = "";
  try {
    if (text === "/录音") {
      app.micWanted = true;
      if (!app.voice.start()) app.error = "麦克风不可用：" + (app.voice.reason || "未就绪");
      return;
    }
    if (text === "/停止录音") { app.micWanted = false; app.voice.stop(); return; }
    if (text === "/结束" && app.engine.phase === "class") { endClass(); return; }
    if (text === "/开始" && app.engine.phase !== "class") {
      if (app.engine.phase === "review") {
        app.engine.reset();
        if (app.memory) app.engine.preferences = app.memory.values();
      }
      app.engine.start(); app.classStartedAt = Date.now(); return;
    }
    if (app.engine.phase === "class") {
      // Text is an explicit simulation channel, never an implicit classroom request to the agent.
      app.engine.input(text, source || "模拟文本");
      // 把老师原话交给电脑端的旁听者（它来决定要不要说话）
      recordUtterance(text, source);
      return;
    }
    // 老师说的第一句话就是上课。真实课堂里他不会在眼镜上按压键或打字。
    if (!text.startsWith("/") && !app.card) {
      app.engine.start();
      app.classStartedAt = Date.now();
      app.engine.input(text, source || "模拟文本");
      recordUtterance(text, source);
      return;
    }
    if (text === "/记录 开") { app.record = true; app.engine.note = "本次复盘事件保存已开启"; return; }
    if (text === "/记录 关") { app.record = false; app.engine.note = "本次复盘事件保存已关闭"; return; }
    if (text === "/复盘") {
      if (!app.config.dataDir) throw new Error("没有可用的私有数据目录");
      const file = path.join(app.config.dataDir, "classroom-review.jsonl");
      if (!fs.existsSync(file)) { app.engine.note = "没有已保存的复盘"; return; }
      const records = fs.readFileSync(file, "utf8").trim().split("\n");
      const latest = JSON.parse(records[records.length - 1]);
      const counts = {};
      latest.events.forEach(event => { counts[event.type] = (counts[event.type] || 0) + 1; });
      app.view = "最近一次：" + latest.events.length + " 个事件";
      app.engine.note = "计时 " + (counts.countdown_started || 0) + " 次 · 建议 " + (counts.advice || 0) + " 次";
      return;
    }
    if (text === "/删除复盘") {
      if (!app.config.dataDir) throw new Error("没有可用的私有数据目录");
      const file = path.join(app.config.dataDir, "classroom-review.jsonl");
      if (fs.existsSync(file)) fs.unlinkSync(file);
      app.engine.note = "已删除本地复盘事件"; return;
    }
    if (text === "/记忆") {
      app.view = app.memory ? JSON.stringify(app.memory.values()) : "个人数据目录不可用"; return;
    }
    if (text === "/清除记忆") {
      if (!app.memory) throw new Error("个人数据目录不可用");
      app.memory.clear(); app.engine.preferences = {}; app.engine.note = "个人偏好已清除"; return;
    }
    if (text === "/取消") {
      if (app.memory) app.memory.pending = null;
      app.engine.budgetDraft = null; app.engine.note = "已取消待确认内容"; return;
    }
    if (text === "/确认" || text === "确认") {
      if (app.memory && app.memory.pending) {
        app.memory.confirm(); app.engine.preferences = app.memory.values(); app.engine.note = "个人偏好已保存";
      } else if (!app.engine.confirmBudget()) app.engine.note = "没有待确认内容";
      return;
    }
    if (matchesBudgetConfirmation(text, app.engine.budgetDraft)) {
      app.engine.confirmBudget(); return;
    }
    if (text.startsWith("/预算 ")) {
      const stages = budgetDraft(text.slice(4));
      app.engine.draftBudget(stages);
      app.view = stages.map(s => s.name + " " + s.minutes + "分钟").join("、");
      return;
    }
    if (app.memory && app.memory.propose(text)) {
      app.view = "拟保存：" + Object.entries(app.memory.pending).map(([k, v]) => ({ concise: "简短", maxOptions: "每次一条", frequency: "减少提醒" }[k] || k)).join("、");
      app.engine.note = "输入 /确认 保存，或 /取消";
      return;
    }
    app.engine.note = "课前可设置偏好、预算或直接开始";
  } catch (e) { app.error = e.message; }
}
function handleNavigation(action) {
  if (action === "activate" && app.engine.phase !== "class") handleText("/开始");
  else if (action === "back" && app.engine.phase === "class") endClass();
}
function clock(seconds) {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
function render() {
  if (!app.scene) return;
  const e = app.engine;
  e.tick();
  const lines = [];
  let header = "不新手老师 · 课前";
  let status = "本地规则 · 未配置语音识别";
  let hint = "确认键开始 · 文本可设置偏好";
  if (e.phase === "class") {
    header = "不新手老师 · 课堂";
    status = app.voiceBusy ? "本地语音识别中" : app.voice && app.voice.active ? "麦克风采集中 · 本地识别" : "文本输入 · 可输入 /录音";
    // 电脑端推过来的话优先显示，它自己会过期
    lines.push(e.stage ? "当前：" + e.stage.name : "当前环节：等待开始");
    lines.push("课堂已用 " + clock(Math.max(0, Math.floor((Date.now() - app.classStartedAt) / 1000))));
    lines.push(e.remaining() !== null ? e.countdown.label + " 剩余 " + clock(e.remaining()) : "活动计时：未开始");
    if (e.stageCandidate || (!e.stage && e.stageMatchStatus)) lines.push(e.stageMatchStatus);
    else if (e.stage) lines.push("环节已用 " + clock(Math.floor((Date.now() - e.stageStartedAt) / 1000)) + " / " + e.stage.minutes + "分钟");
    if (e.viewMode === "timer") {
      lines.length = 0;
      lines.push(e.remaining() !== null ? e.countdown.label + " 剩余 " + clock(e.remaining()) : "活动计时：未开始");
      lines.push("课堂已用 " + clock(Math.max(0, Math.floor((Date.now() - app.classStartedAt) / 1000))));
      lines.push("计时重点显示");
    }
    hint = e.pendingRemaining !== null ? "确认调整 / 取消调整" : e.viewMode === "timer" ? "输入：恢复显示" : e.stageCandidate ? "说或输入：确认环节" : "语音自动处理 · /结束 下课";
  } else if (e.phase === "review") {
    header = "不新手老师 · 课后";
    lines.push("本次记录 " + e.events.length + " 个事件");
    lines.push(app.record ? "已选择保存结构化事件" : "未开启复盘保存");
    if (app.view) lines.push(app.view);
    hint = "确认键开始下一次 · 可输入课后反馈";
  } else {
    if (app.card) {
      status = app.voice && app.voice.active ? "麦克风采集中 · 本地识别" : "已收到本课卡 · 输入 /录音";
      lines.push("本课：" + (app.card.topic || app.card.courseName || ""));
      const keys = (app.card.keyPoints || []).slice(0, 2).join("、");
      if (keys) lines.push("重点：" + keys);
      // 一行只放得下二十来字，环节名一律不铺开，只报段数和总时长
      const stages = app.card.stages || [];
      if (stages.length) {
        const total = stages.reduce((s, x) => s + (Number(x.minutes) || 0), 0);
        lines.push("环节 " + stages.length + " 段 · 共" + total + "分钟");
      }
      lines.push("候答 " + (app.card.waitSeconds || 5) + " 秒");
    } else {
      lines.push("未收到本课卡");
      lines.push("在电脑端点「下发本课卡到眼镜」");
      if (app.view) lines.push(app.view);
    }
  }
  const tip = app.remoteAdvice && Date.now() - app.remoteAdvice.at < 20000 ? app.remoteAdvice.text : e.advice && e.advice.text;
  app.scene.render({ header, status, lines, note: app.error || e.note, hint: tip ? "提示：" + tip : hint });
}
function tick() {
  if (!app.running) { app.frame = null; return; }
  app.frame = os.requestAnimationFrame(tick);
  inputs.pumpNavigation(handleNavigation);
  inputs.pumpText(handleText);
  if (app.voice) app.voice.tick();
  if (app.micRestart && app.micWanted && app.card && !app.voice.active) {
    app.micRestart = false;
    if (!app.voice.start()) app.error = "麦克风不可用：" + app.voice.reason;
  }
  if (Date.now() - app.lastRender >= 100) { app.lastRender = Date.now(); render(); }
  // 心跳：每 3 秒告诉电脑端一声，同时重读一次课次卡
  // （不能只在启动时读一次——老师很可能先开眼镜再在电脑上下发）
  if (Date.now() - app.lastBeat >= 3000) {
    app.lastBeat = Date.now();
    const fresh = bridge.readCard();
    if (fresh && (!app.card || fresh.dispatchedAt !== app.card.dispatchedAt)) {
      app.voiceEpoch += 1;
      app.voiceQueue = [];
      if (app.voice.active) { app.micWanted = false; app.micRestart = true; app.voice.session.cancel(); }
      if (app.engine.phase === "class") endClass();
      app.engine.reset(); app.classStartedAt = 0;
      app.card = fresh;
      app.engine.budget = (fresh.stages || []).filter(s => s.name && Number(s.minutes) > 0).map(s => ({name: String(s.name), minutes: Number(s.minutes)}));
      app.outboxSeen = 0;
      app.remoteAdvice = null;
      console.log("NT_BRIDGE card reloaded " + fresh.courseId + " " + (fresh.topic || ""));
    } else if (!fresh && app.card) {
      app.voiceEpoch += 1;
      app.voiceQueue = [];
      app.micWanted = false;
      if (app.voice.active) app.voice.session.cancel();
      app.card = null;
      app.outboxSeen = 0;
      app.remoteAdvice = null;
    }
    bridge.beat({
      courseId: app.card ? app.card.courseId : "",
      sessionId: app.card ? (app.card.sessionId || app.card.dispatchedAt) : "",
      phase: app.engine ? app.engine.phase : "",
      events: app.engine ? app.engine.events.length : 0,
      microphone: { state: app.micState, reason: app.micReason, frames: app.voice ? app.voice.frames : 0,
        asrBusy: app.voiceBusy, error: app.error || "" },
      bridgeDir: bridge.BRIDGE
    });
    // 看电脑端有没有写新的话过来
    const box = bridge.readOutbox().filter(item => app.card &&
      item.courseId === app.card.courseId &&
      item.sessionId === (app.card.sessionId || app.card.dispatchedAt));
    if (box.length < app.outboxSeen) app.outboxSeen = 0;
    if (box.length > app.outboxSeen) {
      const freshItems = box.slice(app.outboxSeen);
      app.outboxSeen = box.length;
      for (const item of freshItems) {
        if (!Number.isFinite(Date.parse(item.at)) || Date.now() - Date.parse(item.at) >= 20000 || Date.now() < Date.parse(item.at)) continue;
        if (item.type === "mic.start") {
          app.micWanted = true;
          if (app.voice.active && app.voice.session.state === "cancelling") app.micRestart = true;
          else if (!app.voice.active && !app.voice.start()) app.error = "麦克风不可用：" + app.voice.reason;
        } else if (item.type === "class.start") {
          if (app.engine.phase !== "class") { app.engine.start(); app.classStartedAt = Date.now(); }
        } else if (item.type === "class.end") {
          if (app.engine.phase === "class") endClass();
        } else if (item.type === "mic.stop") {
          app.micWanted = false;
          app.voice.stop();
        } else if (item.type === "speak" && item.text && app.engine.phase === "class" && Date.parse(item.at) >= app.lastInputAt) {
          const chars = Array.from(String(item.text));
          app.remoteAdvice = { text: chars.length > 24 ? chars.slice(0, 23).join("") + "…" : chars.join(""), at: Date.now() };
          console.log("NT_TIP " + app.remoteAdvice.text);
        }
      }
    }
  }
}
function resume() { app.running = true; if (app.frame === null) app.frame = os.requestAnimationFrame(tick); }
function pause() { app.running = false; if (app.frame !== null) os.cancelAnimationFrame(app.frame); app.frame = null; }
function start() {
  if (app.window) return;
  app.config = loadConfig();
  let detector = new VoiceActivityDetector();
  app.voice = new inputs.VoiceMonitor({
    onStart: () => { detector = new VoiceActivityDetector(); app.error = ""; app.micState = "pending"; app.micReason = ""; },
    onState: (state, reason) => { app.micState = state; app.micReason = reason || ""; },
    onUnavailable: status => { app.micState = "unavailable"; app.micReason = status.reason || "unknown"; },
    onFrame: frame => {
      const activity = detector.push(frame.data);
      if (!activity.ended) return;
      enqueueVoice(detector.takeUtterance());
    },
    onEnd: result => {
      if (result.status === "completed") enqueueVoice(detector.takeUtterance());
      app.micState = "ended";
      app.micReason = result.reason || result.status;
      if (result.status === "error") app.error = "录音结束：" + result.reason;
      if (result.reason === "time-limit" && app.micWanted && app.running && app.card) app.micRestart = true;
    }
  });
  try { if (app.config.dataDir) app.memory = new PersonalMemory(app.config.dataDir, "local-demo-teacher"); }
  catch (e) { app.error = "个人偏好不可用：" + e.message; }
  app.card = bridge.readCard();
  if (app.card) console.log("NT_BRIDGE card " + app.card.courseId + " " + (app.card.topic || ""));
  app.engine = new Classroom({
    preferences: app.memory ? app.memory.values() : {},
    onEvent: row => {
      const base = app.classStartedAt || row.at;
      bridge.appendEvent({
        type: row.type,
        t: Math.round(((row.at - base) / 1000) * 10) / 10,
        text: row.detail || "",
        courseId: app.card ? app.card.courseId : "",
        sessionId: app.card ? app.card.sessionId : null,
        source: "glasses"
      });
    }
  });
  if (app.card) app.engine.budget = (app.card.stages || []).filter(s => s.name && Number(s.minutes) > 0).map(s => ({name: String(s.name), minutes: Number(s.minutes)}));
  const p = os.WindowProperty.create();
  p.setTitle("不新手老师"); p.setSize([0.64, 0.48, 0.01]);
  app.window = os.Window.create(p);
  app.root = ui.FusionRoot.acquireFusionRootFromWindow(app.window);
  app.scene = createScene(app.root.getRootWidget());
  render(); resume();
  console.log("NT_READY local-rules; local-asr-optional; bridge=" + bridge.BRIDGE);
}
os.App.createApp(lifecycle => {
  if (lifecycle === os.AppLifecycle.ON_CREATE) start();
  else if (lifecycle === os.AppLifecycle.ON_FOREGROUND || lifecycle === os.AppLifecycle.ON_REOPEN) resume();
  else if (lifecycle === os.AppLifecycle.ON_BACKGROUND) pause();
  else if (lifecycle === os.AppLifecycle.ON_DESTROY) { pause(); if (app.scene) app.scene.release(); }
});
