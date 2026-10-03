#!/usr/bin/env python3
"""
build_piece_png.py — rasterise the CC0 "Meridian" chess piece SVGs into the
64x64 RGBA PNG sprites the Vela app ships.

Why this exists
---------------
Vela on the Xiaomi band cannot render SVG in an <image>, so the pieces must be
bitmaps. The PNGs that shipped before were rasterised with a hard-coded
`fill:#ffffff`, which made the white pieces all but disappear on light squares
(white fill + 3px outline only). This script re-renders every piece twice with
an explicit palette:

    white pieces -> white body, near-black outline
    black pieces -> near-black body, light outline

so both colours stay legible on the light (#B8B8B8) and dark (#3A3A3A) squares.

Source
------
kmar/chess_svg_piece_sets (CC0 / public domain), set "meridian".
    https://github.com/kmar/chess_svg_piece_sets

The SVGs are parsed with svglib (pure Python) and painted with Pillow, because
the native cairo backend that cairosvg needs is not available on this machine.

Usage
-----
    python tools/build_piece_png.py [--size 64] [--out <dir>]
"""
import argparse
import math
import os
import sys

from PIL import Image, ImageDraw
from reportlab.graphics.shapes import _PATH_OP_ARG_COUNT  # (2, 2, 6, 0)
from svglib.svglib import svg2rlg

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, "_icons", "meridian")

PIECES = ["wK", "wQ", "wR", "wB", "wN", "wP",
          "bK", "bQ", "bR", "bB", "bN", "bP"]

# Palettes. Keys are the *piece colour*, not the file name.
PALETTE = {
    "w": {"body": (255, 255, 255, 255), "line": (17, 17, 17, 255)},
    "b": {"body": (26, 26, 26, 255),    "line": (240, 240, 240, 255)},
}

SS = 4  # supersampling factor: render big, downscale for clean edges

# The source outlines are 2 units wide on a ~64-unit piece. At full weight the
# queen — a thin, many-stroked piece — ends up reading as a dark blob rather
# than a light piece with dark edges, and the same happens in reverse for the
# black queen. Scaling the stroke back keeps both colours legible.
STROKE_SCALE = 0.62
MIN_STROKE_SS = 2  # never thinner than this many supersampled pixels


def iter_paths(node, out):
    """Depth-first walk of a reportlab drawing, collecting Path leaves."""
    contents = getattr(node, "contents", None)
    if not contents:
        out.append(node)
        return out
    for child in contents:
        iter_paths(child, out)
    return out


def flatten(path):
    """Turn a reportlab Path into a list of subpaths.

    Each subpath is a list of (x, y) points; cubic curves are flattened with
    a fixed subdivision, which is plenty at 4x supersampling.
    """
    pts = path.points
    ops = path.operators
    subpaths = []
    cur = []
    i = 0
    x = y = 0.0
    start = (0.0, 0.0)
    CURVE_STEPS = 24

    for op in ops:
        n = _PATH_OP_ARG_COUNT[op]
        if op == 0:            # moveTo
            if len(cur) > 1:
                subpaths.append(cur)
            x, y = pts[i], pts[i + 1]
            start = (x, y)
            cur = [(x, y)]
        elif op == 1:          # lineTo
            x, y = pts[i], pts[i + 1]
            cur.append((x, y))
        elif op == 2:          # curveTo (c1x c1y c2x c2y x y)
            c1x, c1y, c2x, c2y, ex, ey = pts[i:i + 6]
            for s in range(1, CURVE_STEPS + 1):
                t = s / CURVE_STEPS
                mt = 1 - t
                bx = (mt ** 3) * x + 3 * (mt ** 2) * t * c1x + 3 * mt * (t ** 2) * c2x + (t ** 3) * ex
                by = (mt ** 3) * y + 3 * (mt ** 2) * t * c1y + 3 * mt * (t ** 2) * c2y + (t ** 3) * ey
                cur.append((bx, by))
            x, y = ex, ey
        elif op == 3:          # closePath
            if len(cur) > 1:
                subpaths.append(cur)
            cur = [start]
        i += n

    if len(cur) > 1:
        subpaths.append(cur)
    return subpaths


def stroke_width(path, scale):
    sw = getattr(path, "strokeWidth", None) or 0
    return max(1.0, sw * scale)


def rgba(color, opacity):
    if color is None:
        return None
    r = int(round(color.red * 255))
    g = int(round(color.green * 255))
    b = int(round(color.blue * 255))
    a = int(round((opacity if opacity is not None else 1.0) * 255))
    return (r, g, b, a)


def ellipse_points(el, steps=72):
    """Approximate a reportlab Ellipse as a polygon."""
    cx, cy = el.cx, el.cy
    rx, ry = el.rx, el.ry
    return [((cx + rx * math.cos(2 * math.pi * i / steps)),
             (cy + ry * math.sin(2 * math.pi * i / steps))) for i in range(steps)]


