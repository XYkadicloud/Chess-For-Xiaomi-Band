#!/usr/bin/env node
/**
 * integrate_ai_setup.js — add an "opponent / AI level" chooser to every setup page.
 *
 * The setup page is where a game begins, so this is where the player decides
 * whether to face a human or the engine. Two rows are inserted above the
 * start button:
 *
 *   对手：人机对弈 / 双人对弈
 *   AI 难度：简单 · 普通 · 困难 · 大师   (only shown in AI mode)
 *
 * The chosen values are forwarded to the game page via router params, which
 * game.ux already reads through `protected:`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const D = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const L = ['chinese', 'english'];

const COPY = {
  chinese: {
    opponentLabel: '对手',
    human: '人机对弈',
    two: '双人对弈',
    levelLabel: 'AI 难度',
    levels: { easy: '简单', normal: '普通', hard: '困难', master: '大师' }
  },
  english: {
    opponentLabel: 'Opponent',
    human: 'vs AI',
    // Keep these short: Band 9's content column is only 168dp wide and splits
    // into two ~80dp halves.
    two: '2 Players',
    levelLabel: 'AI level',
    levels: { easy: 'Easy', normal: 'Normal', hard: 'Hard', master: 'Master' }
  }
};

function patch(file, lang) {
  const c = COPY[lang];
  let src = fs.readFileSync(file, 'utf8');
  const before = src;

  if (src.includes('aiMode')) return [];

  /* --- template rows, inserted right before the start button ------- */
  const startBtn = src.indexOf('class="start"');
  if (startBtn < 0) return [];
  const lineStart = src.lastIndexOf('<text', startBtn);
  const rows =
    '    <text class="optLabel">' + c.opponentLabel + '</text>\n' +
    '    <div class="segRow">\n' +
    '      <text class="{{aiMode ? \'seg\' : \'seg sel\'}}" @touchend="setOpponent(\'two\')">' + c.two + '</text>\n' +
    '      <text class="{{aiMode ? \'seg sel\' : \'seg\'}}" @touchend="setOpponent(\'ai\')">' + c.human + '</text>\n' +
    '    </div>\n' +
    '    <text class="optLabel" if="{{aiMode}}">' + c.levelLabel + '</text>\n' +
    '    <div class="segRow" if="{{aiMode}}">\n' +
    '      <text class="{{aiLevel===\'easy\'?\'seg lv sel\':\'seg lv\'}}" @touchend="setLevel(\'easy\')">' + c.levels.easy + '</text>\n' +
    '      <text class="{{aiLevel===\'normal\'?\'seg lv sel\':\'seg lv\'}}" @touchend="setLevel(\'normal\')">' + c.levels.normal + '</text>\n' +
    '      <text class="{{aiLevel===\'hard\'?\'seg lv sel\':\'seg lv\'}}" @touchend="setLevel(\'hard\')">' + c.levels.hard + '</text>\n' +
    '      <text class="{{aiLevel===\'master\'?\'seg lv sel\':\'seg lv\'}}" @touchend="setLevel(\'master\')">' + c.levels.master + '</text>\n' +
    '    </div>\n';
  src = src.slice(0, lineStart) + rows + src.slice(lineStart);

  /* --- styles appended before </style> ---------------------------- */
  src = src.replace('</style>',
    '.optLabel { color:rgba(255,255,255,.6); font-size:13dp; line-height:17dp; margin:4dp 0 3dp; }\n' +
    '.segRow { width:100%; flex-direction:row; justify-content:space-between; }\n' +
    // margin 0 1dp + font-size 11dp keeps four difficulty labels inside the
    // ~40dp columns Band 9 gives them (English "Master" would otherwise clip).
    '.seg { flex:1; height:30dp; margin:0 1dp; border-radius:15dp; background-color:#252828; color:#fff; font-size:13dp; line-height:30dp; text-align:center; }\n' +
    '.seg.sel { background-color:#0D6EFF; }\n' +
    '.seg.lv { font-size:11dp; }\n' +
    '</style>');

  /* --- compact the pre-existing rows so the new AI block fits ------ */
  // The original column already used nearly the full screen height; adding the
  // opponent + difficulty rows pushes it over (422dp needed vs 378dp usable on
  // Band 9 Pro). Verified by tools/check_setup_fit.js.
  //
  // Buy the space back by tightening the vertical rhythm of the rows that sit
  // above the AI block. The status lines are intentionally left as two rows:
  // merging them would overflow horizontally on the 168dp-wide Band 9 screen
  // (the English "Current: 10+0 · Board: Standard" measures ~239dp).

  // Time options: 38dp -> 30dp, and a slightly smaller label font to match.
  src = src.replace(/\.time\s*\{[^}]*\}/, (rule) => {
    let r = rule
      .replace(/line-height:\s*[^;]+;?/g, '')
      .replace(/(?<![-\w])height:\s*[^;]+;?/g, '')
      .replace(/(?<![-\w])font-size:\s*[^;]+;?/g, '')
      .replace(/margin-bottom:\s*[^;]+;?/g, '');
    r = r.replace(/\s+\}/, ' }').replace(/\s{2,}/g, ' ');
    return r.replace(/\}/, 'font-size:14dp; height:30dp; line-height:30dp; margin-bottom:3dp; }');
  });
  // Header and section label: trim their bottom margins.
  src = src.replace(/(\.head\s*\{[^}]*?)margin-bottom:\s*\d+dp/, '$1margin-bottom:6dp');
  src = src.replace(/(\.head\s*\{[^}]*?)height:\s*\d+dp/, '$1height:38dp');
  src = src.replace(/(\.label\s*\{[^}]*?)margin-bottom:\s*\d+dp/, '$1margin-bottom:4dp');
  // Status lines are informational only — one step smaller buys 2dp.
  src = src.replace(/(\.selectedText\s*\{[^}]*?)font-size:\s*\d+dp/, '$1font-size:13dp');

  /* --- script: state + handlers + forward params ------------------- */
  src = src.replace(
    /data\s*:\s*\{/,
    'data:{aiMode:false,aiLevel:\'normal\',');

  // insert handlers before back()
  src = src.replace(/(\n\s*)(back\(\)\s*\{)/,
    '$1setOpponent(m){this.aiMode=(m===\'ai\');},$1setLevel(l){this.aiLevel=l;},$1$2');

  // forward ai params in start()
  src = src.replace(
    /router\.push\(\{uri:'\/pages\/game',params:\{([^}]*)\}\}\)/,
    "router.push({uri:'/pages/game',params:{$1,aiMode:this.aiMode?'true':'false',aiLevel:this.aiLevel}})");

  if (src !== before) {
    fs.writeFileSync(file, src, 'utf8');
    return ['setup'];
  }
  return [];
}

let n = 0;
for (const d of D) {
  for (const l of L) {
    const f = path.join(ROOT, 'devices', d, 'source', l, 'src', 'pages', 'setup', 'setup.ux');
    if (!fs.existsSync(f)) { console.log('  SKIP ' + d + '/' + l); continue; }
    const ch = patch(f, l);
    n += ch.length;
    console.log((ch.length ? '  OK   ' : '  ---- ') + d + '/' + l);
  }
}
console.log('\ndone, ' + n + ' setup pages patched');
