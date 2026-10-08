#!/usr/bin/env node
/*
 * audit_layout_overflow.js — static overflow audit for every Vela .ux page.
 *
 * WHY
 * ---
 * Band screens are 192 / 336 / 212 px wide and the pages are hand-written, so
 * a box that is "exactly the screen width" has zero slack and any extra
 * padding pushes past the edge.  This bit us twice (Band 9 about page,
 * Band 9 Afdian page), so it is worth a machine check.
 *
 * BOX MODEL — read this before trusting a number
 * ----------------------------------------------
 * Vela behaves like `box-sizing: border-box`: a declared `width` ALREADY
 * includes padding and border.  Evidence from this project:
 *
 *     .aboutList { width:192px; padding:8px 12px 28px 12px }   screen = 192
 *     .appItem   { width:168px }                               192 - 24 = 168
 *
 * Under content-box the container would be 192+24 = 216 (overflow), yet the
 * 168 cards are the ones verified good on a real Band 9.  So: border-box.
 *
 *     content width  = width - padding-left - padding-right
 *     outer width    = width + margin-left + margin-right
 *
 * WHAT IS REPORTED
 * ----------------
 *   HARD  H-OVERFLOW  explicit width that does not fit the parent content box,
 *                     and the parent does NOT centre its children on the
 *                     horizontal axis.  Genuine visible overflow.
 *   HARD  V-OVERFLOW  fixed-height box whose children all have explicit
 *                     heights and together exceed height - padding.  Text
 *                     gets clipped.  (This is the Afdian bug.)
 *   SOFT  CENTRED     box wider than the parent content box, but the parent
 *                     centres it horizontally, so it spills symmetrically into
 *                     the padding.  Not visible, but the slack is gone.
 *   SOFT  ZERO-SLACK  outer width exactly equals the parent content width.
 *                     Legal today, breaks on a 1px change.
 *
 * DELIBERATELY IGNORED (would be pure noise)
 * ------------------------------------------
 *   - `position: absolute` elements — different layout model (overlays).
 *   - children of <list> / <scroll> / <swiper> — they are meant to scroll.
 *   - the page root (`.page`) — taller content scrolls.
 *   - vertical checks where any child height is unknown.
 *
 * Usage
 *   node tools/audit_layout_overflow.js          # HARD + SOFT
 *   node tools/audit_layout_overflow.js --hard   # HARD only (CI gate)
 *   node tools/audit_layout_overflow.js -v       # list every sized box
 *   node tools/audit_layout_overflow.js --json
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const VERBOSE = process.argv.includes('-v') || process.argv.includes('--verbose');
const HARD_ONLY = process.argv.includes('--hard');
const AS_JSON = process.argv.includes('--json');

/* ---------------------------------------------------------------- helpers */
const px = (v) => {
  if (v === undefined || v === null) return null;
  const m = String(v).trim().match(/^(-?[\d.]+)\s*(px|dp)?$/);
  return m ? parseFloat(m[1]) : null;
};

function decls(block) {
  const d = {};
  for (const part of String(block).split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim();
    if (k) d[k] = v;
  }
  return d;
}

/* CSS shorthand order: top right bottom left */
function box4(d, prop) {
  const s = d[prop];
  if (s) {
    const p = s.split(/\s+/).map(px);
    if (p.length === 1) return { t: p[0], r: p[0], b: p[0], l: p[0] };
    if (p.length === 2) return { t: p[0], r: p[1], b: p[0], l: p[1] };
    if (p.length === 3) return { t: p[0], r: p[1], b: p[2], l: p[1] };
    return { t: p[0], r: p[1], b: p[2], l: p[3] };
  }
  const g = (n) => px(d[prop + '-' + n]) || 0;
  return { t: g('top'), r: g('right'), b: g('bottom'), l: g('left') };
}
const padding = (d) => box4(d, 'padding');
const margin = (d) => box4(d, 'margin');

/* ------------------------------------------------------------ css parsing */
function collectClasses(src) {
  const classes = {};
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(src))) {
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let r;
    while ((r = ruleRe.exec(m[1]))) {
      const d = decls(r[2]);
      for (const sel of r[1].split(',').map((s) => s.trim())) {
        const cm = sel.match(/^\.([\w-]+)$/);
        if (cm) classes[cm[1]] = Object.assign(classes[cm[1]] || {}, d);
      }
    }
  }
  return classes;
}

