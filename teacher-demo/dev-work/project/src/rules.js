"use strict";

/**
 * 课堂事件与本地规则内核（v2）。
 *
 * 这里是作品「可运行的智能体」的本体：断网、没有模型账号时，
 * 提示决策依然完全成立。规则来自小学课堂痛点调研（_tools/research/classroom-pain-points.md）：
 *
 *   P01 候答时间不足（实测平均 1.8 秒）→ 候答窗口 3 秒，走满才允许点名/评价
 *   P04 理答无力（追问占比 21% vs 61%）→ 学生答完给一句 ≤18 字追问
 *   P13 冷场死追问                     → 同一问句重复 ≥2 次换问法，第 3 次降阶
 *   P05 容错缺失                       → 不先纠正，先问「你是怎么想的」
 *   P06 指令抽象                       → 把「认真点」翻译成具体动作
 *   P12 小结填空                       → 小结时让学生自己说三个词
 *
 * v2 新增三条与「课堂计时 / 无准备模式」直接相关的规则：
 *   环节切换    ← 教师语音里出现明确的内容转变（翻到第几页 / 下面我们讲…）→ 重置环节计时
 *   显式倒计时  ← 教师给出限时要求（给大家 5 分钟讨论）→ HUD 出现倒计时条
 *   模式 B 挖重点 ← 没有课前材料时，从教师刚说出口的词里取追问对象
 *
 * 一条必须分清的分层（v2 反复强调）：
 *   环节识别（何时切换）来自教师语音，实时可用；
 *   环节预算（每段应多久）来自课前材料或课前对话，且必须经老师确认。
 *   没有确认过的预算，就不产生「你超期了」这种结论。
 *
 * 两条诚实边界（写进文档，不写进宣传语）：
 *   1. 眼镜麦克风主要收到的是教师语音，学生语音是弱信号，
 *      所以本内核只对「教师行为」给反馈，不做学情诊断。
 *   2. 「等三秒」在调研里只是提示动作，缺少本土对照实验，不承诺效果。
 */

const LEVEL = Object.freeze({ NONE: 0, LOCATE: 1, DIRECT: 2, DEMONSTRATE: 3 });

/** 候答窗口：3 秒（P01 的核心数字）。 */
const WAIT_MS = 3000;
/** 学生答完到追问上屏的等待：1.2 秒（给教师自己开口的余地）。 */
const FOLLOWUP_DELAY_MS = 1200;
/** 追问用满几次后自动静默。 */
const FOLLOWUP_MAX = 4;
/** 追问句长度上限：18 字。 */
const FOLLOWUP_MAX_CHARS = 18;

/** 口头禅式碎问：出现这些词就不进入候答计时，避免误报冷场。 */
const FILLER_MARKS = ["是不是", "对不对", "好不好", "行不行", "可以吗", "对吧", "好不好啊", "嗯嗯", "好吗"];
/** 疑问句标记：用来区分「教师提问」与「教师讲解」。 */
const QUESTION_MARKS = ["?", "？", "吗", "呢", "什么", "为什么", "怎么", "哪", "多少", "几", "谁", "能不能", "是不是"];

/** 中文数字 → 数值（倒计时、模式 B 挖重点都要用）。 */
const CN_DIGITS = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  半: 0.5
};

/**
 * 环节切换线索（v2）。
 *
 * 老师嘴上说「翻到第几页」「下面我们讲……」，就是一次明确的课堂内容转变，
 * 这是**实时认环节**的依据。
 * 注意它和「课前确认的时长预算」是两件事：识别靠语音，预算靠课前材料 + 老师确认。
 */
