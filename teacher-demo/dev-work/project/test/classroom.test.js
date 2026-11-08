"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Classroom } = require("../src/classroom");
const { PersonalMemory } = require("../src/personal");

function session(options) {
  let at = 100000;
  const e = new Classroom({ now: () => at, ...(options || {}) });
  return { e, advance: ms => { at += ms; e.tick(); }, say: text => e.input(text, "模拟文本") };
}
test("A: 无材料、5 分钟、更正为 3 分钟、提前结束", () => {
  const { e, advance, say } = session(); e.start();
  say("同学们，翻到第十二页，先看看这幅图。");
  say("接下来，两个人一组，讨论一下图片里有哪些形状。");
  say("每组找出两种形状。给大家五分钟。");
  assert.equal(e.page, "12"); assert.equal(e.remaining(), 300); assert.equal(e.budget.length, 0);
  advance(20000); say("刚才说错了，讨论改成三分钟。");
  assert.equal(e.remaining(), 180); advance(10000);
  say("好，现在先停一下，请一组同学说说你们找到的形状。");
  assert.equal(e.remaining(), null); assert.equal(e.countdown.reason, "教师结束活动");
});
test("B/C/D: 上下文建议可撤回，纠正更新已知份数", () => {
  const b = session(); b.e.start();
  b.say("如果我们要组织一次春游，出发前需要考虑什么？");
  b.say("你说要考虑门票，她说还要考虑怎么坐车。");
  b.say("还有吗？还有其他的吗？"); assert.match(b.e.advice.text, /车辆/);
  b.say("好，我们先看看，一共有多少人要坐车。"); assert.equal(b.e.advice, null);
  const c = session(); c.e.start();
  c.say("你说，先把这张纸平均分成两份，再拿其中的一份。");
  c.say("嗯，你是这样想的。还有不同的想法吗？"); assert.match(c.e.advice.text, /平均分/);
  c.say("我刚才听错了，你说的是平均分成三份，再拿其中的一份。");
  assert.equal(c.e.context.parts, 3); assert.equal(c.e.advice, null);
  const d = session(); d.e.start();
  d.say("把一个苹果平均分给两个人，每个人得到多少？");
  d.say("我们再想一想，平均分给两个人，每个人得到多少？");
  d.say("一个苹果，平均分给两个人，每人得到多少呢？");
  assert.match(d.e.advice.text, /分成几份/);
  d.say("我们先说说，一共分成了几份。"); assert.equal(d.e.advice, null);
});
test("E/F: 教师提醒剩余时间不静默改表，组织课堂不产生情绪结论", () => {
  const { e, say } = session(); e.start();
  say("接下来请大家独立想一想，把你的想法写下来。");
  say("这一步我们用两分钟。"); assert.equal(e.remaining(), 120);
  say("还有一分钟，大家可以把最后一句写完。");
  assert.equal(e.remaining(), 120); assert.match(e.note, /不同/);
  say("好，我们先停笔。下面请一位同学说说自己的想法。"); assert.equal(e.remaining(), null);
  say("同学们，先把手里的东西放下，看向前面。");
  say("我们先停一下，我把下一步说清楚。"); assert.equal(e.advice, null);
});
test("G: 预算需单独确认且仅在明确环节后生效", () => {
  const { e, advance, say } = session();
  e.draftBudget([{ name: "讲解", minutes: 10 }, { name: "练习", minutes: 15 }]);
  e.start(); say("接下来做练习。"); advance(1000000); assert.equal(e.stage, null);
  const x = session(); x.e.draftBudget([{ name: "练习", minutes: 15 }]); x.e.confirmBudget(); x.e.start();
  x.say("接下来做练习。"); x.advance(900001); assert.equal(x.e.stage.overdue, true);
});
test("H: 确认前不保存，重启读取，字段更新不覆盖其他偏好，清除", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nonteacher-"));
  try {
    let m = new PersonalMemory(dir, "teacher-a");
    assert.equal(m.propose("我希望上课时提醒简短一些，一次只给我一条建议。请记住这个偏好。"), true);
    assert.deepEqual(new PersonalMemory(dir, "teacher-a").values(), {});
    m.confirm(); m = new PersonalMemory(dir, "teacher-a");
    assert.deepEqual(m.values(), { concise: true, maxOptions: 1 });
    m.propose("今天这类提醒有点多，下次少提醒一些。"); m.confirm();
    assert.deepEqual(new PersonalMemory(dir, "teacher-a").values(), { concise: true, maxOptions: 1, frequency: "less" });
    assert.deepEqual(new PersonalMemory(dir, "teacher-b").values(), {});
    m.clear(); assert.deepEqual(new PersonalMemory(dir, "teacher-a").values(), {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("建议会自动过期，较少提醒的偏好会延长间隔", () => {
  const { e, say, advance } = session({ preferences: { frequency: "less" } }); e.start();
  say("你说要考虑门票，她说还要考虑怎么坐车。"); say("还有吗？还有其他的吗？");
  assert.ok(e.advice); advance(16000); assert.equal(e.advice, null);
  say("还有吗？还有其他的吗？"); assert.equal(e.advice, null);
  advance(104001); say("还有吗？还有其他的吗？"); assert.ok(e.advice);
});

test("计时视图可切换，时间冲突必须明确确认", () => {
  const {e,say} = session(); e.start();
  say("给大家三分钟讨论"); assert.equal(e.remaining(), 180);
  say("只显示计时"); assert.equal(e.viewMode, "timer");
  say("还有一分钟"); assert.equal(e.remaining(), 180); assert.equal(e.pendingRemaining, 60);
  say("确认调整"); assert.equal(e.remaining(), 60); assert.equal(e.pendingRemaining, null);
  say("恢复显示"); assert.equal(e.viewMode, "normal");
  say("还有三分钟"); say("取消调整"); assert.equal(e.remaining(), 60);
});

test("课堂简短讨论计时和常见语音转写变体可启动，历史与假设描述不会启动", () => {
  for (const phrase of ["讨论三分钟", "大家三分钟时间", "討論三分中", "給大家三分鐘水", "給大家三分鐘討論"]) {
    const {e}=session(); e.start(); e.input(phrase,"voice");
    assert.equal(e.remaining(),180,phrase);
  }
  for (const phrase of ["上节课讨论三分钟", "如果讨论三分钟", "刚才给大家三分钟讨论", "三分钟时间", "上节课給大家三分鐘"]) {
    const {e}=session(); e.start(); e.input(phrase,"voice");
    assert.equal(e.remaining(),null,phrase);
  }
});