function parseTemplate(src) {
  let tpl = src;
  const cut = tpl.search(/<style|<script/);
  if (cut > 0) tpl = tpl.slice(0, cut);
  tpl = tpl.replace(/<!--[\s\S]*?-->/g, '');
  /* <template> is a wrapper, not a layout box — drop it so the real page root
   * becomes a direct child of #root (needed for the screen-height detection). */
  tpl = tpl.replace(/<\/?template[^>]*>/gi, '');

  const VOID = new Set(['image', 'input', 'img', 'br']);
  const root = { tag: '#root', classes: [], inline: {}, kids: [] };
  const stack = [root];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;
  while ((m = re.exec(tpl))) {
    const tag = m[2];
    const attrs = m[3] || '';
    if (m[1] === '/') {
      /* Only unwind when the closing tag really matches the open element.
       * Vela allows <image ...></image>, and `image` is also in VOID, so a
       * naive pop would close the PARENT and scramble the whole tree. */
      if (stack.length > 1 && stack[stack.length - 1].tag === tag) stack.pop();
      continue;
    }
    const el = { tag, classes: [], inline: {}, kids: [] };
    const cm = attrs.match(/\bclass\s*=\s*"([^"]*)"/) || attrs.match(/\bclass\s*=\s*'([^']*)'/);
    if (cm) el.classes = cm[1].split(/\s+/).filter(Boolean);
    const sm = attrs.match(/\bstyle\s*=\s*"([^"]*)"/) || attrs.match(/\bstyle\s*=\s*'([^']*)'/);
    if (sm) el.inline = decls(sm[1]);
    stack[stack.length - 1].kids.push(el);
    /* `image`/`input` may or may not carry an explicit closing tag; when they
     * do not, do not push (the closing-tag guard above keeps this safe). */
    if (!(m[4] === '/' || VOID.has(tag))) stack.push(el);
    else if (VOID.has(tag)) el.void = true;
  }
  return root;
}

const styleOf = (el, classes) => {
  const d = {};
  for (const c of el.classes) Object.assign(d, classes[c] || {});
  Object.assign(d, el.inline);
  return d;
};

const SCROLLERS = new Set(['list', 'scroll', 'swiper']);

/* does this element centre its children horizontally? */
function centresHorizontally(d) {
  const dir = (d['flex-direction'] || 'row').trim();
  if (dir.indexOf('column') >= 0) return /center/.test(d['align-items'] || '');
  return /center/.test(d['justify-content'] || '');
}

/* ------------------------------------------------------------------ audit */
function auditPage(label, src, designWidth) {
  const classes = collectClasses(src);
  const tree = parseTemplate(src);
  const hard = [];
  const soft = [];
  const all = [];

  /* The screen-height root(s): direct children of #root sized like the page.
   * Their content scrolls, so a taller child list is not a bug. */
  let screenH = 0;
  for (const k of tree.kids) {
    const hh = px(styleOf(k, classes).height);
    if (hh !== null && hh > screenH) screenH = hh;
  }

  function walk(el, parentContentW, parentCentres) {
    for (const kid of el.kids) {
      const d = styleOf(kid, classes);
      const w = px(d.width);
      const h = px(d.height);
      const pad = padding(d);
      const mar = margin(d);
      const sel = kid.classes.length ? '.' + kid.classes.join('.') : kid.tag;
      const isAbs = /absolute/.test(d.position || '');
      const isScroller = SCROLLERS.has(kid.tag);
      const isScreenRoot = screenH > 0 && h === screenH;
      const contentW = w !== null ? w - (pad.l || 0) - (pad.r || 0) : null;

      /* ---- horizontal ---- */
      if (w !== null && !isAbs && parentContentW !== null) {
        const outer = w + (mar.l || 0) + (mar.r || 0);
        if (outer > parentContentW + 0.001) {
          const msg = `outer ${outer}px (width ${w} + margin ${mar.l || 0}+${mar.r || 0}) > 父内容区 ${parentContentW}px  →  超出 ${(outer - parentContentW).toFixed(1)}px`;
          if (parentCentres) soft.push({ kind: 'CENTRED', sel, msg });
          else hard.push({ kind: 'H-OVERFLOW', sel, msg });
        } else if (Math.abs(outer - parentContentW) < 0.001 && w > 0) {
          soft.push({ kind: 'ZERO-SLACK', sel, msg: `outer ${outer}px == 父内容区 ${parentContentW}px` });
        }
      }

      /* ---- vertical ---- */
      if (h !== null && !isAbs && !isScroller && !isScreenRoot) {
        /* Only meaningful when children stack on the vertical axis. */
        const isColumn = /column/.test((d['flex-direction'] || 'row'));
        let kidsH = 0;
        let complete = kid.kids.length > 0 && isColumn;
        for (const k2 of kid.kids) {
          if (!isColumn) break;
          const s2 = styleOf(k2, classes);
          if (/absolute/.test(s2.position || '')) continue;      // out of flow
          const kh = px(s2.height);
          if (kh === null) { complete = false; break; }
          const m2 = margin(s2), p2 = padding(s2);
          kidsH += kh + (m2.t || 0) + (m2.b || 0) + (p2.t || 0) + (p2.b || 0);
        }
        const avail = h - (pad.t || 0) - (pad.b || 0);
        if (complete && kidsH > avail + 0.001) {
          hard.push({
            kind: 'V-OVERFLOW', sel,
            msg: `height ${h} - padding ${pad.t || 0}+${pad.b || 0} = 可用 ${avail}px，纵向子元素合计 ${kidsH.toFixed(0)}px  →  超出 ${(kidsH - avail).toFixed(0)}px（文字会被裁）`,
          });
        }
      }

      all.push({ sel, w, h, contentW });

      const nextBudget = contentW !== null && contentW > 0 ? contentW : parentContentW;
      walk(kid, nextBudget, centresHorizontally(d));
    }
  }
  walk(tree, designWidth, false);

  return { label, designWidth, hard, soft, all };
}

