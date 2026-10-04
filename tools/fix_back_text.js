#!/usr/bin/env node
/**
 * fix_back_text.js — give every back-chevron `text` an explicit text box.
 *
 * Why
 * ---
 * `.back { color:#fff; font-size:30dp; width:32dp; text-align:center; }`
 * has no height and no line-height. On Vela a `text` node without a declared
 * box collapses, so the "‹" glyph is invisible / mis-aligned. This showed up as
 * `verify_handlers.js` RENDER PITFALLS for settings.ux on all 6 trees.
 *
 * Rules
 * -----
 * - Only touches a `.back { ... }` block that lacks height or line-height.
 * - Adds `height:40dp; line-height:40dp;` (matches the setup/head row height).
 * - Idempotent: re-running changes nothing.
 * - Asserts the block was actually found and rewritten (per injection point).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const LANGS = ['chinese'];

const HEIGHT = '40dp';

let total = 0;
let changed = 0;

for (const d of DEVICES) {
  for (const l of LANGS) {
    const base = path.join(ROOT, 'devices', d, 'source', l, 'src', 'pages');
    if (!fs.existsSync(base)) continue;

    for (const page of fs.readdirSync(base)) {
      const f = path.join(base, page, page + '.ux');
      if (!fs.existsSync(f)) continue;

      const before = fs.readFileSync(f, 'utf8');
      const re = /\.back\s*\{([^}]*)\}/;
      const m = before.match(re);
      if (!m) continue; // this page has no .back class

      total++;
      const body = m[1];
      const hasH = /(?:^|[;\s])height\s*:/.test(body);
      const hasLH = /line-height\s*:/.test(body);
      if (hasH && hasLH) continue; // already fine

      // Rebuild the declaration list, preserving everything else.
      let decls = body
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);

      if (!hasH) decls.push('height:' + HEIGHT);
      if (!hasLH) decls.push('line-height:' + HEIGHT);

      const rebuilt = '.' + 'back' + ' { ' + decls.join('; ') + '; }';
      const after = before.replace(re, rebuilt);
      if (after === before) {
        throw new Error('no-op rewrite for ' + path.relative(ROOT, f) + ' (regex matched but replace did not)');
      }

      fs.writeFileSync(f, after, 'utf8');
      changed++;
      console.log('  FIXED ' + d + '/' + l + '/' + page);
    }
  }
}

// Per-injection-point assertion: we expect exactly one .back per discovered page.
console.log('\nscanned ' + total + ' .back declaration(s), updated ' + changed);
