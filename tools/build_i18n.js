#!/usr/bin/env node
/**
 * build_i18n.js — MERGE THE ENGLISH TREE INTO THE CHINESE TREE (one RPK per device)
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Historically every device carried two independent source trees
 * (source/chinese, source/english). That means 6 projects, 6 RPKs, and every
 * fix had to be written twice. Vela supports multi-language in a single RPK,
 * so this script collapses each pair into ONE tree per device and makes the UI
 * language follow the band automatically.
 *
 * ---------------------------------------------------------------------------
 * HOW VELA i18n ACTUALLY WORKS  (verified against the official docs)
 *
 *   Source: https://iot.mi.com/vela/quickapp/zh/guide/framework/other/i18n.html
 *
 *   1. Put JSON files in  src/i18n/  . File name decides the locale:
 *          zh-CN.json   -> Chinese (China)
 *          en-US.json   -> English (United States)
 *          defaults.json-> fallback for every locale
 *      Lookup priority:  <lang>-<REGION>  ->  <lang>  ->  defaults  -> first file
 *      See also the supported-language table:
 *      https://iot.mi.com/vela/quickapp/zh/guide/framework/other/language-list.html
 *      (zh-CN = Chinese Simplified, en-US / en-GB = English.)
 *
 *   2. Read a string with  this.$t('path.key')  — works in BOTH <template> and
 *      <script>. A ViewModel helper, so it only exists on the page instance
 *      (`this.$t`), not on an imported plain module.
 *
 *   3. Read/observe the device locale with
 *          import configuration from '@system.configuration'
 *          configuration.getLocale()  ->  { language, countryOrRegion }
 *      and react to a system language change with
 *          onConfigurationChanged(event)  //  event.type === 'locale'
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN PROBLEM, AND WHY THERE ARE TWO LAYERS
 *
 * `$t()` resolves against the *system* locale. That is exactly what "follow the
 * device language" needs — and it costs zero JS to switch. But it CANNOT be
 * overridden: switching the system language is the only way to change what
 * `$t()` returns.
 *
 * The user also asked for a manual language switch inside Settings. A manual
 * override therefore needs its own lookup table that the app can consult at
 * runtime, independent of the system locale.
 *
 * So this script emits TWO artefacts from ONE source of truth:
 *
 *   (a) src/i18n/<locale>.json
 *         Drives the static $t() path. Everything that is safe to bind
 *         statically — page titles, section headings, About/Support prose —
 *         reads from here and follows the device language with no JS at all.
 *
 *   (b) src/common/js/strings.js
 *         A plain data module with the same strings keyed by language, plus a
 *         tiny `tr()` helper. Used by the pages that must honour the manual
 *         override in Settings (index / setup / game / settings).
 *
 * Both are generated from the STRINGS table below so they can never drift.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCY
 *
 * Re-running rewrites identical bytes. Assertions run BEFORE any write, so a
 * failed generation leaves the tree untouched.
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];

/*
 * The single source of truth for every user-visible string.
 *
 * Structure:  STRINGS[group][key] = { zh: '...', en: '...' }
 *
 * Keep the keys semantic (what the string means) rather than literal (the
 * Chinese text), otherwise an English wording change forces a key rename.
 */