/* ------------------------------------------------------------------- main */
const results = [];
const push = (label, file, dw) => {
  if (!fs.existsSync(file)) return;
  results.push(auditPage(label, fs.readFileSync(file, 'utf8'), dw));
};

for (const dev of DEVICES) {
  const base = path.join(ROOT, 'devices', dev, 'source', 'chinese', 'src');
  const mf = path.join(base, 'manifest.json');
  if (!fs.existsSync(mf)) continue;
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const dw = (manifest.config && manifest.config.designWidth) || manifest.designWidth || null;
  const pagesDir = path.join(base, 'pages');
  if (!fs.existsSync(pagesDir)) continue;
  for (const page of fs.readdirSync(pagesDir).sort()) {
    push(`${dev}/${page}`, path.join(pagesDir, page, page + '.ux'), dw);
  }
}
{
  const base = path.join(ROOT, 'src');
  const mf = path.join(base, 'manifest.json');
  if (fs.existsSync(mf)) {
    const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const dw = (manifest.config && manifest.config.designWidth) || manifest.designWidth || 480;
    const pagesDir = path.join(base, 'pages');
    if (fs.existsSync(pagesDir)) {
      for (const page of fs.readdirSync(pagesDir).sort()) {
        push(`root-src/${page}`, path.join(pagesDir, page, page + '.ux'), dw);
      }
    }
  }
}

if (AS_JSON) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

let nH = 0, nC = 0, nZ = 0;
for (const r of results) {
  const centred = r.soft.filter((p) => p.kind === 'CENTRED');
  const zeros = r.soft.filter((p) => p.kind === 'ZERO-SLACK');
  const show = r.hard.length || centred.length || (VERBOSE && zeros.length);
  if (!show) continue;
  console.log(`\n── ${r.label}   (designWidth ${r.designWidth})`);
  if (VERBOSE) {
    for (const b of r.all) {
      if (b.w === null && b.h === null) continue;
      console.log(`     · ${b.sel.padEnd(30)} w=${b.w === null ? '-' : b.w}  h=${b.h === null ? '-' : b.h}  content=${b.contentW === null ? '-' : b.contentW}`);
    }
  }
  for (const p of r.hard) { nH++; console.log(`   ❌ [${p.kind}] ${p.sel}\n        ${p.msg}`); }
  if (!HARD_ONLY) for (const p of centred) { nC++; console.log(`   ⚠  [${p.kind}] ${p.sel}\n        ${p.msg}`); }
  if (VERBOSE) for (const p of zeros) { nZ++; console.log(`   ·  [${p.kind}] ${p.sel}  ${p.msg}`); }
}

console.log('\n' + '='.repeat(70));
console.log(`HARD 真实溢出（文字/元素会被裁）    : ${nH}`);
if (!HARD_ONLY) console.log(`SOFT 居中溢出（吃掉 padding，不裁切）: ${nC}`);
if (VERBOSE) console.log(`     零余量（合法但无缓冲）          : ${nZ}`);
console.log(nH === 0 ? '\nLAYOUT OVERFLOW OK ✅' : `\n发现 ${nH} 处真实溢出 ❌`);
process.exit(nH === 0 ? 0 : 1);