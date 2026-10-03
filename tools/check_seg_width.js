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

    // collect labels from the template.
    // The current generator uses a STATIC class plus an inline style ternary:
    //   <text class="seg lv" style="background-color:{{aiLevel==='easy'?...}}" ...>简单</text>
    // The older form (ternary inside class) is still parsed for safety.
    const tpl = src.match(/<template>([\s\S]*?)<\/template>/)[1];
    const groups = { seg: [], lv: [] };
    const re = /<text([^>]*)>([^<]*)<\/text>/g;
    let m;
    while ((m = re.exec(tpl))) {
      const attrs = m[1];
      const label = m[2].trim();
      if (!label || /\{\{/.test(label)) continue;

      // --- static class (new form) ---
      const clsM = attrs.match(/\bclass="([^"]*)"/);
      if (clsM && !/\{\{/.test(clsM[1])) {
        const toks = clsM[1].split(/\s+/).filter(Boolean);
        if (toks[0] === 'seg') {
          (toks.includes('lv') ? groups.lv : groups.seg).push(label);
        }
        continue;
      }

      // --- legacy form: ternary inside class ---
      if (!clsM) continue;
      const expr = clsM[1].replace(/[=!]==?\s*'[^']*'/g, '');
      const lits = [...expr.matchAll(/'([^']+)'/g)].map((x) => x[1]);
      if (!lits.length) continue;
      const first = lits[0].split(/\s+/)[0];
      if (first !== 'seg') continue;
      const isLv = lits[0].split(/\s+/).includes('lv');
      (isLv ? groups.lv : groups.seg).push(label);
    }

    const rows = [
      { name: 'opponent', labels: groups.seg, fs: fsSeg, avail: num(decl(src, 'segRow', 'width')) || contentW },
      { name: 'level', labels: groups.lv, fs: fsLv, avail: num(decl(src, 'segRow', 'width')) || contentW }
    ];
    for (const r of rows) {
      if (!r.labels.length) continue;
      const n = r.labels.length;
      const colW = (r.avail - segMarginX * 2 * n) / n;
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

    // --- two-column setting rows: label | control -------------------------
    const stacked = /flex-direction:\s*column/.test(String(decl(src, 'row', 'flex-direction') || ''));
    const rowLabelW = stacked ? contentW : num(decl(src, 'rowLabel', 'width'));
    const fsLabel = num(decl(src, 'rowLabel', 'font-size'));
    const stepBtnW = num(decl(src, 'stepBtn', 'width'));
    const stepperW = num(decl(src, 'stepper', 'width'));
    const sideW = num(decl(src, 'side', 'width'));
    const sideRowW = num(decl(src, 'sideRow', 'width'));

    // (a) label column must hold its widest text
    const labelRe = /<text class="rowLabel"[^>]*>([^<]*)<\/text>/g;
    let lm;
    let worstL = 0, worstLbl = '';
    while ((lm = labelRe.exec(tpl))) {
      const s = lm[1].trim();
      if (!s || /\{\{/.test(s)) continue;
      const w = emWidth(s) * fsLabel;
      if (w > worstL) { worstL = w; worstLbl = s; }
    }
    if (rowLabelW) {
      const ok = worstL <= rowLabelW;
      if (!ok) problems++;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${dev}/${lang} ${'label'.padEnd(9)} colW=${rowLabelW}dp  widest="${worstLbl}"=${worstL.toFixed(1)}dp` +
        (ok ? '' : `  OVER ${(worstL - rowLabelW).toFixed(1)}dp`));
    }

    // (b) stepper row must hold [-] value [+]
    if (stepperW && stepBtnW) {
      const need = stepBtnW * 2 + 24; // 24dp reserved for the value text
      const ok = need <= stepperW;
      if (!ok) problems++;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${dev}/${lang} ${'stepper'.padEnd(9)} colW=${stepperW}dp  need=${need}dp` +
        (ok ? '' : `  OVER ${(need - stepperW)}dp`));
    }

    // (c) side chooser row must hold two buttons
    if (sideRowW && sideW) {
      const need = sideW * 2 + 6;
      // Side labels ("White"/"黑方") must fit inside one button.
      // Works for both the static-class form and the legacy class-ternary form.
      const sideRe = /<text([^>]*)>([^<]*)<\/text>/g;
      const fsSide = num(decl(src, 'side', 'font-size'));
      let sm, worstS = 0, worstSide = '';
      while ((sm = sideRe.exec(tpl))) {
        const attrs = sm[1];
        const clsM = attrs.match(/\bclass="([^"]*)"/);
        if (!clsM) continue;
        const isSide = /\bside\b/.test(clsM[1]) || /mySide/.test(clsM[1]);
        if (!isSide) continue;
        const s = sm[2].trim();
        if (!s || /\{\{/.test(s)) continue;
        const w = emWidth(s) * fsSide;
        if (w > worstS) { worstS = w; worstSide = s; }
      }
      const ok = need <= sideRowW && worstS <= sideW;
      if (!ok) problems++;
      const over = Math.max(need - sideRowW, worstS - sideW);
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${dev}/${lang} ${'side'.padEnd(9)} colW=${sideW}dp  widest="${worstSide}"=${worstS.toFixed(1)}dp` +
        (ok ? '' : `  OVER ${over.toFixed(1)}dp`));
    }
  }
}
console.log('\n' + (problems === 0 ? 'ALL SEGMENTED ROWS FIT' : problems + ' ROW(S) OVERFLOW'));
process.exit(problems === 0 ? 0 : 1);
