"use strict";
// Simulates the published IrisView input APIs, with no real microphone or model.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict"), Module = require("node:module");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "nonteacher-voice-"));
process.env.NT_BRIDGE_DIR = root;
const src = path.resolve(__dirname, "../../teacher-demo/dev-work/project/src");
let lifecycle, frame, requests = 0, queue = [], textQueue = [], currentSession, resolveFetch, rendered;
const appEvents = { ON_CREATE: 0, ON_FOREGROUND: 1, ON_REOPEN: 2, ON_BACKGROUND: 3, ON_DESTROY: 4 };
const fakeOs = { App:{createApp:fn=>lifecycle=fn}, AppLifecycle:appEvents,
  requestAnimationFrame:fn=>(frame=fn,1), cancelAnimationFrame:()=>{},
  WindowProperty:{create:()=>({setTitle(){},setSize(){}})}, Window:{create:()=>({})} };
const fakeUi = { FusionRoot:{acquireFusionRootFromWindow:()=>({getRootWidget:()=>({})})} };
const input = { takeNavigationAction:()=>null, takeTextInput:()=>textQueue.shift() || null,
  getVoiceInputAvailability:()=>({canRequest:true,ready:true,reason:"none"}),
  requestVoiceInput:()=>{requests++; currentSession={state:"recording",takeEvent:()=>queue.shift()||null,cancel:()=>true,finish:()=>true};return currentSession;} };
const originalLoad = Module._load, originalFetch = global.fetch;
Module._load = function(name, parent, main) {
  if(name === "@irisview/osx/os") return fakeOs;
  if(name === "@irisview/osx/fusionui") return fakeUi;
  if(name === "@irisview/osx/os/input") return input;
  return originalLoad.call(this,name,parent,main);
};
global.fetch = async()=>resolveFetch ? new Promise(resolve => { resolveFetch = resolve; }) : ({ok:true,json:async()=>({text:"同学们请翻到第十二页"})});
require.cache[require.resolve(path.join(src,"scene.js"))] = {id:path.join(src,"scene.js"),filename:path.join(src,"scene.js"),loaded:true,exports:{createScene:()=>({render(model){rendered=model;},release(){}})}};
require.cache[require.resolve(path.join(src,"config.js"))] = {id:path.join(src,"config.js"),filename:path.join(src,"config.js"),loaded:true,exports:{loadConfig:()=>({dataDir:""})}};
(async()=>{
  const card={courseId:"c-test",sessionId:"session-1",topic:"认识分数",dispatchedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(root,"lesson-card.json"),JSON.stringify(card));
  fs.writeFileSync(path.join(root,"outbox.jsonl"),["class.start","mic.start"].map(type=>JSON.stringify({type,courseId:"c-test",sessionId:"session-1",at:new Date().toISOString()})).join("\n")+"\n");
  require(path.join(src,"index.js")); lifecycle(appEvents.ON_CREATE); frame();
  assert.equal(requests,1,"card command requests microphone");
  const speech=Buffer.alloc(640); for(let i=0;i<640;i+=2)speech.writeInt16LE(5000,i);
  queue.push({type:"state",state:"recording",reason:"none"});
  for(let i=0;i<6;i++)queue.push({type:"audio",data:speech,sampleCount:320,sequence:i});
  for(let i=0;i<30;i++)queue.push({type:"audio",data:Buffer.alloc(640),sampleCount:320,sequence:i+6});
  frame(); await new Promise(resolve=>setImmediate(resolve));
  const events=fs.readFileSync(path.join(root,"events.jsonl"),"utf8").trim().split("\n").map(JSON.parse);
  assert(events.some(e=>e.type==="utterance" && e.source==="voice" && e.text.includes("十二页")),"transcription enters class automatically");
  textQueue.push({text:"给大家三分钟讨论"}); frame();
  resolveFetch = true;
  for(let i=0;i<6;i++)queue.push({type:"audio",data:speech,sampleCount:320,sequence:i});
  for(let i=0;i<30;i++)queue.push({type:"audio",data:Buffer.alloc(640),sampleCount:320,sequence:i+6});
  frame();
  assert.equal(typeof resolveFetch, "function", "old recognition is in flight");
  await new Promise(r=>setTimeout(r,120)); frame();
  assert.match(rendered.status,/识别中/, "processing status appears during the delayed request");
  textQueue.push({text:"讨论改成两分钟"}); frame();
  resolveFetch({ok:true,json:async()=>({text:"给大家五分钟讨论"})});
  await new Promise(resolve=>setImmediate(resolve));
  resolveFetch = null;
  const updated=fs.readFileSync(path.join(root,"events.jsonl"),"utf8").trim().split("\n").map(JSON.parse);
  assert(updated.some(e=>e.type==="countdown_started" && e.text==="120"), "text correction is applied");
  assert(!updated.some(e=>e.type==="utterance" && e.text==="给大家五分钟讨论"), "late voice result cannot undo newer text");
  textQueue.push({text:"只显示计时"}); await new Promise(r=>setTimeout(r,120)); frame();
  assert.match(rendered.lines[0],/讨论 剩余/); assert.equal(rendered.lines[2],"计时重点显示");
  textQueue.push({text:"还有一分钟"}); await new Promise(r=>setTimeout(r,120)); frame();
  assert.match(rendered.note,/确认调整/); assert.match(rendered.hint,/确认调整/);
  textQueue.push({text:"确认调整"}); await new Promise(r=>setTimeout(r,120)); frame();
  assert.match(rendered.note,/已按确认调整/); assert.match(rendered.lines[0],/01:00|00:59/);
  textQueue.push({text:"恢复显示"}); await new Promise(r=>setTimeout(r,120)); frame();
  assert.match(rendered.lines[0],/当前/);
  global.fetch = async()=>({ok:false,status:503});
  for(let i=0;i<6;i++)queue.push({type:"audio",data:speech,sampleCount:320,sequence:i});
  for(let i=0;i<30;i++)queue.push({type:"audio",data:Buffer.alloc(640),sampleCount:320,sequence:i+6});
  frame(); await new Promise(resolve=>setImmediate(resolve)); await new Promise(r=>setTimeout(r,120)); frame();
  assert.match(rendered.note,/本地语音识别不可用.*503/, "injected ASR failure is displayed");
  global.fetch = async()=>({ok:true,json:async()=>({text:"给大家三分钟讨论"})});
  for(let i=0;i<6;i++)queue.push({type:"audio",data:speech,sampleCount:320,sequence:i});
  for(let i=0;i<30;i++)queue.push({type:"audio",data:Buffer.alloc(640),sampleCount:320,sequence:i+6});
  frame(); await new Promise(resolve=>setImmediate(resolve)); await new Promise(r=>setTimeout(r,120)); frame();
  assert.match(rendered.note,/计时已开始/, "a successful subsequent request recovers after injected failure");
  queue.push({type:"end",status:"completed",reason:"time-limit"}); frame();
  assert.equal(requests,2,"recording is renewed after time limit");
  lifecycle(appEvents.ON_DESTROY);
  console.log("PASS: simulated input, processing state, injected ASR failure and recovery, stale result suppression, interface feedback and renewal");
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
  Module._load=originalLoad;global.fetch=originalFetch;fs.rmSync(root,{recursive:true,force:true});
});
