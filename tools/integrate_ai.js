#!/usr/bin/env node
/**
 * integrate_ai.js — patch every device/language game.ux to support human-vs-AI play.
 *
 * The chess engine lives in src/common/js/ai.js (shared, copied into each tree).
 * This script performs a set of well-defined, idempotent textual transformations:
 *
 *   1. Add `import ai from '../../common/js/ai.js'` after the storage import.
 *   2. Extend `private` state with AI fields (aiEnabled, aiLevel, aiThinking, aiColor).
 *   3. Insert AI helper methods before `undoMove(`.
 *   4. Hook `maybeAiMove()` at the end of `move(from,to)` so the engine replies.
 *   5. Add an AI toggle + difficulty cycle to the in-game settings overlay.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const LANGS = ['chinese', 'english'];

/* ------------------------------------------------------------------ *
 * Per-language copy bank
 * ------------------------------------------------------------------ */
const COPY = {
  chinese: {
    importLine: "import ai from '../../common/js/ai.js';",
    privateExtra: "aiEnabled: false, aiLevel: 'normal', aiThinking: false, aiColor: 'black', aiStatusText: '', aiTimerId: null, aiDisabledByUser:false,",
    setupLabelHuman: '人机对弈：开',
    setupLabelHumanOff: '人机对弈：关',
    labelLevel: 'AI 难度：',
    labelThinking: 'AI 思考中…',
    labelAiTurn: 'AI 回合，请稍候',
    resignAi: 'AI 认输',
    levelNames: { easy: '简单', normal: '普通', hard: '困难', master: '大师' },
    humanIsWhite: '你执白棋，AI 执黑棋',
    humanIsBlack: '你执黑棋，AI 执白棋'
  },
  english: {
    importLine: "import ai from '../../common/js/ai.js';",
    privateExtra: "aiEnabled: false, aiLevel: 'normal', aiThinking: false, aiColor: 'black', aiStatusText: '', aiTimerId: null, aiDisabledByUser:false,",
    setupLabelHuman: 'Play vs AI: On',
    setupLabelHumanOff: 'Play vs AI: Off',
    labelLevel: 'AI level: ',
    labelThinking: 'AI is thinking…',
    labelAiTurn: 'AI to move…',
    resignAi: 'AI resigns',
    levelNames: { easy: 'Easy', normal: 'Normal', hard: 'Hard', master: 'Master' },
    humanIsWhite: 'You are White, AI is Black',
    humanIsBlack: 'You are Black, AI is White'
  }
};

/* ------------------------------------------------------------------ *
 * Helper snippets (kept as single-line-friendly blocks)
 * ------------------------------------------------------------------ */

// Methods injected into every game page (ES module style, `function` free).
function aiMethods(c) {
  return [
    "isAiTurn(){return this.aiEnabled&&!this.gameOver&&!this.resultVisible&&this.turn[0]===this.aiColor[0];},",
    "resetAi(){this.aiThinking=false;if(this.aiTimerId){clearTimeout(this.aiTimerId);this.aiTimerId=null;}ai.setLevel(this.aiLevel);},",
    "cycleAiLevel(){const order=['easy','normal','hard','master'];const i=order.indexOf(this.aiLevel);this.aiLevel=order[(i+1)%order.length];ai.setLevel(this.aiLevel);this.saveSettings();this.buildSquares();},",
    "toggleAiMode(){this.aiEnabled=!this.aiEnabled;this.aiThinking=false;this.hintText=this.aiEnabled?this.aiHumanBanner():'已切换为双人对弈';this.saveSettings();if(this.isAiTurn())this.maybeAiMove();},",
    "aiHumanBanner(){return this.aiColor==='white'?" + JSON.stringify(c.humanIsBlack) + ":" + JSON.stringify(c.humanIsWhite) + ";},",
    /* Kick off an AI search asynchronously (after paint) so the UI stays responsive. */
    "maybeAiMove(){if(!this.isAiTurn()||this.aiThinking)return;this.aiThinking=true;this.hintText=" + JSON.stringify(c.labelAiTurn) + ";this.timerWasRunning=!!this.timerId;this.stopClock();this.aiTimerId=setTimeout(()=>{this.aiTimerId=null;this.runAiMove();},60);},",
    /* Derive the en-passant target square from the recorded last move, which
     * is how this page tracks it (there is no explicit ep field). */
    "aiEpSquare(){const lm=this.lastMove;if(!lm||lm.length!==2)return -1;const d=Math.abs(lm[1]-lm[0]);if(d!==16)return -1;const p=this.board[lm[1]];if(!p||p[1]!=='P')return -1;return (lm[0]<lm[1]?lm[0]+8:lm[0]-8);},",
    /* Run the search, then replay the chosen move through the normal rules path. */
    "runAiMove(){let mv=null;try{ai.setLevel(this.aiLevel);mv=ai.compute(this.board,this.turn,this.castling,this.aiEpSquare(),this.halfmoveClock);}catch(e){mv=null;}this.aiThinking=false;if(mv&&this.board[mv.from]&&this.board[mv.from][0]===this.turn[0]){this.applyAiMove(mv.from,mv.to);}else{this.hintText='AI 无法走子';if(this.timerWasRunning)this.startClock();}},",
    /* Apply the engine move using the exact same rules pipeline as a human tap. */
    "applyAiMove(from,to){this.selected=from;this.legalMoves=[to];this.move(from,to);if(!this.unlimited&&!this.gameOver&&!this.resultVisible&&!this.aiThinking)this.startClock();},",
    /* AI-aware undo wrapper: in AI mode one undo rewinds the full round. */
    "undoMove(){if(this.aiEnabled&&!this.aiThinking&&this.history.length>=2){this.undoMoveBase();this.undoMoveBase();this.resultVisible=false;this.gameOver=false;this.hintText='已悔棋，请继续';return;}this.undoMoveBase();},"
  ].join('\n  ');
}

