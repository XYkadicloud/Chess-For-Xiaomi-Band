#!/usr/bin/env node
/*
 * verify_time_side.js — guard the two features added on top of the AI work:
 *
 *   1. Fischer increment ("X min + Y sec"), routed setup -> game.
 *   2. Side selection ("play white" / "play black") in AI mode.
 *
 * These are silent-failure-prone: a missing param simply means the game starts
 * with the wrong colour, or the clock never gains the bonus. Neither throws on
 * the device, so every link in the chain is asserted here.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const LANGS = ['chinese', 'english'];

let problems = 0;
function check(ok, label, detail) {
  if (!ok) problems++;
  console.log((ok ? 'OK   ' : 'FAIL ') + label + (ok || !detail ? '' : '  :: ' + detail));
}

for (const d of DEVICES) {
  for (const l of LANGS) {
    const base = path.join(ROOT, 'devices', d, 'source', l, 'src', 'pages');
    const setupF = path.join(base, 'setup', 'setup.ux');
    const gameF = path.join(base, 'game', 'game.ux');
    if (!fs.existsSync(setupF) || !fs.existsSync(gameF)) { console.log('SKIP ' + d + '/' + l); continue; }

    const setup = fs.readFileSync(setupF, 'utf8');
    const game = fs.readFileSync(gameF, 'utf8');
    const tag = d + '/' + l;

    // --- setup side: must offer a side chooser and forward both params ----
    check(/pickSide\(/.test(setup), tag + ' setup defines pickSide');
    check(/mySide==='black'/.test(setup), tag + ' setup has a black-side chip');
    check(/incIncrement\(/.test(setup) && /decIncrement\(/.test(setup),
      tag + ' setup has +/- increment steppers');
    check(/increment\s*:/.test(setup) && /mySide\s*:/.test(setup),
      tag + ' setup forwards increment + mySide to game');

    // --- game side: params, state, credit, persistence -------------------
    check(/mySide:\s*'white'/.test(game), tag + ' game accepts mySide param');
    check(/increment:\s*'0'/.test(game), tag + ' game accepts increment param');
    check(/incrementSeconds:0,/.test(game), tag + ' game declares incrementSeconds state');
    check(/String\(this\.mySide\)==='black'\)\?'white':'black'/.test(game),
      tag + ' game derives aiColor from mySide');
    check(/__INC_CREDIT__[\s\S]{0,60}incrementSeconds>0/.test(game),
      tag + ' game credits increment after a move');
    check(/incrementSeconds:this\.incrementSeconds/.test(game),
      tag + ' increment is saved with the active game');
    check(/Number\(v\.incrementSeconds\)/.test(game),
      tag + ' increment is restored on resume');

    // aiColor must be derived from mySide, never from the current turn.
    const turnDerived = /this\.aiColor=this\.turn==='white'\?/.test(game);
    check(!turnDerived, tag + ' aiColor is NOT derived from the current turn');
  }
}

console.log('\n' + (problems === 0 ? 'TIME + SIDE WIRING OK' : problems + ' PROBLEM(S)'));
process.exit(problems === 0 ? 0 : 1);
