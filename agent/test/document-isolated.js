"use strict";
// Tests real document extraction against isolated data; no user library is touched.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "nonteacher-doc-test-"));
process.env.AGENT_DATA = path.join(root, "data");
process.env.AGENT_BRIDGE = path.join(root, "bridge");
const script = `import zipfile,sys,os
p=sys.argv[1]
with zipfile.ZipFile(os.path.join(p,'lesson.pptx'),'w') as z:
 z.writestr('ppt/slides/slide1.xml','<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>三角形四年级专属课件</a:t></a:r></a:p></p:sld>')
 z.writestr('ppt/slides/slide2.xml','<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>两边之和大于第三边</a:t></a:r></a:p></p:sld>')
with zipfile.ZipFile(os.path.join(p,'lesson.docx'),'w') as z:
 z.writestr('word/document.xml','<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>教学目标认识三角形</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>课堂讨论</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
`;
try {
  const generated = spawnSync("python", ["-c", script, root], {encoding:"utf8"});
  assert.equal(generated.status, 0, generated.stderr);
  const kb = require("../server/knowledge");
  for (const name of ["lesson.pptx", "lesson.docx"]) {
    const result = kb.importFromPath(path.join(root,name), "课件");
    assert.equal(result.readable, true, JSON.stringify(result));
    const preview = kb.readFile(result.file);
    assert.match(preview, /三角形/);
    assert.ok(kb.search("三角形",10).some(hit => hit.file === result.file));
  }
  assert.match(kb.readFile("课件/lesson.pptx"), /第2张/);
  assert.match(kb.readFile("课件/lesson.docx"), /课堂讨论/);
  const pdf = kb.importFromPath(path.resolve(__dirname,"../演示课件/认识三角形.pdf"),"课件");
  assert.equal(pdf.readable,true,JSON.stringify(pdf));
  const context = kb.documentContext("根据上传课件给我备课建议");
  assert.equal(context.file,pdf.file);
  assert.match(context.text,/2\s*[、,]\s*3\s*[、,]\s*6/);
  assert.match(context.text,/第6页/);
  if (process.platform === "win32") {
    const scanned = kb.importFromPath(path.resolve(__dirname,"../三角形三边关系-课件节选.pdf"),"课件");
    assert.equal(scanned.readable,true,JSON.stringify(scanned));
    assert.match(scanned.warnings.join(""),/OCR/);
    assert.match(kb.readFile(scanned.file),/图片文字 OCR/);
  }
  const md = kb.ingest({name:"sample.md",category:"资料",content:"# 备课\n分数教学"});
  assert.match(kb.readFile(md.file),/分数教学/);
  fs.writeFileSync(path.join(root,"old.ppt"),"not a presentation");
  const old = kb.importFromPath(path.join(root,"old.ppt"),"课件");
  assert.equal(old.readable,false);
  assert.match(old.warnings.join(""),/PPTX/);
  console.log("PASS: PDF, PPTX, DOCX, Markdown, retrieval, context and legacy-format feedback");
} finally {
  const resolved = fs.realpathSync(root), expected = path.join(fs.realpathSync(os.tmpdir()), "nonteacher-doc-test-");
  if (!resolved.startsWith(expected)) throw new Error("Unexpected test directory");
  fs.rmSync(resolved,{recursive:true,force:true});
}
