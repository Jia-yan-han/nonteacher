"use strict";
const ui = require("@irisview/osx/fusionui");
function fitText(value, limit) {
  const chars = Array.from(String(value || "").replace(/[\r\n\t]+/g, " "));
  return chars.length > limit ? chars.slice(0, limit - 1).join("") + "…" : chars.join("");
}
function createScene(root) {
  const board = ui.Board.create();
  board.setParent(root);
  board.setIgnoreLayout(true);
  board.setSize([640, 480, 0]);
  board.getLocalStyle().setBackgroundColor(ui.Color.fromRGB8(0, 0, 0));
  function line(y, size, brightness) {
    const t = ui.Text.create();
    t.setParent(board); t.setIgnoreLayout(true); t.setPosition([20, y, 0]); t.setSize([600, 38, 0]);
    const s = t.getLocalStyle();
    s.setTextColor(ui.Color.fromRGB8(0, brightness, 0));
    s.setTextAlign(ui.TextAlign.TOP_LEFT);
    s.setTextFont(ui.Font.getCachedFont("", size, 0, 0));
    return t;
  }
  const header = line(15, 22, 240);
  const status = line(55, 16, 150);
  const a = line(120, 22, 240);
  const b = line(162, 20, 210);
  const c = line(204, 18, 170);
  const d = line(246, 18, 170);
  const note = line(322, 17, 180);
  const hint = line(405, 18, 200);
  return { render(m) {
    header.setText(fitText(m.header, 25)); status.setText(fitText(m.status, 29));
    [a, b, c, d].forEach((v, i) => v.setText(fitText((m.lines || [])[i], i === 0 ? 25 : 28)));
    note.setText(fitText(m.note, 27)); hint.setText(fitText(m.hint, 27));
  }, release() {} };
}
module.exports = { createScene, fitText };
