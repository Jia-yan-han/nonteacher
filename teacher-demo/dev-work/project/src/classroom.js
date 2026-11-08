"use strict";

// Local, deliberately narrow rules. Only facts present in the teacher's words
// are used; no assumptions about students' answers or the teacher's emotions.
const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function number(s) {
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "十") return 10;
  if (s.includes("十")) {
    const p = s.split("十");
    return (p[0] ? digits[p[0]] : 1) * 10 + (p[1] ? digits[p[1]] : 0);
  }
  return digits[s];
}
function duration(text) {
  const m = text.match(/(\d+|[一二两三四五六七八九十]+)\s*(分钟|秒钟|秒)/);
  return m ? number(m[1]) * (m[2] === "分钟" ? 60 : 1) : null;
}

class Classroom {
  constructor(options) {
    this.now = options && options.now || Date.now;
    this.preferences = options && options.preferences || {};
    this.onEvent = (options && options.onEvent) || null;
    this.reset();
  }
  reset() {
    this.phase = "prepare";
    this.page = "";
    this.activity = "";
    this.context = {};
    this.countdown = null;
    this.pendingRemaining = null;
    this.viewMode = "normal";
    this.budget = [];
    this.budgetDraft = null;
    this.stage = null;
    this.stageCandidate = null;
    this.stageMatchStatus = "等待环节线索";
    this.stageStartedAt = 0;
    this.advice = null;
    this.lastAdviceAt = -Infinity;
    this.events = [];
    this.source = "";
    this.note = "无课前材料，可直接开始";
  }
  event(type, detail) {
    const row = { type, at: this.now(), source: this.source, detail: detail || "" };
    this.events.push(row);
    if (this.events.length > 200) this.events.shift();
    if (this.onEvent) {
      try { this.onEvent(row); } catch (e) { /* 桥断了不影响课堂 */ }
    }
  }
  draftBudget(stages) {
    if (!Array.isArray(stages) || !stages.length || stages.some(s => !s.name || !(s.minutes > 0))) throw new Error("环节或分钟数无效");
    this.budgetDraft = stages.map(s => ({ name: String(s.name), minutes: Number(s.minutes) }));
    this.note = "预算草案待确认";
  }
  confirmBudget() {
    if (!this.budgetDraft) return false;
    this.budget = this.budgetDraft;
    this.budgetDraft = null;
    this.event("budget_confirmed", this.budget.map(s => s.name + " " + s.minutes + "分钟").join("、"));
    this.note = "课前预算已确认";
    return true;
  }
  start() {
    this.phase = "class";
    this.stageStartedAt = this.now();
    this.source = "";
    this.note = this.budget.length ? "已开始；等待明确环节" : "已开始；无课前预算";
    this.event("class_started");
  }
  end() {
    if (this.countdown && this.countdown.active) this.stopCountdown("课程结束");
    this.phase = "review";
    this.advice = null;
    this.event("class_ended");
    this.note = "本次事件仅在当前会话中复盘";
  }
  stopCountdown(reason) {
    if (!this.countdown || !this.countdown.active) return;
    this.pendingRemaining = null;
    this.countdown.active = false;
    this.countdown.reason = reason;
    this.event("countdown_stopped", reason);
  }
  setAdvice(text, basis) {
    const interval = this.preferences.frequency === "less" ? 120000 : 30000;
    if (this.now() - this.lastAdviceAt < interval) return;
    this.advice = { text, basis, expiresAt: this.now() + 15000 };
    this.lastAdviceAt = this.now();
    this.event("advice", basis);
  }
  tick() {
    if (this.advice && this.now() >= this.advice.expiresAt) this.advice = null;
    if (this.countdown && this.countdown.active && this.now() >= this.countdown.endsAt && !this.countdown.finished) {
      this.countdown.finished = true;
      this.event("countdown_elapsed");
      this.note = "活动时间到";
    }
    if (this.phase === "class" && this.stage && !this.stage.warned && this.now() - this.stageStartedAt >= Math.max(0, this.stage.minutes * 60000 - 60000)) {
      this.stage.warned = true;
      this.note = this.stage.name + "接近计划时间";
    }
    if (this.phase === "class" && this.stage && !this.stage.overdue && this.now() - this.stageStartedAt > this.stage.minutes * 60000) {
      this.stage.overdue = true;
      this.note = this.stage.name + "已超过确认的预算";
      this.event("budget_overdue", this.stage.name);
    }
  }
  input(raw, source) {
    // Normalize a narrowly observed ASR variant only when an explicit discussion
    // command is present; keep the recorded transcript unchanged upstream.
    let text = String(raw || "").trim()
      .replace(/討論/g, "讨论")
      .replace(/分鐘/g, "分钟")
      .replace(/給/g, "给");
    if (source === "voice" && /讨论/.test(text)) {
      text = text.replace(/([一二两三四五六七八九十\d]+)\s*分中/g, "$1分钟");
    }
    if (!text || this.phase !== "class") return false;
    this.source = source || "模拟文本";
    this.advice = null;
    if (/^(只显示|突出|重点显示)(计时|倒计时|活动计时)[。！!]?$/u.test(text)) {
      this.viewMode = "timer"; this.note = "已突出活动计时";
      this.event("view_changed", "突出活动计时"); return true;
    }
    if (/^(恢复显示|显示全部|恢复全部)[。！!]?$/u.test(text)) {
      this.viewMode = "normal"; this.note = "已恢复完整显示";
      this.event("view_changed", "恢复完整显示"); return true;
    }
    if (/^(确认调整|确认修改|确认剩余时间)[。！!]?$/u.test(text) && this.pendingRemaining !== null && this.countdown && this.countdown.active) {
      const seconds = this.pendingRemaining;
      this.countdown.endsAt = this.now() + seconds * 1000;
      this.countdown.finished = false; this.pendingRemaining = null;
      this.note = "已按确认调整计时";
      this.event("countdown_confirmed", String(seconds)); return true;
    }
    if (/^(取消调整|取消修改)[。！!]?$/u.test(text) && this.pendingRemaining !== null) {
      this.pendingRemaining = null; this.note = "已保留原计时";
      this.event("countdown_confirmation_cancelled"); return true;
    }
    const page = text.match(/第?\s*(\d+|[一二两三四五六七八九十]+)\s*页/);
    if (page) { this.page = String(number(page[1])); this.event("page", this.page); }
    if (/讨论|同桌/.test(text)) this.activity = "讨论";
    else if (/独立想|写下来|停笔/.test(text)) this.activity = "独立思考";
    if (/平均分成[两二三四五六七八九十\d]+份/.test(text)) {
      const n = text.match(/平均分成([两二三四五六七八九十\d]+)份/);
      this.context.parts = number(n[1]);
      this.context.average = true;
      this.event("parts", String(this.context.parts));
    }
    if (/门票/.test(text)) this.context.tickets = true;
    if (/坐车|车辆/.test(text)) this.context.transport = true;

    const seconds = duration(text);
    const futureOrHypothetical = /上节课|下节课|昨天|明天|假如|如果|等会|待会/.test(text);
    const historical = futureOrHypothetical || /以前|之前|刚才/.test(text);
    const correction = this.countdown && this.countdown.active && /改成/.test(text) && !futureOrHypothetical;
    const startCommand = !historical && (
      /给大家|给同学|我们用|大家用|限时|计时|分钟内.*(?:完成|讨论|练习)|用\s*[一二两三四五六七八九十\d]+\s*(分钟|秒)/.test(text) ||
      /^(?:请)?(?:大家)?讨论\s*[一二两三四五六七八九十\d]+\s*(?:分钟|秒钟|秒)[。！!？?]?$/u.test(text) ||
      /^(?:给)?大家\s*[一二两三四五六七八九十\d]+\s*(?:分钟|秒钟|秒)(?:的)?时间[。！!？?]?$/u.test(text));
    if (this.countdown && this.countdown.active && /结束计时|停止计时|取消计时/.test(text)) {
      this.pendingRemaining = null; this.stopCountdown("教师结束计时"); this.note = "已结束计时";
    } else if (seconds && this.countdown && this.countdown.active && /再加|加上|延长/.test(text)) {
      this.pendingRemaining = null; this.countdown.endsAt = Math.max(this.now(), this.countdown.endsAt) + seconds * 1000; this.countdown.finished = false; this.note = "已延长 " + seconds + " 秒"; this.event("countdown_extended", String(seconds));
    } else if (seconds && /还有/.test(text)) {
      if (this.countdown && this.countdown.active) {
        const remaining = Math.max(0, Math.ceil((this.countdown.endsAt - this.now()) / 1000));
        if (Math.abs(remaining - seconds) > 10) {
          this.pendingRemaining = seconds;
          this.note = "时间不同：确认调整或取消调整";
          this.event("time_conflict", "教师说 " + seconds + " 秒，计时剩余 " + remaining + " 秒");
        }
      }
    } else if (seconds && seconds <= 7200 && (correction || startCommand)) {
      this.pendingRemaining = null;
      if (this.countdown && this.countdown.active) this.stopCountdown("新时间替换");
      this.countdown = { active: true, label: this.activity || "活动", total: seconds, endsAt: this.now() + seconds * 1000, finished: false };
      this.event("countdown_started", String(seconds));
      this.note = "活动计时已开始";
    }
    if (this.countdown && this.countdown.active && /先停一下|先停笔|讨论结束/.test(text)) {
      this.stopCountdown("教师结束活动");
      this.note = "教师结束活动";
    }

    if (this.budget.length) {
      const immediate = !/明天|下节课|假如|如果|以后|等会|待会/.test(text);
      const action = /开始|进入|接下来|现在进行|给大家|给同学|大家用|我们用|限时/.test(text);
      const exact = immediate && action ? this.budget.filter(s => text.includes(s.name)) : [];
      const confirmed = /^(确认环节|确认进入)$/.test(text) ? this.stageCandidate : null;
      const found = confirmed || (exact.length === 1 ? exact[0] : null);
      if (found && (!this.stage || this.stage.name !== found.name)) {
        this.stage = { ...found, overdue: false };
        this.stageStartedAt = this.now();
        this.stageCandidate = null;
        this.stageMatchStatus = "";
        this.event("stage_changed", found.name);
        this.note = "已进入 " + found.name;
      } else if (!found && immediate && action && /讨论/.test(text)) {
        const candidates = this.budget.filter(s => s.name.includes("讨论"));
        this.stageCandidate = candidates.length === 1 ? candidates[0] : null;
        this.stageMatchStatus = candidates.length === 1 ? "候选：" + candidates[0].name + "（待确认）" : candidates.length ? "讨论对应多个环节，待确认" : "课卡中没有讨论环节";
      }
    }
    if (/还有吗|还有其他的/.test(text) && this.context.transport && this.context.tickets) {
      this.setAdvice("可以聚焦：怎么安排车辆？", "教师复述了门票和坐车");
    } else if (/还有不同的想法/.test(text) && this.context.average) {
      this.setAdvice("可以问：为什么要平均分？", "教师复述了平均分的思路");
    }
    const appleQuestion = /平均分给两个人/.test(text) && /每个人|每人/.test(text);
    if (appleQuestion) {
      this.context.appleQuestions = (this.context.appleQuestions || 0) + 1;
      if (this.context.appleQuestions >= 3) this.setAdvice("可以先问：一共分成几份？", "教师连续重复平均分问题");
    } else if (!/再想一想/.test(text)) this.context.appleQuestions = 0;
    this.event("input_processed", "已处理教师表达");
    return true;
  }
  remaining() {
    if (!this.countdown || !this.countdown.active) return null;
    return Math.max(0, Math.ceil((this.countdown.endsAt - this.now()) / 1000));
  }
}
module.exports = { Classroom, number, duration };
