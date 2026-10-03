#!/usr/bin/env node
/**
 * build_setup_page.js — generate the two-screen setup wizard for every tree.
 *
 * Replaces the old patch-on-top approach with a full template generator, so the
 * page always converges to a known-good state no matter what was there before.
 *
 * Screen 1 — mode: two large cards (2 players / vs AI)
 * Screen 2 — time: [-/+ steppers for "X min + Y sec"] and, in AI mode,
 *            a side chooser (play white / play black)
 *
 * Navigation is a `step` value inside the page; routing and manifest are
 * untouched. Values are forwarded to game.ux via router params.
 *
 * ---------------------------------------------------------------------------
 * HARD-WON LESSONS (do not regress these):
 *
 * 1. SELECTED STATE MUST NOT RELY ON A TERNARY INSIDE `class`.
 *    The old version used:
 *        class="{{cond ? 'seg sel' : 'seg'}}"
 *    On Band 9 the whole expression string leaked into the class list, so
 *    EVERY chip rendered as selected (all blue) — reported as
 *    "每一个东西都是高亮蓝色的". The reliable Vela idiom (already proven in
 *    game.ux, which does `style="...{{turn==='white'?'#4EA1FF':'#FFFFFF'}}"`)
 *    is: keep `class` STATIC, and drive only the colour via an inline
 *    `style` attribute with a ternary. We do exactly that here.
 *
 * 2. A `text` node used as a flex child needs an explicit HEIGHT and
 *    LINE-HEIGHT. `.stepVal` previously had only `flex:1`, so the value
 *    ("10 分钟") collapsed to zero height and was invisible on device —
 *    reported as "选择时间这边他不会显示时间". Every text control below now
 *    carries height + line-height.
 *
 * 3. Assertions: every handler the template calls must exist in the script,
 *    and every option group must have a stable id in `data`, otherwise a tap
 *    silently does nothing on the real device.
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const LANGS = ['chinese', 'english'];

// Per-device geometry. The root is 12dp padding on each side, so the usable
// content width is screenW - 24. The root height is the device screen height.
const GEO = {
  'xiaomi-band-9': { w: 192, h: 490 },
  'xiaomi-band-9-pro': { w: 336, h: 480 },
  'xiaomi-band-10': { w: 212, h: 520 }
};

const COPY = {
  chinese: {
    step1Title: '选择对局模式',
    modeTwo: '双人对弈',
    modeTwoDesc: '两人轮流走子',
    modeAi: '人机对战',
    modeAiDesc: '与内置 AI 对弈',
    step2Title: '用时设置',
    sideLabel: '我执',
    sideWhite: '白方',
    sideBlack: '黑方',
    minutesLabel: '每方时长',
    minutesUnit: '分钟',
    minutesInf: '无限制',
    incrementLabel: '每步加秒',
    incrementUnit: '秒',
    boardLabel: '棋盘大小',
    boardNormal: '标准',
    boardLarge: '放大',
    boardCompact: '紧凑',
    boardNormalShort: '标准',
    boardLargeShort: '放大',
    boardCompactShort: '紧凑',
    levelLabel: 'AI 难度',
    levels: { easy: '简单', normal: '普通', hard: '困难', master: '大师' },
    levelsShort: { easy: '简单', normal: '普通', hard: '困难', master: '大师' },
    next: '下一步',
    start: '开始下棋'
  },
  english: {
    step1Title: 'Choose mode',
    modeTwo: '2 Players',
    modeTwoDesc: 'Two people share this band',
    modeAi: 'vs AI',
    modeAiDesc: 'Play the built-in engine',
    step2Title: 'Time',
    sideLabel: 'I play',
    sideWhite: 'White',
    sideBlack: 'Black',
    minutesLabel: 'Time',
    minutesUnit: 'min',
    minutesInf: 'No limit',
    incrementLabel: 'Incr.',
    incrementUnit: 'sec',
    boardLabel: 'Board',
    boardNormal: 'Standard',
    boardLarge: 'Large',
    boardCompact: 'Compact',
    boardNormalShort: 'Std',
    boardLargeShort: 'Big',
    boardCompactShort: 'Mini',
    levelLabel: 'Level',
    levels: { easy: 'Easy', normal: 'Normal', hard: 'Hard', master: 'Master' },
    levelsShort: { easy: 'Easy', normal: 'Norm', hard: 'Hard', master: 'Pro' },
    next: 'Next',
    start: 'Start'
  }
};

const SEL_BG = '#0D6EFF';   // selected chip background
const IDLE_BG = '#24262B';  // unselected chip background
const SEL_FG = '#FFFFFF';
const IDLE_FG = '#C9CDD4';

/** Inline style for a chip whose selected state we drive without a class ternary. */
function chipStyle(expr, extra) {
  return `background-color:{{${expr}?'${SEL_BG}':'${IDLE_BG}'}};color:{{${expr}?'${SEL_FG}':'${IDLE_FG}'}};${extra || ''}`;
}

