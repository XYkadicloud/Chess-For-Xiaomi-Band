#!/usr/bin/env node
/**
 * verify_ai_integration.js — prove the AI wiring inside each game.ux behaves
 * correctly, without a device.
 *
 * Strategy: extract the <script> block from a game.ux, evaluate it in a vm
 * sandbox with stub `@system.*` modules, wrap the exported page object into a
 * minimal fake component (private/computed/setData), then drive real chess
 * moves through it and assert the AI replies and the undo pairing works.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const D = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const L = ['chinese'];

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}

/* ---- load the shared engine as a CommonJS value ------------------- */
function loadEngine() {
  const src = fs.readFileSync(path.join(ROOT, 'src/common/js/ai.js'), 'utf8');
  const body = src
    .replace(/^export default ai;\s*$/m, '')
    .replace(/^export \{[\s\S]*?\};\s*$/m, '');
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.createContext(sandbox);
  vm.runInContext(body + '\nmodule.exports = { ai, LEVELS, LEVEL_ORDER, AiPlayer, Position, hasLegalMove, typeOf, VALUE };', sandbox);
  return sandbox.module.exports;
}

/* ---- build a fake Vela component around an exported page ---------- */
function makeComponent(def) {
  const priv = {};
  Object.assign(priv, def.private || {});
  Object.assign(priv, def.data || {});
  const comp = {};
  const proto = {};
  for (const k in def) {
    if (k === 'private' || k === 'data') continue;
    if (k === 'computed') {
      for (const c in def.computed) {
        Object.defineProperty(proto, c, { get: def.computed[c].bind(comp), enumerable: true });
      }
    } else if (typeof def[k] === 'function') {
      proto[k] = def[k];
    } else {
      priv[k] = def[k];
    }
  }
  Object.setPrototypeOf(comp, proto);
  Object.assign(comp, priv);
  comp.setData = function (o) { Object.assign(comp, o); };
  return comp;
}

/* ---- load one game.ux and wire the real engine into it ------------ */
function loadPage(device, lang) {
  const f = path.join(ROOT, 'devices', device, 'source', lang, 'src', 'pages', 'game', 'game.ux');
  const src = fs.readFileSync(f, 'utf8');
  const m = src.match(/<script>([\s\S]*)<\/script>/);
  let body = m[1];

  const engine = loadEngine();

  // Strip import lines; provide stubs for @system.*
  const storage = {
    _s: {},
    get(o) { const v = this._s[o.key]; (o.success || o.fail)(v === undefined ? { data: undefined } : { data: v }); },
    set(o) { this._s[o.key] = o.value; if (o.success) o.success(); }
  };
  const router = { back() {}, push() {} };
  /* stub for the i18n layer: the page calls tr() to build its status and
   * result strings. Returning the key keeps the assertions independent of
   * whatever language happens to be active. */
  const tr = (k) => k;
  const configuration = { getLocale: () => ({ language: 'zh', countryOrRegion: 'CN' }) };

  body = body
    .replace(/^\s*import .*?;\s*$/gm, '')
    .replace(/export default/, 'var __def =');

  const timers = [];
  const sandbox = {
    storage, router, tr, configuration,
    ai: engine.ai,
    console,
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: () => 0, clearInterval: () => {},
    Date, Math, JSON, Object, Array, String, Number, parseInt, isNaN, Boolean
  };
  vm.createContext(sandbox);
  vm.runInContext(body + '\n__page = __def;', sandbox);

  /* The page resolves every label through the platform's $t() (device
   * language). Return the key so the assertions do not depend on which
   * language happens to be active. Injected before makeComponent so it also
   * lands on the prototype and is visible to every computed. */
  sandbox.__page.$t = (k) => k;
  const comp = makeComponent(sandbox.__page);
  // execute any pending setTimeout (AI move scheduling) synchronously
  comp.__drain = function () {
    let guard = 0;
    while (timers.length && guard++ < 50) {
      const t = timers.shift();
      t.fn();
    }
  };
  return comp;
}

