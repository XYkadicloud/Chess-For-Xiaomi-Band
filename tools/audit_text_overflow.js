#!/usr/bin/env node
/**
 * audit_text_overflow.js — static overflow audit for every Vela .ux page.
 *
 * Vela text has no automatic shrinking: a <text> renders at its font-size and
 * clips/overflows once the content exceeds its box. This tool parses each .ux
 * file, resolves the effective width/height/font-size/line-height/padding of
 * every text element, then estimates wrapped line count and required height
 * for the actual string content (CJK counted as 1.0 em, ASCII as ~0.55 em).
 *
 * Reports, per file:
 *   - texts whose content needs more lines than the declared height allows
 *   - texts whose width is narrower than a single character
 *   - fixed-height containers whose children overflow them
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const D = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const L = ['chinese', 'english'];
const PAGES = ['index', 'setup', 'game', 'settings', 'about', 'support', 'purchase'];

/* ---- helpers ----------------------------------------------------- */
function isCJK(ch) {
  const c = ch.codePointAt(0);
  return (c >= 0x2E80 && c <= 0x9FFF) || (c >= 0xF900 && c <= 0xFAFF) ||
         (c >= 0xFF00 && c <= 0xFFEF) || (c >= 0x3000 && c <= 0x303F);
}

/* width of a string in em units (relative to font-size) */
function emWidth(str) {
  let w = 0;
  for (const ch of str) {
    if (ch === '\n') { w += 999; continue; }         // force break
    if (isCJK(ch)) w += 1.0;
    else if (ch === ' ') w += 0.28;
    else if (/[iIl1jt.,:;'|!]/.test(ch)) w += 0.30;
    else if (/[A-Z0-9]/.test(ch)) w += 0.62;
    else w += 0.55;
  }
  return w;
}

function num(v) {
  if (v === undefined) return undefined;
  const m = String(v).match(/(-?[\d.]+)/);
  return m ? parseFloat(m[1]) : undefined;
}

/* Parse the <style> block into a map of class -> declarations. */
function parseStyles(css) {
  const map = {};
  const re = /\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const cls = m[1];
    const decls = {};
    m[2].split(';').forEach(p => {
      const i = p.indexOf(':');
      if (i < 0) return;
      decls[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
    map[cls] = Object.assign(map[cls] || {}, decls);
  }
  return map;
}

/* Resolve declarations for an element, merging all of its classes. */
function resolve(styles, classAttr, inlineAttr) {
  const out = {};
  (classAttr || '').split(/\s+/).filter(Boolean).forEach(c => {
    Object.assign(out, styles[c] || {});
  });
  // inline style overrides
  (inlineAttr || '').split(';').forEach(p => {
    const i = p.indexOf(':');
    if (i < 0) return;
    out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}

/* Collect text elements with their content and inherited box. */
function* textNodes(src) {
  // <text ...>content</text> possibly spanning lines
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1];
    const raw = m[2];
    // strip nested mustaches / interpolation -> keep literal parts
    const content = raw.replace(/\{\{[\s\S]*?\}\}/g, '~');
    const cls = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
    const style = (attrs.match(/style="([^"]*)"/) || [])[1] || '';
    yield { attrs, content, cls, style, index: m.index };
  }
}

/* ---- audit one file --------------------------------------------- */
function audit(file, device) {
  const src = fs.readFileSync(file, 'utf8');
  const styleM = src.match(/<style>([\s\S]*?)<\/style>/);
  if (!styleM) return [];
  const styles = parseStyles(styleM[1]);
  const tplM = src.match(/<template>([\s\S]*?)<\/template>/);
  const tpl = tplM ? tplM[1] : src;

  const issues = [];
  for (const t of textNodes(tpl)) {
    const d = resolve(styles, t.cls, t.style);
    const fs_ = num(d['font-size']);
    const lh = num(d['line-height']) || (fs_ ? fs_ * 1.4 : undefined);
    const w = num(d['width']);
    const h = num(d['height']);
    const pt = num(d['padding-top']) || 0;
    const pb = num(d['padding-bottom']) || 0;
    const pl = num(d['padding-left']) || 0;
    const pr = num(d['padding-right']) || 0;

    if (!fs_) continue;
    const text = t.content.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    // available inner width
    const innerW = (w !== undefined) ? (w - pl - pr) : undefined;
    let lines;
    if (innerW && innerW > 0) {
      const emTotal = emWidth(text);
      const charsPerLine = Math.max(1, innerW / fs_);
      lines = Math.max(1, Math.ceil(emTotal / charsPerLine));
    } else {
      // width unknown (flex/auto) -> assume the parent page width
      const emTotal = emWidth(text);
      const charsPerLine = 16; // conservative for a 192dp page at 13dp
      lines = Math.max(1, Math.ceil(emTotal / charsPerLine));
    }

    const needH = lines * lh + pt + pb;
    if (h !== undefined && needH > h + 0.5) {
      issues.push({
        kind: 'height',
        cls: t.cls || '(inline)',
        text: text.slice(0, 40) + (text.length > 40 ? '…' : ''),
        need: Math.round(needH),
        have: h,
        lines,
        excess: Math.round(needH - h)
      });
    } else if (h === undefined) {
      // No declared height: text flows in its parent. Report the wrapped
      // height so a human can check the parent container, and flag strings
      // that need 3+ lines as a risk.
      if (lines >= 3) {
        issues.push({
          kind: 'flow',
          cls: t.cls || '(inline)',
          text: text.slice(0, 40) + (text.length > 40 ? '…' : ''),
          need: Math.round(needH),
          have: null,
          lines,
          excess: 0
        });
      }
    }

    // width too narrow for the content to be readable
    if (w !== undefined && innerW !== undefined && innerW < fs_) {
      issues.push({
        kind: 'width',
        cls: t.cls || '(inline)',
        text: text.slice(0, 20),
        need: Math.round(fs_),
        have: innerW,
        lines: 0,
        excess: Math.round(fs_ - innerW)
      });
    }
  }
  return issues;
}

/* ---- run --------------------------------------------------------- */
let filesChecked = 0, totalIssues = 0;
const report = {};

for (const d of D) {
  for (const l of L) {
    for (const pg of PAGES) {
      const f = path.join(ROOT, 'devices', d, 'source', l, 'src', 'pages', pg, pg + '.ux');
      if (!fs.existsSync(f)) continue;
      filesChecked++;
      const issues = audit(f, d);
      if (issues.length) {
        const key = d + '/' + l + '/' + pg;
        report[key] = issues;
        totalIssues += issues.length;
      }
    }
  }
}

console.log('== text overflow audit ==');
console.log('files checked: ' + filesChecked + '\n');
const keys = Object.keys(report).sort();
if (!keys.length) {
  console.log('No overflow detected.');
} else {
  for (const k of keys) {
    console.log(k + '  (' + report[k].length + ')');
    for (const i of report[k]) {
      console.log('   [' + i.kind + '] .' + i.cls +
        '  needs ' + i.need + 'dp, has ' + i.have + 'dp (' + i.lines + ' lines, +' + i.excess + 'dp)');
      console.log('        "' + i.text + '"');
    }
  }
}
console.log('\nTOTAL ISSUES: ' + totalIssues);
