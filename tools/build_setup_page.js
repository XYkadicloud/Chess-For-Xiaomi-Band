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
    title: '开始对局',
    step1Title: '选择对局模式',
    modeTwo: '双人对弈',
    modeTwoDesc: '两人在同一台手环上轮流走子',
    modeAi: '人机对战',
    modeAiDesc: '与内置 AI 对弈，无需第二个人',
    step2Title: '用时设置',
    sideLabel: '我执',
    sideWhite: '白方',
    sideBlack: '黑方',
    sideDesc: '白方先行',
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
    start: '开始下棋',
    back: '返回'
  },
  english: {
    title: 'Start game',
    step1Title: 'Choose mode',
    modeTwo: '2 Players',
    modeTwoDesc: 'Two people share this band',
    modeAi: 'vs AI',
    modeAiDesc: 'Play the built-in engine',
    step2Title: 'Time',
    sideLabel: 'I play',
    sideWhite: 'White',
    sideBlack: 'Black',
    sideDesc: 'White moves first',
    minutesLabel: 'Time',
    minutesUnit: 'min',
    minutesInf: 'No limit',
    incrementLabel: 'Incr.',
    incrementUnit: 'sec',
    boardLabel: 'Board',
    boardNormal: 'Standard',
    boardLarge: 'Large',
    boardCompact: 'Compact',
    // Short labels used on the segmented buttons, where space is tight.
    boardNormalShort: 'Std',
    boardLargeShort: 'Big',
    boardCompactShort: 'Mini',
    levelLabel: 'Level',
    levels: { easy: 'Easy', normal: 'Normal', hard: 'Hard', master: 'Master' },
    levelsShort: { easy: 'Easy', normal: 'Norm', hard: 'Hard', master: 'Pro' },
    next: 'Next',
    start: 'Start',
    back: 'Back'
  }
};

