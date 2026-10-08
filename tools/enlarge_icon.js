#!/usr/bin/env node
/*
 * enlarge_icon.js — rebuild the launcher icon so the artwork fills the canvas,
 * matching the reference app (malay-dict) whose icon is a 99/100 full bleed.
 *
 * WHY
 * ---
 * The shipped icon is a white disc + black knight that only occupies 120 of
 * the 192 px canvas (62.5%), so it renders visibly smaller than every other
 * app in the launcher.  The reference project fills ~99%.  This tool re-crops
 * the artwork and scales it up to a configurable fill ratio.
 *
 * SOURCE OF TRUTH
 * ---------------
 * `src/common/icon.png` holds the artwork at its native size (bbox 140x140).
 * The per-device copies are the same artwork, but already shrunk to 120x120
 * by tools/fix_icon_padding.py, so they carry less detail.  We therefore
 * resample from the NATIVE master into every destination — one consistent
 * result and the least resampling loss.  (Verified: normalised alpha profiles
 * of master vs device copies differ by <8/255, i.e. same artwork.)
 *
 * ALPHA CORRECTNESS — the part that is easy to get wrong
 * -----------------------------------------------------
 * In this artwork every fully-transparent pixel is (0,0,0,0).  Interpolating
 * straight RGBA would therefore blend that black into the antialiased rim and
 * leave a dark halo around the disc.  So we
 *
 *     premultiply  ->  resample  ->  unpremultiply
 *
 * which is the only way to scale this class of image correctly.
 *
 * Usage
 *   node tools/enlarge_icon.js                 # fill 190/192 (99%), write all
 *   node tools/enlarge_icon.js --fill 190
 *   node tools/enlarge_icon.js --dry-run       # report, change nothing
 *   node tools/enlarge_icon.js --from <png>    # override the master
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CANVAS = 192;

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const FILL = parseFloat(argOf('--fill', '190'));
const DRY = argv.includes('--dry-run');
const FROM = argOf('--from', null);
const OUT = argOf('--out', null);      /* write to a preview dir instead of the project */

