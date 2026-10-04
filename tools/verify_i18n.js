#!/usr/bin/env node
/*
 * verify_i18n.js — prove the two-layer localisation actually works.
 *
 * Layer 1: src/i18n/{zh-CN,en-US,defaults}.json  (`$t`, follows the device)
 * Layer 2: src/common/js/strings.js              (`tr`, honours the override)
 *
 * The interesting behaviour is the interaction between the user's stored
 * preference ('system' | 'zh' | 'en') and the device locale. A mistake there
 * shows up on the band as "the setting does nothing" or "my choice was reset
 * on the next page", which is impossible to debug from a screenshot — so the
 * state machine is exercised here instead.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}

/* ------------------------------------------------------------------ *
 * 1. Locale files exist, parse, and have identical key sets.
 * ------------------------------------------------------------------ */
console.log('\n[1] locale files');
const LOCALES = ['src/i18n/zh-CN.json', 'src/i18n/en-US.json', 'src/i18n/defaults.json'];
const parsed = {};
for (const rel of LOCALES) {
  const abs = path.join(ROOT, rel);
  ok(rel + ' exists', fs.existsSync(abs));
  if (!fs.existsSync(abs)) continue;
  let j = null;
  try { j = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { ok(rel + ' parses', false, e.message); continue; }
  ok(rel + ' parses', true);
  parsed[rel] = j;
}

function flatKeys(o, pre, out) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object') flatKeys(v, pre + k + '.', out);
    else out.push(pre + k);
  }
  return out;
}
const keysOf = (j) => flatKeys(j, '', []).sort();

const zh = parsed['src/i18n/zh-CN.json'];
const en = parsed['src/i18n/en-US.json'];
const def = parsed['src/i18n/defaults.json'];

ok('zh-CN.json is non-empty', zh && Object.keys(zh).length > 0);
ok('en-US.json is non-empty', en && Object.keys(en).length > 0);

if (zh && en) {
  const kz = keysOf(zh), ke = keysOf(en);
  ok('zh and en have the same number of keys', kz.length === ke.length, kz.length + ' vs ' + ke.length);
  const onlyZh = kz.filter((k) => !ke.includes(k));
  const onlyEn = ke.filter((k) => !kz.includes(k));
  ok('no key is missing from en', onlyEn.length === 0, 'missing: ' + onlyEn.join(', '));
  ok('no key is missing from zh', onlyZh.length === 0, 'extra: ' + onlyZh.join(', '));
  ok('key count is substantial (>= 100)', kz.length >= 100, 'got ' + kz.length);

  /* Chinese must actually contain Chinese, English must not — a copy/paste
   * mistake that silently ships the wrong language. */
  const zhFlat = flatMap(zh), enFlat = flatMap(en);
  const cjk = /[\u4e00-\u9fff]/;
  const zhWithCjk = Object.keys(zhFlat).filter((k) => cjk.test(zhFlat[k]));
  ok('zh strings mostly contain Chinese', zhWithCjk.length >= kz.length * 0.8,
    zhWithCjk.length + '/' + kz.length);
  const enWithCjk = Object.keys(enFlat).filter((k) => cjk.test(enFlat[k]));
  ok('en strings contain (almost) no Chinese', enWithCjk.length <= 2,
    'offending: ' + enWithCjk.slice(0, 5).join(', '));
}

if (def && en) {
  ok('defaults.json falls back to English', JSON.stringify(flatMap(def)) === JSON.stringify(flatMap(en)));
}

