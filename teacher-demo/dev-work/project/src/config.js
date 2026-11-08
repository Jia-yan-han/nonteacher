"use strict";

/**
 * 运行期配置。
 *
 * 合规红线：赛题要求「不得在提交材料中包含密钥」。
 * 因此应用包内只有默认配置与代码，密钥文件在演示前写入应用私有数据目录
 * （FUSIONUI_APP_DATA_DIR），由运行环境注入，不进入提交包。
 *
 * 配置分层：
 *   config.json    非敏感项（接口地址、模型名、演示开关）
 *   llm-key.txt    云端模型密钥
 *   asr-key.txt    云端 ASR 密钥
 *   script.json    演示脚本覆盖（可选）
 *   lesson.json    课前上下文覆盖（可选）
 */

const fs = require("node:fs");
const path = require("node:path");
const { applicationDataDirectory } = require("./application-data");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch (error) {
    return "";
  }
}

/** 应用私有数据目录不可用时降级为无文件模式，演示不中断。 */
function resolveDataDir() {
  try {
    return { dir: applicationDataDirectory(), ok: true, reason: "" };
  } catch (error) {
    return { dir: "", ok: false, reason: String((error && error.message) || error) };
  }
}

function loadConfig() {
  const resolved = resolveDataDir();
  const dataDir = resolved.dir;
  const config = {
    dataDir: dataDir,
    dataDirAvailable: resolved.ok,
    dataDirReason: resolved.reason,
    logFile: dataDir ? path.join(dataDir, "events.jsonl") : "",
    lessonFile: dataDir ? path.join(dataDir, "lesson.json") : "",
    scriptFile: dataDir ? path.join(dataDir, "script.json") : "",
    llm: {
      enabled: false,
      baseUrl: "",
      model: "",
      apiKey: "",
      timeoutMs: 6000
    },
    asr: {
      enabled: false,
      baseUrl: "",
      model: "",
      language: "zh",
      apiKey: "",
      timeoutMs: 5000
    },
    demo: {
      autoplay: true,
      scriptName: "内置演示脚本"
    }
  };

  if (!dataDir) return config;

  const raw = readJson(path.join(dataDir, "config.json"));
  if (raw) {
    if (raw.llm && raw.llm.baseUrl && raw.llm.model) {
      config.llm.baseUrl = String(raw.llm.baseUrl);
      config.llm.model = String(raw.llm.model);
      config.llm.timeoutMs = Number(raw.llm.timeoutMs) > 0 ? Number(raw.llm.timeoutMs) : 6000;
      config.llm.apiKey = readText(path.join(dataDir, String(raw.llm.keyFile || "llm-key.txt")));
      config.llm.enabled = Boolean(config.llm.apiKey);
    }
    if (raw.asr && raw.asr.baseUrl) {
      config.asr.baseUrl = String(raw.asr.baseUrl);
      config.asr.model = String(raw.asr.model || "");
      config.asr.language = String(raw.asr.language || "zh");
      config.asr.timeoutMs = Number(raw.asr.timeoutMs) > 0 ? Number(raw.asr.timeoutMs) : 5000;
      config.asr.apiKey = readText(path.join(dataDir, String(raw.asr.keyFile || "asr-key.txt")));
      config.asr.enabled = Boolean(config.asr.apiKey);
    }
    if (raw.demo) {
      if (typeof raw.demo.autoplay === "boolean") config.demo.autoplay = raw.demo.autoplay;
      if (raw.demo.scriptName) config.demo.scriptName = String(raw.demo.scriptName);
    }
  }

  return config;
}

module.exports = { loadConfig: loadConfig };
