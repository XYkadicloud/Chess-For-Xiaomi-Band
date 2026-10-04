#!/usr/bin/env node
/**
 * fix_porting.js — correct the per-device layout constants in the ports.
 *
 * Band 9 (192dp) is the ORIGINAL; the 9 Pro (336dp) and Band 10 (212dp) builds
 * were first-pass ports that copied Band 9's magic numbers. This tool rewrites
 * every device-specific constant so each build is geometrically correct for its
 * own designWidth.
 *
 * Fixes applied:
 *   1. centerOn(): the horizontal centre must be designWidth/2, not 96dp.
 *      Band 10 wrongly used 96 (the Band 9 centre) -> 10dp off-centre.
 *   2. maxBoardLeft()/maxBoardTop(): expressed in terms of designWidth so the
 *      board cannot be scrolled off its own viewport.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEVICES = {
  'xiaomi-band-9': { w: 192, viewH: 280 },
  'xiaomi-band-9-pro': { w: 336, viewH: 280 },
  'xiaomi-band-10': { w: 212, viewH: 280 }
};
const LANGS = ['chinese'];

function fix(file, geo) {
  let src = fs.readFileSync(file, 'utf8');
  const before = src;
  const changes = [];
  const half = geo.w / 2;
  const halfV = geo.viewH / 2;

  /* 1. horizontal centre in centerOn() */
  // match the literal constant used as the centre passed to (col+0.5)
  const centerRe = /(Math\.min\(0,)(\d+(?:\.\d+)?)(-\(col\+0\.5\)\*this\.squareSize\))/;
  const cm = src.match(centerRe);
  if (cm && Number(cm[2]) !== half) {
    src = src.replace(centerRe, '$1' + half + '$3');
    changes.push('center ' + cm[2] + '->' + half);
  }

  /* 2. vertical centre in centerOn() */
  const vRe = /(Math\.min\(0,)(\d+(?:\.\d+)?)(-\(row\+0\.5\)\*this\.squareSize\))/;
  const vm = src.match(vRe);
  if (vm && Number(vm[2]) !== halfV) {
    src = src.replace(vRe, '$1' + halfV + '$3');
    changes.push('centerV ' + vm[2] + '->' + halfV);
  }

  /* 3. maxBoardLeft(): make it designWidth-relative */
  const mblRe = /maxBoardLeft\(\)\{return [^}]*\}/;
  const wantLeft = geo.w <= 240
    ? 'maxBoardLeft(){return Math.min(0,' + geo.w + '-this.boardSize);}'
    : 'maxBoardLeft(){return Math.max(0,Math.floor((' + geo.w + '-this.boardSize)/2));}';
  if (mblRe.test(src) && !src.includes(wantLeft)) {
    src = src.replace(mblRe, wantLeft);
    changes.push('maxBoardLeft');
  }

  /* 4. maxBoardTop(): make it viewport-relative */
  const mbtRe = /maxBoardTop\(\)\{return [^}]*\}/;
  const wantTop = 'maxBoardTop(){return Math.min(0,' + geo.viewH + '-this.boardSize);}';
  if (mbtRe.test(src) && !src.includes(wantTop)) {
    src = src.replace(mbtRe, wantTop);
    changes.push('maxBoardTop');
  }

  if (src !== before) fs.writeFileSync(file, src, 'utf8');
  return changes;
}

let n = 0;
for (const d of Object.keys(DEVICES)) {
  for (const l of LANGS) {
    const f = path.join(ROOT, 'devices', d, 'source', l, 'src', 'pages', 'game', 'game.ux');
    if (!fs.existsSync(f)) continue;
    const ch = fix(f, DEVICES[d]);
    if (ch.length) { n += ch.length; console.log('  OK   ' + d + '/' + l + '  [' + ch.join(', ') + ']'); }
  }
}
console.log('\ndone, ' + n + ' porting fixes applied');