def rect_points(rc):
    x, y, w, h = rc.x, rc.y, rc.width, rc.height
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


def shape_subpaths(node):
    """Return (subpaths, fillColor, strokeColor, strokeWidth, fillOpacity, strokeOpacity)
    for any reportlab shape we know how to draw, or None if unsupported."""
    cls = type(node).__name__
    if cls == "Path":
        return (flatten(node),
                getattr(node, "fillColor", None), getattr(node, "strokeColor", None),
                getattr(node, "strokeWidth", None),
                getattr(node, "fillOpacity", None), getattr(node, "strokeOpacity", None))
    if cls == "Ellipse":
        return ([ellipse_points(node)],
                getattr(node, "fillColor", None), getattr(node, "strokeColor", None),
                getattr(node, "strokeWidth", None),
                getattr(node, "fillOpacity", None), getattr(node, "strokeOpacity", None))
    if cls == "Rect":
        return ([rect_points(node)],
                getattr(node, "fillColor", None), getattr(node, "strokeColor", None),
                getattr(node, "strokeWidth", None),
                getattr(node, "fillOpacity", None), getattr(node, "strokeOpacity", None))
    return None


def bounds_of(shapes):
    """Overall (minx, miny, maxx, maxy) across every subpath point."""
    mnx = mny = float("inf")
    mxx = mxy = float("-inf")
    for subs, *_ in shapes:
        for sp in subs:
            for x, y in sp:
                mnx = min(mnx, x); mxx = max(mxx, x)
                mny = min(mny, y); mxy = max(mxy, y)
    if mnx == float("inf"):
        return None
    return mnx, mny, mxx, mxy


def render(svg_path, out_path, size, palette):
    drawing = svg2rlg(svg_path)
    if drawing is None:
        raise RuntimeError("svglib could not parse " + svg_path)

    # Collect every drawable shape once, together with its paints.
    shapes = []
    for node in iter_paths(drawing, []):
        info = shape_subpaths(node)
        if info and info[0]:
            shapes.append(info)
    if not shapes:
        raise RuntimeError("no drawable geometry in " + svg_path)

    # Fit the *real* geometry bounds into the sprite, leaving a small margin so
    # the outline is never clipped. svglib's reported width/height is wrong for
    # these files (it says 48x48 while the coordinates span 0..64).
    b = bounds_of(shapes)
    mnx, mny, mxx, mxy = b
    gw, gh = (mxx - mnx), (mxy - mny)
    margin = 0.045 * max(gw, gh)
    mnx -= margin; mxx += margin
    mny -= margin; mxy += margin
    gw, gh = (mxx - mnx), (mxy - mny)

    work = size * SS
    k = work / max(gw, gh)          # uniform scale, keep aspect ratio
    offx = (work - gw * k) / 2.0 - mnx * k
    offy = (work - gh * k) / 2.0 - mny * k

    img = Image.new("RGBA", (work, work), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    def tx(x, y):
        # SVG y grows downward, same as PIL, so no flip is needed.
        return (x * k + offx, y * k + offy)

    for subs, fill_col, line_col, sw, fill_op, stroke_op in shapes:
        f = rgba(fill_col, fill_op)
        l = rgba(line_col, stroke_op)
        width = max(MIN_STROKE_SS, (sw or 0) * k * STROKE_SCALE)

        closed = [sp for sp in subs if len(sp) >= 3]
        if f is not None and f[3] > 0 and closed:
            body = palette["body"]
            for sp in closed:
                draw.polygon([tx(x, y) for x, y in sp], fill=body)

        if l is not None and l[3] > 0 and width > 0:
            for sp in subs:
                pts = [tx(x, y) for x, y in sp]
                if len(pts) < 2:
                    continue
                draw.line(pts, fill=palette["line"],
                          width=int(round(width)), joint="curve")

    img = img.resize((size, size), Image.LANCZOS)
    img.save(out_path, "PNG", optimize=True)
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=64)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    if not os.path.isdir(SRC):
        sys.exit("missing SVG source dir: " + SRC)

    out_dir = args.out or os.path.join(HERE, "_pieces_out")
    os.makedirs(out_dir, exist_ok=True)

    for name in PIECES:
        key = name.lower()  # e.g. wK -> wk
        src = os.path.join(SRC, key + ".svg")
        if not os.path.isfile(src):
            sys.exit("missing source svg: " + src)
        palette = PALETTE[name[0]]
        dst = os.path.join(out_dir, name + ".png")
        render(src, dst, args.size, palette)
        print("  %-4s -> %s  (%d bytes)" % (name, os.path.basename(dst), os.path.getsize(dst)))

    print("\n%d piece sprites written to %s" % (len(PIECES), out_dir))


if __name__ == "__main__":
    main()