const STAGE_PATTERNS = [
  { re: /翻[开到]?\s*第?\s*([0-9]+|[一二三四五六七八九十]+)\s*页/, kind: "page", hint: "第 {0} 页" },
  { re: /翻\s*页/, kind: "page", hint: "翻页" },
  { re: /(?:下面|接下来)\s*(?:我们)?\s*(?:来)?\s*(?:看|讲|说|学|做|练|算|读|想)/, kind: "next", hint: "进入下一环节" },
  { re: /(?:我们|咱们)\s*(?:来|现在)?\s*(?:总结|回顾|小结|练习|做练习|算一算|想一想|探究)/, kind: "next", hint: "进入下一环节" },
  { re: /第\s*([0-9]+|[一二三四五六七八九十]+)\s*(?:题|组|步|关|部分)/, kind: "index", hint: "第 {0} 题" },
  { re: /(?:好|那|嗯|来)[,，。！]?\s*(?:我们)?\s*(?:来看|来讲|来想|来做|来看一下)/, kind: "next", hint: "进入下一环节" },
  { re: /(?:最后|最后一个)\s*(?:一?个)?\s*(?:问题|题|练习|活动|环节)/, kind: "next", hint: "最后一个环节" },
  { re: /(?:下课|就到这里|先到这儿|这节课就)/, kind: "end", hint: "本课结束" }
];

/** 限时语境：时长词附近出现这些动词/名词，才算「教师在分配限时任务」。 */
const COUNTDOWN_CONTEXT =
  /(讨论|小组|同桌|互相|交流|练习|做题|做一做|算一算|算|写|读|想一想|思考|完成|独立|看看|观察|说一说|试一试|尝试|限时|以内|之内)/;
/** 限时引导词：出现这些词，说明这句话本身就是在分配时间。 */
const COUNTDOWN_LEAD = /(给大家|给同学们|给各位|限时|大家用|同学们用|咱们用|我们用)/;
const DURATION_RE = /([0-9]+(?:\.[0-9]+)?|[一二两三四五六七八九十半]+)\s*(分钟|秒钟|秒)/;

/**
 * 容错 / 跳过线索（v2，接 P05）。
 * 教师替学生把话说完或直接给答案时，不先纠正，先给一句替代话术。
 */
const SKIP_PATTERNS = [
  { re: /下面(?:你|大家|你们)?\s*自己\s*(?:算|想|做|看|试|读|完成)/, kind: "self-solve", label: "教师替学生跳过提问" },
  { re: /(?:你们|大家|咱们)\s*自己\s*(?:算算|想想|做做|试试|说说)/, kind: "self-solve", label: "教师替学生跳过提问" },
  { re: /算了/, kind: "give-up", label: "放弃当前追问" },
  { re: /下一个[^，。！？]{0,4}(?:来|请|回答)/, kind: "skip", label: "跳到下一个，没接住当前回答" },
  { re: /(?:我|老师)?\s*直接(?:告诉|给)你们?\s*(?:答案|结果|做法)/, kind: "give-answer", label: "直接给答案，跳过了让学生先说" },
  { re: /不用(?:再)?(?:问|说了|回答)/, kind: "give-up", label: "放弃当前追问" }
];

/** 模式 B 挖重点：教师给概念命名（「这个叫做平均分」）。 */
const FOCUS_TERM_RE = /(?:叫做|叫作|称为|读作|这叫)\s*([^\s，。！？、；：]{2,6})/;
/** 模式 B 挖重点：教师说出的「数量 + 量词」（「3 份」「两个人」）。 */
const FOCUS_COUNT_RE = /([0-9]+|[一二两三四五六七八九十半]+)\s*(个|份|只|本|块|人|张|条|道|题|组|根|杯|碗|片|颗|粒|支)/;

