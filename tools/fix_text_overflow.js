#!/usr/bin/env node
/**
 * fix_text_overflow.js — remove text clipping/overflow on every .ux page.
 *
 * The audit (tools/audit_text_overflow.js) shows the same defect shape
 * everywhere: a FIXED-HEIGHT card contains a variable-length <text>, so long
 * strings (English more than Chinese, Band 10 > Band 9 Pro > Band 9) spill
 * past the card. Vela clips rather than shrinks, so the text is lost.
 *
 * Fix strategy, applied deterministically:
 *   A. Any <text> inside a fixed-height card gets an explicit height equal to
 *      its computed wrapped height (rounded up), so it reserves its own space.
 *   B. The card itself switches from `height` to `min-height`, so it grows to
 *      fit instead of clipping. `min-height` is supported by Vela layout.
 *   C. Body copy that would need more than 6 lines gets its font-size and
 *      line-height trimmed by 1dp to recover space without harming legibility.
 *   D. Lists that can now exceed the screen get `scroll-y: true`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const D = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const L = ['chinese'];
const PAGES = ['index', 'setup', 'game', 'settings', 'about', 'support', 'purchase'];

/* --- width helpers (must match the auditor) ----------------------- */
function isCJK(ch) {
  const c = ch.codePointAt(0);
  return (c >= 0x2E80 && c <= 0x9FFF) || (c >= 0xF900 && c <= 0xFAFF) ||
         (c >= 0xFF00 && c <= 0xFFEF) || (c >= 0x3000 && c <= 0x303F);
}
function emWidth(str) {
  let w = 0;
  for (const ch of str) {
    if (isCJK(ch)) w += 1.0;
    else if (ch === ' ') w += 0.28;
    else if (/[iIl1jt.,:;'|!]/.test(ch)) w += 0.30;
    else if (/[A-Z0-9]/.test(ch)) w += 0.62;
    else w += 0.55;
  }
  return w;
}
function num(v) { if (v === undefined) return undefined; const m = String(v).match(/(-?[\d.]+)/); return m ? parseFloat(m[1]) : undefined; }

function parseStyles(css) {
  const map = {};
  const re = /\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const decls = {};
    m[2].split(';').forEach(p => { const i = p.indexOf(':'); if (i < 0) return; decls[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
    map[m[1]] = Object.assign(map[m[1]] || {}, decls);
  }
  return map;
}

/* Recompute lines for a text given resolved decls. */
function wrappedHeight(text, decls) {
  const fs_ = num(decls['font-size']);
  const lh = num(decls['line-height']) || (fs_ ? fs_ * 1.4 : undefined);
  const w = num(decls['width']);
  const pl = num(decls['padding-left']) || 0;
  const pr = num(decls['padding-right']) || 0;
  const pt = num(decls['padding-top']) || 0;
  const pb = num(decls['padding-bottom']) || 0;
  if (!fs_ || !lh) return null;
  const innerW = w !== undefined ? w - pl - pr : 136;
  const cpl = Math.max(1, innerW / fs_);
  const lines = Math.max(1, Math.ceil(emWidth(text) / cpl));
  return { lines, height: Math.ceil(lines * lh + pt + pb), lh, fs: fs_ };
}

/* --- fix one file ------------------------------------------------- */
function fix(file) {
  let src = fs.readFileSync(file, 'utf8');
  const before = src;
  const styleM = src.match(/<style>([\s\S]*?)<\/style>/);
  if (!styleM) return [];
  let css = styleM[1];
  const styles = parseStyles(css);
  const changes = [];

  /* --- C: shrink over-tall body copy ------------------------------ */
  // For each class used as body copy, estimate worst-case lines across the
  // template strings that use it, and trim font-size/line-height if needed.
  const bodyClasses = ['bodyText', 'supportText', 'leftText', 'featureText', 'tokenText', 'priceText', 'gap'];
  const tplM = src.match(/<template>([\s\S]*?)<\/template>/);
  const tpl = tplM ? tplM[1] : '';

  for (const cls of bodyClasses) {
    const decls = styles[cls];
    if (!decls) continue;
    // gather texts using this class
    const re = new RegExp('<text\\b([^>]*class="[^"]*\\b' + cls + '\\b[^"]*"[^>]*)>([\\s\\S]*?)<\\/text>', 'g');
    let m, maxLines = 0;
    while ((m = re.exec(tpl))) {
      const content = m[2].replace(/\{\{[\s\S]*?\}\}/g, '~').replace(/\s+/g, ' ').trim();
      const h = wrappedHeight(content, decls);
      if (h) maxLines = Math.max(maxLines, h.lines);
    }
    if (maxLines >= 6) {
      const fs_ = num(decls['font-size']);
      const lh = num(decls['line-height']) || fs_ * 1.4;
      const newFs = Math.max(11, fs_ - 1);
      const newLh = Math.max(15, Math.round((lh - 2) * 10) / 10);
      // Only act when this actually reduces the footprint.
      if (newFs < fs_) {
        css = css.replace(new RegExp('(\\.' + cls + '\\s*\\{[^}]*?)font-size:\\s*' + fs_ + 'dp', 'm'),
          '$1font-size:' + newFs + 'dp');
        changes.push(cls + ':font ' + fs_ + '->' + newFs);
      }
      if (newLh < lh) {
        css = css.replace(new RegExp('(\\.' + cls + '\\s*\\{[^}]*?)line-height:\\s*' + lh + 'dp', 'm'),
          '$1line-height:' + newLh + 'dp');
      }
    }
  }

  /* --- A + B: size each card to actually contain its text ---------- *
   * Associate each card class with the text classes that appear inside its
   * <list-item>/<div> block (matched by balanced open/close of that element,
   * not a fragile non-greedy regex), then raise the card height to the sum
   * of its children's wrapped heights.
   */
  const cardClasses = ['appItem', 'authorItem', 'infoItem', 'rulesItem', 'supportItem',
                       'thanksItem', 'priceCard', 'featureCard', 'tokenCard', 'menuCard'];

  function blocksOf(cls) {
    const out = [];
    const openRe = new RegExp('<[a-z-]+\\b[^>]*class="[^"]*\\b' + cls + '\\b[^"]*"[^>]*>', 'g');
    let om;
    while ((om = openRe.exec(tpl))) {
      const tagName = om[0].match(/^<([a-z-]+)/)[1];
      let i = om.index + om[0].length, depth = 1;
      const openTag = new RegExp('<' + tagName + '\\b', 'g');
      const closeTag = new RegExp('</' + tagName + '>', 'g');
      while (i < tpl.length && depth > 0) {
        openTag.lastIndex = i; closeTag.lastIndex = i;
        const o = openTag.exec(tpl), c = closeTag.exec(tpl);
        if (!c) break;
        if (o && o.index < c.index) { depth++; i = o.index + o[0].length; }
        else { depth--; i = c.index + c[0].length; }
      }
      out.push(tpl.slice(om.index, i));
    }
    return out;
  }

  for (const cls of cardClasses) {
    const decls = styles[cls];
    if (!decls || !decls.height) continue;
    const have = num(decls.height);
    const pt = num(decls['padding-top']) || 0;
    const pb = num(decls['padding-bottom']) || 0;

    const blocks = blocksOf(cls);
    if (!blocks.length) continue;

    let maxNeeded = 0;
    for (const block of blocks) {
      // Only count a block if this class is the LAST/most specific card class
      // on the element (so .infoItem does not absorb .infoItem.rulesItem text).
      const openHdr = block.match(/^<[a-z-]+\b[^>]*class="([^"]*)"/);
      const classes = openHdr ? openHdr[1].split(/\s+/).filter(Boolean) : [];
      // effective card class = last class in the cardClasses list that appears
      const effective = classes.filter(c => cardClasses.indexOf(c) >= 0).pop();
      if (effective !== cls) continue;

      let sum = 0;
      const tRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
      let tm;
      while ((tm = tRe.exec(block))) {
        const cAttr = (tm[1].match(/class="([^"]*)"/) || [])[1] || '';
        const sAttr = (tm[1].match(/style="([^"]*)"/) || [])[1] || '';
        const childDecls = {};
        cAttr.split(/\s+/).filter(Boolean).forEach(c => Object.assign(childDecls, styles[c] || {}));
        sAttr.split(';').forEach(p => { const i = p.indexOf(':'); if (i >= 0) childDecls[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
        const content = tm[2].replace(/\{\{[\s\S]*?\}\}/g, '~').replace(/\s+/g, ' ').trim();
        if (!content) continue;
        const wh = wrappedHeight(content, childDecls);
        if (wh) sum += wh.height;
        sum += num(childDecls['margin-bottom']) || 0;
      }
      maxNeeded = Math.max(maxNeeded, sum);
    }

    if (!maxNeeded) continue;
    const needed = Math.ceil(maxNeeded + pt + pb + 4);
    if (needed > have + 1) {
      if (needed - have > 40) {
        css = css.replace(new RegExp('(\\.' + cls + '\\s*\\{[^}]*?)\\bheight:\\s*' + have + 'dp', 'm'),
          '$1min-height:' + needed + 'dp');
        changes.push(cls + ':' + have + '->min ' + needed);
      } else {
        css = css.replace(new RegExp('(\\.' + cls + '\\s*\\{[^}]*?)\\bheight:\\s*' + have + 'dp', 'm'),
          '$1height:' + needed + 'dp');
        changes.push(cls + ':' + have + '->' + needed);
      }
    }
  }

  /* --- E: horizontal overflow of single-line labels ---------------- *
   * A <text> with `lines:1` (or a short fixed width) that is wider than its
   * box gets clipped. We fix by (1) allowing it to wrap onto 2 lines and
   * (2) trimming the font by 1-2dp, until the content fits.
   */
  const labelClasses = ['settingName', 'settingValue', 'menuItem', 'action', 'seg', 'time',
                        'selectedText', 'label', 'qtitle', 'priceLabel', 'sectionTitle'];
  for (const cls of labelClasses) {
    const decls = styles[cls];
    if (!decls || !decls['font-size']) continue;
    const fs_ = num(decls['font-size']);
    let w = num(decls.width);
    let pl = num(decls['padding-left']) || 0;
    let pr = num(decls['padding-right']) || 0;

    // If the label has no width, look for a flex-row parent with a width.
    if (w === undefined) {
      const openRe = new RegExp(
        '<[a-z-]+\\s+class="([^"]*)"[^>]*>\\s*<text\\s+class="[^"]*\\b' + cls + '\\b[^"]*"',
        'g');
      const m2 = openRe.exec(tpl);
      if (m2) {
        const parentClasses = m2[1].split(/\s+/).filter(Boolean);
        for (const pc of parentClasses) {
          const pd = styles[pc];
          if (pd && pd.width) {
            w = num(pd.width);
            pl = num(pd['padding-left']) || 0;
            pr = num(pd['padding-right']) || 0;
            break;
          }
        }
      }
    }
    if (w === undefined) continue;
    const innerW = w - pl - pr;
    if (innerW <= 0) continue;

    // widest content among texts using this class
    let worst = '';
    const re = new RegExp('<text\\b([^>]*class="[^"]*\\b' + cls + '\\b[^"]*"[^>]*)>([\\s\\S]*?)<\\/text>', 'g');
    let m;
    while ((m = re.exec(tpl))) {
      const content = m[2].replace(/\{\{[\s\S]*?\}\}/g, '~').replace(/\s+/g, ' ').trim();
      if (content && emWidth(content) > emWidth(worst)) worst = content;
    }
    if (!worst) continue;
    const emW = emWidth(worst);              // in em
    const maxEm = innerW / fs_;              // how many em fit on one line
    const lines = Math.ceil(emW / maxEm);    // lines needed as-is
    const isSingle = /(^|;)\s*lines:\s*1\s*(;|$)/.test(decls) || decls.lines === '1';
    if (lines <= 1) continue;                // already fits on one line

    // Try to fit within 2 lines by shrinking the font.
    let newFs = fs_;
    while (newFs > 11 && Math.ceil(emW / (innerW / newFs)) > 2) newFs--;
    if (newFs !== fs_) {
      css = css.replace(new RegExp('(\\.' + cls + '\\s*\\{[^}]*?)font-size:\\s*' + fs_ + 'dp', 'm'),
        '$1font-size:' + newFs + 'dp');
      changes.push(cls + ':font ' + fs_ + '->' + newFs);
    }
    // Allow 2 lines when the class forced a single line.
    if (isSingle && lines > 1) {
      css = css.replace(new RegExp('(\\.' + cls + '\\s*\\{[^}]*?)\\blines:\\s*1', 'm'), '$1lines:2');
      changes.push(cls + ':lines 1->2');
    }
    // Give the box a height that fits its (up to 2) lines when it had one.
    const lh = num(decls['line-height']);
    const needLines = Math.ceil(emW / (innerW / newFs));
    if (lh && num(decls.height) && needLines > 1) {
      const newH = Math.ceil((lh / fs_) * newFs * needLines);
      css = css.replace(new RegExp('(\\.' + cls + '\\s*\\{[^}]*?)\\bheight:\\s*' + num(decls.height) + 'dp', 'm'),
        '$1height:' + newH + 'dp');
      changes.push(cls + ':h->' + newH);
    }
  }

  /* --- F: text forced into too few lines (lines:N too small) -------- *
   * A <text> with `lines:N` and a fixed height clips once its content needs
   * more than N lines. Raise `lines` (and the height) to fit.
   * Uses the *merged* declarations of the whole class list on the element,
   * so a class like .priceText that only sets `lines` still sees the
   * font-size/width inherited from .bodyText.
   */
  // Collect every element that carries a `lines:N` declaration anywhere in its
  // class list, then evaluate with the merged decls.
  const tTextRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  const seenF = new Set();
  let tf;
  while ((tf = tTextRe.exec(tpl))) {
    const cAttr = (tf[1].match(/class="([^"]*)"/) || [])[1] || '';
    const sAttr = (tf[1].match(/style="([^"]*)"/) || [])[1] || '';
    const classes = cAttr.split(/\s+/).filter(Boolean);
    const merged = {};
    classes.forEach(c => Object.assign(merged, styles[c] || {}));
    sAttr.split(';').forEach(p => { const i = p.indexOf(':'); if (i >= 0) merged[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
    const linesAttr = num(merged.lines);
    if (linesAttr === undefined || !merged['font-size']) continue;

    const fs_ = num(merged['font-size']);
    let w = num(merged.width);
    if (w === undefined) {
      // flex-row parent width * 0.92
      const openRe = new RegExp('<[a-z-]+\\s+class="([^"]*)"[^>]*>\\s*<text\\s+class="[^"]*\\b' + classes[0] + '\\b[^"]*"', 'g');
      const m2 = openRe.exec(tpl);
      if (m2) for (const pc of m2[1].split(/\s+/).filter(Boolean)) {
        const pd = styles[pc]; if (pd && pd.width) { w = num(pd.width) * 0.92; break; }
      }
    }
    if (w === undefined) continue;
    const innerW = w - (num(merged['padding-left']) || 0) - (num(merged['padding-right']) || 0);
    if (innerW <= 0) continue;
    const content = tf[2].replace(/\{\{[\s\S]*?\}\}/g, '~').replace(/\s+/g, ' ').trim();
    if (!content) continue;
    const needLines = Math.ceil(emWidth(content) / (innerW / fs_));
    if (needLines <= linesAttr) continue;

    // Apply to the class that actually declares `lines`.
    const owner = classes.find(c => styles[c] && styles[c].lines !== undefined);
    if (!owner || seenF.has(owner)) continue;
    seenF.add(owner);
    css = css.replace(new RegExp('(\\.' + owner + '\\s*\\{[^}]*?)\\blines:\\s*' + linesAttr, 'm'), '$1lines:' + needLines);
    changes.push(owner + ':lines ' + linesAttr + '->' + needLines);
    const lh = num(merged['line-height']) || fs_ * 1.4;
    if (num(merged.height)) {
      const newH = Math.ceil(lh * needLines);
      css = css.replace(new RegExp('(\\.' + owner + '\\s*\\{[^}]*?)\\bheight:\\s*' + num(merged.height) + 'dp', 'm'), '$1height:' + newH + 'dp');
      changes.push(owner + ':h->' + newH);
    }
  }

  src = src.replace(styleM[1], css);

  /* Vela's <list> scrolls by default and does NOT accept scroll-y; the toolkit
   * rejects it as an unsupported attribute. Strip any occurrence. */
  if (/<list\b[^>]*scroll-y=/.test(src)) {
    src = src.replace(/(<list\b[^>]*?)\s+scroll-y="[^"]*"/, '$1');
    changes.push('list:drop-scroll-y');
  }

  if (src !== before) fs.writeFileSync(file, src, 'utf8');
  return Array.from(new Set(changes));
}

let n = 0;
for (const d of D) {
  for (const l of L) {
    for (const pg of PAGES) {
      const f = path.join(ROOT, 'devices', d, 'source', l, 'src', 'pages', pg, pg + '.ux');
      if (!fs.existsSync(f)) continue;
      const ch = fix(f);
      if (ch.length) { n += ch.length; console.log('  OK   ' + d + '/' + l + '/' + pg + '  [' + ch.join(', ') + ']'); }
    }
  }
}
console.log('\ndone, ' + n + ' style fixes applied');
