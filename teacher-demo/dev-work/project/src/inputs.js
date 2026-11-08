"use strict";

/**
 * 输入接入：导航、键盘文字、麦克风音频。
 *
 * 音频部分把 16 kHz / 单声道 / s16le 的 PCM 帧转成电平用于可视化，
 * 同时保留原始字节，等 ASR 就绪时可以直接送去转写，不用重新采一次。
 */

const input = require("@irisview/osx/os/input");
function pumpNavigation(handler) {
  let action = null;
  let guard = 0;
  while (guard < 32 && (action = input.takeNavigationAction()) !== null) {
    guard += 1;
    handler(action);
  }
}

function pumpText(handler) {
  const submission = input.takeTextInput();
  if (submission && submission.text) handler(submission.text);
}

function voiceAvailability() {  try {
    return input.getVoiceInputAvailability("audio");
  } catch (error) {
    return { supported: false, declared: false, canRequest: false, ready: false, reason: String(error.message) };
  }
}

/** s16le 字节 → RMS 电平，0..1。 */
function levelFromPcm(bytes) {
  if (!bytes || bytes.length < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const value = bytes[i] | (bytes[i + 1] << 8);
    const sample = value > 32767 ? value - 65536 : value;
    sum += sample * sample;
    count += 1;
  }
  if (!count) return 0;
  const rms = Math.sqrt(sum / count);
  const level = rms / 12000;
  return level > 1 ? 1 : level;
}

class VoiceMonitor {
  constructor(handlers) {
    this.handlers = handlers || {};
    this.session = null;
    this.level = 0;
    this.frames = 0;
    this.samples = 0;
    this.startedAt = 0;
    this.lastPcm = null;
    this.lastFrame = null;
    this.reason = "";
  }

  get active() {
    return this.session !== null;
  }

  start() {
    if (this.session) return false;
    const availability = voiceAvailability();
    if (!availability.canRequest) {
      this.reason = availability.reason || "not-ready";
      if (this.handlers.onUnavailable) this.handlers.onUnavailable(availability);
      return false;
    }
    try {
      this.session = input.requestVoiceInput({ mode: "audio" });
      this.startedAt = Date.now();
      this.frames = 0;
      this.samples = 0;
      this.level = 0;
      this.reason = "";
      if (this.handlers.onStart) this.handlers.onStart();
      return true;
    } catch (error) {
      this.session = null;
      this.reason = String((error && error.message) || error);
      if (this.handlers.onUnavailable) this.handlers.onUnavailable({ reason: this.reason });
      return false;
    }
  }

  tick() {
    if (!this.session) return;
    let event = null;
    let guard = 0;
    while (guard < 128 && (event = this.session.takeEvent()) !== null) {
      guard += 1;
      if (event.type === "audio") {
        this.frames += 1;
        this.samples += event.sampleCount;
        const level = levelFromPcm(event.data);
        this.level = this.level * 0.6 + level * 0.4;
        this.lastFrame = event.data;
        if (this.handlers.onFrame) {
          this.handlers.onFrame({ sequence: event.sequence, sampleCount: event.sampleCount, data: event.data });
        }
      } else if (event.type === "state") {
        if (this.handlers.onState) this.handlers.onState(event.state, event.reason);
      } else if (event.type === "end") {
        this.lastPcm = this.pcmChunks || null;
        const durationMs = Date.now() - this.startedAt;
        this.session = null;
        if (this.handlers.onEnd) {
          this.handlers.onEnd({
            status: event.status,
            reason: event.reason,
            frames: this.frames,
            samples: this.samples,
            durationMs: durationMs
          });
        }
        this.frames = 0;
        this.samples = 0;
        this.level = 0;
        return;
      }
    }
  }

  stop() {
    if (!this.session) return;
    this.session.finish();
  }
}

/** 导航通道是否已连接（前台应用 + 已声明 input.navigation）。 */
function navigationAvailability() {
  try {
    if (typeof input.isNavigationAvailable === "function") return { available: input.isNavigationAvailable() };
    return { available: null, reason: "api-missing" };
  } catch (error) {
    return { available: false, reason: String((error && error.message) || error) };
  }
}

module.exports = {
  pumpNavigation: pumpNavigation,
  pumpText: pumpText,
  voiceAvailability: voiceAvailability,
  navigationAvailability: navigationAvailability,
  levelFromPcm: levelFromPcm,
  VoiceMonitor: VoiceMonitor
};