const EVENT_TYPES = Object.freeze({
  cold_response: {
    label: "冷场",
    detail: "同一个问句重复，问完仍然没人接",
    // 四级阶梯：同一问句第 1/2/3/4 次重复各给一句不重复的提示。
    // 验收口径：连续 3 次重复同一问句时，第 3 次必须出现「降阶」。
    levels: [
      "换个问法：从「为什么」改成「你从哪一句看出来」",
      "再缩一次：把问句压成一个词——「一半」",
      "降阶：先问「这整体分了几份」，再问「为什么」",
      "拆到最小动作：只问一个数，一份一份数出来"
    ],
    script: [
      "我们换个问法：你从哪一句看出来是这个答案的？",
      "先说一个词就行：哪一部分是一半？",
      "先只回答一个数：它一共分成了几份？",
      "我们一个一个数：一、二，一共两份"
    ]
  },
  no_response: {
    label: "提问后无人应答",
    detail: "问完 3 秒内没有学生应答",
    levels: [
      "问完还没人应，先把问题改成具体动作",
      "点名到人：把要学生说的那句话说完整",
      "自己做示范，再请一位学生重复一遍"
    ],
    script: [
      "",
      "谁能用一句话说说你是怎么想的？",
      "我先做一个，你们看，然后请一位同学重复一遍"
    ]
  },
  wrong_answer: {
    label: "学生回答有偏差",
    detail: "学生回答与本课目标概念不一致",
    levels: [
      "先别急着纠正",
      "先肯定对的那部分，再追问：它一共分成了几份？",
      "退回概念本身：整体平均分成几份，先定份数再定取的份数"
    ],
    script: [
      "",
      "你说的这一点很关键，我们再看看：它分成了几份？",
      "我们从「平均分」开始，一份一份数"
    ]
  },
  unexpected_question: {
    label: "学生提出意外问题",
    detail: "学生提出了超出当前环节的问题",
    levels: [
      "这是个好问题，先接住",
      "用一句话回应，再问全班还有谁有想法",
      "转成 30 秒小组探究，再回到主线"
    ],
    script: [
      "",
      "这个问题问得好，我先说两句，全班也想想",
      "我们给它 30 秒小组聊一下，然后回到这道题"
    ]
  },
  stall: {
    label: "互动停滞",
    detail: "连续一段时间没有课堂反应",
    levels: [
      "课堂安静下来了",
      "暂停讲解，做一次全体齐答或举手判断",
      "给一个 30 秒能完成的小任务：同桌互说"
    ],
    script: [
      "",
      "请大家把手举起来，老师看一下",
      "同桌互相说一遍，一个说一个听"
    ]
  },
  time_overflow: {
    label: "环节超时",
    detail: "当前环节已超出计划时长",
    levels: [
      "本环节已超出计划时长",
      "压缩成一个动作：只讲一个例子就上练习",
      "提前收束，一句话小结后进入下一环节"
    ],
    script: [
      "",
      "",
      "这一部分我们记住一件事就够了，现在看下面这道题"
    ]
  },
  praise: {
    label: "学生答对",
    detail: "学生回答命中本课知识点",
    levels: [
      "学生答对了",
      "点名肯定，并追问：你是怎么想到的？",
      "请他讲一遍给同桌听"
    ],
    script: [
      "",
      "回答正确！你能说说你是怎么想到的吗？",
      "把你的方法讲给同桌听一下"
    ]
  },
  skip_answer: {
    label: "替学生把话说了",
    detail: "教师跳过让学生先说，直接给答案或推进到下一个",
    levels: [
      "先别替学生说，先问一句",
      "先问：你是怎么想的？",
      "先让他说一个数，再纠正"
    ],
    script: [
      "",
      "先问问看：你是怎么想的？",
      "你先说一个数，我们一起对一下"
    ]
  },
  countdown: {
    label: "限时活动",
    detail: "教师给出明确的限时要求（例：给大家 5 分钟讨论）",
    levels: ["已计时", "到点前 30 秒", "时间到"],
    script: ["", "还有 30 秒，把结论写下来", "时间到，哪位同学先说说结果？"]
  },
  stage_switch: {
    label: "环节切换",
    detail: "教师语音中出现明确的课堂内容转变",
    levels: ["已切到新环节，计时重新开始"],
    script: [""]
  }
});

/**
 * 提示强度策略（脚手架撤除）。
 *
 * 第一次出现的事件只记录不打扰；确认是真困难才逐级升级；
 * 任何一次澄清或采纳都把计数清零，提示随之撤除。
 * time_overflow / praise 是例外：前者首次即直给动作，后者首次即旁注（不打断）。
 */