const STRINGS = {
  app: {
    name:            { zh: 'Chess',              en: 'Chess' },
    continueGame:    { zh: '继续对局',            en: 'Continue game' },
    startGame:       { zh: '开始游戏',            en: 'Start game' },
    settings:        { zh: '下棋设置',            en: 'Chess settings' },
    about:           { zh: '关于',                en: 'About' },
    exitApp:         { zh: '退出应用',            en: 'Exit app' },
    done:            { zh: '完成',                en: 'Done' }
  },

  setup: {
    step1Title:      { zh: '选择对局模式',        en: 'Choose mode' },
    step2Title:      { zh: '用时设置',            en: 'Time' },
    modeTwo:         { zh: '双人对弈',            en: '2 Players' },
    modeTwoDesc:     { zh: '两人轮流走子',        en: 'Two people share this band' },
    modeAi:          { zh: '人机对战',            en: 'vs AI' },
    modeAiDesc:      { zh: '与内置 AI 对弈',      en: 'Play the built-in engine' },
    sideLabel:       { zh: '我执',                en: 'I play' },
    sideWhite:       { zh: '白方',                en: 'White' },
    sideBlack:       { zh: '黑方',                en: 'Black' },
    minutesLabel:    { zh: '每方时长',            en: 'Time' },
    minutesUnit:     { zh: '分钟',                en: 'min' },
    minutesInf:      { zh: '无限制',              en: 'No limit' },
    incrementLabel:  { zh: '每步加秒',            en: 'Incr.' },
    incrementUnit:   { zh: '秒',                  en: 'sec' },
    levelLabel:      { zh: 'AI 难度',             en: 'Level' },
    levelEasy:       { zh: '简单',                en: 'Easy' },
    levelNormal:     { zh: '普通',                en: 'Normal' },
    levelHard:       { zh: '困难',                en: 'Hard' },
    levelMaster:     { zh: '大师',                en: 'Master' },
    levelEasyShort:  { zh: '简单',                en: 'Easy' },
    levelNormalShort:{ zh: '普通',                en: 'Norm' },
    levelHardShort:  { zh: '困难',                en: 'Hard' },
    levelMasterShort:{ zh: '大师',                en: 'Pro' },
    next:            { zh: '下一步',              en: 'Next' },
    start:           { zh: '开始下棋',            en: 'Start' }
  },

  settings: {
    title:           { zh: '下棋设置',            en: 'Chess settings' },
    autoCenter:      { zh: '选中后自动居中',      en: 'Auto-center on select' },
    boardSize:       { zh: '棋盘大小',            en: 'Board size' },
    boardStandard:   { zh: '标准',                en: 'Standard' },
    boardLarge:      { zh: '放大',                en: 'Large' },
    boardCompact:    { zh: '紧凑',                en: 'Compact' },
    language:        { zh: '语言',                en: 'Language' },
    langSystem:      { zh: '跟随系统',            en: 'System' },
    langChinese:     { zh: '中文',                en: '中文' },
    langEnglish:     { zh: 'English',             en: 'English' },
    on:              { zh: '开启',                en: 'On' },
    off:             { zh: '关闭',                en: 'Off' }
  },

  game: {
    white:           { zh: '白',                  en: 'White' },
    black:           { zh: '黑',                  en: 'Black' },
    undo:            { zh: '悔棋',                en: 'Undo' },
    menu:            { zh: '菜单',                en: 'Menu' },
    menuTitle:       { zh: '棋局菜单',            en: 'Game menu' },
    endGame:         { zh: '结束对局',            en: 'End game' },
    resign:          { zh: '认输',                en: 'Resign' },
    draw:            { zh: '和棋',                en: 'Draw' },
    exitGame:        { zh: '退出对局',            en: 'Exit game' },
    continueGame:    { zh: '继续对局',            en: 'Continue game' },
    playAgain:       { zh: '再来一局',            en: 'Play again' },
    viewGame:        { zh: '查看棋局',            en: 'View game' },
    autoCenterOn:    { zh: '自动居中',            en: 'Auto-center' },
    boardSizeLabel:  { zh: '棋盘大小',            en: 'Board size' },
    playVsAi:        { zh: '人机对弈',            en: 'Play vs AI' },
    aiLevelLabel:    { zh: 'AI 难度',             en: 'AI level' },
    hintTap:         { zh: '点击棋子开始走子',    en: 'Tap a piece to move' },
    gameOver:        { zh: '对局结束',            en: 'Game over' },
    whiteTurn:       { zh: '白方回合',            en: "White's turn" },
    blackTurn:       { zh: '黑方回合',            en: "Black's turn" },
    noUndo:          { zh: '还没有可以悔的棋',    en: 'Nothing to undo' },
    undoDone:        { zh: '已悔棋',              en: 'Move undone' },
    thinking:        { zh: '请稍候',              en: 'Thinking' },
    aiCantMove:      { zh: '无法走子',            en: 'AI cannot move' },
    boardError:      { zh: '局面异常',            en: 'Position error' },
    resignAsk:       { zh: '对手认输',            en: 'Opponent resigned' },
    youWhite:        { zh: '你执白棋',            en: 'You play White' },
    youBlack:        { zh: '你执黑棋',            en: 'You play Black' },
    whiteFirst:      { zh: '执白先行',            en: 'White moves first' },
    drawAgreed:      { zh: '双方同意',            en: 'By agreement' },
    stalemate:       { zh: '逼和',                en: 'stalemate' },
    checkmate:       { zh: '将死',                en: 'checkmate' },
    timeout:         { zh: '超时',                en: 'timeout' },
    wins:            { zh: '胜',                  en: 'wins' },
    /* --- added for the game-page conversion --- */
    settingsTitle:   { zh: '下棋设置',            en: 'Game settings' },
    closeSettings:   { zh: '完成',                en: 'Done' },
    on:              { zh: '开',                  en: 'On' },
    off:             { zh: '关',                  en: 'Off' },
    aiTurn:          { zh: 'AI 回合，请稍候',     en: 'AI to move…' },
    aiWhiteFirst:    { zh: 'AI 执白先行',         en: 'AI plays White first' },
    switchedTwo:     { zh: '已切换为双人对弈',    en: 'Switched to 2-player' },
    selectHint:      { zh: '请先选择当前回合的棋子', en: 'Select a piece of the side to move' },
    moveDone:        { zh: '走子完成，请交给',    en: 'Move played, pass to ' },
    checkPass:       { zh: '将军，请交给',        en: 'Check! Pass to ' },
    reselect:        { zh: '已选择 ',             en: 'Selected ' },
    tapBlueDot:      { zh: '，点击蓝点落子',      en: ', tap a blue dot' },
    restoredTurn:    { zh: '已恢复对局，轮到',    en: 'Game restored, ' },
    selectedTurn:    { zh: '的回合',              en: "'s turn" },
    gameOverHint:    { zh: '对局已结束',          en: 'Game over' },
    drawShort:       { zh: '和棋',                en: 'Draw' },
    resignWins:      { zh: '胜（对手认输）',      en: ' wins (resignation)' },
    timeoutWins:     { zh: '胜（超时）',          en: ' wins (timeout)' },
    mateWins:        { zh: '胜（将死）',          en: ' wins (checkmate)' },
    stalemateDraw:   { zh: '和棋（逼和）',        en: 'Draw (stalemate)' },
    drawAgreedFull:  { zh: '和棋（双方同意）',    en: 'Draw (agreed)' },
    levelEasy:       { zh: '简单',                en: 'Easy' },
    levelNormal:     { zh: '普通',                en: 'Normal' },
    levelHard:       { zh: '困难',                en: 'Hard' },
    levelMaster:     { zh: '大师',                en: 'Master' },
    levelShortEasy:  { zh: '简单',                en: 'Easy' },
    levelShortNormal:{ zh: '普通',                en: 'Norm' },
    levelShortHard:  { zh: '困难',                en: 'Hard' },
    levelShortMaster:{ zh: '大师',                en: 'Pro' }
  },

  about: {
    title:           { zh: '关于',                en: 'About' },
    /* `version` is special: tools/bump_version.js rewrites it from the
     * manifest so the About page can never drift from versionName again. The
     * value here is only a seed for a fresh checkout. */
    version:         { zh: '1.1',                 en: '1.1' },
    developer:       { zh: '开发者',              en: 'Developer' },
    aboutApp:        { zh: '应用说明',            en: 'About this app' },
    aboutAppBody:    {
      zh: 'Chess 是一款运行在 Xiaomi Band Vela 上的离线西洋棋快应用，不需要网络或手机伴侣。内置 AI 引擎，可在没有第二位玩家时与电脑对弈。',
      en: 'Chess is an offline chess quick app for Xiaomi Band Vela. No network or phone companion is required. A built-in AI engine lets you play against the computer when no second player is available.'
    },
    supportedRules:  { zh: '已支持的规则',        en: 'Supported rules' },
    supportedRulesBody: {
      zh: '棋子基本走法与吃子、将军、将死、逼和、王车易位、吃过路兵、兵升变、三次重复和棋、五十回合和棋。',
      en: 'Basic piece movement and captures, check, checkmate, stalemate, castling, en passant, pawn promotion, threefold repetition, and the fifty-move draw rule.'
    },
    notSupported:    { zh: '尚未完整支持',        en: 'Not fully supported' },
    notSupportedBody: {
      zh: '兵升变目前自动升为后，暂不支持选择升变为车、象或马；暂不支持棋局历史保存与 PGN 导入导出。',
      en: 'Pawn promotion currently defaults to a queen; choosing a rook, bishop, or knight is not supported. Saving game history and PGN import/export are not supported yet.'
    },
    pieces:          { zh: '棋子素材',            en: 'Piece artwork' },
    piecesBody: {
      zh: '棋子外观来自 lichess 默认棋子集 cburnett，作者 Colin M.L. Burnett，以 CC-BY-SA-3.0 许可使用。',
      en: 'Pieces use the cburnett set, the default on lichess.org. Art by Colin M.L. Burnett, used under CC-BY-SA-3.0.'
    },
    afdian:          { zh: '爱发电主页',          en: 'Afdian page' },
    afdianBody:      { zh: '这是我的爱发电主页，希望能够捐赠支持一下。', en: 'This is my Afdian page. Donations are welcome.' },
    afdianButton:    { zh: '点击查看大图二维码',  en: 'Tap to view the QR code' },
    thanks:          { zh: '感谢你的支持',        en: 'Thank you for your support' },
    goPay:           { zh: '前往付款',            en: 'Go to payment' }
  },

  support: {
    title:           { zh: '爱发电主页',          en: 'Afdian page' },
    hint:            { zh: '扫码支持开发者',      en: 'Scan to support the developer' },
    caption:         { zh: '这是我的爱发电主页',  en: 'This is my Afdian page' },
    body:            { zh: '如果你喜欢这个项目，希望能够捐赠支持一下。', en: 'If you enjoy this project, please consider making a donation.' },
    backToAbout:     { zh: '返回关于',            en: 'Back to About' }
  },

  /* The paid page only ships on Band 9 Pro and Band 10. */
  purchase: {
    title:           { zh: '爱发电购买',          en: 'Support via Afdian' },
    price:           { zh: '2元',                 en: '¥2' },
    priceText:       { zh: '诚信付费，希望有人购买... (-_-;)', en: 'An honest ask — I hope someone buys it… (-_-;)' },
    tokenText:       { zh: '消耗了我1.3亿 Token（60元左右）',
                       en: 'Cost me 130M tokens (about ¥60)' },
    featureText:     { zh: '主要是要做想做其他功能，但是做一半又放弃了。以后看一下能不能再更新出来一些其他的功能 (@_@)',
                       en: 'I wanted to build more features but abandoned them halfway. Maybe some will make it in later. (@_@)' },
    projectText:     { zh: '也可以看一下我另一个项目', en: 'Also check out my other project' },
    browserText:     { zh: '这个呢是一个带有 AI 功能、RSS 订阅源和浏览器的软件「腕上浏览器」，希望能看看，谢谢喵～',
                       en: '“Wrist Browser” — a watch app with AI, RSS feeds and a browser. Please take a look, thank you~' },
    confirm:         { zh: '已购买',              en: 'Purchased' }
  }
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Flatten STRINGS into { 'group.key': {zh, en} } so both targets agree. */
function flatten(table) {
  const out = {};
  for (const group of Object.keys(table)) {
    for (const key of Object.keys(table[group])) {
      const full = group + '.' + key;
      out[full] = table[group][key];
    }
  }
  return out;
}

/** Build a nested object suitable for an i18n JSON file, for one language. */
function nestFor(entries, lang) {
  const out = {};
  for (const full of Object.keys(entries)) {
    const parts = full.split('.');
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = entries[full][lang];
  }
  return out;
}

function writeIfChanged(file, content) {
  const abs = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (fs.existsSync(abs) && fs.readFileSync(abs, 'utf8') === content) return false;
  fs.writeFileSync(abs, content, 'utf8');
  return true;
}

/** Same, but for files that live inside a device tree (absolute path given). */
function writeAbsIfChanged(abs, content) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (fs.existsSync(abs) && fs.readFileSync(abs, 'utf8') === content) return false;
  fs.writeFileSync(abs, content, 'utf8');
  return true;
}

