# -*- coding: utf-8 -*-
"""
make_piece_sheet.py — 把 _look_pieces/ 里的 12 枚棋子（从 RPK 实体解出来的）
放大拼成一张对照图，放在深浅两种棋盘格背景上，便于肉眼验收。

白棋子要看深格上的轮廓，黑棋子要看浅格上的轮廓 —— 两行分开摆。
"""
import os, sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else '_look_pieces'
OUT = sys.argv[2] if len(sys.argv) > 2 else '_piece_check.png'

ORDER = ['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP']

CELL = 120          # 每枚棋子的格子边长（放大后）
COLS = 6
ROWS = 2
PAD = 16

LIGHT = (240, 217, 181)   # 浅格
DARK  = (181, 136, 99)    # 深格

W = PAD + COLS * CELL + PAD
H = PAD + ROWS * CELL + PAD
sheet = Image.new('RGB', (W, H), (30, 30, 30))

for i, name in enumerate(ORDER):
    r, c = divmod(i, COLS)
    # 交替棋盘格底色：白棋放深格，黑棋放浅格 —— 最能暴露轮廓问题
    if r == 0:   # 白棋 -> 深格背景
        bg = DARK
    else:        # 黑棋 -> 浅格背景
        bg = LIGHT
    if (r + c) % 2 == 0:
        bg = tuple(max(0, v - 18) for v in bg)

    path = os.path.join(SRC, name + '.png')
    tile = Image.new('RGB', (CELL, CELL), bg)

    if os.path.exists(path):
        im = Image.open(path).convert('RGBA')
        # 等比缩放到格子的 84%
        target = int(CELL * 0.84)
        w, h = im.size
        scale = min(target / w, target / h)
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
        ox = (CELL - im.size[0]) // 2
        oy = (CELL - im.size[1]) // 2
        tile.paste(im, (ox, oy), im)
    else:
        print('MISSING ' + name)

    sheet.paste(tile, (PAD + c * CELL, PAD + r * CELL))

sheet.save(OUT)
print('wrote ' + OUT + '  ' + str(sheet.size))