function decideLevel(type, streak) {
  if (type === "time_overflow") return streak >= 1 ? LEVEL.DIRECT : LEVEL.NONE;
  if (type === "praise") return streak >= 1 ? LEVEL.LOCATE : LEVEL.NONE;
  // 替学生把话说了：第一次只旁注（不打断），第二次才直给替代话术
  if (type === "skip_answer") return streak >= 2 ? LEVEL.DIRECT : LEVEL.LOCATE;
  if (streak <= 1) return LEVEL.NONE;
  if (streak === 2) return LEVEL.LOCATE;
  if (streak === 3) return LEVEL.DIRECT;
  return LEVEL.DEMONSTRATE;
}

/**
 * 冷场专用阶梯：同一问句第 1、2 次重复仍在「换问法」层级但文案不同，
 * 第 3 次必须给出「降阶」，第 4 次起拆到最小动作。
 */
const COLD_LADDER = [LEVEL.LOCATE, LEVEL.LOCATE, LEVEL.DIRECT, LEVEL.DEMONSTRATE];

/** 取某类事件在当前连续次数下的提示层级。 */
function eventLevel(type, streak) {
  if (type === "cold_response") {
    const index = Math.min(Math.max(streak, 1), COLD_LADDER.length) - 1;
    return COLD_LADDER[index];
  }
  return decideLevel(type, streak);
}

/** 用本地模板生成建议。云端模型不可用时，这就是最终呈现内容。 */
function localAdvice(type, level, textIndex) {
  const spec = EVENT_TYPES[type];
  if (!spec || level === LEVEL.NONE) return null;
  const index =
    typeof textIndex === "number"
      ? Math.min(textIndex, spec.levels.length - 1)
      : Math.min(level, spec.levels.length) - 1;
  return {
    type: type,
    label: spec.label,
    detail: spec.detail,
    level: level,
    title: spec.levels[index] || spec.levels[0],
    script: spec.script[index] || "",
    source: "local"
  };
}

