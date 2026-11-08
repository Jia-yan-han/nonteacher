"use strict";

/**
 * 大模型适配器。
 *
 * 设计要点：
 * 1. 只有一个可替换的 endpoint。baseUrl / model / 密钥都来自运行时配置，
 *    换供应商只改 config.json，不改代码。Zion 的纯后端接口就是同一个位置。
 * 2. 密钥只从应用私有数据目录里的独立文件读，永远不写进代码或应用包。
 * 3. 失败即降级：任何错误都返回 { ok:false }，由调用方退回本地规则内核，
 *    保证没有网络、没有账号时作品依然是可运行的智能体。
 */

async function complete(config, messages) {
  if (!config.llm.enabled || !config.llm.apiKey) {
    return { ok: false, reason: "not-configured" };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);
  try {
    const response = await fetch(config.llm.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + config.llm.apiKey
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages: messages,
        temperature: 0.3,
        max_tokens: 400
      }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, reason: "http-" + response.status, ms: Date.now() - started };
    }
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      parsed = null;
    }
    const content =
      parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message
        ? parsed.choices[0].message.content
        : "";
    return { ok: true, content: String(content || ""), ms: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      reason: error && error.name === "AbortError" ? "timeout" : String((error && error.message) || error),
      ms: Date.now() - started
    };
  }
}

function buildAdvicePrompt(lesson, stage, event, history) {
  const lines = [];
  lines.push("你是一名小学教师的课堂副驾。给教师的提示必须短、具体、可直接照做。");
  lines.push("只输出三行，每行不超过 24 个汉字，不要解释，不要客套：");
  lines.push("第一行：事件判断（为什么会这样）");
  lines.push("第二行：教师可以立刻做的一步动作");
  lines.push("第三行：可以直接照读给学生的 20 字以内话术");
  lines.push("");
  lines.push("【课程】" + lesson.subject + " " + lesson.grade + "《" + lesson.topic + "》");
  lines.push("【当前环节】" + stage.name + "（目标：" + stage.goal + "）");
  lines.push("【教学重点】" + (lesson.keyPoints || []).join("；"));
  lines.push("【已知难点】" + (lesson.difficulties || []).join("；"));
  lines.push("【当前事件】" + event.type + "：" + event.detail + "（连续第 " + event.streak + " 次）");
  if (history && history.length) {
    lines.push("【刚才发生过】" + history.slice(-3).map((h) => h.type).join("、"));
  }
  return lines.join("\n");
}

function buildTeacherPrompt(lesson, stage, question, history) {
  const lines = [];
  lines.push("你是一名小学教师的课堂副驾，正在回答教师此刻的问题。");
  lines.push("只输出三行，每行不超过 24 个汉字：");
  lines.push("第一行：直接回答");
  lines.push("第二行：可以配合的一个具体动作");
  lines.push("第三行：如果学生追问，可以接的一句话");
  lines.push("");
  lines.push("【课程】" + lesson.subject + " " + lesson.grade + "《" + lesson.topic + "》");
  lines.push("【当前环节】" + stage.name + "（目标：" + stage.goal + "）");
  lines.push("【教师问题】" + question);
  if (history && history.length) {
    lines.push("【本节课已发生】" + history.slice(-5).map((h) => h.type).join("、"));
  }
  return lines.join("\n");
}

module.exports = {
  complete: complete,
  buildAdvicePrompt: buildAdvicePrompt,
  buildTeacherPrompt: buildTeacherPrompt
};