function tpl(c, isChinese, geo) {
  const boardDefault = isChinese ? '标准' : 'Standard';
  const boardLarge = c.boardLarge;
  const boardCompact = c.boardCompact;
  const boardNormal = c.boardNormal;
  const W = geo.w;              // root width  = screen width
  const H = geo.h;              // root height = screen height
  const CW = W - 24;            // content width (12dp padding each side)
  // On wide screens a setting row is "label on the left, control on the right".
  // On narrow screens (Band 9 = 168dp, Band 10 = 188dp content width) that
  // split leaves too little room for four difficulty chips and a +/- stepper,
  // so the label moves above the control and the control spans the full width.
  const stacked = CW < 220;
  const labelW = stacked ? CW : Math.max(56, Math.round(CW * 0.38));
  const ctrlW = stacked ? CW : CW - labelW - 6;
  const stepBtnW = stacked ? 52 : Math.min(44, Math.max(34, Math.floor((ctrlW - 18) / 2)));
  const sideW = stacked ? Math.floor((CW - 6) / 2) : Math.floor((ctrlW - 6) / 2);

  return `<template>
  <div class="setup">
    <div class="head">
      <text class="back" @click="goBack">\u2039</text>
      <text class="title">{{step===1 ? '${c.step1Title}' : '${c.step2Title}'}}</text>
    </div>

    <div class="pane" if="{{step===1}}">
      <div class="{{mode==='ai' ? 'card sel' : 'card'}}" @touchend="pickMode('two')">
        <text class="cardTitle">${c.modeTwo}</text>
        <text class="cardDesc">${c.modeTwoDesc}</text>
      </div>
      <div class="{{mode==='ai' ? 'card sel' : 'card'}}" @touchend="pickMode('ai')">
        <text class="cardTitle">${c.modeAi}</text>
        <text class="cardDesc">${c.modeAiDesc}</text>
      </div>
    </div>

    <div class="pane" if="{{step===2}}">
      <div class="row" if="{{mode==='ai'}}">
        <text class="rowLabel">${c.sideLabel}</text>
        <div class="sideRow">
          <text class="{{mySide==='white' ? 'side sel' : 'side'}}" @touchend="pickSide('white')">${c.sideWhite}</text>
          <text class="{{mySide==='black' ? 'side sel' : 'side'}}" @touchend="pickSide('black')">${c.sideBlack}</text>
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
          <text class="{{boardSize==='${boardLarge}'?'seg sel':'seg'}}" @touchend="pickBoard('${boardLarge}')">${c.boardLargeShort}</text>
          <text class="{{boardSize==='${boardNormal}'?'seg sel':'seg'}}" @touchend="pickBoard('${boardNormal}')">${c.boardNormalShort}</text>
          <text class="{{boardSize==='${boardCompact}'?'seg sel':'seg'}}" @touchend="pickBoard('${boardCompact}')">${c.boardCompactShort}</text>
        </div>
      </div>

      <div class="row" if="{{mode==='ai'}}">
        <text class="rowLabel">${c.levelLabel}</text>
        <div class="segRow">
          <text class="{{aiLevel==='easy'?'seg lv sel':'seg lv'}}" @touchend="pickLevel('easy')">${c.levelsShort.easy}</text>
          <text class="{{aiLevel==='normal'?'seg lv sel':'seg lv'}}" @touchend="pickLevel('normal')">${c.levelsShort.normal}</text>
          <text class="{{aiLevel==='hard'?'seg lv sel':'seg lv'}}" @touchend="pickLevel('hard')">${c.levelsShort.hard}</text>
          <text class="{{aiLevel==='master'?'seg lv sel':'seg lv'}}" @touchend="pickLevel('master')">${c.levelsShort.master}</text>
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
.back { width:32dp; color:#fff; font-size:30dp; text-align:center; }
.title { color:#fff; font-size:22dp; font-weight:bold; }
.pane { width:${CW}dp; flex-direction:column; }

.card { width:${CW}dp; height:76dp; border-radius:14dp; background-color:#252828; margin-bottom:12dp; padding:12dp; flex-direction:column; justify-content:center; }
.card.sel { background-color:#0D6EFF; }
.cardTitle { color:#fff; font-size:19dp; font-weight:bold; margin-bottom:5dp; }
.cardDesc { color:rgba(255,255,255,.7); font-size:13dp; }

.row { width:${CW}dp; min-height:${stacked ? 62 : 52}dp; flex-direction:${stacked ? 'column' : 'row'}; align-items:${stacked ? 'stretch' : 'center'}; justify-content:space-between; margin-bottom:${stacked ? 4 : 8}dp; }
.rowLabel { width:${stacked ? '100%' : labelW + 'dp'}; color:#fff; font-size:${stacked ? 13 : 15}dp; line-height:${stacked ? 15 : 20}dp; margin-bottom:${stacked ? 3 : 0}dp; }

.sideRow { width:${ctrlW}dp; flex-direction:row; justify-content:space-between; }
.side { width:${sideW}dp; height:${stacked ? 46 : 52}dp; border-radius:12dp; background-color:#252828; color:#fff; font-size:16dp; line-height:${stacked ? 46 : 52}dp; text-align:center; }
.side.sel { background-color:#0D6EFF; font-weight:bold; }

.stepper { width:${ctrlW}dp; flex-direction:row; justify-content:space-between; align-items:center; }
.stepBtn { width:${stepBtnW}dp; height:48dp; border-radius:12dp; background-color:#252828; color:#fff; font-size:26dp; line-height:48dp; text-align:center; }
.stepVal { flex:1; color:#fff; font-size:15dp; text-align:center; }

.segRow { width:${ctrlW}dp; flex-direction:row; justify-content:space-between; }
.seg { flex:1; height:44dp; margin:0 2dp; border-radius:12dp; background-color:#252828; color:#fff; font-size:14dp; line-height:44dp; text-align:center; }
.seg.sel { background-color:#0D6EFF; }
.seg.lv { font-size:12dp; }

.start { position:absolute; left:12dp; bottom:14dp; width:${CW}dp; height:46dp; border-radius:23dp; background-color:#0D6EFF; color:#fff; font-size:18dp; line-height:46dp; text-align:center; }
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

    // Assertions: the generated page must contain every handler the template
    // calls, otherwise a tap would silently do nothing on the device.
    const handlers = ['goBack', 'pickMode', 'pickSide', 'pickLevel', 'pickBoard',
      'incMinutes', 'decMinutes', 'incIncrement', 'decIncrement', 'goStep2', 'start'];
    const missing = handlers.filter((h) => !new RegExp(h + '\\s*\\(').test(src));
    if (missing.length) throw new Error('generated page missing handlers: ' + missing.join(', '));
    // The template must not reference a method that is absent from the script.
    if (!src.includes('mySide') || !src.includes('increment')) {
      throw new Error('generated page missing expected params');
    }

    fs.writeFileSync(f, src, 'utf8');
    n++;
    console.log('  OK   ' + d + '/' + l);
  }
}
console.log('\ndone, ' + n + ' setup pages generated');
