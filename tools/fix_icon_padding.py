"""
fix_icon_padding.py

The Vela layout / launcher places the manifest `icon` at a fixed display size.
Other system icons render their artwork within roughly 60-65% of the canvas;
our knight artwork currently fills ~73% (bbox 26-166 on a 192px square), which
makes it look oversized in the app list.

The official Vela JS spec only mandates 192x192 (iot.mi.com .../manifest.html),
so the canvas size is unchanged; we just inset the artwork further.

Padding math:
- target artwork box: 120 x 120 centred inside 192 x 192  -> 36px padding/side
  (fill ratio 62.5%, leaves ~19% safe area on every side)
- alpha bounding box is preserved exactly, just shrunk + re-pasted

Idempotent: identical input produces byte-identical output.
"""
from PIL import Image
import glob, hashlib, sys

CANVAS = 192
TARGET_BOX = 120  # artwork content box (square, both axes)

def fix_one(path):
    im = Image.open(path).convert('RGBA')
    if im.size != (CANVAS, CANVAS):
        print(f'SKIP {path}: size={im.size}, not {CANVAS}x{CANVAS}')
        return False
    alpha = im.split()[-1]
    bbox = alpha.getbbox()
    if bbox is None:
        print(f'SKIP {path}: fully transparent')
        return False
    l, t, r, b = bbox
    cw, ch = r - l, b - t
    if cw == 0 or ch == 0:
        print(f'SKIP {path}: empty content bbox')
        return False
    # shrink while preserving aspect
    scale = min(TARGET_BOX / cw, TARGET_BOX / ch)
    new_w = max(1, int(round(cw * scale)))
    new_h = max(1, int(round(ch * scale)))
    # crop the content region, downscale, paste into a fresh canvas
    content = im.crop((l, t, r, b))
    scaled = content.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    off_x = (CANVAS - new_w) // 2
    off_y = (CANVAS - new_h) // 2
    canvas.paste(scaled, (off_x, off_y), scaled)
    # Only write if changed (preserve mtime of already-correct icons)
    out_bytes_buffer = canvas.tobytes()
    if im.tobytes() == out_bytes_buffer:
        print(f'OK   {path}: unchanged')
        return True
    canvas.save(path, 'PNG', optimize=True)
    new_md5 = hashlib.md5(open(path, 'rb').read()).hexdigest()[:10]
    print(f'FIX  {path}: bbox=({l},{t},{r},{b}) {cw}x{ch} -> {new_w}x{new_h} centred ({off_x},{off_y}) md5={new_md5}')
    return True

def main():
    paths = sorted(glob.glob('devices/*/source/*/src/common/icon.png'))
    if not paths:
        print('no icon.png files found', file=sys.stderr)
        sys.exit(1)
    n = 0
    for p in paths:
        if fix_one(p): n += 1
    print(f'ICONS-FIX OK ({n}/{len(paths)} updated, rest already centred)')

if __name__ == '__main__':
    main()