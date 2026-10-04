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
const LANGS = ['chinese'];

const CJK = /[\u3000-\u9fff\uff00-\uffef]/;

/* Labels are bindings now ({{lvEasyShort}}), so the literal text no longer
 * lives in the template. Resolve a binding name to the tr() key it wraps by
 * reading the page's `computed` block, then look the key up in both locale
 * files — which also turns this into a real ENGLISH layout check, something
 * the old literal-based version could not do. */
let I18N = { zh: {}, en: {} };
function loadI18n() {
  for (const [lang, file] of [['zh', 'zh-CN.json'], ['en', 'en-US.json']]) {
    const p = path.join(ROOT, 'src', 'i18n', file);
    if (!fs.existsSync(p)) continue;
    const flat = (o, pre) => {
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (v && typeof v === 'object') flat(v, pre + k + '.');
        else I18N[lang][pre + k] = String(v);
      }
    };
    flat(JSON.parse(fs.readFileSync(p, 'utf8')), '');
  }
}
loadI18n();

/* Map a computed name -> the tr('...') key it returns. */
function computedKeys(src) {
  const out = {};
  const block = src.match(/computed\s*:\s*\{([\s\S]*?)\n\s*\},/);
  if (!block) return out;
  const re = /(\w+)\s*\([^)]*\)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(block[1]))) {
    const k = m[2].match(/tr\(\s*'([^']+)'\s*\)/);
    if (k) out[m[1]] = k[1];
  }
  return out;
}

/* Resolve a template label: either a literal, or {{name}}. */
function resolveLabel(label, keys) {
  const trim = label.trim();
  const b = trim.match(/^\{\{\s*([A-Za-z_$]\w*)\s*\}\}$/);
  if (!b) return /\{\{/.test(trim) ? null : trim;
  const key = keys[b[1]];
  if (!key) return null;
  return { zh: I18N.zh[key] || '', en: I18N.en[key] || '' };
}

/* Widest measured width of a label (literal or {zh,en} pair). */
function labelWidth(label, fs) {
  if (label == null) return { w: 0, text: '', lang: '' };
  if (typeof label === 'string') return { w: emWidth(label) * fs, text: label, lang: 'zh' };
  const wz = emWidth(label.zh) * fs, we = emWidth(label.en) * fs;
  return we > wz ? { w: we, text: label.en, lang: 'en' } : { w: wz, text: label.zh, lang: 'zh' };
}

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
    const CKEYS = computedKeys(src);
    const groups = { seg: [], lv: [] };
    const re = /<text([^>]*)>([^<]*)<\/text>/g;
    let m;
    while ((m = re.exec(tpl))) {
      const attrs = m[1];
      const label = resolveLabel(m[2], CKEYS);
      if (label == null || label === '') continue;

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
      let worst = 0, worstLabel = '', worstLang = '';
      for (const l of r.labels) {
        const measured = labelWidth(l, r.fs);
        if (measured.w > worst) { worst = measured.w; worstLabel = measured.text; worstLang = measured.lang; }
      }
      const ok = worst <= colW;
      if (!ok) problems++;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${dev}/${lang} ${r.name.padEnd(9)} cols=${n} colW=${colW.toFixed(1)}dp  widest[${worstLang}]="${worstLabel}"=${worst.toFixed(1)}dp` +
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
    let worstL = 0, worstLbl = '', worstLLang = '';
    while ((lm = labelRe.exec(tpl))) {
      const s = resolveLabel(lm[1], CKEYS);
      if (s == null || s === '') continue;
      const measured = labelWidth(s, fsLabel);
      if (measured.w > worstL) { worstL = measured.w; worstLbl = measured.text; worstLLang = measured.lang; }
    }
    if (rowLabelW) {
      const ok = worstL <= rowLabelW;
      if (!ok) problems++;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${dev}/${lang} ${'label'.padEnd(9)} colW=${rowLabelW}dp  widest[${worstLLang}]="${worstLbl}"=${worstL.toFixed(1)}dp` +
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
      let sm, worstS = 0, worstSide = '', worstSLang = '';
      while ((sm = sideRe.exec(tpl))) {
        const attrs = sm[1];
        const clsM = attrs.match(/\bclass="([^"]*)"/);
        if (!clsM) continue;
        const isSide = /\bside\b/.test(clsM[1]) || /mySide/.test(clsM[1]);
        if (!isSide) continue;
        const s = resolveLabel(sm[2], CKEYS);
        if (s == null || s === '') continue;
        const measured = labelWidth(s, fsSide);
        if (measured.w > worstS) { worstS = measured.w; worstSide = measured.text; worstSLang = measured.lang; }
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
