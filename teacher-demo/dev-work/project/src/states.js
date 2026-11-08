"use strict";

/**
 * 五状态机。
 *
 * prepare 课前准备 → listen 课堂感知 → think 事件判断 → advise 建议呈现 → review 课后问答
 * 每一次状态切换都对应一次可见的画面变化，模拟器里可直接目视验收。
 */

const STATE = Object.freeze({
  PREPARE: "prepare",
  LISTEN: "listen",
  THINK: "think",
  ADVISE: "advise",
  REVIEW: "review"
});

const STATE_META = Object.freeze({
  prepare: {
    name: "课前准备",
    hint: "↑↓ 选环节   确认 开始上课   文字 可提问"
  },
  listen: {
    name: "课堂感知",
    hint: "确认 标记事件   上 恢复追问   下 静默   返回 下课"
  },
  think: {
    name: "分析中",
    hint: "正在生成建议"
  },
  advise: {
    name: "教学建议",
    hint: "↑↓ 换层级   确认 采纳   返回 忽略"
  },
  review: {
    name: "课后问答",
    hint: "文字 继续提问   返回 回到课堂"
  }
});

class StateMachine {
  constructor(onChange) {
    this.state = STATE.PREPARE;
    this.previous = null;
    this.onChange = onChange;
    this.reason = "init";
  }

  to(next, reason) {
    if (next === this.state) return false;
    this.previous = this.state;
    this.state = next;
    this.reason = reason || "";
    if (this.onChange) this.onChange(next, this.previous, this.reason);
    return true;
  }

  meta() {
    return STATE_META[this.state] || STATE_META.prepare;
  }
}

module.exports = { STATE: STATE, STATE_META: STATE_META, StateMachine: StateMachine };
