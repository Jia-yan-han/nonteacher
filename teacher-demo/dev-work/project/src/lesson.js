"use strict";

/**
 * 课前上下文。
 *
 * 对应产品方案第 1 项「课前教学准备」：教学目标、知识重点、教学环节、潜在难点。
 * 默认内置一份可直接演示的课次；演示前可把 lesson.json 写进应用私有数据目录覆盖。
 *
 * followups 是「追问一句」的素材库：每条 ≤18 字，且都指向本课知识点，
 * 避免退化成通用废话（调研 P04：新手缺的正是针对具体回答的追问）。
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_LESSON = {
  subject: "小学数学",
  grade: "三年级",
  topic: "认识分数",
  objectives: [
    "理解 1/2 表示把一个整体平均分成 2 份中的 1 份",
    "能用分数表示简单的量"
  ],
  keyPoints: ["平均分", "分母表示份数", "分子表示取的份数"],
  difficulties: ["分子与分母写反", "把 1/2 读成 '二分之一' 时丢掉 '平均分' 的前提"],
  followups: [
    "1/2 是怎么来的？先说分了几份",
    "你怎么知道是一半，不是三分之一",
    "整体是哪一块？指给我看",
    "这两份一样大吗",
    "如果分成 3 份呢"
  ],
  stages: [
    { id: "intro", name: "导入", minutes: 3, goal: "用分苹果引出「平均分」" },
    { id: "explain", name: "讲解", minutes: 10, goal: "讲清 1/2 的含义" },
    { id: "practice", name: "练习", minutes: 12, goal: "完成 3 道分数练习" },
    { id: "summarize", name: "收束", minutes: 5, goal: "小结并布置作业" }
  ]
};

function loadLesson(file) {
  if (!file) return DEFAULT_LESSON;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || !raw.stages || !raw.stages.length) return DEFAULT_LESSON;
    return Object.assign({}, DEFAULT_LESSON, raw);
  } catch (error) {
    return DEFAULT_LESSON;
  }
}

function stageSummary(lesson, index) {
  const stage = lesson.stages[index] || lesson.stages[0];
  return {
    id: stage.id,
    name: stage.name,
    minutes: stage.minutes,
    goal: stage.goal,
    index: index,
    total: lesson.stages.length
  };
}

/**
 * 把学生这句回答对上本课知识点。
 * 命中就用来生成「针对这个回答」的追问，没命中就退回课前关键词轮转。
 */
function matchKeyPoint(lesson, text) {
  const raw = String(text || "");
  if (!raw) return "";
  const points = (lesson && lesson.keyPoints) || [];
  for (const point of points) {
    if (raw.indexOf(point) >= 0) return point;
  }
  // 关键词的近义说法，够用即可，不做语义模型
  const aliases = {
    平均分: ["平均", "一样多", "同样多", "平分"],
    分母表示份数: ["分成", "几份", "份数"],
    分子表示取的份数: ["取了", "拿到", "其中"]
  };
  for (const point of points) {
    const words = aliases[point] || [];
    for (const word of words) {
      if (raw.indexOf(word) >= 0) return point;
    }
  }
  return "";
}

module.exports = {
  DEFAULT_LESSON: DEFAULT_LESSON,
  loadLesson: loadLesson,
  stageSummary: stageSummary,
  matchKeyPoint: matchKeyPoint
};
