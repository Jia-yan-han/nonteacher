"use strict";

/**
 * 演示脚本回放引擎。
 *
 * 现场没有真实学生，模拟器里也拿不到麦克风声音，
 * 所以把「ASR 会给出的事件流」写成脚本按真实时间轴回放。
 * 它只负责「什么时候发生什么」，判定逻辑仍然全部在 rules.js 里，
 * 因此回放走的是和真实语音完全相同的处理路径。
 *
 * 诚实标注：回放事件在日志里一律带 source="replay"，
 * 与真实语音链路的样本分开统计。
 */

class ScriptPlayer {
  constructor(options) {
    const opts = options || {};
    this.events = opts.events || [];
    this.onEvent = opts.onEvent || function () {};
    this.onDone = opts.onDone || function () {};
    this.source = opts.source || "replay";
    this.speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
    this.index = 0;
    this.startedAt = 0;
    this.running = false;
  }

  get total() {
    return this.events.length;
  }

  get position() {
    return this.index;
  }

  start(now) {
    this.index = 0;
    this.startedAt = now || Date.now();
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  /** 由主循环每帧调用；到点就把事件交给信号层。 */
  tick(now) {
    if (!this.running) return false;
    const current = now || Date.now();
    const elapsed = (current - this.startedAt) * this.speed;
    let fired = false;
    while (this.index < this.events.length && this.events[this.index].at <= elapsed) {
      const event = this.events[this.index];
      this.index += 1;
      fired = true;
      this.onEvent(event.kind, event.text || "", Date.now(), this.source);
    }
    if (this.index >= this.events.length) {
      this.running = false;
      this.onDone();
    }
    return fired;
  }
}

module.exports = { ScriptPlayer: ScriptPlayer };