function levelLabelExpr(c) {
  return "'" + c.labelLevel + "'+(" + JSON.stringify(c.levelNames) + "[this.aiLevel]||this.aiLevel)";
}

/* ------------------------------------------------------------------ *
 * Patch one file
 * ------------------------------------------------------------------ */
function patch(file, lang, device) {
  const c = COPY[lang];
  let src = fs.readFileSync(file, 'utf8');
  const before = src;
  const changes = [];
  const isBand9 = device === 'xiaomi-band-9';

  /* 1. import */
  if (!src.includes("common/js/ai.js")) {
    // Place right after the last existing import line in <script>.
    const m = src.match(/<script>\s*\n([\s\S]*?)(\nexport default)/);
    if (m) {
      src = src.replace(m[0], m[0].replace(m[2], '\n' + c.importLine + m[2]));
      changes.push('import');
    }
  }

  /* 2. private state */
  if (!src.includes('aiEnabled')) {
    src = src.replace(/private:\s*\{/, 'private: {\n    ' + c.privateExtra + '\n    ');
    changes.push('state');
  }

  /* 3. AI methods. Rename the original undoMove -> undoMoveBase, then inject
   *    the AI method block (which provides an AI-aware undoMove wrapper). */
  {
    const BEGIN = '/* __AI_METHODS_BEGIN__ */';
    const END = '/* __AI_METHODS_END__ */';
    // strip any previously-injected block
    const b = src.indexOf(BEGIN);
    const e = src.indexOf(END);
    if (b >= 0 && e > b) {
      src = src.slice(0, b) + src.slice(e + END.length);
      src = src.replace(/\n\s*\n\s*(\/\* __AI_METHODS_BEGIN__|undoMove\(\))/, '\n  $1');
    }
    // ensure the base undo is renamed exactly once
    if (!src.includes('undoMoveBase()')) {
      src = src.replace(/(\n\s*)undoMove\(\)\s*\{/, '$1undoMoveBase() {');
      changes.push('undoRename');
    }
    if (!src.includes('maybeAiMove(){')) {
      const anchor = /(\n\s*)(undoMoveBase\(\)\s*\{)/;
      if (anchor.test(src)) {
        src = src.replace(anchor,
          '$1' + BEGIN + '\n  ' + aiMethods(c) + '\n  ' + END + '$1$2');
        changes.push('methods');
      }
    }
  }

  /* 4. hook move(): call maybeAiMove after the move resolves.
   *    move() ends with the checkmate/stalemate/draw chain then "},"
   *    followed by the AI methods block or undoMoveBase().
   */
  if (!src.includes('/* __AI_MOVEHOOK__ */')) {
    const start = src.indexOf('\n  move(from,to)');
    let end = src.indexOf('/* __AI_METHODS_BEGIN__ */', start);
    if (end < 0) end = src.indexOf('\n  undoMoveBase()', start);
    if (end < 0) end = src.indexOf('\n  undoMove()', start);
    if (start >= 0 && end > start) {
      const segment = src.slice(start, end);
      const tailIdx = segment.lastIndexOf('},');
      if (tailIdx > 0) {
        const patched =
          segment.slice(0, tailIdx) +
          ' /* __AI_MOVEHOOK__ */ if(!this.resultVisible&&!this.gameOver)this.maybeAiMove();' +
          segment.slice(tailIdx);
        src = src.slice(0, start) + patched + src.slice(end);
        changes.push('moveHook');
      }
    }
  }

  /* 5. settings overlay: add AI rows right after the board-size row. */
  if (!src.includes('@click="cycleAiLevel"')) {
    const marker = '@click="cycleBoardSize"';
    const idx = src.indexOf(marker);
    if (idx >= 0) {
      const lineEnd = src.indexOf('</text>', idx);
      if (lineEnd > 0) {
        const close = src.indexOf('>', lineEnd);
        const rows =
          '\n        <text class="menuItem" @click="toggleAiMode">' + c.setupLabelHuman + '</text>' +
          '\n        <text class="menuItem" if="{{aiEnabled}}" @click="cycleAiLevel">{{' + levelLabelExpr(c) + '}}</text>';
        src = src.slice(0, close + 1) + rows + src.slice(close + 1);
        changes.push('settingsUI');
      }
    }
  }

  /* 6. Persist AI mode alongside the saved game so a resume keeps the opponent. */
  if (!src.includes('aiEnabled:this.aiEnabled')) {
    // saveActiveGame: append ai fields to the stored payload
    src = src.replace(
      /(saveActiveGame\(\)\{[\s\S]*?gameOver:false)(\}\))/,
      '$1,aiEnabled:this.aiEnabled,aiLevel:this.aiLevel,aiColor:this.aiColor$2');
    // loadActiveGame: restore them
    src = src.replace(
      /(this\.confirmBeforeResign=true;)/,
      '$1this.aiEnabled=v.aiEnabled===true;this.aiLevel=v.aiLevel||\'normal\';this.aiColor=v.aiColor||\'black\';this.resetAi();');
    changes.push('persist');
  }

  /* 7. newPosition should reset AI thinking state. */
  if (!src.includes('this.aiColor=this.aiColor||')) {
    src = src.replace(/(newPosition\(\)\s*\{\s*this\.gameOver=false;)/,
      '$1 this.aiThinking=false;this.aiColor=this.aiColor||\'black\';');
    changes.push('newPosReset');
  }

  /* 8. onHide: clear any pending AI timer so it does not fire off-screen. */
  if (!src.includes('this.aiTimerId&&clearTimeout')) {
    src = src.replace(/onHide\(\)\s*\{/,
      'onHide(){if(this.aiTimerId){clearTimeout(this.aiTimerId);this.aiTimerId=null;}this.aiThinking=false;');
    changes.push('hideCleanup');
  }

  /* 9. Accept aiMode / aiLevel router params from the setup page and apply
   *    them at the END of onInit (after the board exists). */
  if (!src.includes("String(this.aiMode)==='true'")) {
    src = src.replace(/protected:\s*\{([^}]*)\}/,
      "protected: {$1, aiMode: 'false', aiLevel: 'normal' }");
    // append setup-AI activation just before onInit's closing brace
    const start = src.indexOf('onInit()');
    const end = src.indexOf("\n  onShow()", start);
    if (start >= 0 && end > start) {
      const seg = src.slice(start, end);
      const tail = seg.lastIndexOf('},');
      if (tail > 0) {
        const inject =
          ' this.aiEnabled=String(this.aiMode)===\'true\';' +
          ' if(this.aiEnabled){this.aiLevel=this.aiLevel||\'normal\';this.aiColor=this.turn===\'white\'?\'black\':\'white\';}this.resetAi();';
        const patched = seg.slice(0, tail) + inject + seg.slice(tail);
        src = src.slice(0, start) + patched + src.slice(end);
        changes.push('params');
      }
    }
  }

  /* 10. onShow: if it is the AI's turn (e.g. after a resume), let it move. */
  if (!src.includes('if(this.isAiTurn())this.maybeAiMove();')) {
    src = src.replace(/onShow\(\)\s*\{([^}]*)\}/,
      'onShow(){ $1 if(!this.gameOver&&!this.resultVisible&&!this.paused&&this.isAiTurn())this.maybeAiMove();}');
    changes.push('onShowAi');
  }

  if (src !== before) {
    fs.writeFileSync(file, src, 'utf8');
  }
  return changes;
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */
let total = 0;
for (const d of DEVICES) {
  for (const l of LANGS) {
    const f = path.join(ROOT, 'devices', d, 'source', l, 'src', 'pages', 'game', 'game.ux');
    if (!fs.existsSync(f)) { console.log('  SKIP (missing) ' + d + '/' + l); continue; }
    const ch = patch(f, l, d);
    total += ch.length;
    console.log((ch.length ? '  OK   ' : '  ---- ') + d + '/' + l + '  [' + ch.join(', ') + ']');
  }
}
console.log('\ndone, ' + total + ' transformations applied');
