"use strict";

/**
 * 语音接入：端点检测（VAD）+ 一句 ASR。
 *
 * 分两层，理由很实际：
 *
 * 1. 端点检测在本地做，用能量判决 + 静音挂起，零延迟、零成本、零依赖，
 *    它决定「教师这一句话说到哪结束」，是候答 3 秒的计时起点。
 *    这一层完全离线，可以用构造的 PCM 直接验证。
 *
 * 2. 转写走云端 ASR，只在运行时配置里给 baseUrl / model / 密钥文件，
 *    密钥不进应用包；没配置就返回 not-configured，应用显示「离线」，
 *    绝不编造转写内容。
 *
 * 这里没有写死任何一家供应商的私有协议：接口按
 * OpenAI 兼容的 /audio/transcriptions 形状写，
 * 换供应商只改 config.json，不改代码。
 */

/** 16 kHz / 单声道 / s16le，每帧 20 ms = 320 samples。 */
const FRAME_MS = 20;
/** 连续静音多久算一句话结束（挂起时间）。 */
const HANGOVER_MS = 600;
/** 连续语音多久算真的开始说话了。 */
const PREROLL_MS = 120;
/** Preserve audio before speech detection, including soft initial syllables. */
const LEADING_AUDIO_MS = 400;

/** PCM → RMS 能量。 */
function rms(pcm) {
  if (!pcm || pcm.length < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const value = pcm[i] | (pcm[i + 1] << 8);
    const sample = value > 32767 ? value - 65536 : value;
    sum += sample * sample;
    count += 1;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/**
 * 语音活动检测：把连续 PCM 帧切成一个个话段。
 *
 * 判决方式：自适应噪声底 + 绝对门限。
 * 噪声底取近期能量的低分位，阈值 = max(绝对门限, 噪声底 × 倍数)，
 * 这样在不同教室、不同麦克风增益下都能工作。
 */
class VoiceActivityDetector {
  constructor(options) {
    const opts = options || {};
    this.absoluteFloor = opts.absoluteFloor || 900;
    this.noiseFactor = opts.noiseFactor || 3.2;
    this.noiseFloor = opts.noiseFloor || 300;
    this.samplesSeen = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.buffer = [];
    this.preroll = [];
    this.bufferMs = 0;
    this.inSpeech = false;
    this.lastEndpointAt = 0;
  }

  threshold() {
    return Math.max(this.absoluteFloor, this.noiseFloor * this.noiseFactor);
  }

  /**
   * 推入一帧 PCM。
   * 返回 { active, started, ended, ms, energy }：ended 为真表示这里检测到一句话结束。
   */
  push(pcm) {
    const energy = rms(pcm);
    const ms = pcm && pcm.length ? (pcm.length / 2 / 16000) * 1000 : FRAME_MS;
    this.samplesSeen += 1;
    const threshold = this.threshold();
    const voiced = energy >= threshold;

    if (!this.inSpeech) {
      this.preroll.push(Buffer.from(pcm));
      while (this.preroll.length > Math.ceil(LEADING_AUDIO_MS / FRAME_MS)) this.preroll.shift();
    }

    if (!voiced) {
      this.noiseFloor = this.noiseFloor * 0.9 + energy * 0.1;
    }

    let started = false;
    let ended = false;

    if (voiced) {
      this.speechMs += ms;
      this.silenceMs = 0;
      if (!this.inSpeech && this.speechMs >= PREROLL_MS) {
        this.inSpeech = true;
        started = true;
        this.buffer.push(...this.preroll);
        this.bufferMs += this.preroll.length * FRAME_MS;
        this.preroll = [];
      }
      if (this.inSpeech && !started) { this.buffer.push(Buffer.from(pcm)); this.bufferMs += ms; }
      if (this.inSpeech && this.bufferMs >= 10000) { ended = true; this.inSpeech = false; this.speechMs = 0; }
    } else {
      this.speechMs = 0;
      this.silenceMs += ms;
      if (this.inSpeech) { this.buffer.push(Buffer.from(pcm)); this.bufferMs += ms; }
      if (this.inSpeech && this.silenceMs >= HANGOVER_MS) {
        ended = true;
        this.inSpeech = false;
        this.speechMs = 0;
        this.silenceMs = 0;
      }
    }

    return {
      active: this.inSpeech,
      started: started,
      ended: ended,
      ms: ms,
      energy: energy,
      threshold: threshold
    };
  }

  /** 取出自上一个端点以来累积的音频。 */
  takeUtterance() {
    if (!this.buffer.length) return null;
    const merged = Buffer.concat(this.buffer);
    this.buffer = [];
    this.bufferMs = 0;
    return merged;
  }
}

/**
 * 一句 ASR。
 *
 * 没配置就明确返回 not-configured，不猜、不编。
 * 配置了就 POST 到 baseUrl（OpenAI 兼容形状），返回转写文本。
 */
async function transcribe(config, pcm, options) {
  const asr = (config && config.asr) || {};
  if (asr.local) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch("http://127.0.0.1:48721/transcribe", { method: "POST", headers: { "Content-Type": "audio/pcm" }, body: pcm, signal: controller.signal });
      if (!response.ok) return { ok: false, reason: "http-" + response.status };
      const result = await response.json();
      return { ok: true, text: String(result.text || "") };
    } catch (error) { return { ok: false, reason: error.name === "AbortError" ? "timeout" : "local-unavailable" }; }
    finally { clearTimeout(timer); }
  }
  if (!asr.enabled || !asr.baseUrl || !asr.apiKey) {
    return { ok: false, reason: "not-configured" };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), asr.timeoutMs || 5000);
  try {
    const form = new FormData();
    form.append("file", new Blob([pcm], { type: "audio/pcm" }), "utterance.pcm");
    form.append("model", asr.model || "whisper-1");
    form.append("language", asr.language || "zh");
    const response = await fetch(asr.baseUrl, {
      method: "POST",
      headers: { authorization: "Bearer " + asr.apiKey },
      body: form,
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
    const content = parsed && parsed.text !== undefined ? parsed.text : "";
    return { ok: true, text: String(content || ""), ms: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      reason: error && error.name === "AbortError" ? "timeout" : String((error && error.message) || error),
      ms: Date.now() - started
    };
  }
}

module.exports = {
  FRAME_MS: FRAME_MS,
  HANGOVER_MS: HANGOVER_MS,
  rms: rms,
  VoiceActivityDetector: VoiceActivityDetector,
  transcribe: transcribe
};
