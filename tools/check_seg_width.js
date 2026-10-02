#!/usr/bin/env node
/*
 * check_seg_width.js — verify the opponent / difficulty segmented buttons fit
 * horizontally on every device.
 *
 * Every .seg is `flex:1` inside a .segRow that spans the setup content width,
 * so each button gets (contentW - totalHorizontalMargin) / count. A label is
 * measured with an em-width model: CJK counts as 1.0em, ASCII as ~0.55em.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const LANGS = ['chinese', 'english'];

const CJK = /[\u3000-\u9fff\uff00-\uffef]/;

function emWidth(s) {
  let w = 0;
  for (const ch of s) w += CJK.test(ch) ? 1.0 : 0.55;
  return w;
}

function decl(src, cls, prop) {
  const re = new RegExp('\\.' + cls + '\\s*\\{([^}]*)\\}');
  const m = src.match(re);
  if (!m) return null;
  const all = [...m[1].matchAll(new RegExp(prop + ':\\s*([^;]+)', 'g'))];
  if (!all.length) return null;
  return all[all.length - 1][1].trim(); // last declaration wins
}
function num(v) { const m = String(v == null ? '' : v).match(/-?[\d.]+/); return m ? +m[0] : NaN; }

let problems = 0;
for (const dev of DEVICES) {
  for (const lang of LANGS) {
    const f = path.join(ROOT, 'devices', dev, 'source', lang, 'src', 'pages', 'setup', 'setup.ux');
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');

    const setupW = num(decl(src, 'setup', 'width'));
    const padding = String(decl(src, 'setup', 'padding') || '0').split(/\s+/).map(s => num(s) || 0);
    const contentW = setupW - (padding[1] || 0) * 2;

    const segMarginX = num(String(decl(src, 'seg', 'margin') || '0 0').split(/\s+/)[1]) || 0;
    const fsSeg = num(decl(src, 'seg', 'font-size'));
    const fsLv = num(decl(src, 'lv', 'font-size')) || fsSeg;

    // collect labels from the template
    const tpl = src.match(/<template>([\s\S]*?)<\/template>/)[1];
    const groups = { seg: [], lv: [] };
    const re = /<text class="\{\{([^"]*)\}\}"[^>]*>([^<]*)<\/text>/g;
    let m;
    while ((m = re.exec(tpl))) {
      const expr = m[1].replace(/[=!]==?\s*'[^']*'/g, '');
      const lits = [...expr.matchAll(/'([^']+)'/g)].map(x => x[1]);
      if (!lits.length) continue;
      // Only genuine .seg / .seg.lv chips belong here — the time-option rows
      // use the same `class="{{...}}"` form but resolve to `.time`.
      const first = lits[0].split(/\s+/)[0];
      if (first !== 'seg') continue;
      const isLv = lits[0].split(/\s+/).includes('lv');
      const label = m[2].trim();
      if (label && !/\{\{/.test(label)) (isLv ? groups.lv : groups.seg).push(label);
    }

    const rows = [
      { name: 'opponent', labels: groups.seg, fs: fsSeg },
      { name: 'level', labels: groups.lv, fs: fsLv }
    ];
    for (const r of rows) {
      if (!r.labels.length) continue;
      const n = r.labels.length;
      const colW = (contentW - segMarginX * 2 * n) / n;
      let worst = 0, worstLabel = '';
      for (const l of r.labels) {
        const w = emWidth(l) * r.fs;
        if (w > worst) { worst = w; worstLabel = l; }
      }
      const ok = worst <= colW;
      if (!ok) problems++;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${dev}/${lang} ${r.name.padEnd(9)} cols=${n} colW=${colW.toFixed(1)}dp  widest="${worstLabel}"=${worst.toFixed(1)}dp` +
        (ok ? '' : `  OVER ${(worst - colW).toFixed(1)}dp`));
    }
  }
}
console.log('\n' + (problems === 0 ? 'ALL SEGMENTED ROWS FIT' : problems + ' ROW(S) OVERFLOW'));
process.exit(problems === 0 ? 0 : 1);