function flatMap(o, pre, out) {
  out = out || {}; pre = pre || '';
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object') flatMap(v, pre + k + '.', out);
    else out[pre + k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 2. Every tree ships the same locale files.
 * ------------------------------------------------------------------ */
console.log('\n[2] per-device copies');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
for (const d of DEVICES) {
  const base = path.join(ROOT, 'devices', d, 'source', 'chinese', 'src');
  for (const f of ['i18n/zh-CN.json', 'i18n/en-US.json', 'i18n/defaults.json', 'common/js/strings.js']) {
    ok(d + ' has ' + f, fs.existsSync(path.join(base, f)));
  }
  /* The per-device copy must be byte-identical to the repo-root canonical. */
  for (const [a, b] of [
    ['src/i18n/zh-CN.json', path.join(base, 'i18n', 'zh-CN.json')],
    ['src/i18n/en-US.json', path.join(base, 'i18n', 'en-US.json')],
    ['src/common/js/strings.js', path.join(base, 'common', 'js', 'strings.js')]
  ]) {
    const A = path.join(ROOT, a);
    if (!fs.existsSync(A) || !fs.existsSync(b)) continue;
    ok(d + ' ' + path.basename(b) + ' matches canonical',
      fs.readFileSync(A, 'utf8') === fs.readFileSync(b, 'utf8'));
  }
}

/* ------------------------------------------------------------------ *
 * 3. strings.js behaviour — the preference x locale state machine.
 *
 * The module is ESM; evaluate it by stripping `export` and running it.
 * ------------------------------------------------------------------ */
console.log('\n[3] strings.js language state machine');
{
  const abs = path.join(ROOT, 'src/common/js/strings.js');
  const src = fs.readFileSync(abs, 'utf8');
  const body = src
    .replace(/^export\s+default\s*\{[\s\S]*?\};?\s*$/m, '')
    .replace(/^export\s+/gm, '');
  let api = null;
  try {
    api = new Function(body + '\nreturn { tr, setLang, setSystemLang, systemLang, getLang, getMode, resolveLang };')();
    ok('strings.js evaluates', true);
  } catch (e) {
    ok('strings.js evaluates', false, e.message);
  }

  if (api) {
    const { tr, setLang, setSystemLang, getLang, getMode, resolveLang } = api;

    /* device = Chinese, preference = system -> Chinese */
    setSystemLang('zh'); setLang('system');
    ok('system + zh device -> zh', getLang() === 'zh', getLang());
    const zhHello = tr('app.settings');

    /* device = English, preference = system -> English */
    setSystemLang('en'); setLang('system');
    ok('system + en device -> en', getLang() === 'en', getLang());
    const enHello = tr('app.settings');
    ok('tr() returns a different string per language', zhHello !== enHello, zhHello + ' / ' + enHello);

    /* explicit override must survive a later locale report */
    setSystemLang('en'); setLang('zh');
    ok('override zh wins over en device', getLang() === 'zh', getLang());
    setSystemLang('en');                    // the band reports its locale again
    ok('explicit zh survives a locale report', getLang() === 'zh', getLang());
    setSystemLang('zh'); setLang('en');
    ok('override en wins over zh device', getLang() === 'en', getLang());
    setSystemLang('zh');
    ok('explicit en survives a locale report', getLang() === 'en', getLang());

    /* back to system */
    setLang('system');
    ok('system mode follows the device again', getLang() === 'zh', getLang());
    ok('getMode reports system', getMode() === 'system', getMode());

    /* unknown key handling: never blank */
    ok('unknown key returns the key itself', tr('no.such.key') === 'no.such.key', tr('no.such.key'));

    /* resolveLang helper */
    ok('resolveLang(system, zh) -> zh', resolveLang('system', 'zh') === 'zh');
    ok('resolveLang(system, en) -> en', resolveLang('system', 'en') === 'en');
    ok('resolveLang(zh, en) -> zh', resolveLang('zh', 'en') === 'zh');
    ok('resolveLang(en, zh) -> en', resolveLang('en', 'zh') === 'en');
    ok('resolveLang(undefined, zh) -> zh', resolveLang(undefined, 'zh') === 'zh');
  }
}

/* ------------------------------------------------------------------ *
 * 4. No page still hardcodes a user-visible Chinese string.
 * ------------------------------------------------------------------ */
console.log('\n[4] pages are free of hardcoded UI text');
for (const d of DEVICES) {
  const pdir = path.join(ROOT, 'devices', d, 'source', 'chinese', 'src', 'pages');
  if (!fs.existsSync(pdir)) continue;
  for (const e of fs.readdirSync(pdir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const ux = path.join(pdir, e.name, e.name + '.ux');
    if (!fs.existsSync(ux)) continue;
    const s = fs.readFileSync(ux, 'utf8');
    /* Comments aside, no CJK should remain in a page. */
    const stripped = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const hits = (stripped.match(/[\u4e00-\u9fff]/g) || []).length;
    ok(d + '/' + e.name + ' has no hardcoded Chinese', hits === 0, hits + ' char(s)');
  }
}

/* ------------------------------------------------------------------ *
 * 5. Every tr()/$t() key referenced by a page exists in the locale files.
 * ------------------------------------------------------------------ */
console.log('\n[5] every referenced key resolves');
const allZh = zh ? flatMap(zh) : {};
const allEn = en ? flatMap(en) : {};
let unresolved = 0, checked = 0;
for (const d of DEVICES) {
  const pdir = path.join(ROOT, 'devices', d, 'source', 'chinese', 'src');
  if (!fs.existsSync(pdir)) continue;
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ux|js)$/.test(e.name) && !/i18n/.test(p)) files.push(p);
    }
  })(pdir);
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    /* Static keys only: tr('a.b') / $t('a.b'). Dynamic keys are checked by
     * the settings/game computed tests elsewhere. */
    const re = /(?:\btr|\$t)\(\s*'([a-zA-Z0-9_.]+)'\s*\)/g;
    let m;
    while ((m = re.exec(s))) {
      checked++;
      if (!Object.prototype.hasOwnProperty.call(allZh, m[1])) {
        unresolved++;
        console.log('    missing zh key: ' + m[1] + '  (' + path.relative(ROOT, f) + ')');
      }
      if (!Object.prototype.hasOwnProperty.call(allEn, m[1])) {
        unresolved++;
        console.log('    missing en key: ' + m[1] + '  (' + path.relative(ROOT, f) + ')');
      }
    }
  }
}
ok('all referenced keys resolve (' + checked + ' refs)', unresolved === 0, unresolved + ' unresolved');

