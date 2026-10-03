#!/usr/bin/env node
/**
 * verify_ai_first_move.js — the engine must be able to OPEN the game.
 *
 * Bug this guards (shipped, found on a real Band 9):
 *   When the human chose "I play black" at setup, the engine plays white and
 *   therefore has the first move. The page configured aiEnabled/aiColor
 *   correctly, but nothing ever CALLED maybeAiMove() on page entry — the only
 *   trigger was the post-human-move hook. Result: the board sat still and the
 *   match behaved like two-player mode.
 *
 *   A second, subtler defect compounded it: the onShow injection was guarded by
 *   `if (!src.includes('if(this.isAiTurn())this.maybeAiMove();'))`. That exact
 *   substring also occurs inside toggleAiMode(), so the guard was satisfied by
 *   an unrelated line and the injection was silently skipped forever.
 *
 * Assertions per tree:
 *   1. onInit body contains a maybeAiMove() kick
 *   2. onShow body contains a maybeAiMove() kick
 *   3. the AI colour is derived from mySide, NOT from the current turn
 *   4. isAiTurn() compares the side to move against aiColor
 *   5. the move() hook calls maybeAiMove()
 *   6. runAiMove() translates the page's 'white'/'black' into the engine's
 *      'w'/'b' at the call boundary  (see the TURN ENCODING note below)
 *
 * TURN ENCODING -- the defect this file was extended to guard.
 *   The page's state machine uses the FULL WORDS 'white' / 'black' (the WHITE
 *   and BLACK constants, `mySide`, `aiColor`, every hint string). The engine
 *   speaks SINGLE CHARS 'w' / 'b': Position.load stores turn verbatim while all
 *   internal tests read `turn === 'w'`, and make/unmake flips with
 *   `this.turn = this.turn === 'w' ? 'b' : 'w'`.
 *
 *   Passing 'white' therefore makes that ternary false, so the engine sets
 *   turn='w' unconditionally, searches for WHITE, and returns a WHITE piece's
 *   move. On the AI's turn (a black-to-move position) that move belongs to the
 *   wrong army, so runAiMove's validity check rejects it and the UI shows
 *   "AI 无法走子" — the AI appears unable to play at all. It reproduced only
 *   when the AI played white, which is what made it confusing.
 *
 *   The engine is fine; the call site was wrong. Hence assertion 6.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const LANGS = ['chinese', 'english'];

let problems = 0;

// Extract a method body: from `name(` up to the next method's opening.
// Both arguments are bare identifiers (e.g. 'onInit', 'onShow').
function bodyOf(src, name, nextName) {
  const start = src.indexOf(name + '(');
  if (start < 0) return null;
  const end = src.indexOf('\n  ' + nextName + '(', start);
  return src.slice(start, end > start ? end : start + 3000);
}

for (const d of DEVICES) {
  for (const l of LANGS) {
    const f = path.join(ROOT, 'devices', d, 'source', l, 'src', 'pages', 'game', 'game.ux');
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');

    const onInit = bodyOf(src, 'onInit', 'onShow');
    const onShow = bodyOf(src, 'onShow', 'applyBoardSize');
    const runAi = bodyOf(src, 'runAiMove', 'applyAiMove');

    const checks = [];

    // 1 + 2 — the engine must be kicked on entry, in BOTH lifecycle hooks.
    checks.push(['onInit kicks maybeAiMove', !!onInit && /if\(this\.aiEnabled&&this\.isAiTurn\(\)\)this\.maybeAiMove\(\);/.test(onInit)]);
    checks.push(['onShow kicks maybeAiMove', !!onShow && /this\.isAiTurn\(\)\)this\.maybeAiMove\(\);/.test(onShow)]);

    // 3 — colour comes from mySide, never from turn.
    checks.push([
      'aiColor derived from mySide',
      /this\.aiColor=\(String\(this\.mySide\)===\s*'black'\)\?'white':'black'/.test(src)
    ]);
    checks.push(['aiColor NOT derived from turn', !/this\.aiColor\s*=\s*this\.turn\s*===/.test(src)]);

    // 4 — isAiTurn compares the side to move with aiColor.
    checks.push(['isAiTurn uses aiColor', /isAiTurn\(\)\{[^}]*this\.turn\[0\]===this\.aiColor\[0\]/.test(src)]);

    // 5 — a completed move must hand over to the engine.
    checks.push(['move() hook present', src.includes('__AI_MOVEHOOK__') && /__AI_MOVEHOOK__ \*\/\s*if\(!this\.resultVisible&&!this\.gameOver\)this\.maybeAiMove\(\);/.test(src)]);

    // 6 — runAiMove must hand the engine 'w'/'b', not the page's 'white'/'black'.
    checks.push([
      'runAiMove translates turn to w/b',
      !!runAi && /ai\.compute\([^)]*this\.turn\s*===\s*'white'\s*\?\s*'w'\s*:\s*'b'/.test(runAi)
    ]);
    checks.push([
      'runAiMove does NOT pass the raw turn word',
      !!runAi && !/ai\.compute\(\s*this\.board\s*,\s*this\.turn\s*,/.test(runAi)
    ]);

    const bad = checks.filter(([, ok]) => !ok);
    if (bad.length) {
      problems++;
      console.log('FAIL ' + d + '/' + l);
      for (const [name] of bad) console.log('        ' + name);
    } else {
      console.log('OK   ' + d + '/' + l);
    }
  }
}

console.log('\n' + (problems === 0
  ? 'AI FIRST-MOVE WIRING OK (engine can open the game when the human plays black)'
  : problems + ' tree(s) broken'));
process.exit(problems === 0 ? 0 : 1);
