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
 * WHY TWO MECHANISMS
 *
 *   $t('a.b')      — resolved by the framework against the SYSTEM locale.
 *                    Zero runtime cost, auto-updates when the band language
 *                    changes. Correct for text that should simply follow the
 *                    device. Available only on the page instance (`this.$t`,
 *                    and the bare `$t` inside a <template> expression).
 *
 *   this.tr('a.b') — our own lookup in src/common/js/strings.js, driven by the
 *                    stored preference. Needed because $t() cannot be
 *                    overridden by the app.
 *
 * The pages that can be manually overridden (index / setup / game / settings)
 * read everything through `tr()`. About and Support stay static on `$t()` —
 * they are long-form prose read once, and keeping them off the runtime path
 * avoids a pointless re-render on every language flip.
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
  'xiaomi-band-9': { w: 192, h: 490 },
  'xiaomi-band-9-pro': { w: 336, h: 480 },
  'xiaomi-band-10': { w: 212, h: 520 }
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

    <div class="setting" @click="cycleLanguage">
      <text class="settingName">{{langTitle}}</text>
      <text class="settingValue">{{langLabel}}</text>
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
import configuration from '@system.configuration';
import { tr, setLang, setSystemLang } from '../../common/js/strings.js';

/* Language modes, in the order the row cycles through them. */
const LANG_MODES = ['system', 'zh', 'en'];