/* ------------------------------------------------------------------ *
 * 6. Language follows the DEVICE: the in-app switcher is gone and every
 *    page resolves its text through $t() against src/i18n/*.json.
 * ------------------------------------------------------------------ */
console.log('\n[6] language = device language ($t() only)');
const PAGES = ['index', 'setup', 'game', 'settings', 'about', 'support', 'purchase'];
for (const d of DEVICES) {
  const base = path.join(ROOT, 'devices', d, 'source', 'chinese', 'src');
  const sf = path.join(base, 'pages', 'settings', 'settings.ux');
  if (!fs.existsSync(sf)) { ok(d + ' settings exists', false); continue; }
  const s = fs.readFileSync(sf, 'utf8');

  /* The in-app switcher must be gone, but the other rows must remain. */
  ok(d + ' has no language row', !/cycleLanguage|langTitle|langMode/.test(s));
  ok(d + ' settings keeps its other rows', /cycleBoard/.test(s) && /toggleAuto/.test(s));

  /* No page may still carry the retired tr() machinery. */
  const stragglers = [];
  for (const pg of PAGES) {
    const f = path.join(base, 'pages', pg, pg + '.ux');
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (/\btr\s*\(/.test(src) || /langTick|applyLang|initLang|strings\.js/.test(src)) stragglers.push(pg);
  }
  ok(d + ' no page uses the retired tr() machinery', stragglers.length === 0, stragglers.join(','));

  /* Every page must resolve its text through $t(). */
  const noT = PAGES.filter((pg) => {
    const f = path.join(base, 'pages', pg, pg + '.ux');
    return fs.existsSync(f) && !/this\.\$t\(/.test(fs.readFileSync(f, 'utf8'));
  });
  ok(d + ' every page uses $t()', noT.length === 0, noT.join(','));
}

console.log('\n' + (fail === 0 ? 'ALL I18N CHECKS PASS' : 'FAILED: ' + fail) + '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
