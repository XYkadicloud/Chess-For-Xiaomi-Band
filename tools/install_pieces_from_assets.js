#!/usr/bin/env node
/*
 * install_pieces_from_assets.js
 * ---------------------------------------------------------------------------
 * 用外部素材包（pieces-assets-1.0.zip 里的 12 张 512×512 RGBA cburnett PNG）
 * 替换所有 6 套工程的 src/common/pieces/*.png。
 *
 * 为什么需要这一步：之前用的 SVGLib + Pillow 光栅化路径虽然产物 OK，
 * 但用户在更高保真度时倾向于直接用上游 PNG。这里直接消费上游位图。
 *
 * 流程：
 *   1. 读 _pieces_src/<base>.png（PNG 文件名约定见 MAP）；
 *   2. 用 alpha bbox 自动裁去空白边，使棋子居中并占满最大可用画布；
 *   3. 等比缩放到目标尺寸（默认 128，长边大于等于 largest squareSize*2）；
 *   4. 写入 devices/<d>/source/<l>/src/common/pieces/<key>.png。
 *
 * 字节级幂等：每次输出 md5 必须稳定。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, '_pieces_src');
const TARGET = 128;

// cburnett alpha bbox：素材源 PNG 大小 512，主体大约在 ~40-475 范围内，
// 缩到 128 时还要保留 4px 安全边距 —— 直接用 bbox 然后居中到目标画布。
const MAP = {
  wK: 'king_w.png',   wQ: 'queen_w.png', wR: 'rook_w.png',
  wB: 'bishop_w.png', wN: 'knight_w.png', wP: 'pawn_w.png',
  bK: 'king_b.png',   bQ: 'queen_b.png', bR: 'rook_b.png',
  bB: 'bishop_b.png', bN: 'knight_b.png', bP: 'pawn_b.png',
};

const TREES = [];
for (const dev of ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10']) {
  for (const lang of ['chinese']) {
    TREES.push({ dev, lang });
  }
}

const PY = process.env.PIECES_PY || 'C:/Users/HP/.workbuddy-ai/binaries/python/envs/pieces/Scripts/python.exe';

if (!fs.existsSync(SRC_DIR)) {
  console.error('missing ' + SRC_DIR + ' — extract the assets zip first');
  process.exit(2);
}

const script = `
import sys, os, glob
from PIL import Image
SRC = r'${SRC_DIR.replace(/\\/g, '/')}'
TARGET = ${TARGET}
MAP = ${JSON.stringify(MAP)}
def install(out_path, src_name):
    src_path = os.path.join(SRC, src_name)
    im = Image.open(src_path).convert('RGBA')
    # 1) 按 alpha 裁去空白边
    bbox = im.split()[3].getbbox()
    if bbox:
        # 保留 2px 安全边
        pad = 4
        l = max(0, bbox[0] - pad); t = max(0, bbox[1] - pad)
        r = min(im.size[0], bbox[2] + pad); b = min(im.size[1], bbox[3] + pad)
        im = im.crop((l, t, r, b))
    # 2) 等比缩到不超过 TARGET
    w, h = im.size
    s = min(TARGET / w, TARGET / h, 1.0)
    nw = max(1, int(round(w * s))); nh = max(1, int(round(h * s)))
    im = im.resize((nw, nh), Image.LANCZOS)
    # 3) 居中到 TARGET×TARGET 透明画布
    canvas = Image.new('RGBA', (TARGET, TARGET), (0, 0, 0, 0))
    ox = (TARGET - nw) // 2; oy = (TARGET - nh) // 2
    canvas.paste(im, (ox, oy), im)
    canvas.save(out_path, 'PNG', optimize=True)
for k, v in MAP.items():
    print(k, '<-', v)
`;

let summary = '';
const problems = [];

for (const t of TREES) {
  const outDir = path.join(ROOT, 'devices', t.dev, 'source', t.lang, 'src', 'common', 'pieces');
  if (!fs.existsSync(outDir)) { problems.push(t.dev + '/' + t.lang + ' (no pieces dir)'); continue; }

  const tmpDir = path.join(ROOT, '_pieces_tmp_' + t.dev + '_' + t.lang);
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const [key, file] of Object.entries(MAP)) {
    const out = path.join(tmpDir, key + '.png');
    const code = `
from PIL import Image
import os
SRC = r'${SRC_DIR.replace(/\\/g, '/')}'
TARGET = ${TARGET}
src_name = '${file}'
src_path = os.path.join(SRC, src_name)
im = Image.open(src_path).convert('RGBA')
# Scale the WHOLE canvas down. Do NOT crop to the alpha bbox: cropping throws
# away the artist's margins, which made every piece fill ~98% of the image and
# look oversized / edge-to-edge inside a square. Keeping the original framing
# preserves the intended proportions (king ~86%, pawn ~61% of the canvas).
w, h = im.size
s = min(TARGET / w, TARGET / h, 1.0)
nw = max(1, int(round(w * s))); nh = max(1, int(round(h * s)))
im = im.resize((nw, nh), Image.LANCZOS)
canvas = Image.new('RGBA', (TARGET, TARGET), (0, 0, 0, 0))
ox = (TARGET - nw) // 2; oy = (TARGET - nh) // 2
canvas.paste(im, (ox, oy), im)
canvas.save(r'${out.replace(/\\/g, '/')}', 'PNG', optimize=True)
`;
    try {
      execFileSync(PY, ['-c', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      problems.push(t.dev + '/' + t.lang + ' ' + key + ': ' + e.message.split('\n')[0]);
    }
  }

  // 用 md5 比对，对就 mv（保证幂等），不一样的覆盖
  let moved = 0;
  for (const key of Object.keys(MAP)) {
    const src = path.join(tmpDir, key + '.png');
    const dst = path.join(outDir, key + '.png');
    fs.copyFileSync(src, dst);
    moved++;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('OK    ' + t.dev + '/' + t.lang + '  (' + moved + ' pieces from assets)');
}

console.log('---');
if (problems.length) {
  console.log('INSTALL-PIECES FAILED:');
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('INSTALL-PIECES OK (' + TREES.length + ' trees x 12 pieces from pieces-assets-1.0)');