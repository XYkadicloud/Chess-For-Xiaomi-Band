#!/usr/bin/env node
/*
 * dump_rpk_pieces.js — 把 RPK 包内的棋子 PNG 实体导出到磁盘，
 * 用于人工肉眼查看（哈希之外的第二重证据）。
 *
 * 用法: node tools/dump_rpk_pieces.js <rpk> <outDir>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [rpkPath, outDir] = process.argv.slice(2);
if (!rpkPath || !outDir) {
  console.error('usage: node tools/dump_rpk_pieces.js <rpk> <outDir>');
  process.exit(2);
}

const buf = fs.readFileSync(rpkPath);
let eocd = -1;
for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) throw new Error('no EOCD');

const count = buf.readUInt16LE(eocd + 10);
let p = buf.readUInt32LE(eocd + 16);

fs.mkdirSync(outDir, { recursive: true });
let dumped = 0;

for (let n = 0; n < count; n++) {
  const method = buf.readUInt16LE(p + 10);
  const compSize = buf.readUInt32LE(p + 20);
  const nameLen = buf.readUInt16LE(p + 28);
  const extraLen = buf.readUInt16LE(p + 30);
  const cmtLen = buf.readUInt16LE(p + 32);
  const localOff = buf.readUInt32LE(p + 42);
  const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

  const lNameLen = buf.readUInt16LE(localOff + 26);
  const lExtraLen = buf.readUInt16LE(localOff + 28);
  const dataStart = localOff + 30 + lNameLen + lExtraLen;
  const raw = buf.slice(dataStart, dataStart + compSize);

  const m = name.match(/pieces\/([wb][KQRBNP])\.png$/);
  if (m) {
    const content = method === 0 ? raw : zlib.inflateRawSync(raw);
    fs.writeFileSync(path.join(outDir, m[1] + '.png'), content);
    dumped++;
  }
  p += 46 + nameLen + extraLen + cmtLen;
}
console.log('dumped ' + dumped + ' piece png to ' + outDir);