/* ---- helper: play one ply through the page's own tap path --------- */
function humanMove(comp, from, to) {
  comp.tapSquare(from);
  const legal = comp.legalMoves || [];
  if (legal.indexOf(to) < 0) return false;
  comp.tapSquare(to);
  comp.__drain(); // let the scheduled AI reply run
  return true;
}

console.log('== AI integration across all device/language builds ==');

for (const d of D) {
  for (const l of L) {
    const tag = d + '/' + l;
    let comp;
    try {
      comp = loadPage(d, l);
    } catch (e) {
      ok(tag + ' loads', false);
      console.log('        ' + e.message);
      continue;
    }

    ok(tag + ': exposes AI state', 'aiEnabled' in comp && 'aiLevel' in comp);
    ok(tag + ': exposes maybeAiMove', typeof comp.maybeAiMove === 'function');
    ok(tag + ': exposes aiEpSquare', typeof comp.aiEpSquare === 'function');

    // initialise a fresh position
    comp.newPosition();
    ok(tag + ': fresh board is 64 squares', comp.board.length === 64);
    ok(tag + ': starts on white', comp.turn === 'white');

    // AI off by default -> no reply
    comp.aiEnabled = false;
    humanMove(comp, 52, 36); // e2-e4
    ok(tag + ': AI off means black does not move', comp.turn === 'black');

    // ---- turn AI on as black; play a move and require a reply ----
    comp.newPosition();
    comp.aiEnabled = true;
    comp.aiColor = 'black';
    comp.aiLevel = 'easy';
    comp.resetAi();
    const moved = humanMove(comp, 52, 36); // e2-e4
    ok(tag + ': human move accepted', moved);
    ok(tag + ': AI replied (board back on white)', comp.turn === 'white');
    ok(tag + ': AI actually placed a black move', comp.history.length === 2);

    // ---- undo pairing: one undo rewinds both plies ----
    const hlen = comp.history.length;
    comp.undoMove();
    ok(tag + ': single undo rewinds the full round', comp.history.length === hlen - 2);
    ok(tag + ': undo returns move to human', comp.turn === 'white');

    // ---- ep derivation ----
    comp.newPosition();
    // craft a position: white pawn e5 (28), black pawn d5 (27) just double-pushed
    const b = new Array(64).fill(null);
    b[28] = 'wP'; // e5
    b[27] = 'bP'; // d5
    b[60] = 'wK'; b[4] = 'bK';
    comp.board = b;
    comp.turn = 'black';
    comp.lastMove = [11, 27]; // d7 -> d5 double push
    const ep = comp.aiEpSquare();
    ok(tag + ': en-passant square derived (d6=19)', ep === 19);

    // ---- level cycle ----
    comp.newPosition();
    comp.aiLevel = 'easy';
    comp.cycleAiLevel();
    ok(tag + ': cycleAiLevel advances to normal', comp.aiLevel === 'normal');
    comp.cycleAiLevel(); comp.cycleAiLevel(); comp.cycleAiLevel();
    ok(tag + ': cycleAiLevel wraps back to easy', comp.aiLevel === 'easy');

    // ---- a full 6-ply AI-vs-viewer game stays legal ----
    comp.newPosition();
    comp.aiEnabled = true; comp.aiColor = 'black'; comp.aiLevel = 'normal';
    comp.resetAi();
    let legalAll = true;
    for (let ply = 0; ply < 6 && comp.turn === 'white' && !comp.resultVisible; ply++) {
      // viewer plays the first legal move found
      let played = false;
      for (let i = 0; i < 64 && !played; i++) {
        if (comp.board[i] && comp.board[i][0] === 'w') {
          const mvs = comp.getMoves(i);
          if (mvs.length) { played = humanMove(comp, i, mvs[0]); }
        }
      }
      if (!played) break;
      if (comp.turn !== 'white' && !comp.resultVisible) { legalAll = false; break; }
    }
    ok(tag + ': 3 rounds of human-vs-AI stay legal', legalAll && comp.board.length === 64);
  }
}

console.log('\n----------------------------------------------------------');
console.log('passed: ' + pass + '   failed: ' + fail);
console.log('----------------------------------------------------------');
process.exit(fail ? 1 : 0);
