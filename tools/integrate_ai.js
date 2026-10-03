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
      // Collapse the whitespace the block used to sit on, so repeated runs do
      // not accumulate orphaned "\n  " lines.
      src = src.replace(/\n(\s*\n)+(\s*)(?=\/\* __AI_METHODS_BEGIN__|undoMoveBase|undoMove\()/, '\n\n  ');
      src = src.replace(/([;{}])\n(\s*\n)+(\s*)(\/\* __AI_METHODS_BEGIN__)/, '$1\n\n  $4');
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
  // First, collapse any duplicates left behind by the old buggy guard (which
  // re-ran on every pass and stacked up to four copies). Then ensure exactly
  // one copy is present.
  const HIDE = 'if(this.aiTimerId){clearTimeout(this.aiTimerId);this.aiTimerId=null;}this.aiThinking=false;';
  const onHideM = src.match(/onHide\(\)\s*\{/);
  if (onHideM) {
    const from = onHideM.index + onHideM[0].length;
    // find the end of the onHide body: next method definition at the same indent
    const rest = src.slice(from);
    const restMatch = rest.match(/\n\s{2}[a-zA-Z_$][\w$]*\s*\(/);
    const to = restMatch ? from + restMatch.index : src.length;
    let body = src.slice(from, to);
    // strip every occurrence of the injected cleanup
    const cleaned = body.split(HIDE).join('');
    const dupes = (body.length - cleaned.length) / HIDE.length;
    if (dupes > 1) changes.push('hideCleanupDedup(' + dupes + ')');
    body = cleaned;
    if (!body.includes(HIDE)) {
      body = HIDE + body;
      changes.push('hideCleanup');
    }
    src = src.slice(0, from) + body + src.slice(to);
    // ASSERT: exactly one copy inside onHide. (Other methods such as resetAi
    // legitimately contain the same clearTimeout call, so scope the check.)
    const hideBody = src.slice(from, from + src.slice(from).search(/\n\s{2}[a-zA-Z_$][\w$]*\s*\(/) + 1);
    const count = (hideBody.match(/this\.aiTimerId\)\{clearTimeout\(this\.aiTimerId\);this\.aiTimerId=null;\}/g) || []).length;
    if (count !== 1) throw new Error('injection failed: hideCleanup (found ' + count + ' copies in onHide)');
  }

  /* 9. Accept aiMode / aiLevel / mySide / increment router params from the
   *    setup wizard and apply them at the END of onInit (after the board
   *    exists). mySide decides which colour the human plays, which in turn
   *    decides the engine colour; increment (Fischer bonus seconds) is credited
   *    to a player after each of their moves. */
  {
    const MARK = '/* __SIDE_TIME_PARAMS__ */';
    const inject = MARK +
      ' this.aiEnabled=String(this.aiMode)===\'true\';' +
      ' const _inc=parseInt(String(this.increment),10);this.incrementSeconds=(isNaN(_inc)||_inc<0)?0:_inc;' +
      ' if(this.aiEnabled){this.aiLevel=this.aiLevel||\'normal\';' +
      'this.aiColor=(String(this.mySide)===\'black\')?\'white\':\'black\';}else{this.aiColor=this.aiColor||\'black\';}' +
      'this.resetAi();if(this.aiEnabled&&this.isAiTurn()){this.hintText=this.aiColor===\'white\'?\'AI 执白先行\':\'\';}';

    // (a) drop the legacy single-purpose block shipped in earlier commits
    const LEGACY = "this.aiEnabled=String(this.aiMode)==='true';" +
      " if(this.aiEnabled){this.aiLevel=this.aiLevel||'normal';" +
      "this.aiColor=this.turn==='white'?'black':'white';}this.resetAi();";
    if (src.includes(LEGACY)) {
      src = src.replace(LEGACY, '');
      changes.push('legacyBlockRemoved');
    }

    // (b) drop any previously injected block. The block always ends with the
    //     substring "...执白先行':'';}" so remove marker..that close-brace.
    const END_OF_BLOCK = "执白先行':'';}";
    const prev = src.indexOf(MARK);
    if (prev >= 0) {
      let stop = src.indexOf(END_OF_BLOCK, prev);
      stop = stop >= 0 ? stop + END_OF_BLOCK.length : src.indexOf(MARK) + MARK.length;
      src = src.slice(0, prev) + src.slice(stop);
    }

    // (c) splice the fresh block in just before onInit's closing brace. The
    //     segment ends with the page object's "}," on its own indent.
    const start = src.indexOf('onInit()');
    const end = src.indexOf("\n  onShow()", start);
    if (start >= 0 && end > start) {
      const seg = src.slice(start, end);
      const at = seg.lastIndexOf('}');
      if (at >= 0) {
        const patched = seg.slice(0, at) + inject + seg.slice(at);
        src = src.slice(0, start) + patched + src.slice(end);
        changes.push(prev >= 0 ? 'paramsRefresh' : 'params');
      }
    }

    // (d) extend `protected` with the new router params (once)
    if (!src.includes("mySide: 'white'")) {
      src = src.replace(/protected:\s*\{([^}]*)\}/,
        "protected: {$1, mySide: 'white', increment: '0' }");
      changes.push('protected');
    }

    // ASSERT: exactly one param block, and the legacy text is gone.
    const hits = (src.match(/__SIDE_TIME_PARAMS__/g) || []).length;
    if (hits !== 1) throw new Error('injection failed: sideTimeParams (found ' + hits + ' copies)');
    if (src.includes(LEGACY)) throw new Error('injection failed: legacy param block survived');
  }

  /* 9b. Fischer increment: credit `incrementSeconds` to the player who just
   *     completed a move. Inserted right after the turn switch inside move(). */
  {
    const MARK = '/* __INC_CREDIT__ */';
    const CREDIT = MARK + ' if(this.incrementSeconds>0&&!this.unlimited){if(this.turn===\'white\'){this.blackSeconds+=this.incrementSeconds;}else{this.whiteSeconds+=this.incrementSeconds;}this.whiteClock=this.formatClock(this.whiteSeconds);this.blackClock=this.formatClock(this.blackSeconds);}';
    const hasMark = src.includes(MARK);
    const anchored = /this\.turn=this\.turn===WHITE\?BLACK:WHITE;/.test(src);
    if (!hasMark && anchored) {
      src = src.replace(/(this\.turn=this\.turn===WHITE\?BLACK:WHITE;)/, '$1' + CREDIT);
      changes.push('incrementCredit');
    }
    // The state field must exist for the credit to work.
    if (!src.includes('incrementSeconds:0,')) {
      src = src.replace(/(private:\s*\{)/, '$1\n    incrementSeconds:0,');
      changes.push('incrementState');
    }
    const hits = (src.match(/__INC_CREDIT__/g) || []).length;
    if (hits !== 1) throw new Error('injection failed: incrementCredit (found ' + hits + ' copies)');
  }

  /* 9c. Persist the increment alongside the saved game so a resume keeps it. */
  {
    if (!src.includes('incrementSeconds:this.incrementSeconds')) {
      src = src.replace(
        /(initialMinutes:this\.initialMinutes,)/,
        '$1incrementSeconds:this.incrementSeconds,');
      src = src.replace(
        /(this\.initialMinutes=this\.unlimited\?0:\(Number\(v\.initialMinutes\)\|\|this\.initialMinutes\);)/,
        '$1this.incrementSeconds=this.unlimited?0:(Number(v.incrementSeconds)||0);');
      changes.push('incrementPersist');
    }
  }

  /* 9d. newPosition must also seed incrementSeconds' baseline (no-op if unset). */
  {
    if (!src.includes('this.incrementSeconds=this.incrementSeconds||0;')) {
      src = src.replace(/(newPosition\(\)\s*\{\s*this\.gameOver=false;)/,
        '$1 this.incrementSeconds=this.incrementSeconds||0;');
      changes.push('newPosInc');
    }
  }

  /* 10. onShow: if it is the AI's turn (e.g. after a resume), let it move. */
  if (!src.includes('if(this.isAiTurn())this.maybeAiMove();')) {
    src = src.replace(/onShow\(\)\s*\{([^}]*)\}/,
      'onShow(){ $1 if(!this.gameOver&&!this.resultVisible&&!this.paused&&this.isAiTurn())this.maybeAiMove();}');
    changes.push('onShowAi');
  }

  /* 11. Performance: incremental square updates. The board UI is a flat list of
   *     64 objects; rebuilding all of them on every tap and every move is the
   *     single hottest path in the page. `updateSquares()` patches only the
   *     squares whose visual state actually changed, and keeps the array
   *     identity stable so Vela can diff it cheaply.
   *
   *     buildSquares() is kept for full rebuilds (new game, resize, load). */
  {
    const MARK = '/* __INCR_SQUARES__ */';
    const fn =
      MARK + ' squareOf(i){const row=Math.floor(i/8),col=i%8,p=this.board[i];' +
      'return{index:i,x:col*this.squareSize,y:row*this.squareSize,' +
      "color:(row+col)%2?'#B8B8B8':'#3A3A3A',piece:p?GLYPHS[p]:''," +
      "pieceSrc:p?'/common/pieces/'+p+'.png':''," +
      "pieceColor:p&&p[0]==='w'?'#FFFFFF':'#111111'," +
      'selected:i===this.selected,lastMove:this.lastMove.indexOf(i)>=0,' +
      'legal:this.legalMoves.indexOf(i)>=0};},' +
      'updateSquares(){if(!this.squares||this.squares.length!==64){this.buildSquares();return;}' +
      'const out=this.squares.slice();let changed=false;' +
      'for(let i=0;i<64;i++){const n=this.squareOf(i),o=out[i];' +
      "if(!o||o.piece!==n.piece||o.pieceSrc!==n.pieceSrc||o.selected!==n.selected||" +
      'o.lastMove!==n.lastMove||o.legal!==n.legal){out[i]=n;changed=true;}}' +
      'if(changed)this.squares=out;},';

    // Strip a previously injected version (idempotent). The block is preceded
    // by the "\n  " separator we add on insert, so consume that too.
    const prev = src.indexOf(MARK);
    if (prev >= 0) {
      const TAIL = 'if(changed)this.squares=out;},';
      const tailAt = src.indexOf(TAIL, prev);
      const stop = tailAt >= 0 ? tailAt + TAIL.length : src.indexOf(MARK) + MARK.length;
      let head = prev;
      if (src.slice(head - 3, head) === '\n  ') head -= 3;
      src = src.slice(0, head) + src.slice(stop);
    }

    // Insert right after buildSquares()'s closing "  }," line.
    const anchor = src.indexOf('    this.squares=s;\n  },');
    if (anchor >= 0) {
      const at = anchor + '    this.squares=s;\n  },'.length;
      src = src.slice(0, at) + '\n  ' + fn + src.slice(at);
      changes.push(prev >= 0 ? 'incrSquaresRefresh' : 'incrSquares');
    }
    const hits = (src.match(/__INCR_SQUARES__/g) || []).length;
    if (hits !== 1) throw new Error('injection failed: incrSquares (found ' + hits + ' copies)');
  }

  /* 12. Route the hot paths through updateSquares(). Tap-to-select, tap-to-move
   *     and undo only ever change a handful of squares, so a full 64-square
   *     rebuild there is pure waste. Full rebuilds stay for new games, resume,
   *     board resizing and settings loads. */
  {
    // tapSquare: both branches only move the selection / legal dots, so the
    // rebuild can be incremental. Anchor on structure, not on the hint copy
    // (which differs per language).
    const tapPatched = src.replace(
      /(this\.legalMoves=this\.showHints\?this\.getMoves\(i\):\[\];\s*this\.hintText=[^;]*;\s*if\(this\.autoCenter\)this\.centerOn\(i\);\s*)this\.buildSquares\(\);/,
      '$1this.updateSquares();');
    if (tapPatched !== src) { src = tapPatched; changes.push('incrTap'); }
    const tapPatched2 = src.replace(
      /(this\.selected=-1;\s*this\.legalMoves=\[\];\s*this\.hintText=[^;]*;\s*)this\.buildSquares\(\);/,
      '$1this.updateSquares();');
    if (tapPatched2 !== src) { src = tapPatched2; changes.push('incrTap2'); }
    // undoMoveBase only reverts the board.
    const undoPatched = src.replace(
      /(this\.resultVisible=false;\s*this\.hintText=[^;]*;\s*)this\.buildSquares\(\);/,
      '$1this.updateSquares();');
    if (undoPatched !== src) { src = undoPatched; changes.push('incrUndo'); }
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
