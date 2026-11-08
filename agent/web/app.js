"use strict";

const S = {
  courses: [], inbox: [], kb: [], hasKey: false,
  view: "home", courseId: null, course: null,
  panel: "classroom", convId: null, conv: null, busy: false
};

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function api(url, options) {
  const r = await fetch(url, options);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "HTTP " + r.status);
  return data;
}
const get = url => api(url);
const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

/* ---------------- 启动 ---------------- */

async function boot() {
  const st = await get("/api/state");
  S.courses = st.courses || [];
  S.inbox = st.inbox || [];
  S.kb = st.kb || [];
  S.hasKey = st.hasKey;
  paintConn();
  render();
  refreshDeviceStatus();
  setInterval(refreshDeviceStatus, 3000);
}

function microphoneLabel(mic) {
  const state = (mic || {}).state;
  const labels = { pending: "等待麦克风授权", recording: "麦克风采集中", cancelling: "正在停止麦克风", ended: "麦克风已停止", unavailable: "麦克风不可用", idle: "麦克风未启动", unknown: "麦克风状态未知" };
  return labels[state] || "麦克风状态未知";
}
async function refreshDeviceStatus() {
  try {
    const state = await get("/api/app/status");
    const s = state.bridge;
    const global = $("#deviceStatus");
    if (global) { global.textContent = s.online ? "模拟器已连接" : "模拟器未连接"; global.className = "device-status " + (s.online ? "online" : "offline"); }
    const asr = $("#asrStatus");
    if (asr) { asr.textContent = state.asr.ready ? "本地语音识别已就绪" : "本地语音识别未就绪"; asr.className = "device-status " + (state.asr.ready ? "online" : "offline"); }
    const line = $("#liveDeviceStatus");
    if (line) line.textContent = s.online ? "模拟器已连接 · " + microphoneLabel(s.microphone) : "模拟器未连接";
    const card = $("#liveCardStatus");
    if (card) card.textContent = s.online && s.dispatched && s.activeCourseId === S.courseId && s.activeSessionId === s.sessionId ? "眼镜已收到当前课次卡" : s.dispatched && s.cardCourseId === S.courseId ? "课次卡已下发，等待眼镜确认" : "当前课程尚未下发课次卡";
    const detail = $("#liveMicDetail");
    if (detail) detail.textContent = s.online && s.microphone ? (s.microphone.error || (s.microphone.reason && s.microphone.reason !== "none" ? "麦克风状态：" + s.microphone.reason : "")) : "";
    const resume = $("#resumeClass");
    if (resume) {
      const matches = s.online && s.activeCourseId === S.courseId && s.activeSessionId === s.sessionId;
      resume.hidden = !(matches && s.phase !== "class");
    }
  } catch (_) {
    const global = $("#deviceStatus");
    if (global) { global.textContent = "模拟器状态不可用"; global.className = "device-status offline"; }
  }
}

function paintConn() {
  const n = $("#conn");
  n.className = "conn " + (S.hasKey ? "ok" : "bad");
  n.innerHTML = `<i></i>${S.hasKey ? "模型已接入" : "未接入模型"}<span class="conn-edit">设置</span>`;
  n.onclick = openSettings;
}

/* ---------------- 接入设置 ---------------- */

