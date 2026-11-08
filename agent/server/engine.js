"use strict";
const { loadProvider, chatEndpoint } = require("./config");

/**
 * 引擎适配层。上面所有业务只认 streamChat / complete 这两个接口。
 * 走的都是 OpenAI 兼容的 /chat/completions，换服务商只改 baseUrl / model / query。
 */

function hasKey() { return Boolean(loadProvider().key); }

async function* streamChat(options) {
  const opts = options || {};
  const p = loadProvider();
  if (!p.key) {
    yield { type: "error", message: "还没接入模型。点右上角「未接入模型」填一下地址和密钥。" };
    return;
  }

  const body = {
    model: opts.model || p.model,
    messages: [{ role: "system", content: opts.system || "" }].concat(opts.messages || []),
    temperature: typeof opts.temperature === "number" ? opts.temperature : 0.6,
    max_tokens: opts.maxTokens || 1200,
    stream: true
  };
  // 思考强度：low 能把首字从 4.6s 压到 2.4s。
  // 写成 default / off / none 就不发这个字段（部分模型不接受）。
  const effort = String(p.reasoningEffort || "").trim();
  if (effort && !["default", "off", "none", "auto"].includes(effort)) body.reasoning_effort = effort;

  let res;
  try {
    res = await fetch(chatEndpoint(p), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + p.key },
      body: JSON.stringify(body)
    });
  } catch (e) {
    yield { type: "error", message: "连不上模型服务：" + e.message + "（检查地址是否有误、本机网络是否可达）" };
    return;
  }

  // 有些服务商不认 reasoning_effort，回 400。那就去掉再试一次，不让一个参数搞死整条链。
  if (!res.ok && body.reasoning_effort && res.status === 400) {
    const first = await res.text().catch(() => "");
    if (/reasoning|invalid param/i.test(first)) {
      const retryBody = Object.assign({}, body);
      delete retryBody.reasoning_effort;
      try {
        res = await fetch(chatEndpoint(p), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + p.key },
          body: JSON.stringify(retryBody)
        });
      } catch (e) {
        yield { type: "error", message: "连不上模型服务：" + e.message };
        return;
      }
    } else {
      yield { type: "error", message: `模型服务返回 400。${first.slice(0, 400)}` };
      return;
    }
  }

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.text()).slice(0, 500); } catch (e) { /* ignore */ }
    yield { type: "error", message: `模型服务返回 ${res.status}。${detail}` };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  // 有些推理模型会把思考过程写进 content（<think>…</think>），这里剥掉，不上屏。
  let inThink = false;
  let hold = "";
  function* strip(text) {
    hold += text;
    for (;;) {
      if (inThink) {
        const end = hold.indexOf("</think");
        if (end < 0) { hold = ""; return; }
        const close = hold.indexOf(">", end);
        if (close < 0) return;
        hold = hold.slice(close + 1);
        inThink = false;
      } else {
        const start = hold.indexOf("<think");
        if (start < 0) { if (hold) { yield hold; hold = ""; } return; }
        if (start > 0) { const out = hold.slice(0, start); hold = hold.slice(start); yield out; return; }
        const close = hold.indexOf(">");
        if (close < 0) return;
        hold = hold.slice(close + 1);
        inThink = true;
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const choice = json.choices && json.choices[0];
        // 部分服务商非流式降级时直接给 message；reasoning_content 一律忽略
        const delta = (choice && (choice.delta || choice.message)) || null;
        const text = delta && delta.content;
        if (!text) continue;
        for (const clean of strip(text)) {
          if (!clean) continue;
          full += clean;
          yield { type: "delta", text: clean };
        }
      } catch (e) { /* 半包，忽略 */ }
    }
  }

  if (hold && !inThink) {
    full += hold;
    yield { type: "delta", text: hold };
  }
  yield { type: "done", text: full };
}

/** 非流式，用于结构化产出（课次卡、复盘、沉淀）。 */
async function complete(options) {
  let out = "";
  for await (const chunk of streamChat(Object.assign({}, options, { temperature: (options && options.temperature) ?? 0.2 }))) {
    if (chunk.type === "delta") out += chunk.text;
    if (chunk.type === "error") throw new Error(chunk.message);
  }
  return out;
}

module.exports = { streamChat, complete, hasKey };