/** 归一化问句：去标点与空白，只留前 14 个字用于判重。 */
function normalizeQuestion(text) {
  return String(text || "")
    .replace(/[\s，。？！、；：""''《》（）()\.,?!;:"'`~…—\-]/g, "")
    .slice(0, 14);
}

/** 碎问识别：口头禅式的「是不是/对不对」不该触发候答与冷场。 */
function isFillerQuestion(text) {
  const compact = normalizeQuestion(text);
  for (const mark of FILLER_MARKS) {
    if (compact.indexOf(mark) >= 0) return true;
  }
  return false;
}

/** 是否像一句提问（用于区分提问与讲解）。 */
function looksLikeQuestion(text) {
  const raw = String(text || "");
  if (!raw) return false;
  for (const mark of QUESTION_MARKS) {
    if (raw.indexOf(mark) >= 0) return true;
  }
  return /[?？]$/.test(raw.trim());
}

/** 截断到 18 字，保证 AR 屏上一眼能读完。 */
function clampFollowup(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (raw.length <= FOLLOWUP_MAX_CHARS) return raw;
  return raw.slice(0, FOLLOWUP_MAX_CHARS);
}

/**
 * 中文数字 / 阿拉伯数字 → 数值。
 * 支持「十」「十五」「二十」「二十三」与「半」。
 */
function parseNumber(token) {
  const raw = String(token || "").trim();
  if (!raw) return null;
  if (/^[0-9]+(\.[0-9]+)?$/.test(raw)) return Number(raw);
  if (raw.indexOf("十") >= 0) {
    const parts = raw.split("十");
    const head = parts[0] ? CN_DIGITS[parts[0]] : 1;
    const tail = parts[1] ? CN_DIGITS[parts[1]] : 0;
    if (head === undefined || tail === undefined) return null;
    return head * 10 + tail;
  }
  if (CN_DIGITS[raw] !== undefined) return CN_DIGITS[raw];
  return null;
}

/**
 * 环节切换检测（v2）。
 *
 * 返回 { hit, kind, hint, matched }；没命中时 hit=false。
 * hint 是给人看的一句话（「第 12 页」「进入下一环节」），用来做日志与复盘。
 */
function detectStageSwitch(text) {
  const raw = String(text || "");
  if (!raw) return { hit: false };
  for (const pattern of STAGE_PATTERNS) {
    const matched = raw.match(pattern.re);
    if (!matched) continue;
    let hint = pattern.hint;
    if (matched[1]) hint = hint.replace("{0}", matched[1]);
    return { hit: true, kind: pattern.kind, hint: hint, matched: matched[0] };
  }
  return { hit: false };
}

/**
 * 显式倒计时检测（v2）。
 *
 * 只认「教师在分配限时任务」的语境：
 *   「给大家 5 分钟讨论」✓（引导词 + 时长）
 *   「5 分钟内完成练习」✓（时长 + 活动词）
 *   「这节课我们上了 45 分钟」✗（没有活动词也没有引导词）
 * 返回 { hit, seconds, minutes, label }。
 */
function detectCountdown(text) {
  const raw = String(text || "");
  if (!raw) return { hit: false };
  const matched = raw.match(DURATION_RE);
  if (!matched) return { hit: false };
  const value = parseNumber(matched[1]);
  if (value === null || value <= 0) return { hit: false };
  const unit = matched[2];
  const seconds = unit === "分钟" ? Math.round(value * 60) : Math.round(value);
  if (seconds < 5 || seconds > 7200) return { hit: false };
  const around = raw.slice(Math.max(0, matched.index - 14), matched.index + matched[0].length + 14);
  if (!COUNTDOWN_CONTEXT.test(around) && !COUNTDOWN_LEAD.test(raw)) return { hit: false };
  return {
    hit: true,
    seconds: seconds,
    minutes: unit === "分钟" ? value : seconds / 60,
    label: "限时 " + (unit === "分钟" ? value + " 分钟" : value + " 秒"),
    matched: matched[0]
  };
}

/**
 * 容错 / 跳过检测（v2，接 P05）。
 * 返回 { hit, kind, label }。
 */
function detectSkip(text) {
  const raw = String(text || "");
  if (!raw) return { hit: false };
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.re.test(raw)) return { hit: true, kind: pattern.kind, label: pattern.label };
  }
  return { hit: false };
}

/**
 * 模式 B：从教师最近说过的几句话里挖「当前重点」。
 *
 * 没有课前材料时，追问不能是通用废话（「你是从哪一句看出来的？」），
 * 而要指向教师自己刚说出口的那个词：
 *   「这个叫做平均分」      → term  「平均分」
 *   「平均分给 3 个小朋友」 → count 「3个」
 * 新的优先，旧的靠后。
 */
function recentFocus(texts) {
  const list = Array.isArray(texts) ? texts : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const raw = String(list[i] || "");
    if (!raw) continue;
    const term = raw.match(FOCUS_TERM_RE);
    if (term) return { kind: "term", token: term[1], from: list[i] };
    const count = raw.match(FOCUS_COUNT_RE);
    if (count) return { kind: "count", token: count[1] + count[2], from: list[i] };
  }
  return null;
}

/** 模式 B 的追问句：指向教师刚说过的那个词，≤18 字。 */
function focusFollowup(focus) {
  if (!focus || !focus.token) return "";
  if (focus.kind === "term") return "「" + focus.token + "」这个词怎么讲给同学？";
  return "「" + focus.token + "」这一步是怎么定的？";
}

/** 模式 B 的降阶句：把大问题压成一个数或一个词，≤18 字。 */
function focusDemote(focus) {
  if (!focus || !focus.token) return "";
  if (focus.kind === "term") return "先只说一个词：" + focus.token;
  return "先只回答一个数：" + focus.token + "，是多少？";
}

