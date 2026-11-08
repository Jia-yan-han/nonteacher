"use strict";
const { performance } = require("node:perf_hooks");
const { Classroom } = require("../src/classroom");
const samples = [];
for (let i = 0; i < 10; i += 1) {
  const c = new Classroom();
  c.start();
  c.input("如果我们要组织一次春游，出发前需要考虑什么？", "模拟文本");
  c.input("你说要考虑门票，她说还要考虑怎么坐车。", "模拟文本");
  const start = performance.now();
  c.input("还有吗？还有其他的吗？", "模拟文本");
  const ms = performance.now() - start;
  if (!c.advice) throw new Error("未产生预期候选建议");
  samples.push(Number(ms.toFixed(3)));
}
console.log(JSON.stringify({ measurement: "local synchronous rule only", unit: "ms", samples }));
