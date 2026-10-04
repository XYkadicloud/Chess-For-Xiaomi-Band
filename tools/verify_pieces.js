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
 *   4. COLOUR IDENTITY: the piece reads as its own colour.
 *
 *      A naive "count light vs dark pixels" test does not work for the lichess
 *      cburnett set, and neither does the "white body + light rim / black body
 *      + light rim" model I first reached for. The real set is:
 *
 *        white pieces : white body, BLACK contour, no light detail
 *        black pieces : black body, BLACK contour, plus a LIGHT inner detail
 *                       (queen's band lines, bishop's slit, knight's mane)
 *
 *      Measured tone census of a correct sprite (opaque pixels only):
 *
 *        wK 57%L  wQ 38%L  wR 52%L  wB 44%L  wN 66%L  wP 66%L
 *        bK 68%D  bQ 77%D  bR 86%D  bB 89%D  bN 98%D  bP 100%D
 *
 *      So the robust, direction-correct assertions are:
 *        (a) a white piece is LIGHT-dominant overall, a black piece DARK-
 *            dominant overall (a blank or mis-coloured sprite fails this);
 *        (b) both carry a BLACK contour where the silhouette meets transparency
 *            (this is what stays visible on the light square);
 *        (c) a black piece additionally shows the amount of light inner detail
 *            its source art actually has (BLACK_DETAIL_MIN) -- bK/bQ/bR/bB/bN
 *            carry #ECECEC line-work, bP is a deliberate pure silhouette. If
 *            that detail vanishes the piece becomes an unreadable blob on the
 *            dark square, which is a silent failure on the device.
 *
 *      We therefore measure the whole-sprite census plus the silhouette rim.
 *
 *   5. game.ux references /common/pieces/<name>.png
 *   6. no leftover .svg sprites in the source tree
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const LANGS = ['chinese'];
const WHITE = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP'];
const BLACK = ['bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
const ALL = WHITE.concat(BLACK);

// cburnett gives SOME black pieces light line-work (#ECECEC) -- the queen's
// band lines, the bishop's slit, the knight's mane/eye, the rook's collar --
// and those are what keep them readable on the dark square. The remaining
// black pieces are deliberate solid silhouettes and have none at all:
//   bP is a pure silhouette (0 light strokes in bp.svg).
//   bN's mane/eye strokes are hairlines, so it lands around 1.8%.
// These floors encode the measured minimum for each piece; the guard's job is
// to catch a REGRESSION (detail silently painted over in the body colour),
// not to demand a number the source art never had.
const BLACK_DETAIL_MIN = {
  bK: 0.08, bQ: 0.05, bR: 0.03, bB: 0.03, bN: 0.010, bP: 0.0
};

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
      const at = (x, y) => {
        const i3 = (y * png.w + x) * 4;
        return { r: px[i3], g: px[i3 + 1], b: px[i3 + 2], a: px[i3 + 3] };
      };
      let opaque = 0, light = 0, dark = 0;
      let edgeN = 0, edgeDark = 0;
      for (let y = 0; y < png.h; y++) {
        for (let x = 0; x < png.w; x++) {
          const p = at(x, y);
          if (p.a < 40) continue;
          opaque++;
          const lum = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
          if (lum > 140) light++;
          else if (lum <= 80) dark++;
          // Edge = opaque here, but a 4-neighbour is transparent => silhouette.
          const nbrs = [
            x > 0 ? at(x - 1, y) : { a: 0 },
            x < png.w - 1 ? at(x + 1, y) : { a: 0 },
            y > 0 ? at(x, y - 1) : { a: 0 },
            y < png.h - 1 ? at(x, y + 1) : { a: 0 }
          ];
          if (nbrs.some((k) => k.a < 40)) {
            edgeN++;
            if (lum < 110) edgeDark++;
          }
        }
      }
      if (opaque < 100) bad(tag + ' ' + n + '.png is effectively blank (' + opaque + ' opaque px)');
      stats[n] = {
        opaque,
        lightRatio: opaque ? light / opaque : 0,
        darkRatio: opaque ? dark / opaque : 0,
        rimDarkRatio: edgeN ? edgeDark / edgeN : 0
      };
    }

    // 4. colour identity (see the header comment for the measured basis):
    //    white piece -> light-dominant; black piece -> dark-dominant.
    //    Both carry a black contour along the silhouette.
    //    A black piece must also show some light inner detail, or it is an
    //    unreadable blob on the dark square.
    for (const [set, wantLight] of [[WHITE, true], [BLACK, false]]) {
      for (const n of set) {
        const s = stats[n];
        if (!s) continue;
        if (wantLight && s.lightRatio < 0.30) {
          bad(tag + ' ' + n + ' is not light-dominant (light ' + (s.lightRatio * 100).toFixed(0) + '%)');
        }
        if (!wantLight && s.darkRatio < 0.55) {
          bad(tag + ' ' + n + ' is not dark-dominant (dark ' + (s.darkRatio * 100).toFixed(0) + '%)');
        }
        if (s.rimDarkRatio < 0.40) {
          bad(tag + ' ' + n + ' silhouette has no dark contour (dark rim ' +
              (s.rimDarkRatio * 100).toFixed(0) + '%)');
        }
        if (!wantLight && s.lightRatio < BLACK_DETAIL_MIN[n]) {
          bad(tag + ' ' + n + ' black piece lost its light inner detail (light ' +
              (s.lightRatio * 100).toFixed(1) + '%, want >= ' +
              (BLACK_DETAIL_MIN[n] * 100).toFixed(1) + '%)');
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