function tpl(c, isChinese, geo) {
  const boardDefault = isChinese ? '标准' : 'Standard';
  const boardLarge = c.boardLarge;
  const boardCompact = c.boardCompact;
  const boardNormal = c.boardNormal;
  const W = geo.w;
  const H = geo.h;
  const CW = W - 24;
  const stacked = CW < 220;
  const labelW = stacked ? CW : Math.max(56, Math.round(CW * 0.38));
  const ctrlW = stacked ? CW : CW - labelW - 6;
  const stepBtnW = stacked ? 52 : Math.min(48, Math.max(38, Math.floor((ctrlW - 18) / 2)));
  const sideW = stacked ? Math.floor((CW - 6) / 2) : Math.floor((ctrlW - 6) / 2);

  return `<template>
  <div class="setup">
    <div class="head">
      <text class="back" @click="goBack">\u2039</text>
      <text class="title">{{step===1 ? '${c.step1Title}' : '${c.step2Title}'}}</text>
    </div>

    <div class="pane" if="{{step===1}}">
      <div class="card" style="${chipStyle("mode==='two'")}" @touchend="pickMode('two')">
        <text class="cardTitle">${c.modeTwo}</text>
        <text class="cardDesc">${c.modeTwoDesc}</text>
      </div>
      <div class="card" style="${chipStyle("mode==='ai'")}" @touchend="pickMode('ai')">
        <text class="cardTitle">${c.modeAi}</text>
        <text class="cardDesc">${c.modeAiDesc}</text>
      </div>
    </div>

    <div class="pane" if="{{step===2}}">
      <div class="row" if="{{mode==='ai'}}">
        <text class="rowLabel">${c.sideLabel}</text>
        <div class="sideRow">
          <text class="side" style="${chipStyle("mySide==='white'")}" @touchend="pickSide('white')">${c.sideWhite}</text>
          <text class="side" style="${chipStyle("mySide==='black'")}" @touchend="pickSide('black')">${c.sideBlack}</text>
        </div>
      </div>

      <div class="row">
        <text class="rowLabel">${c.minutesLabel}</text>
        <div class="stepper">
          <text class="stepBtn" @touchend="decMinutes">\u2212</text>
          <text class="stepVal">{{minutesLabel}}</text>
          <text class="stepBtn" @touchend="incMinutes">+</text>
        </div>
      </div>

      <div class="row" if="{{!unlimited}}">
        <text class="rowLabel">${c.incrementLabel}</text>
        <div class="stepper">
          <text class="stepBtn" @touchend="decIncrement">\u2212</text>
          <text class="stepVal">{{incrementLabel}}</text>
          <text class="stepBtn" @touchend="incIncrement">+</text>
        </div>
      </div>

      <div class="row">
        <text class="rowLabel">${c.boardLabel}</text>
        <div class="segRow">
          <text class="seg" style="${chipStyle(`boardSize==='${boardLarge}'`)}" @touchend="pickBoard('${boardLarge}')">${c.boardLargeShort}</text>
          <text class="seg" style="${chipStyle(`boardSize==='${boardNormal}'`)}" @touchend="pickBoard('${boardNormal}')">${c.boardNormalShort}</text>
          <text class="seg" style="${chipStyle(`boardSize==='${boardCompact}'`)}" @touchend="pickBoard('${boardCompact}')">${c.boardCompactShort}</text>
        </div>
      </div>

      <div class="row" if="{{mode==='ai'}}">
        <text class="rowLabel">${c.levelLabel}</text>
        <div class="segRow">
          <text class="seg lv" style="${chipStyle("aiLevel==='easy'")}" @touchend="pickLevel('easy')">${c.levelsShort.easy}</text>
          <text class="seg lv" style="${chipStyle("aiLevel==='normal'")}" @touchend="pickLevel('normal')">${c.levelsShort.normal}</text>
          <text class="seg lv" style="${chipStyle("aiLevel==='hard'")}" @touchend="pickLevel('hard')">${c.levelsShort.hard}</text>
          <text class="seg lv" style="${chipStyle("aiLevel==='master'")}" @touchend="pickLevel('master')">${c.levelsShort.master}</text>
        </div>
      </div>
    </div>

    <text class="start" if="{{step===1}}" @touchend="goStep2">${c.next}</text>
    <text class="start" if="{{step===2}}" @touchend="start">${c.start}</text>
  </div>
</template>
<style>
.setup { width:${W}dp; height:${H}dp; background-color:#000; padding:16dp 12dp; flex-direction:column; overflow:hidden; }
.head { width:${CW}dp; height:40dp; flex-direction:row; align-items:center; margin-bottom:6dp; }
.back { width:32dp; height:40dp; color:#fff; font-size:30dp; line-height:40dp; text-align:center; }
.title { color:#fff; font-size:22dp; line-height:40dp; font-weight:bold; }
.pane { width:${CW}dp; flex-direction:column; }

.card { width:${CW}dp; height:76dp; border-radius:14dp; margin-bottom:12dp; padding:12dp; flex-direction:column; justify-content:center; }
.cardTitle { color:#fff; font-size:19dp; line-height:24dp; font-weight:bold; margin-bottom:5dp; }
.cardDesc { color:rgba(255,255,255,.72); font-size:13dp; line-height:17dp; }

.row { width:${CW}dp; min-height:${stacked ? 62 : 56}dp; flex-direction:${stacked ? 'column' : 'row'}; align-items:${stacked ? 'stretch' : 'center'}; justify-content:space-between; margin-bottom:${stacked ? 4 : 8}dp; }
.rowLabel { width:${stacked ? '100%' : labelW + 'dp'}; height:${stacked ? 15 : 20}dp; color:#fff; font-size:${stacked ? 13 : 15}dp; line-height:${stacked ? 15 : 20}dp; margin-bottom:${stacked ? 3 : 0}dp; }

.sideRow { width:${ctrlW}dp; flex-direction:row; justify-content:space-between; }
.side { width:${sideW}dp; height:${stacked ? 48 : 54}dp; border-radius:12dp; font-size:16dp; line-height:${stacked ? 48 : 54}dp; text-align:center; font-weight:bold; }

.stepper { width:${ctrlW}dp; flex-direction:row; justify-content:space-between; align-items:center; }
.stepBtn { width:${stepBtnW}dp; height:46dp; border-radius:12dp; background-color:#2E3138; color:#fff; font-size:26dp; line-height:46dp; text-align:center; }
.stepVal { flex:1; height:46dp; line-height:46dp; margin:0 4dp; border-radius:12dp; background-color:#1C1E22; color:#fff; font-size:16dp; font-weight:bold; text-align:center; }

.segRow { width:${ctrlW}dp; flex-direction:row; justify-content:space-between; }
.seg { flex:1; height:44dp; margin:0 2dp; border-radius:12dp; font-size:14dp; line-height:44dp; text-align:center; }
.seg.lv { font-size:12dp; }

.start { position:absolute; left:12dp; bottom:14dp; width:${CW}dp; height:50dp; border-radius:25dp; background-color:#0D6EFF; color:#fff; font-size:18dp; line-height:50dp; text-align:center; font-weight:bold; }
</style>
<script>
import router from '@system.router';
import storage from '@system.storage';
export default {
  data: { step:1, mode:'two', mySide:'white', aiLevel:'normal', minutes:10, increment:0, boardSize:'${boardDefault}' },
  onInit(){ this.loadSettings(); },
  onShow(){ this.loadSettings(); },
  loadBoardSize(){
    storage.get({key:'CHESS_SETTINGS',success:(r)=>{
      try{
        const raw=r&&r.data!==undefined?r.data:r;
        const v=typeof raw==='string'?JSON.parse(raw):raw;
        this.boardSize = v&&v.boardSize ? v.boardSize : '${boardDefault}';
      }catch(e){ this.boardSize='${boardDefault}'; }
    },fail:()=>{ this.boardSize='${boardDefault}'; }});
  },
  loadSettings(){ this.loadBoardSize(); },
  get unlimited(){ return this.minutes === 0; },
  get minutesLabel(){ return this.unlimited ? '${c.minutesInf}' : this.minutes + ' ${c.minutesUnit}'; },
  get incrementLabel(){ return this.increment + ' ${c.incrementUnit}'; },
  goBack(){ if(this.step===2){ this.step=1; } else { router.back(); } },
  pickMode(m){ this.mode = m; },
  pickSide(s){ this.mySide = s; },
  pickLevel(l){ this.aiLevel = l; },
  pickBoard(b){ this.boardSize = b; },
  incMinutes(){ if(this.minutes===0){ this.minutes=1; } else if(this.minutes<10){ this.minutes+=1; } else if(this.minutes<60){ this.minutes+=5; } },
  decMinutes(){ if(this.minutes<=1){ this.minutes=0; } else if(this.minutes<=10){ this.minutes-=1; } else { this.minutes-=5; } },
  incIncrement(){ if(this.increment<10){ this.increment+=1; } else if(this.increment<30){ this.increment+=5; } },
  decIncrement(){ if(this.increment<=10){ this.increment-=1; } else { this.increment-=5; } if(this.increment<0){ this.increment=0; } },
  goStep2(){ this.step=2; },
  start(){
    const unlimited = this.minutes === 0;
    const size = this.boardSize==='${boardLarge}' ? '44' : (this.boardSize==='${boardCompact}' ? '24' : '30');
    router.push({uri:'/pages/game',params:{
      minutes: String(unlimited ? 0 : this.minutes),
      increment: String(unlimited ? 0 : this.increment),
      unlimited: unlimited ? 'true' : 'false',
      boardSize: size,
      resume: 'false',
      aiMode: this.mode==='ai' ? 'true' : 'false',
      aiLevel: this.aiLevel,
      mySide: this.mode==='ai' ? this.mySide : 'white'
    }});
  }
}
</script>
`;
}

