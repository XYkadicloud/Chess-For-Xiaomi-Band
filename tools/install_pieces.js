#!/usr/bin/env node
/**
 * install_pieces.js — copy the freshly rasterised piece sprites into every
 * device/language tree, and drop the now-useless .svg files (Vela cannot
 * render SVG in an <image>, so shipping them just bloats the RPK).
 *
 * Source of truth: tools/_pieces_out/*.png (built by tools/build_piece_png.py
 * from the lichess "cburnett" set in tools/_icons/lichess; that is the set
 * lichess itself ships as its default, GPLv2+).
 *
 * Idempotent: re-running over already-installed trees is a no-op copy.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(__dirname, '_pieces_out');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const LANGS = ['chinese'];
const NAMES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];

if (!fs.existsSync(SRC)) {
  console.error('missing sprite dir: ' + SRC + '\nrun: python tools/build_piece_png.py');
  process.exit(1);
}

// Sanity: every expected sprite must exist and be a valid PNG before we touch
// any tree, so a half-built set can never be installed.
const problems = [];
for (const n of NAMES) {
  const f = path.join(SRC, n + '.png');
  if (!fs.existsSync(f)) { problems.push('missing sprite ' + n + '.png'); continue; }
  const b = fs.readFileSync(f);
  const sig = b.slice(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') { problems.push(n + '.png is not a PNG'); continue; }
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  if (w !== 64 || h !== 64) problems.push(n + '.png is ' + w + 'x' + h + ' (expected 64x64)');
  const colorType = b[25];
  if (colorType !== 6) problems.push(n + '.png colorType=' + colorType + ' (expected 6 = RGBA)');
}
if (problems.length) {
  console.error('sprite set is not usable:\n  ' + problems.join('\n  '));
  process.exit(1);
}

let installed = 0, removed = 0;
for (const d of DEVICES) {
  for (const l of LANGS) {
    const dir = path.join(ROOT, 'devices', d, 'source', l, 'src', 'common', 'pieces');
    if (!fs.existsSync(dir)) { console.log('  SKIP ' + d + '/' + l); continue; }
    for (const n of NAMES) {
      fs.copyFileSync(path.join(SRC, n + '.png'), path.join(dir, n + '.png'));
      installed++;
    }
    // Remove the unused SVGs so they do not ship inside the RPK.
    for (const f of fs.readdirSync(dir)) {
      if (f.toLowerCase().endsWith('.svg')) { fs.unlinkSync(path.join(dir, f)); removed++; }
    }
    console.log('  OK   ' + d + '/' + l);
  }
}
console.log('\n' + installed + ' sprites installed, ' + removed + ' unused .svg removed');
