"use strict";

/**
 * 事件日志与延迟测量。
 *
 * 赛题要求至少 10 次连续延迟测量，因此每条关键事件都落一行 JSONL，
 * 本地链路延迟与云端链路延迟分开统计。
 */

const fs = require("node:fs");
const path = require("node:path");

function append(file, record) {
  if (!file) return;
  try {
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
  } catch (error) {
    /* 日志失败不影响主流程 */
  }
}

function readAll(file) {
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const pos = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[pos] * 100) / 100;
}

function summarize(file) {
  const records = readAll(file);
  const local = [];
  const cloud = [];
  for (const record of records) {
    if (typeof record.localLatencyMs === "number") local.push(record.localLatencyMs);
    if (typeof record.cloudLatencyMs === "number") cloud.push(record.cloudLatencyMs);
  }
  return {
    total: records.length,
    localCount: local.length,
    cloudCount: cloud.length,
    localP50: percentile(local, 50),
    localP95: percentile(local, 95),
    localMax: local.length ? Math.max.apply(null, local) : null,
    cloudP50: percentile(cloud, 50),
    cloudP95: percentile(cloud, 95),
    cloudMax: cloud.length ? Math.max.apply(null, cloud) : null
  };
}

module.exports = {
  append: append,
  readAll: readAll,
  summarize: summarize,
  ensureDir: (dir) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      /* ignore */
    }
  },
  logPath: (dir, name) => path.join(dir, name)
};