/* ------------------------------------------------------------------ *
 * Assertions — run before ANY write so a failure never half-applies.
 * ------------------------------------------------------------------ */
const entries = flatten(STRINGS);
const allKeys = Object.keys(entries);

(function assert() {
  const problems = [];
  for (const k of allKeys) {
    const v = entries[k];
    if (!v || typeof v.zh !== 'string' || typeof v.en !== 'string') {
      problems.push(k + ': missing zh or en');
      continue;
    }
    if (!v.zh.trim()) problems.push(k + ': empty zh');
    if (!v.en.trim()) problems.push(k + ': empty en');
    /* A '{' would be read as an interpolation placeholder by $t(). */
    if (/[{}]/.test(v.zh) || /[{}]/.test(v.en)) {
      problems.push(k + ': contains a brace, which $t() reads as interpolation');
    }
  }
  if (problems.length) {
    throw new Error('i18n string table invalid:\n  ' + problems.join('\n  '));
  }
  if (allKeys.length < 60) {
    throw new Error('i18n table looks truncated (' + allKeys.length + ' keys)');
  }
})();

/* ------------------------------------------------------------------ *
 * (a) src/i18n/*.json  — the static $t() layer
 * ------------------------------------------------------------------ */
const zh = nestFor(entries, 'zh');
const en = nestFor(entries, 'en');

