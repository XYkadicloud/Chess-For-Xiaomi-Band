#!/usr/bin/env node
/**
 * verify_pieces.js — assert that every tree ships a complete, usable set of
 * bitmap piece sprites, and that game.ux points at them.
 *
 * The band cannot render SVG, so a missing or broken PNG is not a cosmetic
 * problem: the piece simply does not appear, and the board becomes unreadable.
 * That failure is silent on the device, hence this static guard.
 *
 * Checks per tree:
 *   1. all 12 sprites exist
 *   2. each is a real PNG, >= 64x64, RGBA
 *   3. each actually contains visible pixels (a blank sprite is useless)
 *   4. white pieces are white-dominant, black pieces dark-dominant
 *      (this is what makes both colours legible on light and dark squares)
 *   5. game.ux references /common/pieces/<name>.png
 *   6. no leftover .svg sprites in the source tree
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const LANGS = ['chinese', 'english'];
const WHITE = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP'];
const BLACK = ['bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
const ALL = WHITE.concat(BLACK);

let problems = 0;
function bad(msg) { problems++; console.log('FAIL ' + msg); }

/** Minimal PNG reader: verify signature/IHDR and decode raw RGBA pixels. */
function readPng(file) {
  const buf = fs.readFileSync(file);
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const bitDepth = buf[24], colorType = buf[25];
  // Gather IDAT
  let i = 8, idat = [], seenIHDR = false;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.slice(i + 4, i + 8).toString('ascii');
    const data = buf.slice(i + 8, i + 8 + len);
    if (type === 'IHDR') seenIHDR = true;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (!seenIHDR || !idat.length) return null;
  return { w, h, bitDepth, colorType, raw: zlib.inflateSync(Buffer.concat(idat)) };
}

/** Unfilter a single scanline (PNG filter types 0..4). */
function unfilter(raw, w, h) {
  const bpp = 4;                 // RGBA, bitDepth 8
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = raw.slice(pos, pos + stride); pos += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return out;
}

for (const d of DEVICES) {
  for (const l of LANGS) {
    const dir = path.join(ROOT, 'devices', d, 'source', l, 'src', 'common', 'pieces');
    const game = path.join(ROOT, 'devices', d, 'source', l, 'src', 'pages', 'game', 'game.ux');
    const tag = d + '/' + l;
    if (!fs.existsSync(dir)) { bad(tag + ' missing pieces dir'); continue; }

    // 6. stale SVGs
    for (const f of fs.readdirSync(dir)) {
      if (f.toLowerCase().endsWith('.svg')) bad(tag + ' leftover svg sprite: ' + f);
    }

    const stats = {};
    for (const n of ALL) {
      const f = path.join(dir, n + '.png');
      if (!fs.existsSync(f)) { bad(tag + ' missing ' + n + '.png'); continue; }
      const png = readPng(f);
      if (!png) { bad(tag + ' ' + n + '.png is not a decodable PNG'); continue; }
      if (png.w < 64 || png.h < 64) bad(tag + ' ' + n + '.png is ' + png.w + 'x' + png.h + ' (want >=64)');
      if (png.colorType !== 6) bad(tag + ' ' + n + '.png colorType ' + png.colorType + ' (want 6=RGBA)');

      const px = unfilter(png.raw, png.w, png.h);
      let opaque = 0, light = 0, dark = 0;
      for (let i2 = 0; i2 < px.length; i2 += 4) {
        const r = px[i2], g = px[i2 + 1], b = px[i2 + 2], a = px[i2 + 3];
        if (a < 40) continue;
        opaque++;
        if (r > 200 && g > 200 && b > 200) light++;
        else if (r < 80 && g < 80 && b < 80) dark++;
      }
      if (opaque < 100) bad(tag + ' ' + n + '.png is effectively blank (' + opaque + ' opaque px)');
      stats[n] = { light, dark };
    }

    // 4. contrast sanity per colour
    for (const [set, name, key] of [[WHITE, 'white', 'light'], [BLACK, 'black', 'dark']]) {
      for (const n of set) {
        const s = stats[n];
        if (!s) continue;
        const other = key === 'light' ? 'dark' : 'light';
        if (s[key] <= s[other]) {
          bad(tag + ' ' + n + ' is not ' + name + '-dominant (light=' + s.light + ' dark=' + s.dark + ')');
        }
      }
    }

    // 5. game.ux wiring
    if (fs.existsSync(game)) {
      const src = fs.readFileSync(game, 'utf8');
      if (!src.includes("'/common/pieces/'")) bad(tag + ' game.ux does not reference /common/pieces/');
      if (!src.includes("+'.png'")) bad(tag + ' game.ux piece path is not a .png');
      if (/\/common\/pieces\/'\+p\+'\.svg/.test(src)) bad(tag + ' game.ux still points at .svg');
    } else {
      bad(tag + ' missing game.ux');
    }

    if (problems === 0) console.log('OK   ' + tag);
  }
}

console.log('\n' + (problems === 0
  ? 'PIECE SPRITES OK (6 trees x 12 pieces)'
  : problems + ' PIECE PROBLEM(S)'));
process.exit(problems === 0 ? 0 : 1);