/**
 * 追问生成器。
 *
 * 优先针对学生这句回答里命中的知识点；没有命中就用课前关键词里挑一句，
 * 保证每条追问都指向本课，而不是通用废话。
 *
 * v2 变化：没有课前追问库（模式 B）时，改从教师刚说过的词里挖重点，
 * 而不是退回一句写死的通用废话。
 */
function buildFollowup(lesson, context) {
  const ctx = context || {};
  const followups = (lesson && lesson.followups) || [];
  if (ctx.matched) {
    return {
      text: clampFollowup("「" + ctx.matched + "」这一步怎么想到的"),
      basis: "matched",
      matched: ctx.matched
    };
  }
  if (!followups.length && ctx.focus && ctx.focus.token) {
    return {
      text: clampFollowup(focusFollowup(ctx.focus)),
      basis: "focus",
      matched: ctx.focus.token
    };
  }
  const index = ctx.index || 0;
  const pick = followups.length ? followups[index % followups.length] : "你是从哪一句看出来的？";
  return { text: clampFollowup(pick), basis: followups.length ? "lesson" : "generic", matched: "" };
}

/**
 * 事件计数器：同一类型连续出现才升级，任何一次解决都会清零。
 */
class EventTracker {
  constructor() {
    this.counts = {};
    this.history = [];
  }

  record(type, at, streakOverride) {
    const current = this.counts[type] || 0;
    const streak = typeof streakOverride === "number" && streakOverride > 0 ? streakOverride : current + 1;
    this.counts[type] = streak;
    const event = { type: type, streak: streak, at: at || Date.now() };
    this.history.push(event);
    if (this.history.length > 50) this.history.shift();
    return event;
  }

  /** 教师采纳建议、给出澄清或事件消失时调用，撤除升级。 */
  clear(type) {
    if (type) this.counts[type] = 0;
    else this.counts = {};
  }

  recent(n) {
    return this.history.slice(-(n || 5));
  }
}

/**
 * 信号来源抽象。
 *
 * 真实课堂里信号来自 ASR：教师语音切出问句与讲解，学生语音切出应答。
 * 在 ASR 到位之前，信号可以由教师手动标记，或由演示脚本回放，
 * 三者走同一入口，模型接入后只替换信号来源，不动规则内核。
 *
 * 这里同时承担候答计时：
 *   teacherQuestion  记下问句与时刻，开始候答窗
 *   teacherSpeech    教师自己接着讲 → 自答，取消候答
 *   teacherQuestion(重复)  同一问句再问一次 → 冷场候选（距上次 ≥3 秒才成立）
 *   studentAnswer    有应答 → 候答成功
 */
class SignalSource {
  constructor(onSignal) {
    this.onSignal = onSignal;
    this.pending = [];
    this.question = null; // { text, key, askedAt, repeatIndex }
    this.questionCounts = {};
    this.lastAnswerAt = 0;
    this.lastTeacherAt = 0;
    this.answerPending = null; // { text, at, matched }
  }

  emit(type, detail, extra) {
    const signal = Object.assign({ type: type, detail: detail || "", at: Date.now() }, extra || {});
    this.pending.push(signal);
    if (this.onSignal) this.onSignal(signal);
    return signal;
  }