const i18nZh = JSON.stringify(zh, null, 2) + '\n';
const i18nEn = JSON.stringify(en, null, 2) + '\n';
/* `defaults.json` is what the framework falls back to for any locale we do not
 * ship explicitly (e.g. a band set to Japanese). Defaulting to English is the
 * conventional choice and keeps the layout predictable. */
const i18nDefaults = i18nEn;

/* ------------------------------------------------------------------ *
 * (b) src/common/js/strings.js — the runtime `tr()` layer
 *
 * Deliberately a plain data module (no $t, no ViewModel): pages that honour
 * the manual override call `tr(key)` from here.
 * ------------------------------------------------------------------ */
function buildStringsModule() {
  const lines = [];
  lines.push('/*');
  lines.push(' * strings.js — GENERATED by tools/build_i18n.js. DO NOT EDIT BY HAND.');
  lines.push(' *');
  lines.push(' * Runtime translation table for the WHOLE app. Every .ux page binds its');
  lines.push(' * visible text through tr() in a computed property, so all pages share');
  lines.push(' * one language at all times and all of them honour the manual override');
  lines.push(' * from Settings. (src/i18n/*.json is generated from the same table and is');
  lines.push(' * what build_i18n.js writes out; the pages do not read it directly.)');
  lines.push(' *');
  lines.push(' * Why one mechanism and not $t():');
  lines.push(' *   $t() always follows the SYSTEM locale and cannot be overridden by the');
  lines.push(' *   app. Mixing the two is what made the About page stay Chinese while');
  lines.push(' *   the home page had already switched to English. Everything goes');
  lines.push(' *   through tr() so a single language is applied everywhere.');
  lines.push(' *');
  lines.push(' * Language is settled SYNCHRONOUSLY at page init via initLang(locale),');
  lines.push(' * never left to an async storage read, so the first painted frame is');
  lines.push(' * already in the right language (no zh -> en flash on startup).');
  lines.push(' *');
  lines.push(' * Usage:');
  lines.push(" *   import { tr, initLang } from '../../common/js/strings.js';");
  lines.push(" *   initLang(configuration.getLocale());   // in onInit, before first render");
  lines.push(" *   tr('settings.autoCenter')              // -> active-language string");
  lines.push(" *   setLang('zh' | 'en' | 'system')        // apply an override");
  lines.push(' */');
  lines.push('');
  lines.push("export const LANG_ZH = 'zh';");
  lines.push("export const LANG_EN = 'en';");
  lines.push('');
  lines.push('/* Active language. Converges on the device language immediately at');
  lines.push(' * initLang(), then follows the stored preference once it is known. */');
  lines.push("let _lang = LANG_EN;");
  lines.push('');
  lines.push('/* The device language, resolved once at startup from');
  lines.push(" * configuration.getLocale(). Used as the target of the 'system' mode. */");
  lines.push("let _systemLang = LANG_EN;");
  lines.push('');
  lines.push('/* The user-facing preference: \'system\' | \'zh\' | \'en\'. Kept separate from');
  lines.push(" * _lang so that a locale change reported by the system does NOT silently");
  lines.push(' * override an explicit choice the user made in Settings. */');
  lines.push("let _mode = 'system';");
  lines.push('');
  lines.push('/*');
  lines.push(' * Settle the language synchronously from the device locale. Call this at');
  lines.push(' * the top of every page\'s onInit, BEFORE anything is rendered, so the');
  lines.push(' * first frame already uses the right language. Safe to call repeatedly.');
  lines.push(' *');
  lines.push(' * The stored preference is applied later (storage is async); until it');
  lines.push(' * arrives we are already correct for the common case of "follow system",');
  lines.push(' * which is also the default preference.');
  lines.push(' */');
  lines.push('export function initLang(locale) {');
  lines.push("  const l = locale && locale.language;");
  lines.push("  setSystemLang(l === LANG_ZH ? LANG_ZH : LANG_EN);");
  lines.push('  return _lang;');
  lines.push('}');
  lines.push('');
  lines.push('/*');
  lines.push(' * Record the device language and, if the user is following the system,');
  lines.push(' * switch to it. Called on every page show and on configuration change.');
  lines.push(' * Never clobbers an explicit zh/en override.');
  lines.push(' */');
  lines.push('export function setSystemLang(l) {');
  lines.push("  _systemLang = (l === LANG_ZH) ? LANG_ZH : LANG_EN;");
  lines.push("  if (_mode === 'system') _lang = _systemLang;");
  lines.push('}');
  lines.push('');
  lines.push('export function systemLang() { return _systemLang; }');
  lines.push('');
  lines.push('export function setLang(mode) {');
  lines.push("  if (mode === 'zh' || mode === LANG_ZH) { _mode = LANG_ZH; _lang = LANG_ZH; return; }");
  lines.push("  if (mode === 'en' || mode === LANG_EN) { _mode = LANG_EN; _lang = LANG_EN; return; }");
  lines.push("  /* anything else = follow the system */");
  lines.push("  _mode = 'system';");
  lines.push('  _lang = _systemLang;');
  lines.push('}');
  lines.push('');
  lines.push('export function getLang() { return _lang; }');
  lines.push('');
  lines.push('export function getMode() { return _mode; }');
  lines.push('');
  lines.push('/*');
  lines.push(' * Resolve the language that should actually be used, given the stored');
  lines.push(" * preference and the device locale. 'system' is the default.");
  lines.push(' */');
  lines.push('export function resolveLang(pref, deviceLang) {');
  lines.push("  const dev = (deviceLang === LANG_ZH) ? LANG_ZH : LANG_EN;");
  lines.push("  if (pref === LANG_ZH || pref === LANG_EN) return pref;");
  lines.push('  return dev;');
  lines.push('}');
  lines.push('');
  lines.push('const TABLE = {');
  lines.push('  zh: {');
  for (const k of allKeys) {
    lines.push('    ' + JSON.stringify(k) + ': ' + JSON.stringify(entries[k].zh) + ',');
  }
  lines.push('  },');
  lines.push('  en: {');
  for (const k of allKeys) {
    lines.push('    ' + JSON.stringify(k) + ': ' + JSON.stringify(entries[k].en) + ',');
  }
  lines.push('  }');
  lines.push('};');
  lines.push('');
  lines.push('/*');
  lines.push(' * tr(key) — look up a string in the active language. Falls back to the');
  lines.push(' * English entry, then to the key itself, so a missing key is visible');
  lines.push(' * rather than blank.');
  lines.push(' */');
  lines.push('export function tr(key) {');
  lines.push('  const row = TABLE[_lang] || TABLE.en;');
  lines.push('  if (row && Object.prototype.hasOwnProperty.call(row, key)) return row[key];');
  lines.push('  if (TABLE.en && Object.prototype.hasOwnProperty.call(TABLE.en, key)) return TABLE.en[key];');
  lines.push('  return key;');
  lines.push('}');
  lines.push('');
  lines.push('export default { tr, initLang, setLang, setSystemLang, systemLang, getLang, getMode, resolveLang, LANG_ZH, LANG_EN };');
  lines.push('');
  return lines.join('\n');
}

