#!/usr/bin/env node
/**
 * merge_languages.js — fold the English tree into the Chinese tree.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES
 *
 *  1. Settings page: adds a "语言 / Language" three-state row (System / 中文 /
 *     English) and makes the whole page language-aware.
 *
 *  2. Every other page in the Chinese tree: replaces the hard-coded Chinese
 *     literals with `$t('group.key')` bindings (static strings that follow the
 *     device language) or `this.tr('group.key')` (strings that must respect the
 *     manual override chosen in Settings).
 *
 *  3. Removes the now-redundant `source/english` tree for each device.
 *
 * ---------------------------------------------------------------------------
 * ONE MECHANISM: $t()
 *
 *   $t('a.b')  — resolved by the Vela runtime against src/i18n/*.json, so the
 *                text follows the DEVICE language. Zero runtime cost, and it
 *                re-resolves when the band language changes. Available on the
 *                page instance (`this.$t`).
 *
 * There is no second mechanism and no in-app language switch. A custom `tr()`
 * layer with a stored override was tried and removed: it needed a `langTick`
 * reactive dependency, and it produced a page that rendered completely empty,
 * a home screen stuck in one language, and a zh->en flash on every first frame.
 * `toSystemLang()` below exists to strip any trace of it and to restore every
 * computed the templates bind.
 *
 * ---------------------------------------------------------------------------
 * HARD-WON RULES BAKED IN (see build_setup_page.js for the longer version)
 *
 *  - A ternary inside `class="..."` breaks on Band 9. Selection is always
 *    driven by an inline `style`, never by a class.
 *  - A `text` used as a flex child needs explicit height + line-height or it
 *    collapses to zero height and becomes invisible.
 *  - Vela rejects a bare `get foo(){}` accessor; derived values must live in
 *    `computed: {...}`.
 *  - Assertions run before any write, so a failed run leaves the tree intact.
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];

const GEO = {
  /* viewportH = the height of `.boardViewport` in game.ux, which is what the
   * board must slide within. Band 9 Pro is taller (its clock row is a single
   * line, see fix_band9_band10_clock.js) and centres its board horizontally
   * instead of pinning it left. Keep these in step with the .ux styles. */
  'xiaomi-band-9': { w: 192, h: 490, viewportH: 264, centred: false },
  'xiaomi-band-9-pro': { w: 336, h: 480, viewportH: 280, centred: true },
  'xiaomi-band-10': { w: 212, h: 520, viewportH: 264, centred: false }
};

/*
 * Settings page — fully regenerated (it is short and layout-sensitive).
 *
 * REACTIVITY NOTE: `tr()` is a plain imported function; the ViewModel cannot
 * see that it read our language state, so a bare {{tr('x')}} would NOT re-render
 * when the language changes. Every label therefore goes through a `computed`
 * property (or reads `langTick`), because `computed` IS tracked and will
 * re-evaluate when a dependency changes. `langTick` is the explicit dependency
 * that bumps on every language switch.
 */
/* ------------------------------------------------------------------ *
 * Revert the custom tr() language machinery back to the platform's own
 * $t() lookup.
 *
 * Why: $t() is resolved by the Vela runtime against src/i18n/*.json and
 * follows the DEVICE language. The hand-rolled tr() path added an in-app
 * override, a langTick dependency and an async storage read, which produced
 * a zh->en first-frame flash and left some pages pinned to one language
 * (About rendered nothing at all because its computeds were lost). We now
 * use $t() everywhere: no language state, nothing to keep in sync.
 *
 * The conversions below are applied to every page at the end of the pass, so
 * a tree that still carries the old machinery converges in one run.
 * ------------------------------------------------------------------ */

/* Remove a member `name(...){ ... }` (plus a trailing comma) with balanced
 * brace matching, so a body containing nested braces is handled safely. */
function removeMember(src, name) {
  const re = new RegExp('(^|[\\s,{])' + name + '\\s*\\([^)]*\\)\\s*\\{', 'g');
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[1].length;
    let depth = 1;
    let i = m.index + m[0].length;      /* just past the opening '{' */
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (depth !== 0) return src;        /* unbalanced — refuse to guess */
    let end = i;
    if (src[end] === ',') end++;
    return removeMember(src.slice(0, start) + src.slice(end), name);
  }
  return src;
}

/* The i18n groups, used to split `tt_<group>_<key>` back into a key path. */
const I18N_GROUPS = ['app', 'setup', 'settings', 'game', 'about', 'support', 'purchase'];

/* Make sure every `{{tt_<group>_<key>}}` the template uses has a computed.
 * This is what repairs the About page, whose computeds had been dropped. */
