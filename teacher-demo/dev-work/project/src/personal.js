"use strict";
const fs = require("node:fs");
const path = require("node:path");

class PersonalMemory {
  constructor(directory, teacherId) {
    if (!directory || !path.isAbsolute(directory)) throw new Error("个人数据目录不可用");
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(teacherId)) throw new Error("教师身份无效");
    this.file = path.join(directory, "personal-" + teacherId + ".json");
    this.teacherId = teacherId;
    this.preferences = {};
    this.pending = null;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (data.teacherId !== teacherId || !data.preferences || typeof data.preferences !== "object") throw new Error("个人数据无效");
      this.preferences = data.preferences;
    } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  propose(text) {
    const update = {};
    if (/简短|简洁/.test(text)) update.concise = true;
    if (/一条|一个/.test(text) && /建议|提醒/.test(text)) update.maxOptions = 1;
    if (/少提醒|提醒.*少|提醒.*多/.test(text)) update.frequency = "less";
    if (!Object.keys(update).length) return false;
    this.pending = update;
    return true;
  }
  confirm() {
    if (!this.pending) return false;
    const at = new Date().toISOString();
    const next = { ...this.preferences };
    for (const [key, value] of Object.entries(this.pending)) next[key] = { value, source: "teacher-confirmed", confirmedAt: at, scope: "future" };
    const temp = this.file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify({ teacherId: this.teacherId, preferences: next }, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
    this.preferences = next;
    this.pending = null;
    return true;
  }
  values() { return Object.fromEntries(Object.entries(this.preferences).map(([k, v]) => [k, v.value])); }
  clear() {
    try { fs.unlinkSync(this.file); } catch (e) { if (e.code !== "ENOENT") throw e; }
    this.preferences = {};
    this.pending = null;
  }
}
module.exports = { PersonalMemory };
