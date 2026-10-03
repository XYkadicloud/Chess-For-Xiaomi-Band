#!/usr/bin/env node
/**
 * verify_handlers.js — every method called from a template must be defined.
 *
 * Motivation
 * ----------
 * A `@click="foo"` or `@touchend="foo('x')"` that references a method which does
 * not exist in the page's `export default { ... }` produces NO error at build
 * time and NO visible error on the device — the tap simply does nothing. This is
 * the hardest class of bug to notice, and it is exactly what shipped: the setup
 * page called setOpponent()/setLevel() that were never injected.
 *
 * This scans every .ux file and reports any handler that is called but not
 * defined. It deliberately errs on the side of reporting: a name flagged here
 * should be checked by hand, not blindly "fixed".
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'build' || e.name === 'dist') continue;
      walk(p, out);
    } else if (e.name.endsWith('.ux')) {
      out.push(p);
    }
  }
  return out;
}

// Pull the <template> and <script> blocks out of a .ux file.
function blocks(src) {
  const t = src.match(/<template>([\s\S]*?)<\/template>/);
  const s = src.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  return { tpl: t ? t[1] : '', script: s ? s[1] : '' };
}

// Method names defined in the page object: `name(` at the top level of the
// exported object, plus `name: function` / `name: (` forms.
function definedMethods(script) {
  const names = new Set();
  // foo() {   /   foo(a, b) {
  for (const m of script.matchAll(/(?:^|[,{\s])([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/g)) {
    names.add(m[1]);
  }
  // foo: function  /  foo: (a) =>  /  foo: () =>
  for (const m of script.matchAll(/(?:^|[,{\s])([a-zA-Z_$][\w$]*)\s*:\s*(?:function|\()/g)) {
    names.add(m[1]);
  }
  return names;
}

// Names that are legitimately not methods.
const BUILTIN = new Set([
  // JS / framework
  'if', 'for', 'while', 'return', 'function', 'typeof', 'new', 'this',
  'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date',
  'parseInt', 'parseFloat', 'isNaN', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'console', 'require', 'import', 'export',
  'true', 'false', 'null', 'undefined', 'void', 'delete', 'in', 'of', 'do',
  // Vela component lifecycle / built-ins
  'onInit', 'onReady', 'onShow', 'onHide', 'onDestroy', 'onBackPress',
  'onConfigurationUpdate',
  // in-template helpers commonly available
  'item', 'index', 'list'
]);

function handlersInTemplate(tpl) {
  const found = [];
  // @click="..."  @touchend="..."  @change="..."  @longpress="..."
  for (const m of tpl.matchAll(/@[a-zA-Z]+\s*=\s*"([^"]*)"/g)) {
    const expr = m[1];
    // `foo`, `foo('a')`, `foo(bar, 'x')`, `foo.bar()` — take leading identifier
    for (const c of expr.matchAll(/([a-zA-Z_$][\w$]*)\s*(?=\(|$|\s)/g)) {
      found.push(c[1]);
    }
  }
  return found;
}

let totalFiles = 0;
let totalBad = 0;
const report = [];

for (const dev of ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10']) {
  for (const lang of ['chinese', 'english']) {
    const base = path.join(ROOT, 'devices', dev, 'source', lang, 'src', 'pages');
    if (!fs.existsSync(base)) continue;
    for (const f of walk(base)) {
      totalFiles++;
      const src = fs.readFileSync(f, 'utf8');
      const { tpl, script } = blocks(src);
      if (!tpl || !script) continue;

      const defined = definedMethods(script);
      const called = handlersInTemplate(tpl);
      const missing = [...new Set(called)].filter(
        (n) => !defined.has(n) && !BUILTIN.has(n)
      );
      if (missing.length) {
        totalBad++;
        const rel = path.relative(ROOT, f).replace(/\\/g, '/');
        report.push({ rel, missing });
      }
    }
  }
}

console.log('checked ' + totalFiles + ' .ux files');
if (report.length) {
  console.log('\nUNDEFINED HANDLERS (tap will silently do nothing):');
  for (const r of report) {
    console.log('  ' + r.rel);
    console.log('      ' + r.missing.join(', '));
  }
  console.log('\n' + totalBad + ' file(s) with undefined handlers');
  process.exit(1);
} else {
  console.log('all template handlers are defined');
}