/* pngjs lives inside a device project's node_modules. */
function loadPNG() {
  const candidates = [
    path.join(ROOT, 'devices/xiaomi-band-10/source/chinese/node_modules/pngjs'),
    path.join(ROOT, 'devices/xiaomi-band-9/source/chinese/node_modules/pngjs'),
    path.join(ROOT, 'node_modules/pngjs'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return require(c);
  }
  throw new Error('pngjs not found; run npm install inside a device project first');
}
const { PNG } = loadPNG();

/* ---------------------------------------------------------------- imaging */
function loadRGBA(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  return { w: png.width, h: png.height, data: png.data };
}

function contentBox(im, threshold = 16) {
  let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) {
    for (let x = 0; x < im.w; x++) {
      if (im.data[((im.w * y + x) << 2) + 3] > threshold) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* Catmull-Rom kernel (a = -0.5), used for both up- and down-scaling. */
function catmullRom(t) {
  const a = -0.5;
  const at = Math.abs(t);
  if (at < 1) return (a + 2) * at * at * at - (a + 3) * at * at + 1;
  if (at < 2) return a * at * at * at - 5 * a * at * at + 8 * a * at - 4 * a;
  return 0;
}

/* Sample one premultiplied channel with bicubic; coords are in pixel space. */
function sampleBicubic(premul, w, h, c, sx, sy) {
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  let acc = 0, wsum = 0;
  for (let j = -1; j <= 2; j++) {
    const yy = Math.min(h - 1, Math.max(0, y0 + j));
    const wy = catmullRom(sy - (y0 + j));
    if (wy === 0) continue;
    for (let i = -1; i <= 2; i++) {
      const xx = Math.min(w - 1, Math.max(0, x0 + i));
      const wx = catmullRom(sx - (x0 + i));
      const wgt = wx * wy;
      if (wgt === 0) continue;
      acc += premul[(w * yy + xx) * 4 + c] * wgt;
      wsum += wgt;
    }
  }
  if (wsum === 0) return 0;
  return acc / wsum;
}

/* premultiplied float plane, for correct alpha handling */
function toPremul(im) {
  const out = new Float32Array(im.w * im.h * 4);
  for (let i = 0, n = im.w * im.h; i < n; i++) {
    const a = im.data[i * 4 + 3] / 255;
    out[i * 4 + 0] = im.data[i * 4 + 0] * a;
    out[i * 4 + 1] = im.data[i * 4 + 1] * a;
    out[i * 4 + 2] = im.data[i * 4 + 2] * a;
    out[i * 4 + 3] = im.data[i * 4 + 3];
  }
  return out;
}

/* Build a CANVAS x CANVAS icon whose artwork fills `fill` px, centred. */
function buildIcon(im, fill) {
  const box = contentBox(im);
  if (!box) throw new Error('source icon has no opaque content');
  const premul = toPremul(im);
  const canvas = Buffer.alloc(CANVAS * CANVAS * 4, 0);   // fully transparent
  const off = Math.round((CANVAS - fill) / 2);

  for (let oy = 0; oy < fill; oy++) {
    const dy = off + oy;
    if (dy < 0 || dy >= CANVAS) continue;
    for (let ox = 0; ox < fill; ox++) {
      const dx = off + ox;
      if (dx < 0 || dx >= CANVAS) continue;
      /* map output pixel centre into source pixel space */
      const sx = box.x0 + ((ox + 0.5) * box.w) / fill - 0.5;
      const sy = box.y0 + ((oy + 0.5) * box.h) / fill - 0.5;

      const r = sampleBicubic(premul, im.w, im.h, 0, sx, sy);
      const g = sampleBicubic(premul, im.w, im.h, 1, sx, sy);
      const b = sampleBicubic(premul, im.w, im.h, 2, sx, sy);
      let a = sampleBicubic(premul, im.w, im.h, 3, sx, sy);

      a = Math.max(0, Math.min(255, Math.round(a)));
      let R = 0, G = 0, B = 0;
      if (a > 0) {
        const af = a / 255;
        R = Math.max(0, Math.min(255, Math.round(r / af)));
        G = Math.max(0, Math.min(255, Math.round(g / af)));
        B = Math.max(0, Math.min(255, Math.round(b / af)));
      }
      const o = (CANVAS * dy + dx) << 2;
      canvas[o] = R; canvas[o + 1] = G; canvas[o + 2] = B; canvas[o + 3] = a;
    }
  }
  return { data: canvas, box, off };
}

function writePNG(file, buf) {
  const png = new PNG({ width: CANVAS, height: CANVAS });
  buf.copy(png.data);
  fs.writeFileSync(file, PNG.sync.write(png, { colorType: 6 }));
}

function stats(buf) {
  let minx = CANVAS, miny = CANVAS, maxx = -1, maxy = -1, semi = 0, opaque = 0;
  for (let y = 0; y < CANVAS; y++) {
    for (let x = 0; x < CANVAS; x++) {
      const a = buf[((CANVAS * y + x) << 2) + 3];
      if (a > 16) {
        if (x < minx) minx = x; if (y < miny) miny = y;
        if (x > maxx) maxx = x; if (y > maxy) maxy = y;
      }
      if (a > 0 && a < 255) semi++;
      if (a === 255) opaque++;
    }
  }
  return { bbox: [minx, miny, maxx, maxy], w: maxx - minx + 1, h: maxy - miny + 1, semi, opaque };
}

/* ------------------------------------------------------------------- main */
const MASTER = FROM || path.join(ROOT, 'src/common/icon.png');
if (!fs.existsSync(MASTER)) { console.error('master not found: ' + MASTER); process.exit(1); }

const master = loadRGBA(MASTER);
const mbox = contentBox(master);
console.log(`master : ${MASTER}`);
console.log(`         ${master.w}x${master.h}  content bbox ${mbox.w}x${mbox.h} (fill ${(100 * mbox.w / master.w).toFixed(1)}%)`);
console.log(`target : ${CANVAS}x${CANVAS}, artwork ${FILL}px (fill ${(100 * FILL / CANVAS).toFixed(1)}%), centred offset ${Math.round((CANVAS - FILL) / 2)}`);
console.log(`alpha  : premultiplied bicubic (Catmull-Rom)`);
console.log('');

const built = buildIcon(master, FILL);
const st = stats(built.data);
console.log(`result : content bbox ${st.w}x${st.h} at (${st.bbox[0]},${st.bbox[1]})  fill ${(100 * st.w / CANVAS).toFixed(1)}%`);
console.log(`         semi-transparent px ${st.semi}   fully opaque px ${st.opaque}`);
console.log('');

const targets = OUT
  ? [path.join(OUT, 'icon-preview.png')]
  : [
      path.join(ROOT, 'src/common/icon.png'),
      ...['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10']
        .map((d) => path.join(ROOT, 'devices', d, 'source/chinese/src/common/icon.png')),
    ];

if (OUT && !fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

for (const t of targets) {
  if (!OUT && !fs.existsSync(t)) { console.log(`  SKIP  ${path.relative(ROOT, t)} (missing)`); continue; }
  const before = fs.existsSync(t) ? fs.statSync(t).size : 0;
  if (DRY) { console.log(`  DRY   ${t}  (${before} B, would rewrite)`); continue; }
  writePNG(t, built.data);
  const after = fs.statSync(t).size;
  console.log(`  WRITE ${OUT ? t : path.relative(ROOT, t)}  ${before} -> ${after} B`);
}
console.log('\nICON ENLARGE ' + (DRY ? 'DRY-RUN' : 'OK'));