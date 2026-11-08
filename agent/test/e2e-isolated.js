"use strict";
// Real local HTTP routes with a deterministic fake model and isolated storage.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "nonteacher-http-"));
const pause = ms => new Promise(r => setTimeout(r, ms));
let child, fake, lastSystem = "";
async function post(port, url, data) {
  const response = await fetch(`http://127.0.0.1:${port}${url}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url}: ${response.status} ${text}`);
  return url === "/api/chat" ? text : JSON.parse(text);
}
async function get(port, url) { const r = await fetch(`http://127.0.0.1:${port}${url}`); if (!r.ok) throw new Error(url); return r.json(); }
(async () => {
  fake = http.createServer((req,res) => {
    let raw=""; req.on("data", c => raw+=c); req.on("end", () => {
      const body=JSON.parse(raw), system=body.messages[0].content, last=body.messages.at(-1).content;
      lastSystem = system;
      let answer="我们来准备认识分数这节课。";
      if (last.includes("只输出 JSON")) answer=JSON.stringify({topic:"认识分数",keyPoints:["平均分"],stages:[{name:"认识",minutes:20}],waitSeconds:5});
      else if (system.includes("教室后排旁听")) answer=JSON.stringify({note:"教师提出问题",speak:"可以先画图说明",why:"辅助解释"});
      else if (system.includes("课后复盘")) answer="课堂记录：教师提出了问题。";
      res.writeHead(200,{"Content-Type":"text/event-stream"});
      res.end(`data: ${JSON.stringify({choices:[{delta:{content:answer}}]})}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise(r=>fake.listen(0,"127.0.0.1",r));
  const stubPort=fake.address().port, port=48322;
  child=spawn(process.execPath,[path.join(__dirname,"../server/index.js")],{env:{...process.env,AGENT_DATA:path.join(root,"data"),AGENT_BRIDGE:path.join(root,"bridge"),AGENT_PORT:String(port),LLM_BASE_URL:`http://127.0.0.1:${stubPort}/v1`,LLM_API_KEY:"isolated-test",LLM_MODEL:"fake"},stdio:"ignore"});
  for(let i=0;i<50;i++){try { await get(port,"/api/state"); break; } catch(e) {if(i===49)throw e;await pause(100)}}
  const course=await post(port,"/api/course",{name:"隔离的认识分数"});
  const upload = await post(port,"/api/kb/upload",{name:"认识三角形.pdf",category:"课件",data:fs.readFileSync(path.join(__dirname,"../演示课件/认识三角形.pdf")).toString("base64")});
  assert.equal(upload.readable,true,JSON.stringify(upload));
  await post(port,`/api/course/${course.id}`,{subject:"数学",grade:"三年级"});
  const updated=await get(port,`/api/course/${course.id}`);
  assert.equal(updated.meta.subject,"数学");
  assert.equal(updated.meta.grade,"三年级");
  const conv=await post(port,"/api/conversation",{courseId:course.id,type:"prepare",title:"备课"});
  await post(port,"/api/chat",{convId:conv.id,text:"请根据上传的三角形课件给备课建议"});
  assert.match(lastSystem,/认识三角形\.pdf/);
  assert.match(lastSystem,/2\s*[、,]\s*3\s*[、,]\s*6/);
  const card=await post(port,"/api/import",{convId:conv.id});
  assert.equal(card.topic,"认识分数");
  await post(port,`/api/course/${course.id}`,{subject:"语文",grade:"四年级"});
  const afterEdit=await get(port,`/api/course/${course.id}`);
  assert.equal(afterEdit.meta.subject,"语文");
  assert.equal(afterEdit.classroom.card.subject,card.subject);
  await post(port,`/api/classroom/${course.id}/state`,{state:"live"});
  const dispatched={card:JSON.parse(fs.readFileSync(path.join(root,"bridge/lesson-card.json"),"utf8"))};
  fs.writeFileSync(path.join(root,"bridge/status.json"),JSON.stringify({at:new Date().toISOString(),courseId:course.id,sessionId:dispatched.card.sessionId,phase:"prepare"}));
  assert.equal((await get(port,"/api/bridge/status")).phase,"prepare");
  await post(port,`/api/classroom/${course.id}/resume`,{});
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,"bridge/lesson-card.json"),"utf8")).sessionId,dispatched.card.sessionId);
  await post(port,"/api/bridge/utterance",{courseId:course.id,text:"同学们，请看这幅图，怎么平均分？"});
  let status;
  for(let i=0;i<40;i++){status=await get(port,`/api/watch/status?courseId=${course.id}`);if(status.pushed)break;await pause(200)}
  assert.equal(status.pushed,1);
  const output=fs.readFileSync(path.join(root,"bridge/outbox.jsonl"),"utf8").trim().split("\n").map(JSON.parse);
  assert.equal(output[0].type,"class.start");
  assert.equal(output[1].type,"mic.start");
  assert.equal(output[2].type,"class.start");
  const suggestion=output.find(item => item.type === "speak");
  assert.equal(suggestion.sessionId,dispatched.card.sessionId);
  assert.equal(suggestion.text,"可以先画图说明");
  const reviewConv=await post(port,"/api/conversation",{courseId:course.id,type:"review",title:"课堂复盘"});
  await post(port,"/api/chat",{convId:reviewConv.id,text:"请根据课堂记录复盘"});
  assert.match(lastSystem,/同学们，请看这幅图，怎么平均分/);
  assert.match(lastSystem,/认识分数/);
  const document=await post(port,"/api/distill",{convId:reviewConv.id});
  assert.match(lastSystem,/课后复盘/);
  assert.match(lastSystem,/同学们，请看这幅图，怎么平均分/);
  assert.match(document.file,/\.md$/);
  const review=await post(port,`/api/course/${course.id}/review`,{});
  assert.match(review.review,/课堂记录/);
  assert.match(lastSystem,/同学们，请看这幅图，怎么平均分/);
  await post(port,`/api/classroom/${course.id}/state`,{state:"ended"});
  const ended=fs.readFileSync(path.join(root,"bridge/outbox.jsonl"),"utf8").trim().split("\n").map(JSON.parse);
  assert.equal(ended.at(-1).type,"class.end");
  assert.equal((await get(port,`/api/watch/status?courseId=${course.id}`)).running,false);
  console.log("PASS: prepare → card → dispatch → dictation → advice → review (fake model)");
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
  if(child){child.kill();await new Promise(r=>child.once("exit",r));}
  if(fake)await new Promise(r=>fake.close(r));
  fs.rmSync(root,{recursive:true,force:true});
});
