#!/usr/bin/env node
/*
 * check_setup_fit.js — verify the vertical stack of every setup page fits
 * inside the device screen in BOTH opponent modes (two-player and AI).
 *
 * Model
 * -----
 * Setup is a flex column with padding + an absolutely-positioned start
 * button pinned to the bottom. The flow content (everything except the
 * start button) must fit above the start button.
 *
 *   usable = screenH - padTop - padBottom - startH - startBottom - gap
 *
 * Each row contributes (height + margin-bottom). Text rows without an
 * explicit height use font-size * 1.2 (one line) which matches Vela.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const LANGS = ['chinese', 'english'];

// screen heights per device (from each setup.ux .setup { height } declaration)
function screenH(src) {
  const m = src.match(/\.setup\s*\{[^}]*?height:\s*(\d+)dp/);
  return m ? +m[1] : NaN;
}
function padOf(src) {
  const m = src.match(/\.setup\s*\{[^}]*?padding:\s*([\d.]+)dp\s+([\d.]+)dp/);
  return { top: m ? +m[1] : 0, bottom: m ? +m[1] : 0 };
}
// parse a simple flat css rule into a decl map
function rule(src, cls) {
  const re = new RegExp('\\.' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = src.match(re);
  if (!m) return null;
  const d = {};
  for (const part of m[1].split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) d[k] = v; // later wins -> handles duplicates
  }
  return d;
}
function num(d, k, def) {
  if (!d || d[k] === undefined) return def;
  const m = String(d[k]).match(/-?[\d.]+/);
  return m ? +m[0] : def;
}
// margin shorthand "T R B L" helpers (values in dp)
function marginParts(d) {
  const zero = [0, 0, 0, 0];
  if (!d) return zero;
  if (d['margin'] !== undefined) {
    const parts = String(d['margin']).split(/\s+/).map(s => {
      const m = s.match(/-?[\d.]+/); return m ? +m[0] : 0;
    });
    if (parts.length >= 4) return parts;
    if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
    if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
    if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
    return zero;
  }
  return [
    num(d, 'margin-top', 0), num(d, 'margin-right', 0),
    num(d, 'margin-bottom', 0), num(d, 'margin-left', 0)
  ];
}
function marginTop(d) { return marginParts(d)[0]; }
function marginBottom(d) { return marginParts(d)[2]; }

function textHeight(cls, d) {
  const h = num(d, 'height', 0);
  if (h > 0) return h;
  const fs = num(d, 'font-size', 0);
  const lh = num(d, 'line-height', 0);
  if (lh > 0) return lh;
  return fs > 0 ? Math.round(fs * 1.2) : 0;
}

// extract the template body between <template> and </template>
function template(src) {
  const m = src.match(/<template>([\s\S]*?)<\/template>/);
  return m ? m[1] : '';
}

// very small tag walker: returns list of {tag, cls, hasIf, depth}
function rowsOf(tpl) {
  const out = [];
  const re = /<(\/?)(div|text|image|list)\b([^>]*)>/g;
  let m;
  const stack = [];
  while ((m = re.exec(tpl))) {
    const closing = m[1] === '/';
    const tag = m[2];
    const attrs = m[3] || '';
    if (closing) { stack.pop(); continue; }
    const selfClose = /\/\s*$/.test(attrs);
    const clsM = attrs.match(/class="([^"]*)"/);
    // class may be a ternary expression: `{{ a ? 'x y' : 'z' }}`. Prefer the
    // first quoted string literal inside the expression; otherwise the first
    // plain class token. This keeps us from picking up identifiers like
    // `timeControl` / `aiMode` out of `{{...}}`.
    let cls = clsM ? clsM[1] : '';
    let literal = '';
    const expr = cls.match(/\{\{([^}]*)\}\}/);
    if (expr) {
      // Drop comparison operands first (`timeControl === '5+0'`), otherwise the
      // first quoted literal would be the value being compared, not a class.
      const cleaned = expr[1].replace(/[=!]==?\s*'[^']*'/g, '');
      const str = cleaned.match(/'([^']+)'/);
      literal = str ? str[1].split(/\s+/)[0] : '';
    } else {
      literal = (cls.split(/\s+/) || []).find(Boolean) || '';
    }
    const hasIf = /\bif="/.test(attrs);
    const cond = (attrs.match(/if="\{\{([^}]*)\}\}"/) || [])[1] || '';
    out.push({ tag, cls: literal, rawClass: cls, hasIf, cond, depth: stack.length });
    if (!selfClose) stack.push(tag);
  }
  return out;
}

let problems = 0;
for (const dev of DEVICES) {
  for (const lang of LANGS) {
    const f = path.join(ROOT, 'devices', dev, 'source', lang, 'src', 'pages', 'setup', 'setup.ux');
    if (!fs.existsSync(f)) { console.log('SKIP ' + dev + '/' + lang); continue; }
    const src = fs.readFileSync(f, 'utf8');
    const H = screenH(src);
    const pad = padOf(src);
    const start = rule(src, 'start');
    const startH = num(start, 'height', 44);
    const startBottom = num(start, 'bottom', 14);
    const gap = 4; // safety gap between flow content and the pinned button
    // Flow starts at padTop and must stop above the pinned start button, which
    // occupies [H-startBottom-startH, H-startBottom]. padding-bottom does not
    // constrain the flow (the button is absolutely positioned), so it is not
    // subtracted here.
    const usable = H - pad.top - startBottom - startH - gap;

    // The page is now a two-step wizard: .pane rows live at depth 2, nested in
    // .pane (depth 1) inside .setup. Only one pane is visible at a time, and
    // each is followed by its own pinned button, so measure the tallest pane.
    const rows = rowsOf(template(src));
    const rules = {};
    for (const r of rows) if (r.cls && rules[r.cls] === undefined) rules[r.cls] = rule(src, r.cls);

    // Find the pane containers (depth 1) so we can attribute rows to them.
    const panes = rows.filter((r) => r.depth === 1 && r.cls === 'pane');
    const hasPanes = panes.length > 0;

    // Which pane is shown in which step: the wizard uses if="{{step===N}}".
    function paneStep(r) {
      const m = (r.cond || '').match(/step\s*===?\s*(\d+)/);
      return m ? +m[1] : null;
    }

    // Collect the rows that belong to a given pane index (1-based).
    function rowsForStep(stepNo) {
      if (!hasPanes) return rows.filter((r) => r.depth === 1);
      // walk the flat list: rows after a pane opener belong to it until the next
      // depth-1 element
      const out = [];
      let cur = null;
      for (const r of rows) {
        if (r.depth === 1) { cur = r.cls === 'pane' ? paneStep(r) : null; continue; }
        if (r.depth === 2 && cur === stepNo) out.push(r);
      }
      return out;
    }

    function sum(stepNo, mode) {
      let total = 0;
      const detail = [];
      for (const r of rowsForStep(stepNo)) {
        if (r.cls === 'start') continue;
        // Rows that only appear in AI mode
        if (r.hasIf && /mode\s*===?\s*'ai'/.test(r.cond) && !mode.ai) continue;
        // Rows hidden when time is unlimited ("no increment" row).
        if (r.hasIf && /!\s*unlimited/.test(r.cond) && mode.unlimited) continue;
        if (r.hasIf && /\bunlimited\b/.test(r.cond) && /^\s*unlimited\s*$/.test(r.cond) && !mode.unlimited) continue;
        const d = rules[r.cls] || {};
        if (!r.cls) continue;
        let h = textHeight(r.cls, d);
        // A .row wraps a label + control. When it is a flex row its height is
        // the taller of the two; when stacked (narrow screens) it is the sum.
        if (r.cls === 'row') {
          const labelD = rule(src, 'rowLabel') || {};
          const labelH = textHeight('rowLabel', labelD) + marginBottom(labelD);
          const ctrlH = Math.max(
            num(rule(src, 'side'), 'height', 52),
            num(rule(src, 'stepBtn'), 'height', 48),
            num(rule(src, 'seg'), 'height', 44)
          );
          const column = /flex-direction:\s*column/.test(d['flex-direction'] || '');
          h = column ? labelH + ctrlH : Math.max(labelH, ctrlH);
          h = Math.max(num(d, 'min-height', 0), h);
        }
        // Standalone flex rows (kept for safety if a tree still uses them).
        if (r.cls === 'segRow') h = num(rule(src, 'seg'), 'height', 44);
        if (r.cls === 'sideRow') h = num(rule(src, 'side'), 'height', 52);
        if (r.cls === 'stepper') h = num(rule(src, 'stepBtn'), 'height', 48);
        if (r.cls === 'card') h = num(d, 'height', 76);
        const mb = marginBottom(d);
        const mt = marginTop(d);
        total += h + mb + mt;
        detail.push([r.cls, h, mb, mt]);
      }
      return { total, detail };
    }

    // The wizard's panes sit directly under the header, so add the header once.
    const headD = rule(src, 'head') || {};
    const headH = num(headD, 'height', 40) + marginBottom(headD);

    function worstFor(mode2) {
      if (!hasPanes) return sum(1, mode2);
      let best = { total: 0, detail: [], step: 0 };
      for (let i = 1; i <= 2; i++) {
        const s = sum(i, mode2);
        const withHead = { total: s.total + headH, detail: [['head', num(headD, 'height', 40), marginBottom(headD), 0]].concat(s.detail), step: i };
        if (withHead.total > best.total) best = withHead;
      }
      return best;
    }

    // The increment row is hidden when the time is unlimited, which only
    // happens after the user dials minutes down to 0. Measure the worst case
    // (increment row visible) and the unlimited case both.
    const two = worstFor({ ai: false, unlimited: false });
    const ai = worstFor({ ai: true, unlimited: false });
    const aiUnl = worstFor({ ai: true, unlimited: true });
    const worst = Math.max(two.total, ai.total);
    const ok = worst <= usable;
    const flag = ok ? 'OK  ' : 'FAIL';
    if (!ok) problems++;
    console.log(`${flag} ${dev}/${lang}  usable=${usable}dp  two=${two.total}dp  ai=${ai.total}dp` +
      (ok ? '' : `  OVER by ${worst - usable}dp`));
    if (!ok) {
      const which = ai.total >= two.total ? ai : two;
      for (const [c, h, mb, mt] of which.detail) console.log(`        ${c.padEnd(14)} h=${h} mt=${mt} mb=${mb}`);
    }
  }
}
console.log('\n' + (problems === 0 ? 'ALL SETUP PAGES FIT' : problems + ' SETUP PAGE(S) OVERFLOW'));
process.exit(problems === 0 ? 0 : 1);