export default {
  data:{ autoCenter:true, boardSize:'standard', langMode:'system', langTick:0 },
  computed:{
    title(){ this.langTick; return tr('settings.title'); },
    autoLabel(){ this.langTick; return tr('settings.autoCenter'); },
    autoValue(){ this.langTick; return this.autoCenter ? tr('settings.on') : tr('settings.off'); },
    boardTitle(){ this.langTick; return tr('settings.boardSize'); },
    langTitle(){ this.langTick; return tr('settings.language'); },
    doneLabel(){ this.langTick; return tr('app.done'); },
    /* boardSize is stored as a stable key ('standard'|'large'|'compact') and
     * only localised for display, so switching language never corrupts it. */
    boardLabel(){
      this.langTick;
      const m = { standard:'settings.boardStandard', large:'settings.boardLarge', compact:'settings.boardCompact' };
      return tr(m[this.boardSize] || 'settings.boardStandard');
    },
    langLabel(){
      this.langTick;
      const m = { system:'settings.langSystem', zh:'settings.langChinese', en:'settings.langEnglish' };
      return tr(m[this.langMode] || 'settings.langSystem');
    }
  },
  onInit(){ this.load(); this.applySystemLang(); },
  onShow(){ this.load(); this.applySystemLang(); },
  /* React to the user changing the band's own language. When the preference is
   * 'system' the whole UI must follow, so we recompute and re-render. */
  onConfigurationChanged(event){
    if (event && event.type === 'locale') { this.applySystemLang(); this.langTick++; }
  },
  applySystemLang(){
    try {
      const loc = configuration.getLocale();
      setSystemLang(loc && loc.language === 'zh' ? 'zh' : 'en');
    } catch(e){ setSystemLang('en'); }
    setLang(this.langMode);
  },
  load(){
    storage.get({key:'CHESS_SETTINGS',success:(data)=>{
      try{
        const raw=data&&data.data!==undefined?data.data:data;
        if(raw===undefined||raw===null||raw==='')return;
        const v=typeof raw==='string'?JSON.parse(raw):raw;
        this.autoCenter=v.autoCenter!==false;
        this.boardSize=v.boardSize||'standard';
        this.langMode=v.langMode||'system';
        this.applySystemLang();
        this.langTick++;
      }catch(e){}
    },fail:()=>{}});
  },
  save(){storage.set({key:'CHESS_SETTINGS',value:JSON.stringify({autoCenter:this.autoCenter,boardSize:this.boardSize,langMode:this.langMode})});},
  back(){this.save();router.back();},
  toggleAuto(){this.autoCenter=!this.autoCenter;this.save();},
  cycleBoard(){
    this.boardSize = this.boardSize==='large' ? 'compact' : (this.boardSize==='compact' ? 'standard' : 'large');
    this.save();
  },
  cycleLanguage(){
    const i = LANG_MODES.indexOf(this.langMode);
    this.langMode = LANG_MODES[(i + 1) % LANG_MODES.length];
    setLang(this.langMode);
    this.langTick++;
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
function gameRules() {
  return [
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
    ["hintText: '点击棋子开始走子'", "hintText: tr('game.hintTap')", true],
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
 * Game page: after the string rewiring, splice in
 *   (a) the tr/applyLang bootstrap (shared with the other pages),
 *   (b) `sideName()` — turns WHITE/BLACK into a localised side name,
 *   (c) the computed properties the template now references.
 *
 * Idempotent: for (b) and (c) an already-present marker short-circuits.
 * ------------------------------------------------------------------ */
function gameScript(src, dev) {
  let out = src;
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
  const COMPUTED = LBL.map(([k, v]) => '    ' + k + '(){ this.langTick; return ' + v + '; },').join('\n') +
    '\n    aiLevelName(){ this.langTick; const L=this.aiLevel; return L===\'easy\'?tr(\'game.levelEasy\'):(L===\'hard\'?tr(\'game.levelHard\'):(L===\'master\'?tr(\'game.levelMaster\'):tr(\'game.levelNormal\'))); },';

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

  /* The tr/applyLang bootstrap is keyed off strings.js, NOT langTick: the
   * string rules above already introduce `this.langTick;`, so a langTick test
   * would wrongly conclude the bootstrap was done and skip it. */
  if (!/strings\.js/.test(out)) {
    out = injectTrHelper(out, dev, 'game');
    out = out.replace(/(computed\s*:\s*\{)/, '$1\n' + COMPUTED);
    out = out.replace(/(\bresultTitle: ''\s*,)/, "$1 langTick: 0,");
    out = out.replace(/(\n\s*)(onShow\s*\([^)]*\)\s*\{)/, "$1$2 this.applyLang(); ");
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
  const IMPORTS = "import { tr, setLang, setSystemLang, resolveLang } from '../../common/js/strings.js';";
  const ANCHOR = 'export default {';
  if (!src.includes(ANCHOR)) {
    throw new Error(dev + '/' + page + ': no `export default {` to attach the tr helper to');
  }
  /* Already injected on a previous run — leave it alone so the pass stays
   * idempotent instead of stacking duplicate imports/methods. */
  if (/\btr\s*\(k\)\s*\{\s*return tr\(k\);?\s*\}/.test(src) && /\bapplyLang\s*\(/.test(src)) return src;
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
   * so nothing later can shadow them. */
  const helpers =
    "\n  tr(k){ return tr(k); }," +
    "\n  applyLang(){" +
    "\n    try{" +
    "\n      const loc = configuration.getLocale();" +
    "\n      setSystemLang(loc && loc.language === 'zh' ? 'zh' : 'en');" +
    "\n    }catch(e){ setSystemLang('en'); }" +
    "\n    storage.get({key:'CHESS_SETTINGS',success:(data)=>{" +
    "\n      try{" +
    "\n        const raw=data&&data.data!==undefined?data.data:data;" +
    "\n        const v=(raw===undefined||raw===null||raw==='')?null:(typeof raw==='string'?JSON.parse(raw):raw);" +
    "\n        setLang(resolveLang(v&&v.langMode, configuration.getLocale().language==='zh'?'zh':'en'));" +
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
  return src;
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
    for (const need of ['cycleLanguage', 'langLabel', 'onConfigurationChanged', 'langTitle',
                        'boardTitle', 'autoLabel', 'autoValue', 'doneLabel', 'configuration.getLocale']) {
      if (!out.includes(need)) throw new Error(d + ': settings page missing ' + need);
    }
    if (/class="\{\{[^}]*\?/.test(out)) throw new Error(d + ': settings page has a ternary inside class');
    /* Every localised label must sit behind a computed property, otherwise the
     * page will not re-render when the language changes. */
    if (/\{\{\s*tr\(/.test(out)) {
      throw new Error(d + ': settings template calls tr() directly — it must go through a computed property to stay reactive');
    }
    fs.writeFileSync(setFile, out, 'utf8');
    console.log('  OK   ' + d + '/settings (language row added)');
  }

  /* ---- 2. index ---- */
  const idxFile = path.join(main, 'src', 'pages', 'index', 'index.ux');
  if (fs.existsSync(idxFile)) {
    /* Inject the helpers FIRST: the template rules below assume the script
     * already carries the tr()/applyLang() members and the langTick state. */
    let out = injectTrHelper(fs.readFileSync(idxFile, 'utf8'), d, 'index');
    /* The computed block can only be added once; on a re-run it is already
     * there and re-applying the rule would duplicate it. */
    const alreadyHasComputed = /computed\s*:\s*\{[\s\S]*primaryLabel/.test(out);
    const rules = alreadyHasComputed
      ? indexRules(d).filter((r) => !/primaryLabel/.test(String(r[1])))
      : indexRules(d);
    const rew = rewritePages(idxFile, rules, out);
    if (rew !== null) out = rew;
    fs.writeFileSync(idxFile, out, 'utf8');
    console.log('  OK   ' + d + '/index');
  }

  /* ---- 3. about (static $t) ---- */
  const aboutFile = path.join(main, 'src', 'pages', 'about', 'about.ux');
  if (fs.existsSync(aboutFile)) {
    const aboutSrc = fs.readFileSync(aboutFile, 'utf8');
    const out = rewritePages(aboutFile, aboutRules(aboutSrc), aboutSrc);
    if (out !== null) fs.writeFileSync(aboutFile, out, 'utf8');
    const fin = fs.readFileSync(aboutFile, 'utf8');
    if (!/versionText\s*\(\s*\)/.test(fin)) throw new Error(d + ': about.ux lost its versionText computed');
    if (/\bopenPurchase\b/.test(fin) && !/openPurchase\s*\(\s*\)\s*\{/.test(fin)) {
      throw new Error(d + ': about.ux template calls openPurchase but the script does not define it');
    }
    console.log('  OK   ' + d + '/about');
  }

  /* ---- 4. support (static $t) ---- */
  const supFile = path.join(main, 'src', 'pages', 'support', 'support.ux');
  if (fs.existsSync(supFile)) {
    const out = rewritePages(supFile, supportRules());
    if (out !== null) fs.writeFileSync(supFile, out, 'utf8');
    console.log('  OK   ' + d + '/support');
  }

  /* ---- 5. game (tr() + dynamic strings) ---- */
  const gameFile = path.join(main, 'src', 'pages', 'game', 'game.ux');
  if (fs.existsSync(gameFile)) {
    let out = rewritePages(gameFile, gameRules());
    out = gameScript(out === null ? fs.readFileSync(gameFile, 'utf8') : out, d);
    /* assertions: the page is the most failure-prone one, so verify the
     * pieces the device actually needs. */
    for (const need of ['langTick', 'applyLang', 'sideName', 'aiLevelName',
                        'statusText', 'autoCenterLabel', 'boardSizeRow', 'aiModeRow', 'aiLevelRow']) {
      if (!out.includes(need)) throw new Error(d + '/game: converted page missing ' + need);
    }
    if (/\{\{\s*tr\s*\(/.test(out)) {
      throw new Error(d + '/game: template calls tr() directly — wrap it in a computed');
    }
    fs.writeFileSync(gameFile, out, 'utf8');
    console.log('  OK   ' + d + '/game');
  }

  /* ---- 6. purchase (Band 9 Pro / Band 10 only) ---- */
  const purFile = path.join(main, 'src', 'pages', 'purchase', 'purchase.ux');
  if (fs.existsSync(purFile)) {
    const out = rewritePages(purFile, purchaseRules());
    if (out !== null) fs.writeFileSync(purFile, out, 'utf8');
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