const stringsModule = buildStringsModule();

/* ------------------------------------------------------------------ *
 * Emit
 * ------------------------------------------------------------------ */
let changed = 0;

/* The canonical copy lives at the repo root (src/), like ai.js. */
if (writeIfChanged('src/i18n/zh-CN.json', i18nZh)) changed++;
if (writeIfChanged('src/i18n/en-US.json', i18nEn)) changed++;
if (writeIfChanged('src/i18n/defaults.json', i18nDefaults)) changed++;
if (writeIfChanged('src/common/js/strings.js', stringsModule)) changed++;

/* Per-device trees. Each device keeps ONE tree, named `source/main` — the
 * legacy `source/chinese` directory is reused so an existing checkout upgrades
 * in place instead of requiring a fresh clone. */
for (const d of DEVICES) {
  const base = path.join(ROOT, 'devices', d, 'source');
  if (!fs.existsSync(base)) { console.log('  SKIP ' + d + ' (no source/)'); continue; }
  /* Prefer the chinese tree; fall back to whatever exists. */
  const target = fs.existsSync(path.join(base, 'chinese'))
    ? path.join(base, 'chinese')
    : fs.readdirSync(base).map((x) => path.join(base, x)).find((p) => fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'src')));
  if (!target) { console.log('  SKIP ' + d + ' (no source tree found)'); continue; }

  if (writeAbsIfChanged(path.join(target, 'src', 'i18n', 'zh-CN.json'), i18nZh)) changed++;
  if (writeAbsIfChanged(path.join(target, 'src', 'i18n', 'en-US.json'), i18nEn)) changed++;
  if (writeAbsIfChanged(path.join(target, 'src', 'i18n', 'defaults.json'), i18nDefaults)) changed++;
  if (writeAbsIfChanged(path.join(target, 'src', 'common', 'js', 'strings.js'), stringsModule)) changed++;
  console.log('  OK   ' + path.relative(ROOT, target));
}

console.log('\ni18n emitted: ' + allKeys.length + ' keys, ' + changed + ' file(s) written');
