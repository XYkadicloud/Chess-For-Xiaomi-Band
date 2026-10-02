#!/usr/bin/env node
/**
 * update_copy_ai.js — refresh user-facing copy now that an AI opponent exists.
 *
 *  - index subtitle: "单机双人" / "Local 2-player"  ->  mention the AI opponent
 *  - about page: add a line describing the built-in engine
 *
 * Text is matched exactly per language so the rewrite is deterministic.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const D = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const L = ['chinese', 'english'];

const DEVICE_LABEL = {
  'xiaomi-band-9': { zh: 'Xiaomi Band 9', en: 'Xiaomi Band 9' },
  'xiaomi-band-9-pro': { zh: 'Xiaomi Band 9 Pro', en: 'Xiaomi Band 9 Pro' },
  'xiaomi-band-10': { zh: 'Xiaomi Band 10', en: 'Xiaomi Band 10' }
};

let n = 0;

for (const d of D) {
  for (const l of L) {
    const dir = path.join(ROOT, 'devices', d, 'source', l, 'src', 'pages');

    /* --- index subtitle ------------------------------------------- */
    const idx = path.join(dir, 'index', 'index.ux');
    if (fs.existsSync(idx)) {
      let s = fs.readFileSync(idx, 'utf8');
      const before = s;
      const label = DEVICE_LABEL[d][l === 'chinese' ? 'zh' : 'en'];
      const newSub = l === 'chinese'
        ? '双人对弈 / 人机对战 · ' + label
        : '2-player / vs AI · ' + label;
      s = s.replace(/(<text class="subtitle">)[^<]*(<\/text>)/, '$1' + newSub + '$2');
      if (s !== before) { fs.writeFileSync(idx, s, 'utf8'); n++; console.log('  OK   ' + d + '/' + l + '/index'); }
    }

    /* --- about: describe the engine ------------------------------- */
    const ab = path.join(dir, 'about', 'about.ux');
    if (fs.existsSync(ab)) {
      let s = fs.readFileSync(ab, 'utf8');
      const before = s;
      // Append a sentence to the "About this app" body text.
      if (l === 'chinese' && !s.includes('内置 AI')) {
        s = s.replace(
          /(<text class="bodyText">)(Chess 是一款[^<]*?)(<\/text>)/,
          '$1$2 内置 AI 引擎，可在没有第二位玩家时与电脑对弈。$3');
      } else if (l === 'english' && !s.includes('built-in AI')) {
        s = s.replace(
          /(<text class="bodyText">)(Chess is an offline[^<]*?)(<\/text>)/,
          '$1$2 A built-in AI engine lets you play against the computer when no second player is available.$3');
      }
      if (s !== before) { fs.writeFileSync(ab, s, 'utf8'); n++; console.log('  OK   ' + d + '/' + l + '/about'); }
    }
  }
}
console.log('\ndone, ' + n + ' copy updates applied');