  /** 教师问出一句。返回信号对象，streak 用于升级判断。 */
  teacherQuestion(text, at) {
    const now = at || Date.now();
    this.lastTeacherAt = now;
    const key = normalizeQuestion(text);
    if (isFillerQuestion(text)) {
      this.question = null;
      return this.emit("filler_question", "碎问，不计时", { text: text });
    }
    if (!key) {
      this.question = null;
      return this.emit("teacher_speech", "未识别到问句", { text: text });
    }

    const previous = this.question;
    const same = previous && previous.key === key;
    const waited = previous ? now - previous.askedAt : 0;
    const repeatIndex = same ? previous.repeatIndex + 1 : 1;

    if (same && (waited >= WAIT_MS || previous.expired)) {
      // 同一问句在候答窗之后重复 → 冷场（第几次重复决定提示强度）
      this.question = { text: text, key: key, askedAt: now, repeatIndex: repeatIndex };
      return this.emit("cold_response", "同一问句第 " + repeatIndex + " 次重复，仍无人应答", {
        text: text,
        key: key,
        repeatIndex: repeatIndex,
        waitedMs: waited
      });
    }
    if (same) {
      // 候答窗内就重复：教师没等够，属于急问，只记录不提示
      this.question = { text: text, key: key, askedAt: now, repeatIndex: repeatIndex, expired: false };
      return this.emit("restate_quick", "候答窗内重复提问", { text: text, repeatIndex: repeatIndex });
    }

    this.question = { text: text, key: key, askedAt: now, repeatIndex: 0, expired: false };
    return this.emit("question_asked", "教师提问", { text: text, key: key });
  }

  /** 教师继续说话（讲解、自答、追问）。 */
  teacherSpeech(text, at) {
    const now = at || Date.now();
    this.lastTeacherAt = now;
    if (this.answerPending) {
      // 教师在学生答完后开口 → 教师自己接住了，不需要追问提示
      const pending = this.answerPending;
      this.answerPending = null;
      this.question = null;
      return this.emit("teacher_followup", "教师已自行追问，撤回追问提示", { text: text, answer: pending.text });
    }
    if (this.question) {
      this.question = null;
      return this.emit("self_answer", "教师自己接话，取消候答", { text: text });
    }
    return this.emit("teacher_speech", "教师讲解", { text: text });
  }

  /** 学生应答。 */
  studentAnswer(text, at) {
    const now = at || Date.now();
    this.lastAnswerAt = now;
    this.question = null;
    this.answerPending = { text: text, at: now, matched: "" };
    return this.emit("student_answer", "学生应答", { text: text });
  }

  /**
   * 候答窗检查：由主循环每帧调用。
   * 3 秒到 → 只更新计时状态，不打断教师（研究结论：提示动作，不做效果承诺）。
   */
  checkWaitWindow(now) {
    if (!this.question) return false;
    return now - this.question.askedAt >= WAIT_MS;
  }

  /**
   * 候答窗到期 → 记一次 wait_expired（只记录，不弹提示）。
   * 问句保留在窗口里，教师重复同一问句时才能判定为冷场。
   */
  checkQuestionTimeout(now) {
    if (!this.question || this.question.expired) return false;
    if (now - this.question.askedAt < WAIT_MS) return false;
    const waited = now - this.question.askedAt;
    this.question.expired = true;
    this.emit("wait_expired", "提问后 " + (waited / 1000).toFixed(1) + " 秒仍无人应答", { waitedMs: waited });
    return true;
  }

  /** 教师手动标记事件（没有 ASR 时的兜底入口）。 */
  manual(type, detail) {
    return this.emit(type, detail || "教师手动标记");
  }
}

module.exports = {
  LEVEL: LEVEL,
  EVENT_TYPES: EVENT_TYPES,
  WAIT_MS: WAIT_MS,
  FOLLOWUP_DELAY_MS: FOLLOWUP_DELAY_MS,
  FOLLOWUP_MAX: FOLLOWUP_MAX,
  FOLLOWUP_MAX_CHARS: FOLLOWUP_MAX_CHARS,
  decideLevel: decideLevel,
  eventLevel: eventLevel,
  localAdvice: localAdvice,
  normalizeQuestion: normalizeQuestion,
  isFillerQuestion: isFillerQuestion,
  looksLikeQuestion: looksLikeQuestion,
  clampFollowup: clampFollowup,
  buildFollowup: buildFollowup,
  parseNumber: parseNumber,
  detectStageSwitch: detectStageSwitch,
  detectCountdown: detectCountdown,
  detectSkip: detectSkip,
  recentFocus: recentFocus,
  focusFollowup: focusFollowup,
  focusDemote: focusDemote,
  EventTracker: EventTracker,
  SignalSource: SignalSource
};
