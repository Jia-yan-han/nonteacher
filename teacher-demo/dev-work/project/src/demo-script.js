"use strict";

/**
 * 内置演示脚本（回放）。
 *
 * 现场没有真实学生，模拟器里也拿不到麦克风，
 * 所以把「ASR 会给出的事件流」写成脚本，按真实时间轴回放：
 *
 *   0—13 秒   冷场链路：同一问句重复 4 次 → 换问法 → 再缩一次 → 降阶
 *   13—25 秒  追问链路：学生答完给一句 ≤18 字追问；教师自己追问时撤回
 *   25—47 秒  追问上屏可读 + 碎问不计时（误报防护）
 *   47—74 秒  节奏循环：多组问答，产出可核对的延迟样本，追问用满 4 次后自动静默
 *
 * 诚实标注：这些是脚本事件，不是真实录音。
 * 运行日志一律带 source="replay"，与真实语音链路的样本分开统计。
 */

const SCRIPT = {
  name: "三秒 · 冷场降阶 · 追问一句",
  events: [
    // ——— 冷场链路：同一问句连续 4 次，每次间隔 3.6 秒（超过 3 秒候答窗）——
    { at: 1200, kind: "teacher_question", text: "谁能说说，1/2 表示什么？" },
    { at: 4800, kind: "teacher_question", text: "谁能说说，1/2 表示什么？" },
    { at: 8400, kind: "teacher_question", text: "谁能说说，1/2 表示什么？" },
    { at: 12000, kind: "teacher_question", text: "谁能说说，1/2 表示什么？" },

    // ——— 追问链路：学生答完 1.2 秒后上屏；教师自己追问 → 1.2 秒内撤回 ———
    { at: 15600, kind: "teacher_question", text: "把一个苹果平均分给两个小朋友，每人分到多少？" },
    { at: 19400, kind: "student_answer", text: "每人分到半个苹果" },
    { at: 21800, kind: "teacher_followup", text: "你是怎么知道是一半的？" },

    // ——— 追问上屏可读：这一条会在屏上停 5 秒以上 ———
    { at: 24200, kind: "teacher_question", text: "1/2 里的 2 表示什么？" },
    { at: 27800, kind: "student_answer", text: "表示平均分成了两份" },
    { at: 34000, kind: "teacher_question", text: "分母表示什么？" },

    // ——— 碎问不计时：口头禅式的「是不是这样」不进入候答窗，避免误报冷场 ———
    { at: 37600, kind: "student_answer", text: "表示分成了几份" },
    { at: 40400, kind: "teacher_question", text: "是不是这样？" },
    { at: 43800, kind: "teacher_question", text: "那分子呢？" },
    { at: 46600, kind: "student_answer", text: "表示取了其中的几份" },

    // ——— 节奏循环：产出可核对的延迟样本 ———
    { at: 49600, kind: "teacher_question", text: "3/4 怎么读？" },
    { at: 52800, kind: "student_answer", text: "四分之三" },
    { at: 56000, kind: "teacher_question", text: "4 个苹果平均分给 2 人，每人几个？" },
    { at: 59200, kind: "student_answer", text: "每人 2 个" },
    { at: 62000, kind: "teacher_question", text: "如果是 4 个分给 3 人呢？" },
    { at: 65200, kind: "student_answer", text: "不能平均分" },
    { at: 67800, kind: "teacher_question", text: "为什么不能平均分？" },
    { at: 70800, kind: "student_answer", text: "会有人多分到，有人少分到" },
    { at: 73600, kind: "teacher_speech", text: "对，这就是平均分的意思" }
  ]
};

module.exports = { SCRIPT: SCRIPT };
