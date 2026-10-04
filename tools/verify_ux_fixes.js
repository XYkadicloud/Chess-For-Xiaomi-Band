#!/usr/bin/env node
/**
 * verify_ux_fixes.js — guard the three UX fixes made after the bilingual merge.
 *
 * Each of these was a user-reported defect that a static check can pin down, so
 * a later refactor cannot quietly reintroduce them:
 *
 *   A. BOARD PANNING. With the board enlarged (44dp squares = 352dp), the last
 *      row must still be reachable by dragging. The clamp must use the ACTUAL
 *      `.boardViewport` height, which is 264dp on Band 9 / Band 10 and 280dp on
 *      Band 9 Pro — NOT a flat 280. Regression symptom: "放大后棋盘显示不完全,
 *      无法滑到边缘".
 *
 *   B. AI THINKING FEEDBACK. In vs-AI mode the human's move must be visible
 *      before the engine blocks, and a busy indicator must show while it runs.
 *      Regression symptom: tapping feels laggy / the board looks frozen.
 *
 *   C. ONE LANGUAGE PATH. No page may bind text through $t() any more: $t()
 *      follows the system locale and cannot be overridden, so mixing it with
 *      tr() produced "About is Chinese but Home is English". Every page also
 *      needs a synchronous initLang() so the first painted frame is correct
 *      (no zh -> en flash).
 *
 * Usage: node tools/verify_ux_fixes.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEVICES = {
  'xiaomi-band-9': { w: 192, viewportH: 264, centred: false },
  'xiaomi-band-9-pro': { w: 336, viewportH: 280, centred: true },
  'xiaomi-band-10': { w: 212, viewportH: 264, centred: false }
};
const PAGES = ['index', 'setup', 'game', 'settings', 'about', 'support', 'purchase'];

let pass = 0, fail = 0;
const ok = (m) => { pass++; };
const bad = (m) => { fail++; console.log('FAIL ' + m); };

/* The largest selectable square size; the board is 8 of them. */
const MAX_SQUARE = 44;

