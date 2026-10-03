#!/usr/bin/env node
/*
 * fix_band9_band10_clock.js
 * 修复 Band 9 与 Band 10 的"时钟区"——
 * 26dp → 42dp，单行 → 双行（label + time），字号 16 → 20，
 * 棋盘 viewport 高度 -16dp（棋盘整体下移）。
 * 仅改 Band 9 / Band 10；Band 9 Pro 不动。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TREES = [];
for (const dev of ['xiaomi-band-9', 'xiaomi-band-10']) {
  for (const lang of ['chinese', 'english']) TREES.push({ dev, lang });
}

const DIM = {
  'xiaomi-band-9':  { width: 192, halfWidth: 92 },
  'xiaomi-band-10': { width: 212, halfWidth: 100 },
};

const LBL = {
  chinese: { light: '白', dark: '黑', accent: '#4EA1FF', other: '#FFFFFF' },
  english: { light: 'White', dark: 'Black', accent: '#4EA1FF', other: '#FFFFFF' },
};

function patch(file, dev, lang) {
  let src = fs.readFileSync(file, 'utf8');
  const before = src;
  const dim = DIM[dev];
  const l = LBL[lang];

  /* ---------- 模板：单行 → 双行 clockCol ---------- */
  const oldRow =
    `<div class="clocks">` +
    `<text class="clock" style="color:{{turn==='white'?'${l.accent}':'${l.other}'}};">${l.light} {{whiteClock}}</text>` +
    `<text class="clock" style="color:{{turn==='black'?'${l.accent}':'${l.other}'}};">${l.dark} {{blackClock}}</text>` +
    `</div>`;

  const newRow =
    `<div class="clocks">` +
    `<div class="clockCol" style="width:${dim.halfWidth}dp;color:{{turn==='white'?'${l.accent}':'${l.other}'}};">` +
      `<text class="clockLabel">${l.light}</text>` +
      `<text class="clockTime">{{whiteClock}}</text>` +
    `</div>` +
    `<div class="clockCol" style="width:${dim.halfWidth}dp;color:{{turn==='black'?'${l.accent}':'${l.other}'}};">` +
      `<text class="clockLabel">${l.dark}</text>` +
      `<text class="clockTime">{{blackClock}}</text>` +
    `</div>` +
    `</div>`;

  if (src.includes(oldRow)) {
    src = src.replace(oldRow, newRow);
  } else if (src.includes('class="clockCol"') && src.includes('class="clockTime"')) {
    // 已是新版
  } else {
    throw new Error('clock row not in expected shape');
  }

  /* ---------- 样式 ---------- */
  const oldClocksCss = `.clocks { width:${dim.width}dp; height:26dp; flex-direction:row; justify-content:space-around; align-items:center; }`;
  const newClocksCss =
    `.clocks { width:${dim.width}dp; height:42dp; flex-direction:row; justify-content:space-around; align-items:center; }` +
    `.clockCol { flex-direction:column; justify-content:center; align-items:center; }` +
    `.clockLabel { font-size:11dp; height:14dp; line-height:14dp; text-align:center; opacity:0.85; }` +
    `.clockTime  { font-size:20dp; font-weight:bold; height:24dp; line-height:24dp; text-align:center; }`;

  if (src.includes(oldClocksCss)) {
    src = src.replace(oldClocksCss, newClocksCss);
  } else if (src.includes('.clockTime') && src.includes('.clockLabel')) {
    // 已新版
  } else {
    throw new Error('clock css not in expected shape');
  }

  // 删旧的 .clock{...} 规则（如残留）
  src = src.replace(/\.clock \{ font-size:16dp; font-weight:bold; width:82dp; text-align:center; \}/g, '');

  /* ---------- 棋盘 viewport 高度减小 16dp（棋盘下移） ---------- */
  const oldVp = `.boardViewport { width:${dim.width}dp; height:280dp; position:relative; overflow:hidden; background-color:#050505; }`;
  const newVp = `.boardViewport { width:${dim.width}dp; height:264dp; position:relative; overflow:hidden; background-color:#050505; }`;
  if (src.includes(oldVp)) src = src.replace(oldVp, newVp);

  /* ---------- 默认 boardTop 同步 +16：20 → 36 ---------- */
  src = src.replace(/boardTop:\s*20(\s*,)/g, 'boardTop: 36$1');

  if (src === before) return false;
  fs.writeFileSync(file, src);
  return true;
}

let problems = 0, changed = 0;
for (const t of TREES) {
  const file = path.join(ROOT, 'devices', t.dev, 'source', t.lang, 'src', 'pages', 'game', 'game.ux');
  try {
    if (patch(file, t.dev, t.lang)) {
      changed++;
      console.log('OK    ' + t.dev + '/' + t.lang + '  (clock row + board top updated)');
    } else {
      console.log('OK    ' + t.dev + '/' + t.lang + '  (already up to date)');
    }
  } catch (e) {
    problems++;
    console.log('FAIL  ' + t.dev + '/' + t.lang + '  ' + e.message);
  }
}
console.log('---');
console.log(problems ? 'CLOCK-LAYOUT FAILED (' + problems + ')' : 'CLOCK-LAYOUT OK (' + changed + ' changed, ' + (TREES.length - changed - problems) + ' already up to date)');