const PRESETS = [
  { name: "MiniMax", baseUrl: "https://api.minimax.cn/v1", model: "MiniMax-M3.1-Flash" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "阿里百炼", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { name: "火山方舟", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-1-6" }
];

async function openSettings() {
  let s;
  try { s = await get("/api/settings"); }
  catch (e) { say(e.message); return; }

  openModal(`
    <h2>接入模型</h2>
    <p class="why">任何 OpenAI 兼容接口都能用。地址填到 /v1 就行，后面的路径会自动补。</p>
    <div class="presets">
      ${PRESETS.map(p => `<button class="chip" data-preset="${esc(p.baseUrl)}|${esc(p.model)}">${esc(p.name)}</button>`).join("")}
    </div>
    <label class="field"><span>接口地址</span>
      <input type="text" id="setBase" class="text" value="${esc(s.baseUrl)}" placeholder="https://api.minimax.chat/v1" />
    </label>
    <label class="field"><span>模型名</span>
      <input type="text" id="setModel" class="text" value="${esc(s.model)}" placeholder="MiniMax-M2" />
    </label>
    <label class="field"><span>密钥</span>
      <input type="text" id="setKey" class="text" placeholder="${s.hasKey ? "已保存 ····" + esc(s.keyTail) + "，留空则不修改" : "粘贴你的 API Key"}" />
    </label>
    <label class="field"><span>思考强度</span>
      <select id="setEffort" class="text">
        <option value="low">low · 快（首字约 2.4 秒）</option>
        <option value="default">默认 · 深（首字约 4.6 秒）</option>
      </select>
    </label>
    <label class="field"><span>附加参数（可空）</span>
      <input type="text" id="setQuery" class="text" value="${esc(s.query)}" placeholder="例如 GroupId=123456" />
    </label>
    <p class="tiny">当前实际请求地址：<code>${esc(s.endpoint)}</code></p>
    <div class="acts">
      <button class="quiet" id="setCancel">取消</button>
      <button class="primary" id="setSave">保存并测一下</button>
    </div>`);

  $("#dialog").querySelectorAll("[data-preset]").forEach(b => b.onclick = () => {
    const [baseUrl, model] = b.dataset.preset.split("|");
    $("#setBase").value = baseUrl;
    $("#setModel").value = model;
  });
  $("#setCancel").onclick = closeDialog;
  $("#setEffort").value = (s.reasoningEffort === "default" || !s.reasoningEffort) ? "default" : "low";
  $("#setSave").onclick = async () => {
    const btn = $("#setSave");
    btn.disabled = true; btn.textContent = "正在连接…";
    try {
      await post("/api/settings", {
        baseUrl: $("#setBase").value,
        model: $("#setModel").value,
        key: $("#setKey").value,
        query: $("#setQuery").value,
        reasoningEffort: $("#setEffort").value
      });
      const r = await post("/api/settings/test", {});
      await refreshState();
      paintConn();
      openModal(`
        <h2>接通了</h2>
        <p class="why">模型回了一句：${esc(r.reply || "（空）")}</p>
        <div class="acts"><button class="primary" id="okDone">好</button></div>`);
      $("#okDone").onclick = closeDialog;
    } catch (e) {
      await refreshState();
      paintConn();
      openModal(`
        <h2>没接通</h2>
        <p class="why">${esc(e.message)}</p>
        <p class="tiny">配置已经存下来了，改完再点一次右上角就能重试。</p>
        <div class="acts"><button class="primary" id="okDone">知道了</button></div>`);
      $("#okDone").onclick = closeDialog;
    }
  };
  $("#setBase").focus();
}

async function refreshState() {
  const st = await get("/api/state");
  S.courses = st.courses || [];
  S.inbox = st.inbox || [];
  S.kb = st.kb || [];
}

function paintNav() {
  document.querySelectorAll("#globalNav button").forEach(b => {
    b.classList.toggle("on", b.dataset.nav === S.view);
  });
}

function render() {
  paintNav();
  if (S.view === "home") return paintHome();
  if (S.view === "library") return paintLibrary();
  if (S.view === "inbox") return paintInbox();
  if (S.view === "kb") return paintKb();
  if (S.view === "course") return paintCourse();
}

function go(view) {
  S.view = view;
  if (view !== "course") { S.courseId = null; S.course = null; }
  render();
}

/* ---------------- 首页 ---------------- */

function paintHome() {
  const door = (nav, title, desc, count) => `
    <button class="door" data-nav="${nav}">
      <b>${title}</b>
      <span class="desc">${desc}</span>
      <span class="door-foot"><em>${count}</em><span class="door-go">进去</span></span>
    </button>`;

  const recent = S.courses[0];
  $("#view").innerHTML = `
    <div class="home">
      <div class="home-inner">
        <div class="home-kicker">教学工作台</div>
        <div class="home-hero">
          <span class="home-eyebrow">让备课、课堂和复盘连起来</span>
          <h1>把注意力留给课堂。</h1>
          <p class="lead">一堂课，从准备到复盘，有条理地留在这里。</p>
        </div>
        <div class="home-content">
          <section class="home-course">
            <div class="home-section-head"><h2>课程</h2><button class="text-link" data-nav="library">查看课程库</button></div>
            ${recent ? `<div class="home-course-card"><span class="home-eyebrow">${esc([recent.subject, recent.grade].filter(Boolean).join(" · ") || "我的课程")}</span><h3>${esc(recent.name)}</h3><p>围绕同一堂课整理备课、课堂和复盘。</p><div class="home-phases"><span>备课</span><span>课堂</span><span>复盘</span></div><button class="primary" id="homeRecent">进入课程</button></div>` : `<div class="home-course-card"><h3>开始准备第一堂课</h3><p>从课程库新建课程，再整理这节课的想法。</p><button class="primary" data-nav="library">前往课程库</button></div>`}
          </section>
          <aside class="home-workspace"><h2>你的工作空间</h2>
            <div class="doors">
              ${door("library", "课程库", "每堂课的备课、课堂与复盘", S.courses.length)}
              ${door("inbox", "待整理", "为对话找到所属课程", S.inbox.length)}
              ${door("kb", "知识库", "整理课件和教学资料", (S.kb || []).length)}
            </div>
            <p class="home-note">准备一堂课时，可以先从对话开始，慢慢整理成课次卡。</p>
          </aside>
        </div>
      </div>
    </div>`;
  $("#view").querySelectorAll("[data-nav]").forEach(b => b.onclick = () => go(b.dataset.nav));
  if (recent) $("#homeRecent").onclick = () => openCourse(recent.id);
}

/* ---------------- 课程库 ---------------- */

function tally(c) {
  return `<span class="tally">
    <span><u>备课</u>${c.prepare}</span>
    <span><u>课堂</u>${c.classroom}</span>
    <span><u>复盘</u>${c.review}</span>
  </span>`;
}

function paintLibrary() {
  const rows = S.courses.length
    ? S.courses.map(c => `
      <button class="row" data-course="${c.id}">
        <span class="name">
          <b>${esc(c.name)}</b>
          <span>${[c.subject, c.grade].filter(Boolean).join(" ") || "未填学科年级"}</span>
        </span>
        ${tally(c.counts)}
        <span class="stage ${c.stage === "空壳" ? "zero" : ""}">${esc(c.stage)}</span>
      </button>`).join("")
    : `<div class="void">还没有课。<br>从右上角新建第一堂课。</div>`;

  $("#view").innerHTML = `
    <div class="split">
      <main class="listarea library-page">
        <div class="list-heading"><div><h1>课程库</h1><p class="sub">查看和管理课程</p></div><button class="primary" id="newCourse">新建一堂课</button></div>
        ${rows}
      </main>
    </div>`;

  $("#newCourse").onclick = newCourse;
  $("#view").querySelectorAll("[data-course]").forEach(b => b.onclick = () => openCourse(b.dataset.course));
}

async function newCourse() {
  const fields = await courseFields();
  if (!fields) return;
  const c = await post("/api/course", fields);
  await refreshState();
  await openCourse(c.id);
}

function courseFields(meta) {
  const editing = Boolean(meta);
  return new Promise(resolve => {
    openModal(`<h2>${editing ? "编辑课程信息" : "新建一堂课"}</h2>
      <p class="why">${editing ? "修改课程的学科和年级。已导入的课次卡不会自动修改。" : "填写课程名称，学科和年级可以稍后补充。"}</p>
      ${editing ? "" : `<label class="field-label" for="courseName">课程名称</label><input id="courseName" class="text" maxlength="100" placeholder="例如：认识分数">`}
      <label class="field-label" for="courseSubject">学科</label><input id="courseSubject" class="text" maxlength="50" value="${esc(meta ? meta.subject : "")}" placeholder="例如：数学">
      <label class="field-label" for="courseGrade">年级</label><input id="courseGrade" class="text" maxlength="50" value="${esc(meta ? meta.grade : "")}" placeholder="例如：三年级">
      <p class="bmeta red" id="courseFieldError" role="alert"></p>
      <div class="acts"><button class="quiet" id="courseCancel">取消</button><button class="primary" id="courseSave">${editing ? "保存" : "创建课程"}</button></div>`);
    const finish = value => { closeDialog(); resolve(value); };
    $("#courseCancel").onclick = () => finish(null);
    $("#courseSave").onclick = () => {
      const name = editing ? "" : $("#courseName").value.trim();
      if (!editing && !name) { $("#courseFieldError").textContent = "请填写课程名称"; return; }
      finish({ ...(editing ? {} : {name}), subject: $("#courseSubject").value.trim(), grade: $("#courseGrade").value.trim() });
    };
    $(editing ? "#courseSubject" : "#courseName").focus();
  });
}

async function editCourseInfo() {
  const fields = await courseFields(S.course.meta);
  if (!fields) return;
  try {
    await post(`/api/course/${S.courseId}`, fields);
    S.course = await get(`/api/course/${S.courseId}`);
    await refreshState();
    paintCourse();
  } catch (e) { say("保存失败：" + e.message); }
}

/* ---------------- 待整理 ---------------- */

function paintInbox() {
  const rows = S.inbox.length
    ? S.inbox.map(v => `
      <button class="row" data-conv="${v.id}">
        <span class="name"><b>${esc(v.title)}</b><span>${esc((v.createdAt || "").slice(0, 16).replace("T", " "))}</span></span>
        <span class="stage">未挂靠</span>
      </button>`).join("")
    : `<div class="void">没有待整理的对话。<br>在这里开的对话不属于任何一堂课，直到你把它挂上去。</div>`;

  $("#view").innerHTML = `
    <div class="split">
      <main class="listarea library-page">
        <div class="list-heading"><div><h1>待整理</h1><p class="sub">先聊起来，聊完再决定它属于哪堂课</p></div><button class="primary" id="newInbox">新建对话</button></div>
        ${rows}
      </main>
    </div>`;

  $("#newInbox").onclick = async () => {
    const title = await askText({
      title: "新建对话",
      hint: "这段对话还不属于任何课，聊完再决定挂到哪。",
      placeholder: "备课对话",
      okText: "开始聊"
    });
    if (!title) return;
    const v = await post("/api/conversation", { title, type: "prepare", courseId: null });
    await refreshState();
    await openConversation(v.id);
  };
  $("#view").querySelectorAll("[data-conv]").forEach(b => b.onclick = () => openConversation(b.dataset.conv));
}

/* ---------------- 知识库 ---------------- */

const SOURCE_CN = { paste: "粘贴", "local-file": "本机文件", generated: "AI 生成" };
const sizeText = n => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : n > 1024 ? Math.round(n / 1024) + " KB" : (n || 0) + " B");

function paintKb() {
  const files = S.kb || [];
  const cats = {};
  files.forEach(f => { cats[f.category] = (cats[f.category] || 0) + 1; });
  const catList = Object.keys(cats).length
    ? Object.entries(cats).map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${v}</b></div>`).join("")
    : `<p class="hint">还没有分类</p>`;

  const cards = files.length
    ? files.map(f => `
      <button class="kcard" data-file="${esc(f.file)}">
        <span class="kname">${esc(f.name)}</span>
        <span class="kmeta">${esc(f.category)}　${SOURCE_CN[f.source] || f.source}　${sizeText(f.size)}　${f.readable ? "已提取文字" : "未提取文字"}${(f.warnings || []).length ? " · 有解析提示" : ""}</span>
        <span class="ktime">${esc((f.addedAt || "").slice(5, 16).replace("T", " "))}</span>
      </button>`).join("")
    : `<div class="void">知识库是空的。<br>从电脑导入资料，或者在对话里把讨论沉淀下来。</div>`;

  $("#view").innerHTML = `
    <div class="split">
      <main class="listarea library-page">
        <div class="list-heading"><div><h1>知识库</h1><p class="sub">${files.length} 份材料。原件保存在本机；备课对话会按模型配置发送相关文字。提到“课件”时默认使用最近一份可读取材料，也可在对话中指定文件名。</p></div></div>
        <div class="kb-actions"><select id="importCat" class="text" aria-label="导入分类"><option>课件</option><option>我的文本</option><option>调研</option><option>设想</option><option>资料</option></select><button class="primary" id="importFile">从电脑导入</button><button class="quiet" id="pasteDoc">粘贴一段文本</button></div>
        <details class="kb-categories"><summary>资料分类</summary>${catList}</details>
        <div class="kcards">${cards}</div>
        <div id="kbPreview" class="kbpreview"></div>
      </main>
    </div>`;

  $("#importFile").onclick = openFileBrowser;
  $("#pasteDoc").onclick = pasteDialog;
  $("#view").querySelectorAll("[data-file]").forEach(b => b.onclick = () => previewFile(b.dataset.file));
}

function pasteDialog() {
  $("#dialog").innerHTML = `
    <h2>粘贴一段文本</h2>
    <p class="why">存进知识库后，对话时会自动被检索到。</p>
    <input type="text" id="kbName" placeholder="文件名，如 第三单元教案.md" class="text" />
    <select id="kbCat" class="text"><option>课件</option><option>我的文本</option><option>调研</option><option>设想</option></select>
    <textarea id="kbContent" rows="7" placeholder="粘贴内容" class="text"></textarea>
    <div class="acts"><button class="quiet" id="kbCancel">取消</button><button class="primary" id="kbOk">存进去</button></div>`;
  $("#overlay").hidden = false;
  $("#kbCancel").onclick = closeDialog;
  $("#kbOk").onclick = async () => {
    const name = $("#kbName").value.trim(), content = $("#kbContent").value.trim();
    if (!name || !content) return;
    await post("/api/kb", { name, content, category: $("#kbCat").value });
    await refreshState(); closeDialog(); paintKb();
  };
}

/* ---------- 从电脑导入（系统文件选择框） ---------- */

function openFileBrowser() {
  const picker = $("#filePicker");
  picker.value = "";
  picker.click();
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    fr.onerror = () => reject(new Error("读取失败"));
    fr.readAsDataURL(file);
  });
}

async function handlePickedFiles(files) {
  if (!files || !files.length) return;
  const catNode = $("#importCat");
  const category = catNode ? catNode.value : "资料";
  const btn = $("#importFile");
  const old = btn ? btn.textContent : "";
  if (btn) btn.disabled = true;

  let ok = 0;
  const failed = [];
  const notices = [];
  for (const f of files) {
    if (btn) btn.textContent = `正在导入 ${ok + 1}/${files.length}`;
    try {
      const data = await readAsBase64(f);
      const result = await post("/api/kb/upload", { name: f.name, data, category });
      ok += 1;
      if (!result.readable || (result.warnings || []).length) notices.push(f.name + "：" + ((result.warnings || []).join("；") || "未提取到文字"));
    } catch (e) {
      failed.push(f.name + "：" + e.message);
    }
  }

  await refreshState();
  paintKb();
  if (failed.length) say(`${ok} 份已入库，${failed.length} 份失败：\n` + failed.join("\n"));
  else if (notices.length) say("文件已保存，解析提示：\n" + notices.join("\n"));
}

/* ---------- 预览 ---------- */

async function previewFile(rel) {
  const box = $("#kbPreview");
  box.innerHTML = `<p class="hint">正在读…</p>`;
  try {
    const item = (S.kb || []).find(f => f.file === rel) || {};
    const warnings = (item.warnings || []).map(esc).join("；");
    if (!item.readable) {
      box.innerHTML = `<div class="pv-head"><b>${esc(rel)}</b><button class="quiet" id="reparseFile">重新提取文字</button><button class="quiet" id="delFile">从知识库移除</button></div><p class="hint">${warnings || "未提取文字，可尝试重新提取。"}</p>`;
      $("#reparseFile").onclick = () => reparseFile(rel);
      $("#delFile").onclick = () => removeKbFile(rel);
      return;
    }
    const d = await get("/api/kb/file?file=" + encodeURIComponent(rel));
    box.innerHTML = `
      <div class="pv-head">
        <b>${esc(rel)}</b>
        <button class="quiet" id="reparseFile">重新提取文字</button>
        <button class="quiet" id="delFile">从知识库移除</button>
      </div>
      ${warnings ? `<p class="hint">${warnings}</p>` : ""}
      <pre class="pv-body">${esc(d.text)}</pre>`;
    $("#reparseFile").onclick = () => reparseFile(rel);
    $("#delFile").onclick = () => removeKbFile(rel);
  } catch (e) {
    box.innerHTML = `<p class="hint">读不出来：${esc(e.message)}</p>`;
  }
}

async function removeKbFile(rel) {
  const yes = await askConfirm({ title:"从知识库移除", body:"会删掉知识库里的这份副本，你电脑上的原文件不受影响。", okText:"移除" });
  if (!yes) return;
  await post("/api/kb/delete", {file:rel});
  await refreshState(); paintKb();
}

async function reparseFile(rel) {
  const box = $("#kbPreview");
  box.innerHTML = `<p class="hint">正在提取文字，请稍候…</p>`;
  try {
    await post("/api/kb/reindex", {file:rel});
    await refreshState();
    paintKb();
    await previewFile(rel);
  } catch (e) { box.textContent = "提取失败：" + e.message; }
}


/* ---------------- 课程内 ---------------- */

async function openCourse(id) {
  S.view = "course";
  S.courseId = id;
  S.course = await get("/api/course/" + id);
  S.panel = S.course.conversations.prepare.length ? "conversation" : "classroom";
  S.convId = S.course.conversations.prepare.length
    ? S.course.conversations.prepare[S.course.conversations.prepare.length - 1].id
    : null;
  S.conv = S.convId ? await get("/api/conversation/" + S.convId) : null;
  render();
}

async function openConversation(convId) {
  S.convId = convId;
  S.panel = "conversation";
  S.conv = await get("/api/conversation/" + convId);
  if (S.conv.meta.courseId) {
    S.view = "course";
    S.courseId = S.conv.meta.courseId;
    S.course = await get("/api/course/" + S.courseId);
  } else {
    S.view = "course";
    S.course = null;
  }
  render();
}

function paintCourse() {
  if (!S.course) return paintUnlinkedConversation();

  const c = S.course;
  const conv = c.conversations;
  const cls = c.classroom;
  const clsLabel = cls.meta.state === "live" ? "上课中" : cls.card ? "已就绪" : "未开始";

  const entry = (id, title, active, sub, flag) => `
    <button class="entry ${active ? "on" : ""}" data-conv="${id}">
      ${esc(title)}<span class="sub">${sub}${flag ? ` <span class="flag">${flag}</span>` : ""}</span>
    </button>`;

  const tree = `
    <div class="course-bar"><div class="course-identity"><button id="backLib">课程库</button><span>/</span><strong>${esc(c.meta.name)}</strong><button id="editCourse" class="edit-course">编辑学科年级</button></div>
    <nav class="course-tabs" aria-label="课程阶段">
    <details class="course-menu"><summary class="course-tab ${S.panel === "conversation" && S.conv && S.conv.meta.type === "prepare" ? "on" : ""}">备课 <span>${conv.prepare.length}</span></summary><div class="course-menu-panel">
      <div class="group-head"><span>备课对话</span><button data-new="prepare">新建</button></div>
      ${conv.prepare.length
        ? conv.prepare.map(v => entry(v.id, v.title, S.panel === "conversation" && S.convId === v.id,
            v.importedToClassroom ? "已导入课堂" : "备课", "")).join("")
        : `<div class="none">还没有</div>`}
    </div></details>
    <button class="course-tab ${S.panel === "classroom" ? "on" : ""}" data-panel="classroom">课堂 <span>${esc(clsLabel)}</span></button>
    <details class="course-menu"><summary class="course-tab ${S.panel === "conversation" && S.conv && S.conv.meta.type === "review" ? "on" : ""}">复盘 <span>${conv.review.length}</span></summary><div class="course-menu-panel">
      <div class="group-head"><span>复盘对话</span><button data-new="review">新建</button></div>
      ${conv.review.length
        ? conv.review.map(v => entry(v.id, v.title, S.panel === "conversation" && S.convId === v.id, "复盘", "")).join("")
        : `<div class="none">还没有</div>`}
    </div></details></nav>
    <details class="course-info"><summary>课程信息</summary><aside class="rail" id="rail"></aside></details></div>`;

  $("#view").innerHTML = `
    <div class="course-workspace">${tree}<main class="stage-col" id="stage"></main></div>`;

  $("#backLib").onclick = () => go("library");
  $("#editCourse").onclick = editCourseInfo;
  $("#view").querySelectorAll("[data-conv]").forEach(b => b.onclick = () => openConversation(b.dataset.conv));
  $("#view").querySelectorAll("[data-panel]").forEach(b => b.onclick = () => {
    S.panel = b.dataset.panel; paintCourse();
  });
  $("#view").querySelectorAll("[data-new]").forEach(b => b.onclick = () => newConversation(b.dataset.new));

  if (S.panel === "conversation") paintConversation();
  else if (S.panel === "classroom") paintClassroom();
  else paintReview();
  paintRail();
}

async function newConversation(type) {
  const title = await askText({
    title: type === "review" ? "新建复盘对话" : "新建备课对话",
    hint: type === "review" ? `将参考本节课的课次卡和课堂记录（${S.course.classroom.events.length} 条事件）；记录可能不完整。` : "这节课怎么上，先把它聊清楚。",
    placeholder: type === "review" ? "复盘对话" : "备课对话",
    okText: "开始聊"
  });
  if (!title) return;
  const v = await post("/api/conversation", { title, type, courseId: S.courseId });
  S.course = await get("/api/course/" + S.courseId);
  await refreshState();
  await openConversation(v.id);
}

/* 未挂靠对话（从"待整理"点进来） */
function paintUnlinkedConversation() {
  const v = S.conv;
  $("#view").innerHTML = `
    <aside class="tree">
      <div class="crumb"><button id="backInbox">待整理</button></div>
      <div class="course-name">${esc(v.meta.title)}</div>
      <div class="none">还没挂到任何课上</div>
    </aside>
    <main class="stage-col">
      <div class="head">
        <div><h1>${esc(v.meta.title)}</h1><div class="meta">不属于任何一堂课</div></div>
        <div class="tools"><button class="primary" id="linkBtn">整理并挂靠</button></div>
      </div>
      <div class="scroll"><div class="thread" id="thread"></div></div>
      <div class="compose">
        <textarea id="input" rows="1" placeholder="先聊起来，聊完再决定它属于哪堂课"></textarea>
        <button class="primary" id="send">发送</button>
      </div>
    </main>
    <aside class="rail">
      <div class="part"><h3>这段对话</h3>
        <div class="kv"><span>消息</span><b>${v.messages.length} 条</b></div>
        <div class="kv"><span>归属</span><b>待整理</b></div>
      </div>
      <div class="part"><h3>说明</h3>
        <p class="hint">对话可以先建，但不能直接导入课堂。点"整理并挂靠"，它先判断这段是为哪堂课准备的，你确认了才往下走。</p>
      </div>
    </aside>`;

  $("#backInbox").onclick = () => go("inbox");
  bindThread();
  $("#linkBtn").onclick = () => startLinkFlow(v.meta.id);
}

/* ---------------- 对话 ---------------- */

function bindThread() {
  const thread = $("#thread");
  (S.conv.messages || []).filter(m => m.role !== "system").forEach(m => {
    thread.appendChild(turn(m.role === "assistant" ? "other" : "mine", m.content));
  });
  thread.parentElement.scrollTop = thread.parentElement.scrollHeight;
  $("#send").onclick = sendMessage;
  $("#input").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $("#input").addEventListener("input", e => {
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 170) + "px";
  });
  $("#input").focus();
}

function turn(kind, text) {
  const d = document.createElement("div");
  d.className = "turn " + kind;
  d.innerHTML = `<div class="who">${kind === "mine" ? "我" : "搭档"}</div><div class="body"></div>`;
  d.querySelector(".body").textContent = text;
  return d;
}

function paintConversation() {
  if (!S.conv) {
    $("#stage").innerHTML = `<div class="void">这堂课还没有备课对话。<br>左上角"新建"，把这节课怎么上聊出来。</div>`;
    return;
  }
  const v = S.conv.meta;
  const imported = v.importedToClassroom;

  $("#stage").innerHTML = `
    <div class="head">
      <div><h1>${esc(v.title)}</h1><div class="meta">${v.type === "review" ? `复盘对话 · 参考课次卡和 ${S.course.classroom.events.length} 条课堂事件` : "备课对话"}${imported ? " · 已导入课堂" : ""}</div></div>
      <div class="tools">
        <button class="quiet" id="distillBtn">${v.type === "review" ? "保存复盘文档" : "沉淀成文档"}</button>
        ${v.type === "prepare" ? `<button class="quiet" id="importBtn">${imported ? "重新导入课堂" : "导入到课堂"}</button>` : ""}
      </div>
    </div>
    <div class="scroll"><div class="thread" id="thread"></div></div>
    <div class="compose">
      <textarea id="input" rows="1" placeholder="${v.type === "review" ? "例如：请根据课堂记录，帮我复盘这节课" : "输入备课内容"}"></textarea>
      <button class="primary" id="send">发送</button>
    </div>`;
  bindThread();
  $("#distillBtn").onclick = () => distill(v.id);
  const btn = $("#importBtn");
  if (btn) btn.onclick = () => doImport(v.id);
}

async function sendMessage() {
  if (S.busy) return;
  const input = $("#input");
  const text = input.value.trim();
  if (!text) return;
  input.value = ""; input.style.height = "auto";
  S.busy = true; $("#send").disabled = true;

  const thread = $("#thread");
  thread.appendChild(turn("mine", text));
  const reply = turn("other", "");
  reply.querySelector(".body").innerHTML = '<span class="caret"></span>';
  thread.appendChild(reply);
  const scroll = thread.parentElement;
  scroll.scrollTop = scroll.scrollHeight;

  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ convId: S.convId, text })
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      reply.className = "turn err";
      reply.innerHTML = `<div class="body">${esc(e.error || ("HTTP " + res.status))}</div>`;
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let ch; try { ch = JSON.parse(payload); } catch (e) { continue; }
        if (ch.type === "delta") {
          full += ch.text;
          reply.querySelector(".body").textContent = full;
          scroll.scrollTop = scroll.scrollHeight;
        } else if (ch.type === "error") {
          reply.className = "turn err";
          reply.innerHTML = `<div class="body">${esc(ch.message)}</div>`;
        }
      }
    }
    if (full) S.conv.messages.push({ role: "assistant", content: full });
  } catch (e) {
    reply.className = "turn err";
    reply.innerHTML = `<div class="body">请求失败：${esc(e.message)}</div>`;
  } finally {
    S.busy = false; $("#send").disabled = false; $("#input").focus();
  }
}

/* ---------------- 沉淀成文档 ---------------- */

async function distill(convId) {
  const btn = $("#distillBtn");
  btn.disabled = true; btn.textContent = "正在整理…";
  try {
    const r = await post("/api/distill", { convId });
    await refreshState();
    btn.textContent = "已存入知识库";
    const box = document.createElement("div");
    box.className = "turn";
    box.innerHTML = `<div class="who">系统</div><div class="body" style="font-size:13px;color:var(--ink-3)">已存入知识库：${esc(r.file)}（${r.chunks} 段）</div>`;
    $("#thread").appendChild(box);
    $("#thread").parentElement.scrollTop = $("#thread").parentElement.scrollHeight;
  } catch (e) {
    say(e.message);
    btn.disabled = false; btn.textContent = S.conv && S.conv.meta.type === "review" ? "保存复盘文档" : "沉淀成文档";
  }
}

/* ---------------- 挂靠 → 导入 ---------------- */

let pending = { convId: null, courseId: null };

async function startLinkFlow(convId) {
  let sug;
  try { sug = await post("/api/analyze", { convId }); }
  catch (e) { say(e.message); return; }

  pending.convId = convId;
  pending.courseId = sug.courseId || null;

  const options = [];
  if (sug.courseId) options.push({ id: sug.courseId, name: sug.name, note: sug.reason, on: true });
  (sug.alternatives || []).forEach(a => { if (a.courseId !== sug.courseId) options.push({ id: a.courseId, name: a.name, note: "", on: false }); });

  const list = options.length
    ? options.map(o => `<button class="pick ${o.on ? "on" : ""}" data-pick="${o.id}">
        <b>${esc(o.name)}</b>${o.note ? `<span>${esc(o.note)}</span>` : ""}
      </button>`).join("")
    : `<p class="why">没有找到对得上的课。新建一堂，或者先回去把课说出来。</p>`;

  $("#dialog").innerHTML = `
    <h2>这段对话是为哪堂课准备的？</h2>
    <p class="why">${esc(sug.courseId ? "它看起来像这堂课：" : (sug.reason || "没有明显对得上的课"))}</p>
    ${list}
    <div class="acts">
      <button class="quiet" id="dCancel">取消</button>
      <button class="quiet" id="dNew">新建一堂课</button>
      <button class="primary" id="dOk">挂到这堂课</button>
    </div>`;
  $("#overlay").hidden = false;
  $("#dCancel").onclick = closeDialog;
  $("#dialog").querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
    pending.courseId = b.dataset.pick;
    $("#dialog").querySelectorAll("[data-pick]").forEach(x => x.classList.toggle("on", x === b));
  });
  $("#dNew").onclick = async () => {
    const name = await askText({
      title: "新建一堂课",
      hint: "把这段对话挂到一堂新课上。",
      placeholder: "四年级《小数的意义》",
      okText: "建这堂课"
    });
    if (!name) return;
    const c = await post("/api/course", { name });
    await refreshState();
    pending.courseId = c.id;
    closeDialog();
    await confirmLink();
  };
  $("#dOk").onclick = () => { if (pending.courseId) { closeDialog(); confirmLink(); } };
}

async function confirmLink() {
  try {
    await post("/api/link", { convId: pending.convId, courseId: pending.courseId });
    await refreshState();
    S.view = "course"; S.courseId = pending.courseId;
    S.course = await get("/api/course/" + pending.courseId);
    S.panel = "conversation"; S.convId = pending.convId;
    S.conv = await get("/api/conversation/" + pending.convId);
    render();
    await doImport(pending.convId, true);
  } catch (e) { say(e.message); }
}

async function doImport(convId, quiet) {
  try {
    await post("/api/import", { convId });
    S.course = await get("/api/course/" + S.courseId);
    await refreshState();
    render();
    if (!quiet) paintRail();
  } catch (e) {
    if (!quiet) say(e.message);
  }
}

/* ---------------- 课堂 ---------------- */

function paintClassroom() {
  const c = S.course;
  const cls = c.classroom;
  const card = cls.card;
  const live = cls.meta.state === "live";
  const prep = c.conversations.prepare.filter(v => v.messages > 0 || true);

  const body = card
    ? cardBlock(card)
    : `<div class="block">
         <h2>还没有课次卡</h2>
         <p class="hint">请先从备课对话导入课次卡，再开始上课。</p>
         <p class="hint">${prep.length ? "选择一段已挂靠的备课对话导入：" : "还没有备课对话。"}</p>
         ${prep.map(v => `<button class="quiet" data-imp="${v.id}" style="margin:4px 8px 4px 0">${esc(v.title)}</button>`).join("")}
       </div>`;

  $("#stage").innerHTML = `
    <div class="head">
      <div><h1>课堂</h1><div class="meta">${cls.events.length ? `已有 ${cls.events.length} 条事件` : "还没有上过"}</div></div>
      <div class="tools">${card && !live ? `<button class="primary" id="startBtn">开始上课</button>` : ""}
        ${live ? `<button class="quiet" id="endBtn">下课</button>` : ""}
        ${!live && cls.events.length ? `<button class="quiet" id="reviewBtn">基于本节课新建复盘</button>` : ""}</div>
    </div>
    <div class="scroll">
      <div class="block" id="bridgeBox">
        <h2>眼镜</h2>
        <p class="hint">正在读桥的状态…</p>
      </div>
      ${body}
      <details class="block"><summary>课堂分析与运行状态</summary><div id="watchBox">
        <h2>课堂分析</h2>
        <p class="hint">正在读…</p>
      </div></details>
      ${cls.events.length ? eventBlock(cls.events) : `<div class="block"><h2>课堂记录</h2>
        <p class="hint">还没有事件。没上课就没有统计——这里不会先摆一排 0。</p></div>`}
      <details class="block"><summary>导入已有转写</summary><div>
        <h2>导入课堂转写</h2>
        <p class="hint">可粘贴已有转写做课后统计；时间轴按字数估算。实时课堂语音由模拟器麦克风自动采集。</p>
        <textarea id="ingestText" rows="5" style="width:100%;margin-top:10px;border:1px solid var(--rule);border-radius:5px;padding:9px 12px;font-size:13px" placeholder="师：同学们，翻到第十二页…&#10;生：老师我看到了圆…"></textarea>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button class="primary" id="ingestBtn">导入转写</button>
          <button class="quiet" id="sampleBtn">填一段示例</button>
        </div>
      </div></details>
    </div>`;

  $("#stage").querySelectorAll("[data-imp]").forEach(b => b.onclick = () => doImport(b.dataset.imp));
  paintBridgePanel();
  paintWatchPanel();
  const s = $("#startBtn"); if (s) s.onclick = () => setClassState("live");
  const e = $("#endBtn"); if (e) e.onclick = () => setClassState("ended");
  const review = $("#reviewBtn"); if (review) review.onclick = () => newConversation("review");
  $("#ingestBtn").onclick = runIngest;
  $("#sampleBtn").onclick = async () => {
    const t = await fetch("/samples/demo.txt").then(r => r.text()).catch(() => "");
    $("#ingestText").value = t;
  };
}

async function paintBridgePanel() {
  const box = $("#bridgeBox");
  if (!box) return;
  let s;
  try { s = await get("/api/bridge/status"); }
  catch (e) { box.innerHTML = `<h2>眼镜</h2><p class="hint">读不到桥的状态：${esc(e.message)}</p>`; return; }

  const dot = s.online ? "\u25cf" : "\u25cb";
  const dotClass = s.online ? "on" : "off";
  const last = s.lastBeatAt ? s.lastBeatAt.slice(11, 19) : "";
  const hasCard = Boolean(S.course && S.course.classroom && S.course.classroom.card);

  box.innerHTML = `
    <h2>设备准备</h2>
    <p class="hint" id="liveDeviceStatus">${s.online ? "模拟器已连接 · " + esc(microphoneLabel(s.microphone)) : "模拟器未连接"}</p>
    <p class="hint" id="liveCardStatus">检查课次卡状态中…</p>
    <p class="bmeta red" id="liveMicDetail"></p>
    ${S.course.classroom.meta.state === "live" ? `<button class="primary" id="resumeClass" hidden>恢复眼镜课堂</button><p class="hint">眼镜重启后如仍在课前，请恢复眼镜课堂。</p>` : ""}
    <details><summary>设备诊断与手动操作</summary><div class="bridge-line">
      <span class="bdot ${dotClass}">${dot}</span>
      ${s.online ? "眼镜在线" : "眼镜未连接"}
      ${last ? `<span class="bmeta">最后心跳 ${esc(last)}</span>` : `<span class="bmeta">戴上眼镜并启动后这里会亮</span>`}
    </div>
    <div class="bridge-line">
      ${s.dispatched ? `已下发：${esc(s.cardTopic || "本课卡")}` : "还没有下发本课卡"}
      ${s.pendingEvents ? `<span class="bmeta red">眼镜那边还有 ${s.pendingEvents} 条事件没收</span>` : `<span class="bmeta">没有待收事件</span>`}
    </div>
    <div class="bridge-acts">
      <button class="quiet" id="dispatchBtn" ${hasCard ? "" : "disabled"}>${s.dispatched ? "重新下发本课卡" : "下发本课卡到眼镜"}</button>
      <button class="quiet" id="micStart" ${s.dispatched ? "" : "disabled"}>请求麦克风</button>
      <button class="quiet" id="micStop" ${s.dispatched ? "" : "disabled"}>停止麦克风</button>
      <button class="primary" id="pullBtn" ${s.pendingEvents ? "" : "disabled"}>收 ${s.pendingEvents} 条事件</button>
    </div>
    <p class="tiny">桥目录：<code>${esc(s.wslDir)}</code></p></details>`;

  const d = $("#dispatchBtn");
  const resume = $("#resumeClass");
  if (resume) resume.onclick = async () => {
    resume.disabled = true;
    try { await post(`/api/classroom/${S.courseId}/resume`, {}); resume.textContent = "正在同步眼镜…"; }
    catch (e) { say(e.message); resume.disabled = false; }
  };
  if (d) d.onclick = async () => {
    d.disabled = true; d.textContent = "正在下发…";
    try {
      await post("/api/bridge/dispatch", { courseId: S.courseId, convId: (S.conv && S.conv.meta) ? S.conv.meta.id : null });
      await paintBridgePanel();
      await paintWatchPanel();
    } catch (e) { say(e.message); d.disabled = false; d.textContent = "下发本课卡到眼镜"; }
  };
  for (const [id, action] of [["micStart", "start"], ["micStop", "stop"]]) {
    const button = $("#" + id);
    if (button) button.onclick = async () => {
      try { await post("/api/bridge/microphone", {courseId:S.courseId, action}); await refreshDeviceStatus(); }
      catch (e) { say(e.message); }
    };
  }
  refreshDeviceStatus();
  const p = $("#pullBtn");
  if (p) p.onclick = async () => {
    p.disabled = true; p.textContent = "正在收…";
    try {
      const r = await post("/api/bridge/sync", { courseId: S.courseId });
      S.course = await get("/api/course/" + S.courseId);
      await refreshState();
      render();
      if (r.imported) say(`收到 ${r.imported} 条课堂事件，已并入这节课。`, "收妥");
    } catch (e) { say(e.message); p.disabled = false; }
  };
}

async function paintWatchPanel() {
  const box = $("#watchBox");
  if (!box) return;
  let s;
  try { s = await get("/api/watch/status?courseId=" + encodeURIComponent(S.courseId)); }
  catch (e) { box.innerHTML = `<h2>课堂分析</h2><p class="hint">${esc(e.message)}</p>`; return; }

  const notes = (s.notes || []).slice(-4).map(n => `<div class="note-row">${esc(n.replace(/^-\s*/, ""))}</div>`).join("") || `<p class="hint">还没有记下什么。</p>`;

  box.innerHTML = `
    <h2>课堂分析</h2>
    <p class="hint">分析收到的课堂转写，生成观察记录，并在适当时向眼镜发送提示。麦克风和语音识别需正常工作，才能收到实时转写。</p>
    <div class="watch-line">
      <span class="bdot ${s.running ? "on" : "off"}">${s.running ? "\u25cf" : "\u25cb"}</span>
      ${s.running ? "分析已启动" : "分析未运行"}
      <span class="bmeta">已分析 ${s.judged} 次 · 已发送提示 ${s.pushed}/${s.maxPushes} 条</span>
    </div>
    ${s.lastWhy ? `<div class="bmeta">上一次判断：${esc(s.lastWhy)}</div>` : ""}
    ${s.lastError ? `<div class="bmeta red">出错了：${esc(s.lastError)}</div>` : ""}
    <div class="bridge-acts">
      <button class="primary" id="watchToggle">${s.running ? "停止分析" : "启动分析"}</button>
    </div>
    <h2 style="margin-top:18px">观察记录</h2><p class="hint">由模型根据转写生成，可能有误，请结合课堂情况核对。</p>
    ${notes}`;

  $("#watchToggle").onclick = async () => {
    try {
      await post(s.running ? "/api/watch/stop" : "/api/watch/start", { courseId: S.courseId });
      await paintWatchPanel();
    } catch (e) { say(e.message); }
  };
}

function cardBlock(card) {
  const chips = l => (l || []).map(x => `<span>${esc(x)}</span>`).join("") || "—";
  const stages = (card.stages || []).map(s => `<div class="stage-row"><span>${esc(s.name)}</span><span>${s.minutes} 分钟</span></div>`).join("") || "—";
  const note = card.source === "local-fallback"
    ? `<p class="hint" style="margin-top:14px;color:var(--red)">这份课次卡是在没有模型的情况下按关键词粗拼的，不是模型整理的结果。</p>` : "";
  return `
    <div class="block">
      <h2>本课卡</h2>
      <dl class="card">
        <dt>课题</dt><dd>${esc(card.topic || "—")}</dd>
        <dt>课次卡学科年级</dt><dd>${esc([card.subject, card.grade].filter(Boolean).join(" ") || "未填写")}</dd>
        <dt>候答</dt><dd>${card.waitSeconds || 5} 秒</dd>
        <dt>教学目标</dt><dd>${(card.objectives || []).map(esc).join("<br>") || "—"}</dd>
        <dt>本课重点</dt><dd class="chips">${chips(card.keyPoints)}</dd>
        <dt>环节</dt><dd>${stages}</dd>
        <dt>重点留意</dt><dd class="chips">${chips(card.focusWords)}</dd>
      </dl>
      ${note}
    </div>`;
}

function eventBlock(events) {
  const labels = { class_started:"课堂开始", class_ended:"课堂结束", input_processed:"已处理课堂表达", utterance:"课堂表达", countdown_started:"活动计时开始", countdown_elapsed:"活动时间到", countdown_stopped:"活动计时结束", countdown_extended:"活动计时延长", stage_changed:"环节切换", advice:"教学提示", note:"观察记录", question_asked:"检测到提问", wait_expired:"候答计时结束", student_answered:"检测到应答", filler_question:"简短问句" };
  return `
    <div class="block">
      <h2>课堂记录</h2>
      <p class="hint">记录来自系统识别，可能有遗漏或错误；导入转写的时间按字数估算。</p>
      <div class="log">
        ${events.map(x => `<div class="log-row"><span class="t">${typeof x.t === "number" ? x.t.toFixed(1) + "s" : "—"}</span><span class="k">${esc(labels[x.type] || "其他事件")}</span><span class="v">${esc(x.text || "")}</span></div>`).join("")}
      </div>
    </div>`;
}

async function setClassState(state) {
  await post(`/api/classroom/${S.courseId}/state`, { state });
  S.course = await get("/api/course/" + S.courseId);
  await refreshState();
  render();
}

async function runIngest() {
  const text = $("#ingestText").value.trim();
  if (!text) { say("先粘贴一段转写"); return; }
  const btn = $("#ingestBtn");
  btn.disabled = true; btn.textContent = "正在处理…";
  try {
    await post("/api/ingest", { courseId: S.courseId, text });
    S.course = await get("/api/course/" + S.courseId);
    await refreshState();
    render();
  } catch (e) { say(e.message); }
}

/* ---------------- 复盘 ---------------- */

function paintReview() {
  const c = S.course;
  const events = c.classroom.events;
  $("#stage").innerHTML = `
    <div class="head">
      <div><h1>复盘</h1><div class="meta">${events.length ? events.length + " 条课堂事件" : "还没有课堂事件"}</div></div>
      <div class="tools">${events.length ? `<button class="primary" id="genReview">生成复盘</button>` : ""}</div>
    </div>
    <div class="scroll">
      ${events.length ? eventBlock(events) : `<div class="block"><p class="hint">没有事件就没有复盘。先去"课堂"把一段转写推进去。</p></div>`}
      <div class="block">
        <h2>复盘正文</h2>
        ${c.review ? `<div class="doc">${esc(c.review)}</div>` : `<p class="hint">还没有生成。</p>`}
      </div>
    </div>`;
  const b = $("#genReview");
  if (b) b.onclick = async () => {
    b.disabled = true; b.textContent = "正在写…";
    try {
      const r = await post(`/api/course/${S.courseId}/review`, {});
      S.course.review = r.review;
      paintReview();
    } catch (e) { say(e.message); b.disabled = false; b.textContent = "生成复盘"; }
  };
}

/* ---------------- 页边 ---------------- */

function paintRail() {
  const c = S.course;
  const cls = c.classroom;
  $("#rail").innerHTML = `
    <div class="part">
      <h3>这堂课</h3>
      <div class="kv"><span>课题</span><b>${esc(c.meta.name)}</b></div>
      <div class="kv"><span>学科</span><b>${esc(c.meta.subject || "未填写")}</b></div>
      <div class="kv"><span>年级</span><b>${esc(c.meta.grade || "未填写")}</b></div>
      <div class="kv"><span>备课对话</span><b>${c.conversations.prepare.length}</b></div>
      <div class="kv"><span>复盘对话</span><b>${c.conversations.review.length}</b></div>
      <div class="kv"><span>课堂</span><b>${cls.events.length ? "已上过" : "未开始"}</b></div>
    </div>
    <div class="part">
      <h3>知识库</h3>
      <div class="file-list">${S.kb.length ? S.kb.slice(0, 8).map(f => esc(f.name)).join("<br>") + (S.kb.length > 8 ? `<br>…共 ${S.kb.length} 份` : "") : "还是空的"}</div>
      <button class="ghost" id="toKb" style="margin-top:10px">去知识库添加</button>
    </div>`;
  $("#toKb").onclick = () => go("kb");
}

/* ---------------- 弹层与顶栏 ---------------- */

function closeDialog() {
  $("#overlay").hidden = true;
  $("#dialog").innerHTML = "";
}

function openModal(html) {
  $("#dialog").innerHTML = html;
  $("#overlay").hidden = false;
}

/** 自家的输入弹层，替代浏览器原生 prompt。返回 null 表示取消。 */
function askText(options) {
  const o = options || {};
  return new Promise(resolve => {
    openModal(`
      <h2>${esc(o.title || "")}</h2>
      ${o.hint ? `<p class="why">${esc(o.hint)}</p>` : ""}
      <input type="text" id="askInput" class="text" placeholder="${esc(o.placeholder || "")}" value="${esc(o.value || "")}" />
      <div class="acts">
        <button class="quiet" id="askCancel">取消</button>
        <button class="primary" id="askOk">${esc(o.okText || "确定")}</button>
      </div>`);
    const input = $("#askInput");
    const finish = v => { closeDialog(); resolve(v); };
    input.focus();
    if (input.value) input.select();
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); finish(input.value.trim()); }
      if (e.key === "Escape") { e.preventDefault(); finish(null); }
    });
    $("#askCancel").onclick = () => finish(null);
    $("#askOk").onclick = () => finish(input.value.trim());
  });
}

/** 自家的确认弹层，替代浏览器原生 confirm。 */
function askConfirm(options) {
  const o = options || {};
  return new Promise(resolve => {
    openModal(`
      <h2>${esc(o.title || "确认")}</h2>
      <p class="why">${esc(o.body || "")}</p>
      <div class="acts">
        <button class="quiet" id="askCancel">取消</button>
        <button class="primary" id="askOk">${esc(o.okText || "确定")}</button>
      </div>`);
    const finish = v => { closeDialog(); resolve(v); };
    $("#askCancel").onclick = () => finish(false);
    $("#askOk").onclick = () => finish(true);
    $("#dialog").addEventListener("keydown", e => { if (e.key === "Escape") finish(false); });
    $("#askOk").focus();
  });
}

/** 提示弹层，替代浏览器原生 alert。 */
function say(message, title) {
  openModal(`
    <h2>${esc(title || "提示")}</h2>
    <p class="why">${esc(String(message || ""))}</p>
    <div class="acts"><button class="primary" id="askOk">知道了</button></div>`);
  $("#askOk").onclick = closeDialog;
  $("#askOk").focus();
}

$("#toHome").onclick = () => go("home");
$("#filePicker").addEventListener("change", e => handlePickedFiles(e.target.files));
document.querySelectorAll("#globalNav button").forEach(b => b.onclick = () => go(b.dataset.nav));
$("#overlay").addEventListener("click", e => { if (e.target.id === "overlay") closeDialog(); });

boot().catch(e => {
  document.body.innerHTML = `<div style="padding:48px;font:14px/1.8 sans-serif;color:#a8362b">启动失败：${esc(e.message)}</div>`;
});