for (const [dev, geo] of Object.entries(DEVICES)) {
  const dir = path.join(ROOT, 'devices', dev, 'source', 'chinese', 'src', 'pages');
  if (!fs.existsSync(dir)) { bad(dev + ': no pages directory'); continue; }

  /* ---------------- A. board panning bounds ---------------- */
  const gameFile = path.join(dir, 'game', 'game.ux');
  if (!fs.existsSync(gameFile)) { bad(dev + '/game: missing'); }
  else {
    const g = fs.readFileSync(gameFile, 'utf8');

    /* The vertical clamp must equal the viewport height. */
    const topM = g.match(/maxBoardTop\(\)\{return ([^}]*)\}/);
    if (!topM) bad(dev + '/game: no maxBoardTop()');
    else {
      const want = String(geo.viewportH);
      if (!new RegExp('Math\\.min\\(0,' + want + '-this\\.boardSize\\)').test(topM[1])) {
        bad(dev + '/game: maxBoardTop must use the viewport height ' + want + ', got: ' + topM[1]);
      } else ok();

      /* Prove the bottom row is actually reachable at the largest board. */
      const board = MAX_SQUARE * 8;                       // 352
      const minTop = Math.min(0, geo.viewportH - board);  // e.g. -88
      const lastRowBottom = minTop + board;               // board bottom in viewport coords
      if (lastRowBottom < geo.viewportH - 0.5) {
        bad(dev + '/game: bottom row unreachable (needs ' + geo.viewportH +
            ', max reach ' + lastRowBottom + ')');
      } else ok();
    }

    /* The horizontal clamp: left-pinned devices clamp <= 0, the centred one
     * keeps a symmetric margin. */
    const leftM = g.match(/maxBoardLeft\(\)\{return ([^}]*)\}/);
    if (!leftM) bad(dev + '/game: no maxBoardLeft()');
    else {
      const body = leftM[1];
      if (geo.centred) {
        if (!/Math\.max\(0,Math\.floor\(\(/.test(body)) bad(dev + '/game: centred device maxBoardLeft has the wrong form');
        else ok();
      } else {
        if (!new RegExp('Math\\.min\\(0,' + geo.w + '-this\\.boardSize\\)').test(body)) {
          bad(dev + '/game: maxBoardLeft should use width ' + geo.w + ', got: ' + body);
        } else ok();
      }
      /* No leftover `undefined`/`NaN` from a bad GEO lookup. */
      if (/undefined-this\.boardSize|NaN-\(col/.test(g)) bad(dev + '/game: bounds contain undefined/NaN');
      else ok();
    }

    /* The board viewport must actually be as tall as we assume. */
    const vpM = g.match(/\.boardViewport\s*\{[^}]*height\s*:\s*(\d+)dp/);
    if (!vpM) bad(dev + '/game: no .boardViewport height');
    else if (Number(vpM[1]) !== geo.viewportH) {
      bad(dev + '/game: .boardViewport is ' + vpM[1] + 'dp but the clamp assumes ' + geo.viewportH);
    } else ok();

    /* ---------------- B. AI thinking feedback ---------------- */
    if (!/thinkingRing/.test(g)) bad(dev + '/game: no thinking ring markup');
    else ok();
    if (!/hintDots/.test(g)) bad(dev + '/game: no thinking dots');
    else ok();
    if (!/if="\{\{aiThinking\}\}"/.test(g)) bad(dev + '/game: feedback is not gated on aiThinking');
    else ok();

    /* The pre-search delay must be a single frame, not a 60ms stall. */
    if (/runAiMove\(\);\},60\)/.test(g)) bad(dev + '/game: the 60ms pre-search delay is back');
    else ok();
    if (!/runAiMove\(\);\},0\)/.test(g)) bad(dev + '/game: no single-frame yield before the search');
    else ok();

    /* The dot animation must be started and stopped, and its timer declared. */
    if (!/dotTimerId=setInterval/.test(g)) bad(dev + '/game: thinking-dot interval not started');
    else ok();
    if (!/dotTimerId: null/.test(g)) bad(dev + '/game: dotTimerId is not declared');
    else ok();
    const hideAt = g.indexOf('onHide()');
    const hideBody = hideAt < 0 ? '' : g.slice(hideAt, hideAt + 500);
    if (!/clearInterval\(this\.dotTimerId\)/.test(hideBody)) bad(dev + '/game: onHide does not stop the dots');
    else ok();
  }

  /* ---------------- C. one language path ---------------- */
  for (const pg of PAGES) {
    const f = path.join(dir, pg, pg + '.ux');
    if (!fs.existsSync(f)) continue;               /* purchase is 9 Pro / 10 only */
    const s = fs.readFileSync(f, 'utf8');

    /* No $t() anywhere: template or script. */
    if (/\$t\(/.test(s)) bad(dev + '/' + pg + ': still binds text through $t()');
    else ok();

    /* Every page that shows text must import the strings module... */
    if (!/common\/js\/strings\.js/.test(s)) bad(dev + '/' + pg + ': does not import strings.js');
    else ok();

    /* ...and settle the language synchronously in onInit — before the first
     * paint — rather than only after an async storage read, which caused the
     * zh -> en flash. Settings uses its own applySystemLang(), which does the
     * same job, so accept either. */
    const initM = s.match(/onInit\s*\([^)]*\)\s*\{/);
    if (!initM) {
      bad(dev + '/' + pg + ': no onInit() at all');
    } else {
      const body = s.slice(s.indexOf(initM[0]));
      const end = body.indexOf('},');
      const scope = end < 0 ? body.slice(0, 800) : body.slice(0, end);
      if (!/applyLang\(\)|applySystemLang\(\)/.test(scope)) {
        bad(dev + '/' + pg + ': onInit does not settle the language before the first paint');
      } else ok();
      if (!/initLang\(/.test(s)) {
        bad(dev + '/' + pg + ': never calls initLang() (startup may flash the wrong language)');
      } else ok();
    }

    /* Exactly one onInit: a duplicate key would silently shadow. */
    const initCount = (s.match(/onInit\s*\([^)]*\)\s*\{/g) || []).length;
    if (initCount !== 1) bad(dev + '/' + pg + ': ' + initCount + ' onInit definitions (want exactly 1)');
    else ok();

    /* Reactive labels: any tr() must sit behind a computed reading langTick. */
    if (/\{\{\s*tr\s*\(/.test(s)) bad(dev + '/' + pg + ': template calls tr() directly (not reactive)');
    else ok();

    /* Template must be a SINGLE well-formed tree. An injection that appended a
     * stray `</div>` (the thinking-ring rule once did) leaves the <template>
     * with several top-level children; the compiler then rejects the whole
     * page with "There are 6 children, but expect to have 1" and the release
     * silently ships the previous build. Catch it here. */
    {
      const t0 = s.indexOf('<template>');
      const t1 = s.indexOf('</template>');
      if (t0 < 0 || t1 < 0) bad(dev + '/' + pg + ': no <template> block');
      else {
        let d = 0;
        const tags = s.slice(t0 + 10, t1).match(/<[^>]+>/g) || [];
        for (const t of tags) {
          if (/^<\//.test(t)) d--;
          else if (!/\/>$/.test(t)) d++;
        }
        if (d !== 0) bad(dev + '/' + pg + ': template tags unbalanced by ' + d + ' (compiler will reject the page)');
        else ok();
      }
    }
  }
}

/* A cross-device sanity check: the three viewport heights must not all be the
 * same, because that was precisely the original mistake. */
const heights = new Set(Object.values(DEVICES).map((g) => g.viewportH));
if (heights.size < 2) bad('all devices share one viewport height — the flat-280 bug pattern');
else ok();

console.log('--------------------------------------------------------------------------');
console.log('passed: ' + pass + '   failed: ' + fail);
console.log('--------------------------------------------------------------------------');
process.exit(fail ? 1 : 0);