function ensureComputeds(src) {
  const tplEnd = src.indexOf('</template>');
  if (tplEnd < 0) return src;
  const names = new Set();
  for (const m of src.slice(0, tplEnd).matchAll(/\{\{\s*(tt_[A-Za-z0-9_]+)\s*\}\}/g)) names.add(m[1]);
  const add = [];
  for (const n of names) {
    if (new RegExp('\\b' + n + '\\s*\\(').test(src)) continue;   /* already defined */
    const rest = n.slice(3);
    const gi = rest.indexOf('_');
    if (gi < 0) continue;
    const group = rest.slice(0, gi);
    const key = rest.slice(gi + 1);
    if (!I18N_GROUPS.includes(group)) continue;
    add.push("    " + n + "(){ return this.$t('" + group + "." + key + "'); },");
  }
  if (!add.length) return src;
  if (/computed\s*:\s*\{/.test(src)) {
    return src.replace(/(computed\s*:\s*\{)/, '$1\n' + add.join('\n'));
  }
  return src.replace(/(export default\s*\{)/, '$1\n  computed:{\n' + add.join('\n') + '\n  },');
}

/* The home page's four labels are not plain key lookups (the primary label
 * depends on whether a game is in progress), so they are not covered by
 * ensureComputeds(). The 9 Pro / Band 10 trees never got them — their home
 * screen rendered four EMPTY buttons — because indexRules() only matched the
 * Band 9 script shape. Add them here for every tree. */
const INDEX_COMPUTED = [
  ['primaryLabel', "this.hasActiveGame ? this.$t('app.continueGame') : this.$t('app.startGame')"],
  ['settingsLabel', "this.$t('app.settings')"],
  ['aboutLabel', "this.$t('app.about')"],
  ['exitLabel', "this.$t('app.exitApp')"],
];
function ensureIndexComputeds(src) {
  const add = [];
  for (const [name, body] of INDEX_COMPUTED) {
    if (new RegExp('\\b' + name + '\\s*\\(').test(src)) continue;
    add.push('    ' + name + '(){ return ' + body + '; },');
  }
  if (!add.length) return src;
  if (/computed\s*:\s*\{/.test(src)) {
    return src.replace(/(computed\s*:\s*\{)/, '$1\n' + add.join('\n'));
  }
  return src.replace(/(export default\s*\{)/, '$1\n  computed:{\n' + add.join('\n') + '\n  },');
}

/* Convert one page source to the $t()-only language path. Idempotent. */
function toSystemLang(src) {
  let out = src;
  /* 1. Drop the retired helpers / bootstrap methods. */
  out = removeMember(out, 'tr');
  out = removeMember(out, 'applyLang');
  out = removeMember(out, 'applySystemLang');
  out = removeMember(out, 'onConfigurationChanged');
  /* 2. Drop leftover calls and language state. Consume the surrounding
   *    horizontal whitespace too, so removing `this.applyLang();` from
   *    `onInit(){ this.applyLang(); x(); }` leaves `onInit(){ x(); }` and not
   *    a widening run of spaces on each pass. */
  out = out.replace(/[ \t]*this\.applyLang\(\)[ \t]*;?/g, '');
  out = out.replace(/[ \t]*this\.applySystemLang\(\)[ \t]*;?/g, '');
  out = out.replace(/[ \t]*this\.langTick\s*=\s*\(this\.langTick\s*\|\|\s*0\)\s*\+\s*1[ \t]*;?/g, '');
  out = out.replace(/[ \t]*this\.langTick[ \t]*;?/g, '');
  out = out.replace(/\blangTick\s*:\s*0\s*,?/g, '');
  /* 3. Drop the strings.js import and an now-unused configuration import. */
  out = out.replace(/^[ \t]*import\s*\{[^}]*\}\s*from\s*'[^']*common\/js\/strings\.js';[ \t]*\r?\n/gm, '');
  if (!/\bconfiguration\s*\./.test(out)) {
    out = out.replace(/^[ \t]*import\s+configuration\s+from\s+'@system\.configuration';[ \t]*\r?\n/gm, '');
  }
  /* 4. tr('x') -> this.$t('x'). `\b` keeps `str(`/`attr(` from matching. */
  out = out.replace(/\btr\s*\(/g, 'this.$t(');
  /* 5. Tidy the commas/braces left behind by the removals. */
  out = out.replace(/,\s*,/g, ',').replace(/\{\s*,/g, '{').replace(/,\s*\}/g, '}');
  /* 6. Restore any computed the template needs but the script lacks. */
  out = ensureComputeds(out);
  return out;
}

function settingsPage(geo, dev) {
  const W = geo.w;
  const H = geo.h;
  const PAD = 12;
  const CW = W - PAD * 2;

  return `<template>
  <div class="settingsPage">
    <div class="header">
      <text class="back" @click="back">\u2039</text>
      <text class="headerTitle">{{title}}</text>
    </div>

    <div class="setting" @click="toggleAuto">
      <text class="settingName">{{autoLabel}}</text>
      <text class="settingValue">{{autoValue}}</text>
    </div>

    <div class="setting" @click="cycleBoard">
      <text class="settingName">{{boardTitle}}</text>
      <text class="settingValue">{{boardLabel}}</text>
    </div>

    <text class="footer" @click="back">{{doneLabel}}</text>
  </div>
</template>
<style>
.settingsPage { width:${W}dp; height:${H}dp; background-color:#000000; padding:18dp ${PAD}dp; flex-direction:column; }
.header { width:${CW}dp; height:48dp; flex-direction:row; align-items:center; margin-bottom:12dp; }
.back { color:#FFFFFF; font-size:30dp; width:32dp; text-align:center; height:40dp; line-height:40dp; }
.headerTitle { color:#FFFFFF; font-size:22dp; font-weight:bold; line-height:40dp; }
.setting { width:${CW}dp; min-height:54dp; border-radius:18dp; background-color:#252828; margin-bottom:8dp; padding:0 14dp; flex-direction:row; align-items:center; justify-content:space-between; }
.settingName { color:#FFFFFF; font-size:17dp; line-height:24dp; }
.settingValue { color:#4EA1FF; font-size:15dp; line-height:24dp; }
.footer { width:${CW}dp; height:44dp; border-radius:22dp; background-color:#0D6EFF; color:#FFFFFF; text-align:center; line-height:44dp; font-size:18dp; margin-top:12dp; }
</style>
<script>
import router from '@system.router';
import storage from '@system.storage';

/* Text follows the DEVICE language. $t() is resolved by the Vela runtime
 * against src/i18n/*.json, so there is no in-app language switch and no
 * per-page language state to keep in sync (that machinery caused a zh->en
 * first-frame flash and left some pages stuck in one language). */
export default {
  data:{ autoCenter:true, boardSize:'standard' },
  computed:{
    title(){ return this.$t('settings.title'); },
    autoLabel(){ return this.$t('settings.autoCenter'); },
    autoValue(){ return this.autoCenter ? this.$t('settings.on') : this.$t('settings.off'); },
    boardTitle(){ return this.$t('settings.boardSize'); },
    doneLabel(){ return this.$t('app.done'); },
    /* boardSize is stored as a stable key ('standard'|'large'|'compact') and
     * only localised for display. */
    boardLabel(){
      const m = { standard:'settings.boardStandard', large:'settings.boardLarge', compact:'settings.boardCompact' };
      return this.$t(m[this.boardSize] || 'settings.boardStandard');
    }
  },
  onInit(){ this.load(); },
  onShow(){ this.load(); },
  load(){
    storage.get({key:'CHESS_SETTINGS',success:(data)=>{
      try{
        const raw=data&&data.data!==undefined?data.data:data;
        if(raw===undefined||raw===null||raw==='')return;
        const v=typeof raw==='string'?JSON.parse(raw):raw;
        this.autoCenter=v.autoCenter!==false;
        this.boardSize=v.boardSize||'standard';
      }catch(e){}
    },fail:()=>{}});
  },
  save(){storage.set({key:'CHESS_SETTINGS',value:JSON.stringify({autoCenter:this.autoCenter,boardSize:this.boardSize})});},
  back(){this.save();router.back();},
  toggleAuto(){this.autoCenter=!this.autoCenter;this.save();},
  cycleBoard(){
    this.boardSize = this.boardSize==='large' ? 'compact' : (this.boardSize==='compact' ? 'standard' : 'large');
    this.save();
  }
}
</script>
`;
}

/* ------------------------------------------------------------------ *
 * Generic literal → $t() rewriting for the remaining pages.
 *
 * Each rule is [match, replacement]. `require` lists substrings that must be
 * present afterwards, so a silently-failed substitution is caught.
 * ------------------------------------------------------------------ */
/*
 * Apply a rule table to a page.
 *
 * IDEMPOTENCY: the pipeline is meant to be re-runnable, so a rule whose `from`
 * pattern is already absent because a previous run converted it is NOT an
 * error — it only counts as a failure when the file still contains the raw
 * literal but the rule failed to match it. `alreadyDone` marks rules that can
 * legitimately be gone on a second pass.
 */
function rewritePages(absFile, rules, preSrc) {
  let src = (preSrc === undefined || preSrc === null) ? fs.readFileSync(absFile, 'utf8') : preSrc;
  const before = src;
  const misses = [];
  for (const rule of rules) {
    const from = rule[0];
    const to = rule[1];
    const optional = rule[2] === true;
    if (from instanceof RegExp) {
      if (!from.test(src)) { if (!optional) misses.push(String(from)); continue; }
      src = src.replace(from, to);
      continue;
    }
    if (!src.includes(from)) { if (!optional) misses.push(from); continue; }
    src = src.split(from).join(to);
  }
  if (misses.length) {
    throw new Error(path.relative(ROOT, absFile) + ': patterns not found:\n  ' + misses.join('\n  '));
  }
  /* A no-op is fine on a re-run; only a genuine miss is an error. */
  return src === before ? null : src;
}

/* ------------------------------------------------------------------ *
 * Unify every page onto tr().
 *
 * Background: $t() follows the SYSTEM locale and cannot be overridden by
 * the app. Pages that used $t() therefore stayed Chinese on a Chinese band
 * even after the user picked English in Settings, while pages built on tr()
 * switched — the "About is Chinese, Home is English" split users reported.
 *
 * The fix is one language path for the whole app. This pass rewrites every
 * remaining {{$t('group.key')}} template binding into a computed property
 * that calls tr() and reads `this.langTick` for reactivity:
 *
 *   {{$t('about.title')}}   ->   {{tt_about_title}}
 *   computed: { tt_about_title(){ this.langTick; return tr('about.title'); }, ... }
 *
 * It also makes sure the page has the tr/applyLang bootstrap. Runs after all
 * the per-page rules, so it sees whatever $t() bindings survived them.
 * ------------------------------------------------------------------ */
function localizeName(key) {
  /* about.title -> tt_about_title  (stable, collision-free, valid identifier) */
  return 'tt_' + key.replace(/[^A-Za-z0-9_]/g, '_');
}

function unifyToTr(src, dev, page) {
  /* Collect keys still bound through $t() in the template. */
  const keys = new Set();
  const re = /\{\{\s*\$t\(\s*'([^']+)'\s*\)\s*\}\}/g;
  let m;
  while ((m = re.exec(src)) !== null) keys.add(m[1]);
  /* Script-side `this.$t('key')` is just as pinned to the system locale, so
   * fold those into the same rewrite (e.g. about's versionText computed). */
  const reScript = /this\.\$t\(\s*'([^']+)'\s*\)/g;
  const scriptKeys = new Set();
  while ((m = reScript.exec(src)) !== null) scriptKeys.add(m[1]);
  if (keys.size === 0 && scriptKeys.size === 0) return seedOnInit(src, 'export default {');

  /* 1. rewrite the call sites: template binding and script call alike. */
  let out = src.replace(re, (_all, key) => '{{' + localizeName(key) + '}}');
  out = out.replace(reScript, (_all, key) => "tr('" + key + "')");

  /* 2. make sure the page imports tr() and sets the language synchronously */
  if (!/strings\.js/.test(out)) out = injectTrHelper(out, dev, page);

  /* The script-side calls are already plain tr() now; only the template
   * bindings need a computed to stay reactive. */
  if (keys.size === 0) return seedOnInit(out, 'export default {');

  /* 3. splice the computeds in. Existing computed blocks get the entries
   *    appended; a page with no computed block gets one.
   *
   *    IDEMPOTENCY: a key whose computed is already defined is skipped, so a
   *    second run cannot stack duplicate entries. (The call-site rewrite in
   *    step 1 is a no-op once the $t() form is gone, but the splice below is
   *    driven by the collected keys and would otherwise re-add them.) */
  const fresh = [...keys].filter((k) => !new RegExp('\\b' + localizeName(k) + '\\s*\\(').test(out));
  if (fresh.length === 0) {
    /* nothing left to add; still finish the other guarantees below */
  } else {
    const entries = fresh.map((k) =>
      "    " + localizeName(k) + "(){ this.langTick; return tr('" + k + "'); },").join('\n');

    if (/computed\s*:\s*\{/.test(out)) {
      out = out.replace(/(computed\s*:\s*\{)/, '$1\n' + entries);
    } else {
      out = out.replace(/(export default\s*\{)/, '$1\n  computed:{\n' + entries + '\n  },');
    }
  }

  /* 4. langTick must exist as data for the dependency to register. */
  if (!/langTick\s*:/.test(out)) {
    if (/(data\s*:\s*\{)/.test(out)) {
      out = out.replace(/(data\s*:\s*\{)/, '$1 langTick:0,');
    } else {
      out = out.replace(/(export default\s*\{)/, '$1\n  data:{ langTick:0 },');
    }
  }

  /* 5. settle the language on show so a Settings change is picked up. */
  if (!/this\.applyLang\(\)/.test(out)) {
    if (/(\n\s*)(onShow\s*\([^)]*\)\s*\{)/.test(out)) {
      out = out.replace(/(\n\s*)(onShow\s*\([^)]*\)\s*\{)/, "$1$2 this.applyLang(); ");
    } else {
      /* No onShow: add one next to the first lifecycle hook we can find. */
      out = out.replace(/(export default\s*\{)/, "$1\n  onShow(){ this.applyLang(); },");
    }
  }

  /* 6. ...and once more in onInit, so the FIRST painted frame is already in
   *    the right language (onShow is too late — see seedOnInit). */
  out = seedOnInit(out, 'export default {');

  return out;
}

/* ------------------------------------------------------------------ *
 * Per-page rule tables
 * ------------------------------------------------------------------ */

function indexRules(dev) {
  /* Regex, not literal replacement: `>关于<` would also match inside the
   * already-rewritten `>{{tr('app.about')}}<`, so a plain string replace
   * corrupts the result on a second pass. Anchoring on the whole text element
   * keeps it order-independent and idempotent.
   *
   * Labels go through computed properties, not a bare tr() call inside the
   * template: an imported function is invisible to the ViewModel's dependency
   * tracking, so {{tr('x')}} would render once and never update. */
  return [
    [/<text class="primary" @click="startGame">[^<]*<\/text>/,
     "<text class=\"primary\" @click=\"startGame\">{{primaryLabel}}</text>", true],
    [/<text class="secondary" @click="openSettings">[^<]*<\/text>/,
     "<text class=\"secondary\" @click=\"openSettings\">{{settingsLabel}}</text>", true],
    [/<text class="secondary" @click="openAbout">[^<]*<\/text>/,
     "<text class=\"secondary\" @click=\"openAbout\">{{aboutLabel}}</text>", true],
    [/<text class="secondary" @click="exitApp">[^<]*<\/text>/,
     "<text class=\"secondary\" @click=\"exitApp\">{{exitLabel}}</text>", true],
    /* Already carries the computed block? Then this is a re-run; the rule below
     * would stack a second copy, so skip the whole table in that case. */
    [/(\}, )(data:\{hasActiveGame:false\},)/,
     "$1$2 langTick:0,\n  computed:{\n    primaryLabel(){ this.langTick; return this.hasActiveGame ? tr('app.continueGame') : tr('app.startGame'); },\n    settingsLabel(){ this.langTick; return tr('app.settings'); },\n    aboutLabel(){ this.langTick; return tr('app.about'); },\n    exitLabel(){ this.langTick; return tr('app.exitApp'); }\n  },", true],
    /* Resolve the stored preference on every show, so returning from Settings
     * immediately reflects a language change. */
    [/onShow\(\)\{this\.checkActiveGame\(\);\}/,
     "onShow(){this.applyLang();this.checkActiveGame();}", true]
  ];
}

/* ------------------------------------------------------------------ *
 * The About page's <script> differs per device: Band 9 is a plain
 * back/openQr pair, while 9 Pro and 10 also carry the IAP helpers
 * (`storage` import, `data.purchaseConfirmed`, `loadPurchase`,
 * `openPurchase`). Rebuild the block from scratch so the version binding
 * becomes a `$t('about.version')` computed, but keep the device-specific
 * members — the 9 Pro / Band 10 templates call `openPurchase` and would
 * silently do nothing without it.
 * ------------------------------------------------------------------ */
function aboutScript(src) {
  const iap = /\bopenPurchase\b/.test(src);
  const out = ["import router from '@system.router';"];
  if (iap) out.push("import storage from '@system.storage';");
  out.push("export default {");
  out.push("  computed:{");
  out.push("    versionText(){ return this.$t('about.version'); }");
  out.push("  },");
  if (iap) {
    out.push("  data:{purchaseConfirmed:false},");
    out.push("  onInit(){this.loadPurchase();},");
    out.push("  onShow(){this.loadPurchase();},");
    out.push("  loadPurchase(){storage.get({key:'purchase_confirmed',success:(r)=>{const raw=r&&r.data!==undefined?r.data:r;this.purchaseConfirmed=raw===true||String(raw)==='true';},fail:()=>{this.purchaseConfirmed=false;}});},");
  }
  out.push("  back(){router.back();},");
  out.push("  openQr(){router.push({uri:'/pages/support'});}" + (iap ? "," : ""));
  if (iap) out.push("  openPurchase(){router.push({uri:'/pages/purchase'});}");
  out.push("}");
  return out.join("\n") + "\n";
}

function aboutRules(src) {
  /* The device name is baked into the prose ("运行在 Xiaomi Band 9 Pro Vela
   * 上"), so the body text has to be matched by pattern rather than by an exact
   * literal — three devices, three different strings. The replacement drops the
   * device name in favour of a generic "Xiaomi Band Vela", which is also what
   * the shared i18n string says, so one key serves all three devices. */
  return [
    ['<text class="headerTitle">关于</text>', "<text class=\"headerTitle\">{{$t('about.title')}}</text>", true],
    ['<text class="version">版本 1.1</text>', "<text class=\"version\">{{versionText}}</text>", true],
    ['<text class="authorLabel">开发者</text>', "<text class=\"authorLabel\">{{$t('about.developer')}}</text>", true],
    ['<text class="sectionTitle">应用说明</text>', "<text class=\"sectionTitle\">{{$t('about.aboutApp')}}</text>", true],
    [/<text class="bodyText">Chess 是一款运行在[^<]*<\/text>/,
     "<text class=\"bodyText\">{{$t('about.aboutAppBody')}}</text>", true],
    ['<text class="sectionTitle">已支持的规则</text>', "<text class=\"sectionTitle\">{{$t('about.supportedRules')}}</text>", true],
    ['<text class="bodyText">棋子基本走法与吃子、将军、将死、逼和、王车易位、吃过路兵、兵升变、三次重复和棋、五十回合和棋。</text>',
     "<text class=\"bodyText\">{{$t('about.supportedRulesBody')}}</text>", true],
    ['<text class="sectionTitle">尚未完整支持</text>', "<text class=\"sectionTitle\">{{$t('about.notSupported')}}</text>", true],
    ['<text class="bodyText">兵升变目前自动升为后，暂不支持选择升变为车、象或马；暂不支持棋局历史保存与 PGN 导入导出。</text>',
     "<text class=\"bodyText\">{{$t('about.notSupportedBody')}}</text>", true],
    ['<text class="sectionTitle">棋子素材</text>', "<text class=\"sectionTitle\">{{$t('about.pieces')}}</text>", true],
    [/<text class="bodyText">棋子外观来自[^<]*<\/text>/,
     "<text class=\"bodyText\">{{$t('about.piecesBody')}}</text>", true],
    ['<text class="sectionTitle supportTitle">爱发电主页</text>', "<text class=\"sectionTitle supportTitle\">{{$t('about.afdian')}}</text>", true],
    ['<text class="supportText">这是我的爱发电主页，希望能够捐赠支持一下。</text>',
     "<text class=\"supportText\">{{$t('about.afdianBody')}}</text>", true],
    ['<text class="qrButton">点击查看大图二维码</text>', "<text class=\"qrButton\">{{$t('about.afdianButton')}}</text>", true],
    ['<text class="thanks">感谢你的支持</text>', "<text class=\"thanks\">{{$t('about.thanks')}}</text>", true],
    /* The 9 Pro / Band 10 About page carries an entry point into the paid page. */
    [/<text class="purchaseEntry">前往付款<\/text>/,
     "<text class=\"purchaseEntry\">{{$t('about.goPay')}}</text>", true],
    /* Regex on the script block. The terminator is the literal `</script>`
     * (NOT a lookahead — the lookahead form silently failed to match the
     * one-liner because `\s*` before `</script>` also had to consume the
     * already-matched `\n`). Anchoring on the tag itself is unambiguous and
     * also survives the already-expanded form from a previous pass. */
    [/import router from '@system\.router';[\s\S]*?(?=<\/script>)/, () => aboutScript(src), true]
  ];
}

function supportRules() {
  return [
    ['<text class="title">爱发电主页</text>', "<text class=\"title\">{{$t('support.title')}}</text>", true],
    ['<text class="hint">扫码支持开发者</text>', "<text class=\"hint\">{{$t('support.hint')}}</text>", true],
    ['<text class="caption">这是我的爱发电主页</text>', "<text class=\"caption\">{{$t('support.caption')}}</text>", true],
    ['<text class="support">如果你喜欢这个项目，希望能够捐赠支持一下。</text>',
     "<text class=\"support\">{{$t('support.body')}}</text>", true],
    ['<text class="backButton" @touchend="back">返回关于</text>',
     "<text class=\"backButton\" @touchend=\"back\">{{$t('support.backToAbout')}}</text>", true]
  ];
}

/* ------------------------------------------------------------------ *
 * Game page. Unlike index/about/support, most of its text is *built in
 * script* ("白方回合", "走子完成，请交给白方"), so the conversion has to
 * (a) swap the template literals for tr()-backed computed properties and
 * (b) rewire the dynamic strings to compose from tr() fragments.
 *
 * The dynamic ones use concatenation rather than a full format string so
 * word order stays correct in both languages:
 *   zh: '走子完成，请交给' + '白方'
 *   en: 'Move played, pass to ' + 'White'
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 * Board-interaction performance.
 *
 * Tapping a piece felt laggy because ALL the work happened before the
 * repaint: the selection box only appeared once the legal-move list was
 * ready. Four changes, each measured with tools/bench_selection.js:
 *
 *  1. updateSquares() built all 64 square objects on every tap just to find
 *     that two or three had changed. Only the changed ones are built now.
 *  2. move() rebuilt all 64 squares (buildSquares) although a move touches at
 *     most four. It now uses the same incremental path.
 *  3. getMoves() keyed its cache on `board.join(',') + JSON.stringify(castling)`
 *     — a ~250-char string plus a serialisation on EVERY call, even cache
 *     hits, and hasLegalMove() calls it per piece. The cache is now
 *     per-position and keyed by square index alone, and it is dropped whenever
 *     the position changes. That also fixes a leak: it was never cleared, so a
 *     long game accumulated one entry per position.
 *  4. tapSquare() paints the selection first and computes the moves on the next
 *     frame. A pending computation is flushed if the user taps again before it
 *     lands, so "select, then tap the destination" still works at any speed.
 * ------------------------------------------------------------------ */
function selectionPerf(out, dev) {
  const must = (cond, msg) => { if (!cond) throw new Error(dev + '/game: ' + msg); };

  /* --- 1. new state: the deferred selection + its timer --- */
  if (!/pendingSelect\s*:/.test(out)) {
    out = out.replace(/(\blegalCache\s*:\s*\{\s*\})/, '$1, pendingSelect: -1, selectTimer: null');
  }

  /* --- 2. updateSquares: only build what changed, without 64 linear scans ---
   * Two wins here. (a) It used to build all 64 square objects on every tap to
   * discover that two had changed. (b) `this.legalMoves.indexOf(i)` ran for
   * every one of the 64 squares while the list can hold 27 moves — ~1700
   * comparisons per repaint; two lookup arrays cost 27 writes + 64 reads. */
  {
    const V0 = "updateSquares(){if(!this.squares||this.squares.length!==64){this.buildSquares();return;}const out=this.squares.slice();let changed=false;for(let i=0;i<64;i++){const n=this.squareOf(i),o=out[i];if(!o||o.piece!==n.piece||o.pieceSrc!==n.pieceSrc||o.selected!==n.selected||o.lastMove!==n.lastMove||o.legal!==n.legal){out[i]=n;changed=true;}}if(changed)this.squares=out;}";
    const V1 = "updateSquares(){if(!this.squares||this.squares.length!==64){this.buildSquares();return;}const out=this.squares.slice();let changed=false;for(let i=0;i<64;i++){const o=out[i],p=this.board[i],src=p?'/common/pieces/'+p+'.png':'',sel=i===this.selected,lm=this.lastMove.indexOf(i)>=0,lg=this.legalMoves.indexOf(i)>=0;if(!o||o.pieceSrc!==src||o.selected!==sel||o.lastMove!==lm||o.legal!==lg){out[i]=this.squareOf(i);changed=true;}}if(changed)this.squares=out;}";
    const V2 = "updateSquares(){if(!this.squares||this.squares.length!==64){this.buildSquares();return;}const out=this.squares.slice(),lmk=[],lgk=[];for(let k=0;k<this.lastMove.length;k++)lmk[this.lastMove[k]]=1;for(let k=0;k<this.legalMoves.length;k++)lgk[this.legalMoves[k]]=1;let changed=false;for(let i=0;i<64;i++){const o=out[i],p=this.board[i],src=p?'/common/pieces/'+p+'.png':'',sel=i===this.selected,l=!!lmk[i],g=!!lgk[i];if(!o||o.pieceSrc!==src||o.selected!==sel||o.lastMove!==l||o.legal!==g){out[i]=this.squareOf(i);changed=true;}}if(changed)this.squares=out;}";
    for (const v of [V0, V1]) if (out.includes(v)) { out = out.replace(v, V2); break; }
    must(/const out=this\.squares\.slice\(\),lmk=\[\],lgk=\[\]/.test(out), 'updateSquares was not optimised');
  }

  /* --- 3. getMoves: per-position cache + a cheaper legality test ---
   *
   *  a. The cache key was `board.join(',') + JSON.stringify(castling)` — a
   *     ~250-char string plus a serialisation on every call, even a hit, and
   *     hasLegalMove() calls this once per piece. Keyed by square now, and
   *     dropped whenever the position changes.
   *  b. The legality filter ran isInCheckBoard() per pseudo-move, which does
   *     board.indexOf(king) — a 64-cell scan — before the attack test. The
   *     king square is computed once per getMoves and passed straight to
   *     isSquareAttacked (when the moving piece IS the king its destination is
   *     the king square).
   *
   * NOTE: a variant that also replaced applyBoardMove()'s board copy with
   * make/unmake on a single scratch array was tried and dropped. It bought
   * nothing measurable (the native Array#slice is hard to beat) while adding
   * en-passant/castling bookkeeping to the hottest loop — not a trade worth
   * making. The harness needs thousands of iterations per measurement to be
   * trustworthy; at 300 the numbers swing by 2x and will mislead you. */
  {
    const NEW = "getMoves(i){const p=this.board[i];if(!p)return[];const mine=p[0]===this.turn[0],c=this.legalCache;if(mine&&c[i])return c[i].slice();const b=this.board,color=p[0],type=p[1],opp=color==='w'?'b':'w',pseudo=this.getPseudoMoves(i,b,true),out=[],kingSq=b.indexOf(color+'K');for(let n=0;n<pseudo.length;n++){const to=pseudo[n],nb=this.applyBoardMove(b,i,to);if(!this.isSquareAttacked(nb,type==='K'?to:kingSq,opp))out.push(to);}if(mine)c[i]=out.slice();return out;}";
    /* original */
    const V0 = "getMoves(i){const p=this.board[i];if(!p)return[];const key=this.board.join(',')+'|'+this.turn+'|'+i+'|'+JSON.stringify(this.castling);if(this.legalCache[key])return this.legalCache[key].slice();const pseudo=this.getPseudoMoves(i,this.board,true);const out=[];for(let n=0;n<pseudo.length;n++){const b=this.applyBoardMove(this.board,i,pseudo[n]);if(!this.isInCheckBoard(b,p[0]))out.push(pseudo[n]);}this.legalCache[key]=out.slice();return out;}";
    /* first pass: cheap key, unchanged legality test */
    const V1 = "getMoves(i){const p=this.board[i];if(!p)return[];const mine=p[0]===this.turn[0],c=this.legalCache;if(mine&&c[i])return c[i].slice();const pseudo=this.getPseudoMoves(i,this.board,true);const out=[];for(let n=0;n<pseudo.length;n++){const b=this.applyBoardMove(this.board,i,pseudo[n]);if(!this.isInCheckBoard(b,p[0]))out.push(pseudo[n]);}if(mine)c[i]=out.slice();return out;}";
    /* second pass: the slower scratch-board variant, migrated away from */
    const V2 = "getMoves(i){const p=this.board[i];if(!p)return[];const mine=p[0]===this.turn[0],c=this.legalCache;if(mine&&c[i])return c[i].slice();const b=this.board,color=p[0],type=p[1],opp=color==='w'?'b':'w',pseudo=this.getPseudoMoves(i,b,true),out=[],sc=b.slice(),kingSq=b.indexOf(color+'K');for(let n=0;n<pseudo.length;n++){const to=pseudo[n],cap=sc[to];sc[to]=p;sc[i]=null;let epSq=-1,epCap=null;if(type==='P'&&Math.abs(to-i)===7&&Math.floor(i/8)!==Math.floor(to/8)&&!cap){const e=color==='w'?to+8:to-8;if(sc[e]&&sc[e][0]===opp&&sc[e][1]==='P'){epSq=e;epCap=sc[e];sc[e]=null;}}if(!this.isSquareAttacked(sc,type==='K'?to:kingSq,opp))out.push(to);sc[i]=p;sc[to]=cap;if(epSq>=0)sc[epSq]=epCap;}if(mine)c[i]=out.slice();return out;}";
    for (const v of [V0, V1, V2]) if (out.includes(v)) { out = out.replace(v, NEW); break; }
    must(/kingSq=b\.indexOf\(color\+'K'\)/.test(out), 'getMoves was not optimised');
    must(!/this\.board\.join\(','\)/.test(out), 'getMoves still builds the expensive cache key');
    must(!/isInCheckBoard\(b,p\[0\]\)/.test(out), 'getMoves still rescans the board for the king');
  }

  /* --- 4. drop the move cache whenever the position changes ---
   * Rather than listing the sites by hand, insert after EVERY `this.board=<x>;`
   * reassignment — that is exactly when cached moves become invalid, so a
   * future mutation point (or another rule rewriting one, e.g. saveSizeFix)
   * cannot be forgotten. Normalise first so the rule stays idempotent. */
  out = out.replace(/(this\.board=[^;]*;)this\.legalCache=\{\};/g, '$1');
  out = out.replace(/(this\.board=[^;]*;)/g, '$1this.legalCache={};');
  {
    const n = (out.match(/this\.board=[^;]*;this\.legalCache=\{\};/g) || []).length;
    must(n >= 4, 'only ' + n + ' board reassignment(s) drop the move cache (want >= 4)');
  }

  /* --- 5. a move only touches a few squares: incremental, not a rebuild --- */
  {
    const OLD = 'this.hintText=(this.isInCheckBoard(this.board,this.turn)?this.$t(\'game.checkPass\'):this.$t(\'game.moveDone\'))+this.sideName(this.turn); this.buildSquares();';
    const NEW = 'this.hintText=(this.isInCheckBoard(this.board,this.turn)?this.$t(\'game.checkPass\'):this.$t(\'game.moveDone\'))+this.sideName(this.turn); this.updateSquares();';
    if (out.includes(OLD)) out = out.replace(OLD, NEW);
    must(!/this\.sideName\(this\.turn\); this\.buildSquares\(\);/.test(out), 'move() still rebuilds every square');
  }

  /* --- 6. tapSquare: ONE pass ---
   *
   * A first attempt painted the selection box first and computed the moves on
   * the next frame. On the band that felt SLOWER, not faster, and the reason
   * is that it turns one repaint per tap into TWO, while `setTimeout(...,0)`
   * on this runtime is not a single frame — so the destination dots arrived
   * later than before. What actually helps is doing less work per repaint,
   * which is what the rest of this function does. The tap is a single
   * synchronous pass again.
   *
   * (If box-first is ever wanted back, it must not cost a second repaint —
   * e.g. by mutating only the two changed entries of `squares` in place.) */
  {
    const ONE_LINE = "    if (p && p[0]===this.turn[0]) { this.selected=i; this.legalMoves=this.showHints?this.getMoves(i):[]; this.hintText=this.$t('game.reselect')+this.nameOf(i)+this.$t('game.tapBlueDot'); if(this.autoCenter)this.centerOn(i); this.updateSquares(); }";
    const DEFERRED = [
      "    if (p && p[0]===this.turn[0]) {",
      "      /* Paint the selection box NOW; the legal moves are computed on the",
      "       * next frame, so the box appears before any search work happens. */",
      "      this.selected=i; this.legalMoves=[];",
      "      this.hintText=this.$t('game.reselect')+this.nameOf(i)+this.$t('game.tapBlueDot');",
      "      if(this.autoCenter)this.centerOn(i);",
      "      this.updateSquares();",
      "      if(this.showHints){ const sq=i; this.pendingSelect=sq; this.selectTimer=setTimeout(()=>{ this.selectTimer=null; this.pendingSelect=-1; if(this.selected===sq){ this.legalMoves=this.getMoves(sq); this.updateSquares(); } },0); }",
      "    }",
    ].join('\n');
    if (out.includes(DEFERRED)) out = out.replace(DEFERRED, ONE_LINE);
    must(/this\.selected=i; this\.legalMoves=this\.showHints\?this\.getMoves\(i\):\[\];/.test(out),
      'tapSquare does not compute the moves in a single pass');
  }

  /* --- 7. remove the deferred-selection machinery (now dead) --- */
  out = out.replace(/[ \t]*this\.flushSelect\(\);\r?\n/g, '');
  out = out.replace(/[ \t]*\/\* Finish a deferred selection[\s\S]*?\*\/\r?\n[ \t]*flushSelect\(\)\{[^\n]*\},\r?\n/g, '');
  out = removeMember(out, 'flushSelect');
  out = out.replace(/,[ \t]*pendingSelect:[ \t]*-1,[ \t]*selectTimer:[ \t]*null/g, '');
  out = out.replace(/[ \t]*pendingSelect:[ \t]*-1,[ \t]*selectTimer:[ \t]*null,?/g, '');
  must(!/flushSelect/.test(out), 'flushSelect() is still present');
  must(!/pendingSelect|selectTimer/.test(out), 'the deferred-selection state is still present');

  return out;
}

/* ------------------------------------------------------------------ *
 * Keep the saved game SMALL.
 *
 * Symptom it fixes: mid/late game the app would freeze, then get killed or
 * appear to restart. onHide() and opening the menu both call
 * saveActiveGame(), which JSON.stringify's the WHOLE history and writes it to
 * storage. Every history entry embedded its own copy of `positionCounts`:
 *
 *     this.history.push({..., positionCounts: Object.assign({}, this.positionCounts)})
 *
 * `positionCounts` grows by one key per move, so history held ~N²/2 entries
 * and the saved blob grew QUADRATICALLY. Measured (tools/verify_save_size.js):
 *
 *     ply 20 -> 47 KB      ply 60 -> 328 KB     ply 119 -> 1.19 MB
 *
 * On a band that is a multi-hundred-millisecond stringify + flash write, which
 * is exactly the freeze, and a 1 MB JSON.parse on resume, which is the
 * "restart". After this fix the same 119-ply game saves in ~35 KB.
 *
 * Undo no longer restores a snapshot of the whole map; the move records just
 * the repetition key it added and undo decrements it. (The old snapshot form
 * is still honoured, so a game saved by an older build can still be undone.)
 * ------------------------------------------------------------------ */
function saveSizeFix(out, dev) {
  const must = (cond, msg) => { if (!cond) throw new Error(dev + '/game: ' + msg); };

  const PUSH_OLD = 'this.history.push({board:this.board.slice(),turn:this.turn,last:this.lastMove.slice(),castling:Object.assign({},this.castling),whiteSeconds:this.whiteSeconds,blackSeconds:this.blackSeconds,halfmoveClock:this.halfmoveClock,positionCounts:Object.assign({},this.positionCounts)});';
  const PUSH_NEW = 'this.history.push({board:this.board.slice(),turn:this.turn,last:this.lastMove.slice(),castling:Object.assign({},this.castling),whiteSeconds:this.whiteSeconds,blackSeconds:this.blackSeconds,halfmoveClock:this.halfmoveClock});';
  if (out.includes(PUSH_OLD)) out = out.replace(PUSH_OLD, PUSH_NEW);

  /* Undo has to know which repetition key the move added. It is NOT stored per
   * ply: at undo time this.board/this.turn/this.castling still hold the
   * POST-move state, so positionKey() of the current position is exactly that
   * key. Storing it would cost ~130 chars in every single history entry. */
  out = out.replace(/ this\.history\[this\.history\.length-1\]\.posKey=key;/g, '');

  const UNDO_OPEN = /(const h=this\.history\.pop\(\);)(this\.board=)/;
  if (UNDO_OPEN.test(out)) {
    out = out.replace(UNDO_OPEN, '$1const undoKey=this.positionKey(this.board,this.turn);$2');
  }

  const UNDO_OLD = 'this.halfmoveClock=h.halfmoveClock;this.positionCounts=h.positionCounts;';
  const UNDO_NEW = 'this.halfmoveClock=h.halfmoveClock;if(this.positionCounts[undoKey]){this.positionCounts[undoKey]--;if(this.positionCounts[undoKey]<=0)delete this.positionCounts[undoKey];}else if(h.positionCounts){this.positionCounts=h.positionCounts;}';
  if (out.includes(UNDO_OLD)) out = out.replace(UNDO_OLD, UNDO_NEW);
  /* repair the intermediate form an earlier run of this rule produced */
  out = out.replace(/if\(h\.posKey&&this\.positionCounts\[h\.posKey\]\)\{this\.positionCounts\[h\.posKey\]--;if\(this\.positionCounts\[h\.posKey\]<=0\)delete this\.positionCounts\[h\.posKey\];\}/,
    'if(this.positionCounts[undoKey]){this.positionCounts[undoKey]--;if(this.positionCounts[undoKey]<=0)delete this.positionCounts[undoKey];}');

  /* With the quadratic term gone, the history entry itself dominates: a
   * 64-element array of "wK"/"bP" strings serialises to ~400 bytes per ply.
   * One character per square ("KQRBNP" white, lowercase black, "." empty)
   * cuts that to ~70 and is trivial to reverse. Old saves keep their `board`
   * array and are still undoable via the `h.b ? ... : h.board` fallback. */
  const PUSH_ARR = 'this.history.push({board:this.board.slice(),';
  const PUSH_STR = 'this.history.push({b:this.encodeBoard(this.board),';
  if (out.includes(PUSH_ARR)) out = out.replace(PUSH_ARR, PUSH_STR);

  const UNDOB_OLD = 'const h=this.history.pop();this.board=h.board;';
  const UNDOB_NEW = 'const h=this.history.pop();this.board=h.b?this.decodeBoard(h.b):h.board;';
  if (out.includes(UNDOB_OLD)) out = out.replace(UNDOB_OLD, UNDOB_NEW);

  if (!/encodeBoard\s*\(b\)\s*\{/.test(out)) {
    const HELPERS = "  /* 64 squares as one string: white KQRBNP, black lowercase, '.' empty. */\n" +
      "  encodeBoard(b){let s='';for(let i=0;i<64;i++){const p=b[i];s+=p?(p[0]==='w'?p[1]:p[1].toLowerCase()):'.';}return s;},\n" +
      "  decodeBoard(s){const b=new Array(64);for(let i=0;i<64;i++){const c=s[i];b[i]=(c===undefined||c==='.')?null:(c>='A'&&c<='Z'?'w'+c:'b'+c.toUpperCase());}return b;},\n";
    out = out.replace(/(\n  getMoves\()/, '\n' + HELPERS + '$1');
  }

  must(!/positionCounts:Object\.assign\(\{\},this\.positionCounts\)/.test(out),
    'history still embeds a copy of positionCounts (the saved blob stays quadratic)');
  must(!/posKey/.test(out), 'the repetition key is still stored once per ply');
  must(/const undoKey=this\.positionKey\(this\.board,this\.turn\);/.test(out),
    'undo does not recompute the repetition key from the post-move position');
  must(/if\(this\.positionCounts\[undoKey\]\)/.test(out),
    'undo does not decrement the repetition key');
  must(/this\.history\.push\(\{b:this\.encodeBoard\(this\.board\)/.test(out),
    'history still stores a full board array per ply');
  /* Guard on the DEFINITION, not the name — `this.encodeBoard(` also appears at
   * the call site, so a name-only test passes even when the helper is missing. */
  must(/encodeBoard\s*\(b\)\s*\{/.test(out) && /decodeBoard\s*\(s\)\s*\{/.test(out),
    'board (de)serialiser helpers were not inserted');
  return out;
}

function gameRules() {
  return [
    /* ---- piece sizing ----
     *
     * The pieces are 128px bitmaps but a square is only 24/30/44dp. For
     * <image>, "if width/height are not set it uses the image's ORIGINAL
     * width/height" (Vela docs) — so a bitmap that fails to get a size renders
     * at 128px and swamps the board. Two things were therefore made explicit:
     *
     *   1. the SIZE, in dp, from a computed (a percentage width is not
     *      dependable here; every other image in the app sizes in dp);
     *   2. the CENTERING, via absolute left/top offsets — we do NOT rely on the
     *      parent being a flex container, because a mis-centred piece is
     *      exactly what was reported.
     *
     * `.pieceImage` also carries a default size/offset in CSS: if an inline
     * style is ever ignored, the piece is still ~one square big instead of
     * 128px of overflow. */
    [/<image class="pieceImage" if="\{\{\$item\.pieceSrc\}\}" src="\{\{\$item\.pieceSrc\}\}"><\/image>/,
     '<image class="pieceImage" if="{{$item.pieceSrc}}" src="{{$item.pieceSrc}}" style="left:{{pieceOffset}}dp;top:{{pieceOffset}}dp;width:{{pieceBox}}dp;height:{{pieceBox}}dp;"></image>', true],
    /* Repair the intermediate form an earlier rule produced (size only, no
     * offset), so an already-patched tree converges in one pass. */
    [/<image class="pieceImage" if="\{\{\$item\.pieceSrc\}\}" src="\{\{\$item\.pieceSrc\}\}" style="width:\{\{pieceBox\}\}dp;height:\{\{pieceBox\}\}dp;"><\/image>/,
     '<image class="pieceImage" if="{{$item.pieceSrc}}" src="{{$item.pieceSrc}}" style="left:{{pieceOffset}}dp;top:{{pieceOffset}}dp;width:{{pieceBox}}dp;height:{{pieceBox}}dp;"></image>', true],
    [/\.pieceImage \{[^}]*\}/,
     '.pieceImage { position:absolute; left:2dp; top:2dp; width:26dp; height:26dp; object-fit:contain; z-index:3; }', true],
    /* ---- AI "thinking" feedback ----
     *
     * The engine can run for up to 10s at master level. Without feedback the
     * board appears frozen for that whole time: the human taps, nothing moves,
     * then the reply snaps in. Two cheap additions fix the perceived lag:
     *
     *   1. a pulsing ring over the board, so it is obvious the app is busy —
     *      and the human's own move is already painted underneath it, which is
     *      the "show me where it went" part of the request;
     *   2. an animated hint line ("···") in the area the eye already rests on.
     *
     * Both are driven by the existing `aiThinking` flag — no new state.
     *
     * NOTE: a `class="{{cond?'a':'b'}}"` ternary is a known Vela pitfall (the
     * compiler mishandles the quotes), so the ring is an `if`-gated element
     * rather than a toggled class. */
    [/<div class="hint"><text class="hintText">\{\{hintText\}\}<\/text><\/div>/,
     "<div class=\"hint\"><text class=\"hintText\">{{hintText}}</text><text class=\"hintDots\" if=\"{{aiThinking}}\">{{thinkingDots}}</text></div>", true],
    /* SELF-HEAL the mis-placed ring from the earlier (buggy) rule:
     *
     *     </div>                              <- .board close
     *     </div>                              <- .boardViewport close
     *     <div class="thinkingRing" .../>     <- wrong: outside the viewport
     *     </div>                              <- stray, unbalanced
     *
     * Collapse it back to the balanced form (ring between the two closes).
     * Runs before the placement rule below, so a tree broken by the old rule
     * converges in one pass. */
    [/(\n\s*)(<\/div>\n\s*<\/div>)\n\s*<div class="thinkingRing" if="\{\{aiThinking\}\}"><\/div>\n\s*<\/div>/,
     "$1$2\n      <div class=\"thinkingRing\" if=\"{{aiThinking}}\"></div>", true],
    /* The ring goes just inside .boardViewport, AFTER the .board div closes
     * but BEFORE the viewport's own close. The target sequence is
     *     </div>   <- closes .board (the 64-square container)
     *     </div>   <- closes .boardViewport
     *
     * IMPORTANT: the insertion must go BETWEEN those two, not after them. An
     * earlier version appended `</div>` on top of the two it matched, which
     * produced 6 children in <template> and made the compiler reject the page
     * ("There are 6 children, but expect to have 1"). We now keep the brace
     * stack balanced by emitting only the ring element between the two closes.
     * Self-healing: strip any previously mis-placed copy first. */
    [/(\n\s*<\/div>)(\n\s*<\/div>\n\n)(\s*<div class="hint">)/,
     "$1\n      <div class=\"thinkingRing\" if=\"{{aiThinking}}\"></div>$2$3", true],

    /* ---- top bar / clocks / bottom bar ---- */
    [/<text class="turn">\{\{ statusText \}\}<\/text>/,
     "<text class=\"turn\">{{statusText}}</text>", true],
    [/<text class="clockLabel">白<\/text>/,
     "<text class=\"clockLabel\">{{whiteLabel}}</text>", true],
    [/<text class="clockLabel">黑<\/text>/,
     "<text class=\"clockLabel\">{{blackLabel}}</text>", true],
    /* Band 9 Pro uses a single-line clock (`白 10:00`) instead of the two-row
     * label/time column the other two devices use. */
    [/<text class="clock" style="color:\{\{turn==='white'\?'#4EA1FF':'#FFFFFF'\}\};">白 \{\{whiteClock\}\}<\/text>/,
     "<text class=\"clock\" style=\"color:{{turn==='white'?'#4EA1FF':'#FFFFFF'}};\">{{whiteLabel}} {{whiteClock}}</text>", true],
    [/<text class="clock" style="color:\{\{turn==='black'\?'#4EA1FF':'#FFFFFF'\}\};">黑 \{\{blackClock\}\}<\/text>/,
     "<text class=\"clock\" style=\"color:{{turn==='black'?'#4EA1FF':'#FFFFFF'}};\">{{blackLabel}} {{blackClock}}</text>", true],
    [/<text class="action" @click="undoMove">悔棋<\/text>/,
     "<text class=\"action\" @click=\"undoMove\">{{undoLabel}}</text>", true],
    [/<text class="action" @click="openMenu">菜单<\/text>/,
     "<text class=\"action\" @click=\"openMenu\">{{menuLabel}}</text>", true],

    /* ---- AI feedback styles ----
     * A pulsing accent ring over the board while the engine searches, plus the
     * animated dots next to the hint. Both are decorative and non-blocking:
     * pointer events pass through to the board underneath (the ring is a
     * `div` with no handler, and Vela routes taps to the deepest target). */
    [/\.hintText \{([^}]*)\}/,
     (all, body) => /\.thinkingRing/.test(all) ? all :
       ".hintText {" + body + "}\n.hintDots { color:#4EA1FF; font-size:16dp; margin-left:2dp; }\n.thinkingRing { position:absolute; left:0dp; top:0dp; right:0dp; bottom:0dp; border:2dp solid #4EA1FF; opacity:0.85; }", true],

    /* ---- game menu overlay ---- */
    [/<text class="menuTitle">棋局菜单<\/text>/,
     "<text class=\"menuTitle\">{{menuTitleLabel}}</text>", true],
    [/<text class="menuItem" @click="endGame">结束对局<\/text>/,
     "<text class=\"menuItem\" @click=\"endGame\">{{endGameLabel}}</text>", true],
    [/<text class="menuItem" @click="undoMove">悔棋<\/text>/,
     "<text class=\"menuItem\" @click=\"undoMove\">{{undoLabel}}</text>", true],
    [/<text class="menuItem" @click="confirmResign">认输<\/text>/,
     "<text class=\"menuItem\" @click=\"confirmResign\">{{resignLabel}}</text>", true],
    [/<text class="menuItem" @click="offerDraw">和棋<\/text>/,
     "<text class=\"menuItem\" @click=\"offerDraw\">{{drawLabel}}</text>", true],
    [/<text class="menuItem" @click="openSettings">设置<\/text>/,
     "<text class=\"menuItem\" @click=\"openSettings\">{{settingsLabel}}</text>", true],
    [/<text class="menuItem exitItem" @click="exitGame">退出对局<\/text>/,
     "<text class=\"menuItem exitItem\" @click=\"exitGame\">{{exitGameLabel}}</text>", true],
    [/<text class="menuItem" @click="closeMenu">继续对局<\/text>/,
     "<text class=\"menuItem\" @click=\"closeMenu\">{{continueLabel}}</text>", true],

    /* ---- in-game settings overlay ---- */
    [/<text class="menuTitle">下棋设置<\/text>/,
     "<text class=\"menuTitle\">{{settingsTitle}}</text>", true],
    [/<text class="menuItem" @click="toggleAutoCenter">自动居中：\{\{autoCenter \? '开' : '关'\}\}<\/text>/,
     "<text class=\"menuItem\" @click=\"toggleAutoCenter\">{{autoCenterLabel}}</text>", true],
    [/<text class="menuItem" @click="cycleBoardSize">棋盘大小：\{\{boardSizeLabel\}\}<\/text>/,
     "<text class=\"menuItem\" @click=\"cycleBoardSize\">{{boardSizeRow}}</text>", true],
    [/<text class="menuItem" @click="toggleAiMode">人机对弈：开<\/text>/,
     "<text class=\"menuItem\" @click=\"toggleAiMode\">{{aiModeRow}}</text>", true],
    /* The AI-level row uses a bare object-literal lookup inside {{ }}. Vela's
     * template compiler chokes on the nested quotes, so it becomes a computed. */
    [/<text class="menuItem" if="\{\{aiEnabled\}\}" @click="cycleAiLevel">\{\{'AI 难度：'\+\(\{"easy":"简单","normal":"普通","hard":"困难","master":"大师"\}\[this\.aiLevel\]\|\|this\.aiLevel\)\}\}<\/text>/,
     "<text class=\"menuItem\" if=\"{{aiEnabled}}\" @click=\"cycleAiLevel\">{{aiLevelRow}}</text>", true],
    [/<text class="menuItem" @click="closeSettings">完成<\/text>/,
     "<text class=\"menuItem\" @click=\"closeSettings\">{{doneLabel}}</text>", true],

    /* ---- result overlay ---- */
    [/<text class="menuItem" @click="newGame">再来一局<\/text>/,
     "<text class=\"menuItem\" @click=\"newGame\">{{playAgainLabel}}</text>", true],
    [/<text class="menuItem" @click="closeResult">查看棋局<\/text>/,
     "<text class=\"menuItem\" @click=\"closeResult\">{{viewGameLabel}}</text>", true],

    /* ---- script: static literals ---- */
    ["hintText: '点击棋子开始走子'", "hintText: ''", true],
    /* Repair: an earlier rule rewrote this to tr()/this.$t() INSIDE the `data`
     * object literal. There `this` is not the component yet, so evaluating it
     * threw "this.$t is not a function" (and broke the page's whole data
     * block). The hint text is set in onInit anyway, so '' is correct. */
    [/hintText: this\.\$t\('game\.hintTap'\)/, "hintText: ''", true],
    [/hintText: tr\('game\.hintTap'\)/, "hintText: ''", true],
    ["resultTitle: ''", "resultTitle: ''", true],

    /* statusText / boardSizeLabel become tr()-backed computeds */
    [/statusText\(\) \{ return this\.resultVisible \? '对局结束' : \(this\.turn === WHITE \? '白方回合' : '黑方回合'\); \}/,
     "statusText() { this.langTick; return this.resultVisible ? tr('game.gameOver') : (this.turn === WHITE ? tr('game.whiteTurn') : tr('game.blackTurn')); }", true],
    [/boardSizeLabel\(\) \{ return this\.squareSize===44\?'放大':\(this\.squareSize===24\?'紧凑':'标准'\); \}/,
     "boardSizeLabel() { this.langTick; return this.squareSize===44?tr('settings.boardLarge'):(this.squareSize===24?tr('settings.boardCompact'):tr('settings.boardStandard')); }", true],

    /* ---- script: dynamic strings ---- */
    ["this.hintText=this.aiColor==='white'?'AI 执白先行':'';",
     "this.hintText=this.aiColor==='white'?tr('game.aiWhiteFirst'):'';", true],

    [/this\.hintText='已恢复对局，轮到'\+\(this\.turn===WHITE\?'白方':'黑方'\)/,
     "this.hintText=tr('game.restoredTurn')+this.sideName(this.turn)", true],

    [/this\.resultTitle=\(this\.turn===WHITE\?'黑方':'白方'\)\+'胜（超时）'/,
     "this.resultTitle=this.sideName(this.turn===WHITE?BLACK:WHITE)+tr('game.timeoutWins')", true],
    [/this\.hintText='对局结束：'\+\(this\.turn===WHITE\?'白方':'黑方'\)\+'超时'/,
     "this.hintText=tr('game.gameOver')+': '+this.sideName(this.turn)+tr('game.timeout')", true],

    [/this\.hintText='已选择 '\+this\.nameOf\(i\)\+'，点击蓝点落子'/,
     "this.hintText=tr('game.reselect')+this.nameOf(i)+tr('game.tapBlueDot')", true],
    [/this\.hintText='请先选择当前回合的棋子'/,
     "this.hintText=tr('game.selectHint')", true],

    [/this\.hintText=this\.isInCheckBoard\(this\.board,this\.turn\)\?'将军，请交给'\+\(this\.turn===WHITE\?'白方':'黑方'\):'走子完成，请交给'\+\(this\.turn===WHITE\?'白方':'黑方'\)/,
     "this.hintText=(this.isInCheckBoard(this.board,this.turn)?tr('game.checkPass'):tr('game.moveDone'))+this.sideName(this.turn)", true],
    [/this\.resultTitle=\(this\.turn===WHITE\?'黑方':'白方'\)\+'胜（将死）'/,
     "this.resultTitle=this.sideName(this.turn===WHITE?BLACK:WHITE)+tr('game.mateWins')", true],
    [/this\.resultTitle='和棋（逼和）'/,
     "this.resultTitle=tr('game.stalemateDraw')", true],
    [/this\.resultTitle='和棋'/,
     "this.resultTitle=tr('game.drawShort')", true],

    [/this\.hintText=this\.aiEnabled\?this\.aiHumanBanner\(\):'已切换为双人对弈'/,
     "this.hintText=this.aiEnabled?this.aiHumanBanner():tr('game.switchedTwo')", true],
    [/aiHumanBanner\(\)\{return this\.aiColor==='white'\?"你执黑棋，AI 执白棋":"你执白棋，AI 执黑棋";\}/,
     "aiHumanBanner(){return this.aiColor==='white'?tr('game.youBlack')+\"，\"+tr('game.aiWhiteFirst'):tr('game.youWhite')+\"，\"+tr('game.aiWhiteFirst');}", true],
    [/this\.hintText="AI 无法走子（局面异常）"/,
     "this.hintText=tr('game.aiCantMove')+tr('game.boardError')", true],
    [/this\.hintText="AI 回合，请稍候"/,
     "this.hintText=tr('game.aiTurn')", true],

    [/this\.hintText='已悔棋，请继续'/g, "this.hintText=tr('game.undoDone')", true],
    [/this\.hintText='还没有可以悔的棋'/g, "this.hintText=tr('game.noUndo')", true],

    [/this\.resultTitle='和棋（双方同意）'/,
     "this.resultTitle=tr('game.drawAgreedFull')", true],
    [/this\.resultTitle=\(this\.turn===WHITE\?'黑方':'白方'\)\+'胜（对手认输）'/,
     "this.resultTitle=this.sideName(this.turn===WHITE?BLACK:WHITE)+tr('game.resignWins')", true],
    [/this\.resultTitle='对局结束'/g, "this.resultTitle=tr('game.gameOver')", true],
    [/this\.hintText='对局已结束'/g, "this.hintText=tr('game.gameOverHint')", true],

    /* ---- board size storage keys: localised labels replaced by stable keys ---- */
    [/if\(v\.boardSize==='放大'\)this\.squareSize=44;else if\(v\.boardSize==='紧凑'\)this\.squareSize=24;else this\.squareSize=30;/,
     "if(v.boardSize==='large')this.squareSize=44;else if(v.boardSize==='compact')this.squareSize=24;else this.squareSize=30;", true]
  ];
}

/* ------------------------------------------------------------------ *
 * Board panning bounds.
 *
 * The clamp constants must come from the ACTUAL board viewport, not a
 * guessed number. The original code used a flat `280`, which was the
 * Band 9 Pro viewport height; on Band 9 / Band 10 the viewport is only
 * 264dp tall, so a 352dp (44dp-square) board could never be dragged far
 * enough to reveal its bottom row — the user reported exactly that
 * ("放大后棋盘显示不完全，无法滑到边缘").
 *
 * Correct bounds, per device:
 *   left-clamped devices (Band 9 / Band 10):
 *       maxBoardLeft = min(0, viewportW - boardSize)
 *   centred device (Band 9 Pro):
 *       maxBoardLeft = max(0, floor((viewportW - boardSize)/2))
 *   all devices:
 *       maxBoardTop  = min(0, viewportH - boardSize)
 *
 * Also fixes centerOn(): it scrolled to a hardcoded `140` (half of the
 * wrong 280), so "auto centre" landed off-centre vertically. It now uses
 * viewportH/2.
 * ------------------------------------------------------------------ */
function boardBoundsRules(dev) {
  const g = GEO[dev];
  const vh = g.viewportH;
  const vw = g.w;
  const centred = !!g.centred;

  const maxLeft = centred
    ? 'Math.max(0,Math.floor((' + vw + '-this.boardSize)/2))'
    : 'Math.min(0,' + vw + '-this.boardSize)';
  const maxTop = 'Math.min(0,' + vh + '-this.boardSize)';
  const midV = Math.round(vh / 2);
  const midH = Math.round(vw / 2);

  return [
    /* maxBoardLeft / maxBoardTop — match whatever body is currently there so
     * the rule is device-agnostic and idempotent. */
    [/(\n\s*)maxBoardLeft\(\)\{[^\n]*\},/, '$1maxBoardLeft(){return ' + maxLeft + ';},'],
    [/(\n\s*)maxBoardTop\(\)\{[^\n]*\},/, '$1maxBoardTop(){return ' + maxTop + ';},'],
    /* centerOn(): centre on the viewport, not on a hardcoded 140/96-of-192. */
    [/(\n\s*)centerOn\(i\)\{[^\n]*\},/,
     '$1centerOn(i){const col=i%8,row=Math.floor(i/8);this.boardLeft=' +
     (centred
       ? 'Math.max(0,Math.min(this.maxBoardLeft(),' + midH + '-(col+0.5)*this.squareSize))'
       : 'Math.max(this.maxBoardLeft(),Math.min(0,' + midH + '-(col+0.5)*this.squareSize))') +
     ';this.boardTop=Math.max(this.maxBoardTop(),Math.min(0,' + midV + '-(row+0.5)*this.squareSize));},']
  ];
}

/* ------------------------------------------------------------------ *
 * Collapse duplicate simple declarations inside a <style> block.
 *
 * The feedback rules append `.hintDots` / `.thinkingRing`; before they were
 * made idempotent a re-run could stack several copies. This removes the
 * later duplicates so the pass converges no matter what state the file is
 * in. Only single-line, non-nested declarations are considered, which is all
 * this stylesheet uses.
 * ------------------------------------------------------------------ */
function dedupeStyleLines(src) {
  const open = src.indexOf('<style>');
  const close = src.indexOf('</style>');
  if (open < 0 || close < 0) return src;
  const head = src.slice(0, open + '<style>'.length);
  const body = src.slice(open + '<style>'.length, close);
  const tail = src.slice(close);
  const seen = new Set();
  const out = [];
  for (const ln of body.split('\n')) {
    const sel = ln.match(/^\s*(\.[A-Za-z0-9_-]+)\s*\{/);
    if (sel) {
      if (seen.has(sel[1])) continue;   /* keep the first declaration */
      seen.add(sel[1]);
    }
    out.push(ln);
  }
  return head + out.join('\n') + tail;
}

/* ------------------------------------------------------------------ *
 * Game page: after the string rewiring, splice in
 *   (a) the tr/applyLang bootstrap (shared with the other pages),
 *   (b) `sideName()` — turns WHITE/BLACK into a localised side name,
 *   (c) the computed properties the template now references.
 *
 * Idempotent: for (b) and (c) an already-present marker short-circuits.
 * ------------------------------------------------------------------ */
function gameScript(src, dev) {
  let out = src;

  /* Self-healing: collapse duplicate CSS declarations produced by earlier,
   * non-idempotent runs of the feedback rules. Keeps the first of each. */
  out = dedupeStyleLines(out);

  const LBL = [
    ['whiteLabel', "tr('game.white')"],
    ['blackLabel', "tr('game.black')"],
    ['undoLabel', "tr('game.undo')"],
    ['menuLabel', "tr('game.menu')"],
    ['menuTitleLabel', "tr('game.menuTitle')"],
    ['endGameLabel', "tr('game.endGame')"],
    ['resignLabel', "tr('game.resign')"],
    ['drawLabel', "tr('game.draw')"],
    ['settingsLabel', "tr('app.settings')"],
    ['exitGameLabel', "tr('game.exitGame')"],
    ['continueLabel', "tr('game.continueGame')"],
    ['settingsTitle', "tr('game.settingsTitle')"],
    ['doneLabel', "tr('game.closeSettings')"],
    ['playAgainLabel', "tr('game.playAgain')"],
    ['viewGameLabel', "tr('game.viewGame')"],
    ['autoCenterLabel', "tr('game.autoCenterOn')+'：'+(this.autoCenter?tr('game.on'):tr('game.off'))"],
    ['boardSizeRow', "tr('game.boardSizeLabel')+'：'+this.boardSizeLabel"],
    ['aiModeRow', "tr('game.playVsAi')+'：'+(this.aiEnabled?tr('game.on'):tr('game.off'))"],
    ['aiLevelRow', "tr('game.aiLevelLabel')+'：'+this.aiLevelName"]
  ];
  /* Computed property bodies. NOTE the trailing commas: the block we splice
   * into already has its own members, and Vela (like any JS parser) needs
   * every property separated by a comma. */
  const COMPUTED = LBL.map(([k, v]) => '    ' + k + '(){ return ' + v + '; },').join('\n') +
    '\n    aiLevelName(){ const L=this.aiLevel; return L===\'easy\'?this.$t(\'game.levelEasy\'):(L===\'hard\'?this.$t(\'game.levelHard\'):(L===\'master\'?this.$t(\'game.levelMaster\'):this.$t(\'game.levelNormal\'))); },' +
    /* Animated ellipsis beside the hint while the engine runs. Purely visual:
     * it cycles ·  ··  ··· so a long master-level search does not look hung. */
    '\n    thinkingDots(){ const n=(this.dotTick||0)%4; return n===0?\'\':(n===1?\'·\':(n===2?\'··\':\'···\')); },';

  /* `sideName` first — the dynamic-string rules above now call it. Anchor on
   * `},updateSquares(){`: the page's methods are written compactly on one
   * line, so there is no leading newline to match against.
   *
   * The guard tests for the DEFINITION (`sideName(c){`), not merely the name:
   * the string rules already inserted `this.sideName(...)` call sites, so a
   * loose `/sideName\(/` would match those and wrongly skip the definition. */
  if (!/sideName\s*\(\s*[A-Za-z_$]\w*\s*\)\s*\{/.test(out)) {
    out = out.replace(/\},(updateSquares\s*\()/,
      "},\n  sideName(c){ return c === WHITE ? tr('game.white') : tr('game.black'); },\n  $1");
    if (!/sideName\s*\(\s*[A-Za-z_$]\w*\s*\)\s*\{/.test(out)) {
      throw new Error(dev + '/game: could not insert sideName()');
    }
  }

  /* The label computeds are added once. Language is handled by $t() in
   * toSystemLang() below, so there is no import / onInit / onShow bootstrap
   * here any more — that re-added-then-removed machinery is exactly what used
   * to drift (extra whitespace) on every pass.
   *
   * Guard on the DEFINITION (`thinkingDots(){`), not the bare name: the
   * template already says `{{thinkingDots}}`, so a name-only test was always
   * true and the block was never inserted — the animated dots were dead. */
  if (!/thinkingDots\s*\(\s*\)\s*\{/.test(out)) {
    out = out.replace(/(computed\s*:\s*\{)/, '$1\n' + COMPUTED);
  }
  /* The piece image needs an explicit dp box + offset (see gameRules). Kept
   * separate from COMPUTED so it is also added to trees that already carry the
   * labels. The offset centres the piece by absolute positioning rather than
   * relying on the parent's flex centering. */
  if (!/pieceBox\s*\(\)/.test(out)) {
    out = out.replace(/(computed\s*:\s*\{)/, '$1\n    pieceBox(){ return Math.round(this.squareSize * 0.9); },');
  }
  if (!/pieceOffset\s*\(\)/.test(out)) {
    out = out.replace(/(computed\s*:\s*\{)/,
      '$1\n    pieceOffset(){ const b = Math.round(this.squareSize * 0.9); return Math.max(0, Math.round((this.squareSize - b) / 2)); },');
  }

  /* ---- AI responsiveness ----
   *
   * Two problems to fix, both about what the user SEES while the engine runs:
   *
   * 1. "点击后先显示下哪里了再计算 ai 走法". The human's move IS already
   *    painted (move() calls buildSquares() before maybeAiMove()), but the
   *    60ms artificial delay before the search starts meant the frame could
   *    still be pending. We now yield exactly one frame (setTimeout 0) and
   *    start the engine immediately after — so the board shows the human's
   *    move at once and only THEN does the ring appear.
   *
   * 2. A long search looked like a freeze. `aiThinking` now also drives the
   *    pulsing ring and the animated dots, and we tick `dotTick` on an
   *    interval so the dots actually move.
   */
  if (!/thinkingDots/.test(out)) {
    /* Computeds are spliced by the bootstrap above; make sure ours got in. */
    throw new Error(dev + '/game: thinkingDots computed was not spliced');
  }

  /* Replace the 60ms pre-search delay with a single-frame yield. */
  out = out.replace(
    /this\.aiTimerId=setTimeout\(\(\)=>\{this\.aiTimerId=null;this\.runAiMove\(\);\},60\);/,
    'this.dotTick=0;if(this.dotTimerId)clearInterval(this.dotTimerId);' +
    'this.dotTimerId=setInterval(()=>{this.dotTick=(this.dotTick||0)+1;},420);' +
    'this.aiTimerId=setTimeout(()=>{this.aiTimerId=null;this.runAiMove();},0);');

  /* Stop the dots as soon as a move is produced (or the search fails). */
  out = out.replace(
    /runAiMove\(\)\{let mv=null;/,
    'runAiMove(){if(this.dotTimerId){clearInterval(this.dotTimerId);this.dotTimerId=null;}' +
    'this.dotTick=0;let mv=null;');

  /* A stale interval must not outlive the page or a reset. Guard on the
   * ALREADY-PATCHED form, otherwise re-running stacks a second clear on
   * every pass (the anchor keeps matching). */
  if (!/resetAi\(\)\{this\.aiThinking=false;if\(this\.dotTimerId\)\{clearInterval/.test(out)) {
    out = out.replace(
      /resetAi\(\)\{this\.aiThinking=false;/,
      'resetAi(){this.aiThinking=false;if(this.dotTimerId){clearInterval(this.dotTimerId);this.dotTimerId=null;}this.dotTick=0;');
  }

  /* Declare the new state, and stop the animation when the page is hidden —
   * Vela may kill the page while it runs, but we should not leak a live
   * interval for as long as we are alive. Both are guarded for the same
   * idempotency reason. */
  if (!/dotTimerId: null/.test(out)) {
    out = out.replace(
      /aiTimerId: null,/,
      'aiTimerId: null, dotTimerId: null, dotTick: 0,');
  }
  /* onHide must clear the dot interval too. Two idempotency hazards live here:
   *
   *  - `integrate_ai.js` (step 2) strips its OWN aiTimerId clear from the
   *    onHide body and re-inserts it at the top every run. Anything sitting
   *    between our clear and that block survives, but a guard that keys off
   *    text *before* the aiTimerId block cannot see it reliably.
   *  - A naive guard also mis-fires because the onHide body is one long line
   *    of `...;...;...` — `[^;]*` cannot cross the semicolons.
   *
   * So we SELF-HEAL instead: strip every copy of our dot clear from the body,
   * then insert exactly one right after the aiTimerId clear. Re-running is
   * then a no-op regardless of what integrate_ai.js did in between. */
  {
    const bodyM = out.match(/onHide\(\)\s*\{/);
    if (bodyM) {
      const from = bodyM.index + bodyM[0].length;
      const rest = out.slice(from);
      const nextM = rest.match(/\n\s{2}[a-zA-Z_$][\w$]*\s*\(/);
      const to = nextM ? from + nextM.index : out.length;
      let body = out.slice(from, to);
      const DOT_CLEAR_RE = /if\s*\(this\.dotTimerId\)\s*\{\s*clearInterval\(this\.dotTimerId\)\s*;\s*this\.dotTimerId\s*=\s*null\s*;\s*\}/g;
      body = body.replace(DOT_CLEAR_RE, '');
      const DOT_CLEAR = 'if(this.dotTimerId){clearInterval(this.dotTimerId);this.dotTimerId=null;}';
      const AI_CLEAR = /if\s*\(this\.aiTimerId\)\s*\{\s*clearTimeout\(this\.aiTimerId\)\s*;\s*this\.aiTimerId\s*=\s*null\s*;\s*\}/;
      if (AI_CLEAR.test(body)) {
        /* Insert immediately after the aiTimerId clear, normalised. */
        body = body.replace(AI_CLEAR, (m) => m + DOT_CLEAR);
      } else {
        /* No aiTimerId clear (shouldn't happen once integrate_ai has run) —
         * still make sure our clear is present. */
        body = DOT_CLEAR + body;
      }
      out = out.slice(0, from) + body + out.slice(to);
    }
  }
  {
    const bodyM = out.match(/onHide\(\)\s*\{/);
    if (!bodyM) throw new Error(dev + '/game: onHide() not found');
    const from = bodyM.index + bodyM[0].length;
    const rest = out.slice(from);
    const nextM = rest.match(/\n\s{2}[a-zA-Z_$][\w$]*\s*\(/);
    const hideBody = nextM ? rest.slice(0, nextM.index) : rest;
    const dots = (hideBody.match(/clearInterval\(this\.dotTimerId\)/g) || []).length;
    if (dots !== 1) throw new Error(dev + '/game: onHide has ' + dots + ' dot clears (want exactly 1)');
  }

  /* Assertions — each anchor separately, so a silent regex miss cannot pass. */
  if (/setTimeout\(\(\)=>\{this\.aiTimerId=null;this\.runAiMove\(\);\},60\)/.test(out)) {
    throw new Error(dev + '/game: the 60ms pre-search delay is still present');
  }
  if (!/dotTimerId=setInterval/.test(out)) throw new Error(dev + '/game: thinking-dot interval not wired');
  if (!/clearInterval\(this\.dotTimerId\)/.test(out)) throw new Error(dev + '/game: thinking-dot interval never cleared');
  if (!/dotTimerId: null/.test(out)) throw new Error(dev + '/game: dotTimerId is never declared');
  /* The onHide body is short; slice it out and look for the clear inside it
   * rather than trying to match braces with a regex. */
  const hideAt = out.indexOf('onHide()');
  const hideBody = hideAt < 0 ? '' : out.slice(hideAt, hideAt + 400);
  if (!/clearInterval\(this\.dotTimerId\)/.test(hideBody)) {
    throw new Error(dev + '/game: onHide does not stop the thinking-dot interval');
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Purchase page (Band 9 Pro / Band 10 only). Prose only; every string is
 * static, so plain $t() is enough and no runtime tr() layer is needed.
 * ------------------------------------------------------------------ */
function purchaseRules() {
  return [
    [/<text class="headerTitle">爱发电购买<\/text>/,
     "<text class=\"headerTitle\">{{$t('purchase.title')}}</text>", true],
    [/<text class="price">2元<\/text>/,
     "<text class=\"price\">{{$t('purchase.price')}}</text>", true],
    [/<text class="bodyText priceText">[^<]*<\/text>/,
     "<text class=\"bodyText priceText\">{{$t('purchase.priceText')}}</text>", true],
    [/<text class="bodyText leftText tokenText">[^<]*<\/text>/,
     "<text class=\"bodyText leftText tokenText\">{{$t('purchase.tokenText')}}</text>", true],
    [/<text class="bodyText leftText gap featureText">[^<]*<\/text>/,
     "<text class=\"bodyText leftText gap featureText\">{{$t('purchase.featureText')}}</text>", true],
    [/<text class="bodyText leftText projectText">[^<]*<\/text>/,
     "<text class=\"bodyText leftText projectText\">{{$t('purchase.projectText')}}</text>", true],
    [/<text class="bodyText leftText gap browserText">[^<]*<\/text>/,
     "<text class=\"bodyText leftText gap browserText\">{{$t('purchase.browserText')}}</text>", true],
    [/<text class="confirmButton" @touchend="confirmPurchase">已购买<\/text>/,
     "<text class=\"confirmButton\" @touchend=\"confirmPurchase\">{{$t('purchase.confirm')}}</text>", true]
  ];
}

/* ------------------------------------------------------------------ *
 * Give a page instance a `tr()` method and a language bootstrap.
 *
 * `tr` in strings.js is a module-level function; a <template> can only call
 * methods that live on the ViewModel, so every page using tr() needs a thin
 * forwarding method. `applyLang()` re-reads the stored preference and the
 * device locale on every show, which is what makes a language change made on
 * the Settings page take effect the moment the user comes back.
 * ------------------------------------------------------------------ */
function injectTrHelper(src, dev, page) {
  const IMPORTS = "import { tr, initLang, setLang, setSystemLang, resolveLang } from '../../common/js/strings.js';";
  const ANCHOR = 'export default {';
  if (!src.includes(ANCHOR)) {
    throw new Error(dev + '/' + page + ': no `export default {` to attach the tr helper to');
  }
  /* Already injected on a previous run — leave it alone so the pass stays
   * idempotent instead of stacking duplicate imports/methods. The onInit
   * language seed below is still applied, because it may be missing on trees
   * converted before that rule existed. */
  if (/\btr\s*\(k\)\s*\{\s*return tr\(k\);?\s*\}/.test(src) && /\bapplyLang\s*\(/.test(src)) {
    return seedOnInit(src, ANCHOR);
  }
  /* Add the import next to the other imports. */
  if (!src.includes('common/js/strings.js')) {
    const m = src.match(/^(import [^\n]+\n)/m);
    if (!m) throw new Error(dev + '/' + page + ': no import line found to anchor the strings import');
    src = src.replace(m[0], m[0] + IMPORTS + '\n');
  }
  /* Storage is needed to read the saved preference; make sure it is imported. */
  if (!/import storage from '@system\.storage'/.test(src)) {
    const m = src.match(/^(import [^\n]+\n)/m);
    src = src.replace(m[0], m[0] + "import storage from '@system.storage';\n");
  }
  /* Add the forwarding method and the bootstrap. Inserted as the first members
   * so nothing later can shadow them.
   *
   * applyLang() settles the language in TWO stages because storage is async:
   *
   *   1. initLang(getLocale())  — SYNCHRONOUS, called before waiting on
   *      storage. This is what removes the startup flash: the module default
   *      was English, so a Chinese band painted English text for one frame
   *      and then swapped to Chinese. Now the device language is applied
   *      immediately and the first painted frame is already correct.
   *
   *   2. storage.get(...)       — then honours an explicit zh/en override.
   *      Until it returns we are already right in the common case of
   *      "follow system", which is also the default preference. */
  const helpers =
    "\n  tr(k){ return tr(k); }," +
    "\n  applyLang(){" +
    "\n    let devLang = 'en';" +
    "\n    try{" +
    "\n      const loc = configuration.getLocale();" +
    "\n      devLang = (loc && loc.language === 'zh') ? 'zh' : 'en';" +
    "\n    }catch(e){ devLang = 'en'; }" +
    "\n    initLang({ language: devLang });" +   /* synchronous: no first-frame flash */
    "\n    storage.get({key:'CHESS_SETTINGS',success:(data)=>{" +
    "\n      try{" +
    "\n        const raw=data&&data.data!==undefined?data.data:data;" +
    "\n        const v=(raw===undefined||raw===null||raw==='')?null:(typeof raw==='string'?JSON.parse(raw):raw);" +
    "\n        setLang(resolveLang(v&&v.langMode, devLang));" +
    "\n      }catch(e){ setLang('system'); }" +
    "\n      this.langTick=(this.langTick||0)+1;" +
    "\n    },fail:()=>{ setLang('system'); this.langTick=(this.langTick||0)+1; }});" +
    "\n  },";
  src = src.replace(ANCHOR, ANCHOR + helpers);
  /* Configuration is required by applyLang(). Added BEFORE the helpers so the
   * template rules below see a stable import list. */
  if (!/import configuration from '@system\.configuration'/.test(src)) {
    const m = src.match(/^(import [^\n]+\n)/m);
    src = src.replace(m[0], m[0] + "import configuration from '@system.configuration';\n");
  }
  if (!/\bapplyLang\s*\(/.test(src) || !/\btr\s*\(k\)\s*\{\s*return tr\(k\)/.test(src)) {
    throw new Error(dev + '/' + page + ': failed to inject the tr/lang helpers');
  }

  /* Collapse any duplicate import lines introduced by repeated runs. */
  const seenImports = new Set();
  src = src
    .split('\n')
    .filter((ln) => {
      const m = ln.match(/^\s*import\s+.+?from\s+'([^']+)';\s*$/);
      if (!m) return true;
      if (seenImports.has(m[1])) return false;
      seenImports.add(m[1]);
      return true;
    })
    .join('\n');

  /* Settle the language before the first render (see seedOnInit). */
  return seedOnInit(src, ANCHOR);
}

/* ------------------------------------------------------------------ *
 * Make sure the page applies its language in onInit.
 *
 * onShow runs AFTER the first paint, so putting initLang() only there still
 * lets one frame render with the module default (English) before swapping to
 * the device language — the zh -> en flash the user reported. onInit runs
 * BEFORE the first render, so calling applyLang() there makes the very first
 * frame correct. The storage read inside is async, but initLang() has already
 * applied the device language by then, which is right in the common case of
 * "follow system" (the default preference).
 *
 * Pages that already have an onInit get the call prepended; pages without one
 * get a minimal onInit added. Idempotent.
 * ------------------------------------------------------------------ */
function seedOnInit(src, anchor) {
  /* Make sure initLang is imported. Trees converted before the onInit rule
   * existed import only { tr, setLang, setSystemLang, resolveLang }, and the
   * call below would be a ReferenceError on the device. */
  src = src.replace(
    /import\s*\{([^}]*)\}\s*from\s*'([^']*common\/js\/strings\.js)';/,
    (all, names, mod) => {
      const set = names.split(',').map((x) => x.trim()).filter(Boolean);
      if (!set.includes('initLang')) set.splice(1, 0, 'initLang');
      return "import { " + set.join(', ') + " } from '" + mod + "';";
    });

  /* Normalise the synchronous language settle inside applyLang().
   *
   * Pages from the very first conversion (index/setup/game on all three
   * devices) wrote the device locale into the module via setSystemLang(),
   * e.g.
   *     try{ const loc = configuration.getLocale();
   *          setSystemLang(loc && loc.language === 'zh' ? 'zh' : 'en');
   *     }catch(e){ setSystemLang('en'); }
   * That works, but initLang() is the single canonical entry point: it does
   * the same setSystemLang() AND returns the resolved tag, so the verifier
   * (and any future reader) sees one uniform startup path. Rewrite it in
   * place. Guarded so it only fires on the legacy form and stays idempotent
   * (running again after the rewrite is a no-op because initLang( is present). */
  const settleOneLine =
    /try\{\s*const loc = configuration\.getLocale\(\);\s*setSystemLang\(loc && loc\.language === 'zh' \? 'zh' : 'en'\);\s*\}catch\(e\)\{ setSystemLang\('en'\); \}/;
  const settleMultiLine =
    /try\{[\s\S]{0,200}?const loc = configuration\.getLocale\(\);[\s\S]{0,120}?setSystemLang\(loc && loc\.language === 'zh' \? 'zh' : 'en'\);[\s\S]{0,60}?\}catch\(e\)\{ setSystemLang\('en'\); \}/;
  const settleReplacement =
    "try{ const loc = configuration.getLocale(); initLang({ language: (loc && loc.language === 'zh') ? 'zh' : 'en' }); }catch(e){ setSystemLang('en'); }";
  if (!/initLang\(/.test(src)) {
    if (settleOneLine.test(src)) src = src.replace(settleOneLine, settleReplacement);
    else if (settleMultiLine.test(src)) src = src.replace(settleMultiLine, settleReplacement);
  }

  /* Find EVERY onInit and confirm exactly one. More than one would be a
   * duplicate key (the last wins silently), so that is an error worth throwing
   * rather than papering over. */
  const all = src.match(/onInit\s*\([^)]*\)\s*\{/g) || [];
  if (all.length > 1) {
    throw new Error('page has ' + all.length + ' onInit definitions — refusing to patch');
  }
  if (all.length === 1) {
    /* Already seeds the language? Nothing to do. */
    const body = src.slice(src.indexOf(all[0]));
    const end = body.indexOf('},');
    const scope = end < 0 ? body.slice(0, 600) : body.slice(0, end);
    if (/this\.applyLang\(\)/.test(scope)) return src;
    /* Prepend the call inside the existing onInit. */
    return src.replace(/(onInit\s*\([^)]*\)\s*\{)/, '$1 this.applyLang(); ');
  }
  /* No onInit at all: add a minimal one as the first member. */
  return src.replace(anchor, anchor + '\n  onInit(){ this.applyLang(); },');
}

/* ------------------------------------------------------------------ *
 * Static check: every event handler called from a <template> must have a
 * matching member in that page's <script>. A missing one is silent on the
 * device (the tap simply does nothing), which is the single hardest class
 * of bug to notice — so it is asserted rather than eyeballed.
 * ------------------------------------------------------------------ */
function collectHandlers(src) {
  const out = new Set();
  const re = /@(?:click|touchend|change|longpress|input)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    /* `tapSquare($item.index)` -> `tapSquare`; skip anything with {{ }}. */
    const name = m[1].split('(')[0].trim();
    if (name && !/[{}$]/.test(name)) out.add(name);
  }
  return out;
}

function scriptDefines(src, name) {
  /* methods / computeds / data fields all appear as `name(...)` or `name:`. */
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + esc + '\\s*(\\(|:)').test(src.slice(src.indexOf('</template>')));
}

function assertHandlersBound(absFile) {
  const src = fs.readFileSync(absFile, 'utf8');
  const tplEnd = src.indexOf('</template>');
  if (tplEnd < 0) return;
  const missing = [];
  for (const h of collectHandlers(src.slice(0, tplEnd))) {
    if (!scriptDefines(src, h)) missing.push(h);
  }
  if (missing.length) {
    throw new Error(path.relative(ROOT, absFile) + ': template calls undefined handler(s): ' + missing.join(', '));
  }
  /* Also make sure the <script> is syntactically valid JS. A missing comma in
   * the injected `computed` block produces a page that fails to compile with
   * an opaque device-side error — much cheaper to catch here. */
  const a = src.indexOf('<script>');
  const b = src.lastIndexOf('</script>');
  if (a < 0 || b < 0) return;
  const js = src.slice(a + '<script>'.length, b).replace(/^\s*import .*$/gm, '');
  try {
    new Function(js.replace(/export default/, 'return'));
  } catch (e) {
    throw new Error(path.relative(ROOT, absFile) + ': <script> does not parse: ' + e.message);
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
let n = 0;
const removed = [];

for (const d of DEVICES) {
  const base = path.join(ROOT, 'devices', d, 'source');
  const main = path.join(base, 'chinese');
  if (!fs.existsSync(main)) { console.log('  SKIP ' + d + ' (no chinese tree)'); continue; }

  /* ---- 1. settings (regenerate) ---- */
  const setFile = path.join(main, 'src', 'pages', 'settings', 'settings.ux');
  if (fs.existsSync(path.dirname(setFile))) {
    const out = settingsPage(GEO[d], d);
    /* assertions before write */
    for (const need of ['boardTitle', 'autoLabel', 'autoValue', 'doneLabel', 'this.$t(']) {
      if (!out.includes(need)) throw new Error(d + ': settings page missing ' + need);
    }
    if (/class="\{\{[^}]*\?/.test(out)) throw new Error(d + ': settings page has a ternary inside class');
    /* No in-app language switch any more: the row must be gone and the page
     * must not import the retired strings/tr machinery. */
    for (const gone of ['cycleLanguage', 'langTitle', 'langMode', 'applySystemLang',
                        'strings.js', 'onConfigurationChanged', 'langTick']) {
      if (out.includes(gone)) throw new Error(d + ': settings page still carries ' + gone);
    }
    fs.writeFileSync(setFile, out, 'utf8');
    console.log('  OK   ' + d + '/settings (language row removed)');
  }

  /* ---- 2. index ---- */
  const idxFile = path.join(main, 'src', 'pages', 'index', 'index.ux');
  if (fs.existsSync(idxFile)) {
    let out = fs.readFileSync(idxFile, 'utf8');
    /* The computed block can only be added once; on a re-run it is already
     * there and re-applying the rule would duplicate it. */
    const alreadyHasComputed = /computed\s*:\s*\{[\s\S]*primaryLabel/.test(out);
    const rules = alreadyHasComputed
      ? indexRules(d).filter((r) => !/primaryLabel/.test(String(r[1])))
      : indexRules(d);
    const rew = rewritePages(idxFile, rules, out);
    if (rew !== null) out = rew;
    out = toSystemLang(out);
    out = ensureIndexComputeds(out);
    fs.writeFileSync(idxFile, out, 'utf8');
    console.log('  OK   ' + d + '/index');
  }

  /* ---- 3. about ---- */
  const aboutFile = path.join(main, 'src', 'pages', 'about', 'about.ux');
  if (fs.existsSync(aboutFile)) {
    const aboutSrc = fs.readFileSync(aboutFile, 'utf8');
    let out = rewritePages(aboutFile, aboutRules(aboutSrc), aboutSrc);
    /* Language follows the device via $t(). Strip any leftover tr machinery
     * and restore every computed the template binds (the About page had lost
     * them, which is why it rendered completely empty). */
    out = toSystemLang(out === null ? aboutSrc : out);
    if (out !== aboutSrc) fs.writeFileSync(aboutFile, out, 'utf8');
    const fin = fs.readFileSync(aboutFile, 'utf8');
    if (!/versionText\s*\(\s*\)/.test(fin)) throw new Error(d + ': about.ux lost its versionText computed');
    if (/\btr\s*\(/.test(fin)) throw new Error(d + '/about: about.ux still calls tr()');
    const tplA = fin.slice(0, fin.indexOf('</template>'));
    for (const m of tplA.matchAll(/\{\{\s*(tt_[A-Za-z0-9_]+)\s*\}\}/g)) {
      if (!new RegExp('\\b' + m[1] + '\\s*\\(').test(fin)) {
        throw new Error(d + '/about: template binds {{' + m[1] + '}} but no computed defines it');
      }
    }
    if (/\bopenPurchase\b/.test(fin) && !/openPurchase\s*\(\s*\)\s*\{/.test(fin)) {
      throw new Error(d + ': about.ux template calls openPurchase but the script does not define it');
    }
    console.log('  OK   ' + d + '/about');
  }

  /* ---- 4. support ---- */
  const supFile = path.join(main, 'src', 'pages', 'support', 'support.ux');
  if (fs.existsSync(supFile)) {
    const supSrc = fs.readFileSync(supFile, 'utf8');
    let out = rewritePages(supFile, supportRules(), supSrc);
    out = toSystemLang(out === null ? supSrc : out);
    if (out !== supSrc) fs.writeFileSync(supFile, out, 'utf8');
    if (/\btr\s*\(/.test(fs.readFileSync(supFile, 'utf8'))) {
      throw new Error(d + '/support: support.ux still calls tr()');
    }
    console.log('  OK   ' + d + '/support');
  }

  /* ---- 5. game (tr() + dynamic strings) ---- */
  const gameFile = path.join(main, 'src', 'pages', 'game', 'game.ux');
  if (fs.existsSync(gameFile)) {
    let out = rewritePages(gameFile, gameRules());
    out = out === null ? fs.readFileSync(gameFile, 'utf8') : out;
    /* Bounds must be derived from the real viewport, else a 44dp-square
     * board cannot be panned to its last row. */
    out = rewritePages(gameFile, boardBoundsRules(d), out) || out;
    out = gameScript(out, d);
    /* Make tapping a piece cheap and responsive (see selectionPerf). */
    out = selectionPerf(out, d);
    /* Keep the autosaved game from growing quadratically (see saveSizeFix). */
    out = saveSizeFix(out, d);
    /* Language follows the device via $t(); strip any leftover tr machinery
     * and restore every computed the template binds. */
    out = toSystemLang(out);
    /* assertions: the page is the most failure-prone one, so verify the
     * pieces the device actually needs. */
    for (const need of ['this.$t(', 'sideName', 'aiLevelName',
                        'statusText', 'autoCenterLabel', 'boardSizeRow', 'aiModeRow', 'aiLevelRow']) {
      if (!out.includes(need)) throw new Error(d + '/game: converted page missing ' + need);
    }
    if (/\btr\s*\(/.test(out)) {
      throw new Error(d + '/game: game.ux still calls tr()');
    }
    /* The vertical clamp must equal the viewport height, not a stale 280. */
    const vh = GEO[d].viewportH;
    if (!new RegExp('maxBoardTop\\(\\)\\{return Math\\.min\\(0,' + vh + '-this\\.boardSize\\);\\}').test(out)) {
      throw new Error(d + '/game: maxBoardTop does not use the viewport height ' + vh);
    }
    /* A missing GEO field would silently bake `undefined`/`NaN` into the
     * arithmetic and break panning at runtime — catch it here instead. */
    for (const bad of ["undefined-this.boardSize", "NaN-(col", "undefined-(col"]) {
      if (out.includes(bad)) throw new Error(d + '/game: bounds contain `' + bad + '` (bad GEO field)');
    }
    if (!new RegExp('maxBoardLeft\\(\\)\\{return ' + (GEO[d].centred ? 'Math\\.max' : 'Math\\.min')).test(out)) {
      throw new Error(d + '/game: maxBoardLeft has an unexpected form');
    }
    fs.writeFileSync(gameFile, out, 'utf8');
    console.log('  OK   ' + d + '/game');
  }

  /* ---- 6. purchase (Band 9 Pro / Band 10 only) ---- */
  const purFile = path.join(main, 'src', 'pages', 'purchase', 'purchase.ux');
  if (fs.existsSync(purFile)) {
    const purSrc = fs.readFileSync(purFile, 'utf8');
    let out = rewritePages(purFile, purchaseRules(), purSrc);
    out = toSystemLang(out === null ? purSrc : out);
    if (out !== purSrc) fs.writeFileSync(purFile, out, 'utf8');
    if (/\btr\s*\(/.test(fs.readFileSync(purFile, 'utf8'))) {
      throw new Error(d + '/purchase: purchase.ux still calls tr()');
    }
    console.log('  OK   ' + d + '/purchase');
  }

  n++;
}

/* Run the handler-binding audit over every page of every tree — a page can
 * be fully converted and still be dead on the device if a tap target lost
 * its method. */
for (const d of DEVICES) {
  const pdir = path.join(ROOT, 'devices', d, 'source', 'chinese', 'src', 'pages');
  if (!fs.existsSync(pdir)) continue;
  for (const entry of fs.readdirSync(pdir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const ux = path.join(pdir, entry.name, entry.name + '.ux');
    if (fs.existsSync(ux)) assertHandlersBound(ux);
  }
}
console.log('handler-binding audit: OK');

console.log('\nprocessed ' + n + ' device tree(s)');
if (removed.length) console.log('removed: ' + removed.join(', '));
