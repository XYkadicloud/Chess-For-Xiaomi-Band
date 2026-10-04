#!/usr/bin/env node
/*
 * verify_pieces_in_rpk.js
 * ---------------------------------------------------------------------------
 * 产物级校验：RPK（构建产物）里打包的棋子位图，必须与工程源码
 * devices/<dev>/source/<lang>/src/pieces/*.png 逐个字节一致。
 *
 * 为什么需要这一层：
 *   源码里图片是对的，不代表编译时真把它打进了包。构建工具可能缓存、
 *   可能从别的目录取图、可能根本用了内置占位图。只有解包比对哈希，
 *   才能证明"手环上跑的就是我改的那批图"。
 *
 * 实现：手写 ZIP 读取（EOCD -> 中央目录 -> inflateRawSync），
 *      不依赖任何第三方库，与 verify_release_rpk.js 同一套思路。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const RELEASES = path.join(ROOT, 'releases');

// 设备 -> 源码目录 / 包名前缀。One package per device now: the language is
// chosen at runtime, so the filename no longer carries 中文/英文. The release
// filename embeds the marketing version (Chess_Band9_v1.1.0_release.rpk),
// which changes every release, so we DISCOVER the newest matching package
// instead of hardcoding a version — a hardcoded v1.0.0 silently made this
// checker report "rpk not found" after the version bump.
const TARGETS = [
  { dev: 'xiaomi-band-9',      lang: 'chinese', prefix: 'Chess_Band9_v' },
  { dev: 'xiaomi-band-9-pro',  lang: 'chinese', prefix: 'Chess_Band9Pro_v' },
  { dev: 'xiaomi-band-10',     lang: 'chinese', prefix: 'Chess_Band10_v' },
];

/** Pick the newest `releases/<prefix>*_release.rpk`, or null. */
function findRpk(prefix) {
  if (!fs.existsSync(RELEASES)) return null;
  const hits = fs.readdirSync(RELEASES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('_release.rpk'))
    .sort((a, b) => {
      // sort by the numeric version triple, then by name for stability
      const v = (s) => (s.match(/v(\d+)\.(\d+)\.(\d+)/) || [0, 0, 0, 0]).slice(1).map(Number);
      const va = v(a), vb = v(b);
      return (vb[0] - va[0]) || (vb[1] - va[1]) || (vb[2] - va[2]) || a.localeCompare(b);
    });
  return hits.length ? path.join(RELEASES, hits[0]) : null;
}

// 每套工程应有 12 枚棋子
const PIECES = ['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP'];

function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }

/* ------------------------- 最小 ZIP 读取器 ------------------------- */
function readZip(buf) {
  // 定位 EOCD (0x06054b50)，从尾部往前找
  let eocd = -1;
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD not found (not a zip?)');
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  const entries = {};
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central dir sig at ' + off);
    const method   = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen  = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen   = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);

    // 局部头：跳过它自己的 name/extra
    const lNameLen  = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(dataStart, dataStart + compSize);

    let content;
    if (method === 0) content = raw;
    else if (method === 8) content = zlib.inflateRawSync(raw);
    else throw new Error('unsupported method ' + method + ' for ' + name);

    entries[name] = content;
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return entries;
}

/* ------------------------------ 主流程 ------------------------------ */
let fail = 0, totalChecked = 0;

for (const t of TARGETS) {
  const rpkPath = findRpk(t.prefix);
  const srcDir = path.join(ROOT, 'devices', t.dev, 'source', t.lang, 'src', 'common', 'pieces');

  if (!rpkPath) { console.log('MISS  ' + t.dev + '/' + t.lang + '  (no ' + t.prefix + '*_release.rpk in releases/)'); fail++; continue; }
  if (!fs.existsSync(srcDir))  { console.log('MISS  ' + t.dev + '/' + t.lang + '  (src pieces dir not found)'); fail++; continue; }

  const zip = readZip(fs.readFileSync(rpkPath));

  // 找到包内 pieces 目录（可能在不同前缀下，做一次模糊定位）
  const inZip = {};
  for (const name of Object.keys(zip)) {
    const m = name.match(/(?:^|\/)pieces\/([wb][KQRBNP])\.png$/);
    if (m) inZip[m[1]] = zip[name];
  }

  const zipNames = Object.keys(inZip);
  const problems = [];

  if (zipNames.length !== 12) {
    problems.push('zip contains ' + zipNames.length + ' piece png (expected 12)');
  }

  for (const p of PIECES) {
    const srcFile = path.join(srcDir, p + '.png');
    if (!fs.existsSync(srcFile)) { problems.push(p + '.png missing in source'); continue; }
    if (!inZip[p]) { problems.push(p + '.png missing inside rpk'); continue; }

    const srcMd5 = md5(fs.readFileSync(srcFile));
    const zipMd5 = md5(inZip[p]);
    totalChecked++;
    if (srcMd5 !== zipMd5) {
      problems.push(p + '.png MISMATCH  src=' + srcMd5.slice(0, 8) + ' rpk=' + zipMd5.slice(0, 8));
    }
  }

  if (problems.length) {
    console.log('FAIL  ' + t.dev + '/' + t.lang);
    for (const p of problems) console.log('        ' + p);
    fail++;
  } else {
    console.log('OK    ' + t.dev + '/' + t.lang + '  (12/12 piece png byte-identical to source)');
  }
}

console.log('---');
if (fail) {
  console.log('PIECES-IN-RPK FAILED (' + fail + ' package(s) bad)');
  process.exit(1);
}
console.log('PIECES-IN-RPK OK (' + totalChecked + ' png compared across 6 packages)');