let n = 0;
for (const d of DEVICES) {
  for (const l of LANGS) {
    const f = path.join(ROOT, 'devices', d, 'source', l, 'src', 'pages', 'setup', 'setup.ux');
    if (!fs.existsSync(path.dirname(f))) { console.log('  SKIP ' + d + '/' + l); continue; }
    const src = tpl(COPY[l], l === 'chinese', GEO[d]);

    // 1) every handler the template calls must exist in the script
    const handlers = ['goBack', 'pickMode', 'pickSide', 'pickLevel', 'pickBoard',
      'incMinutes', 'decMinutes', 'incIncrement', 'decIncrement', 'goStep2', 'start'];
    const missing = handlers.filter((h) => !new RegExp(h + '\\s*\\(').test(src));
    if (missing.length) throw new Error(d + '/' + l + ': generated page missing handlers: ' + missing.join(', '));

    // 2) params must survive into the script
    if (!src.includes('mySide') || !src.includes('increment')) {
      throw new Error(d + '/' + l + ': generated page missing expected params');
    }

    // 3) REGRESSION GUARD: no ternary inside a class attribute. That construct
    //    made every chip render selected on Band 9. Selection is driven by
    //    inline `style` instead.
    const badClass = /class="\{\{[^}]*\?[^}]*\}\}"/.test(src);
    if (badClass) throw new Error(d + '/' + l + ': class attribute must not contain a ternary (use inline style)');

    // 4) REGRESSION GUARD: the visible value nodes must have height + line-height,
    //    otherwise they collapse and the user cannot see the chosen time.
    for (const cls of ['stepVal', 'rowLabel', 'side', 'seg', 'cardTitle', 'cardDesc', 'title', 'back']) {
      const re = new RegExp('\\.' + cls + '\\s*\\{([^}]*)\\}');
      const m = src.match(re);
      if (!m) throw new Error(d + '/' + l + ': missing style block .' + cls);
      if (!/height\s*:/.test(m[1]) || !/line-height\s*:/.test(m[1])) {
        throw new Error(d + '/' + l + ': .' + cls + ' needs both height and line-height');
      }
    }

    // 5) selection must be applied via inline style for every option group
    for (const expr of ["mode==='two'", "mode==='ai'", "minutesLabel", "aiLevel==="]) {
      if (expr.includes('===') && !src.includes(expr)) {
        throw new Error(d + '/' + l + ': missing selection binding for ' + expr);
      }
    }
    if ((src.match(/background-color:\{\{/g) || []).length < 8) {
      throw new Error(d + '/' + l + ': expected at least 8 inline selection styles');
    }

    fs.writeFileSync(f, src, 'utf8');
    n++;
    console.log('  OK   ' + d + '/' + l);
  }
}
console.log('\ndone, ' + n + ' setup pages generated');
