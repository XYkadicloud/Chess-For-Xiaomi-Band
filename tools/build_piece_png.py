#!/usr/bin/env python3
"""
build_piece_png.py — rasterise the LICHESS "cburnett" chess piece SVGs into the
64x64 RGBA PNG sprites the Vela app ships.

Why this exists
---------------
Vela on the Xiaomi band cannot render SVG in an <image>, so pieces must be
bitmaps. The earlier revision used the CC0 "meridian" set, which is decorative
and does NOT look like the pieces people expect from lichess/chess.com. This
version uses lichess's own default set.

Source
------
lichess-org/lila, public/piece/cburnett  (the lichess default)
Author: Colin M.L. Burnett
License: GPLv2+  (see tools/_icons/lichess/LICENSE)
Files are kept locally in tools/_icons/lichess/*.svg

Rendering approach
------------------
svglib (pure Python) parses the SVG and already lowers elliptical arcs (`a`
commands) into cubic Beziers, so we never need to implement arc maths. Each
visual shape arrives as a PAIR of reportlab leaves:
    NoStrokePath(points, fill=...)   -> the filled body
    Path(points, stroke=...)         -> the outline (fill=None)
which is exactly what we need to paint body and outline in different colours.

Coordinate handling
-------------------
The drawing root carries no transform; its single Group carries
    (0.75, 0, 0, -0.75, 0, 33.75)
i.e. a uniform 0.75 scale plus a Y flip (SVG y-down -> reportlab y-up). We
apply the full affine matrix ourselves so both scale and flip are honoured.
Stroke width must be scaled by the same factor.

Palette
-------
cburnett encodes colour in the SVG itself, and it does NOT use the
"white body + dark rim / black body + light rim" scheme I first assumed.
Reading the real files (verified by dumping every leaf's fill/stroke):

  white pieces : fill #FFFFFF, contour stroke #000000
  black pieces : fill #000000, contour stroke #000000  <- the rim is BLACK too
                 plus a few detail strokes in #ECECEC (band lines, knight mane)

So black pieces are solid black throughout; what makes them readable is the
LIGHT INNER DETAIL, not a light outer rim. Painting a light rim on them (which
the previous revision did) produces a fat pale halo and a hollow-looking piece.

We therefore key the remap off the SVG's own colour, not the piece's colour:

  fill  #FFFFFF / #000000        -> the body colour for that piece
  stroke #000000 (contour)       -> w: near-black (17,17,17)
                                    b: near-black (26,26,26), i.e. unchanged
  stroke #ECECEC (inner detail)  -> kept light on black pieces; darkened on
                                    white pieces so it stays visible there

Both end up legible on the light (#B8B8B8) and dark (#3A3A3A) squares.

Usage
-----
    python tools/build_piece_png.py [--size 64] [--out <dir>] [--set lichess|meridian]
"""
import argparse
import math
import os
import sys

from PIL import Image, ImageDraw
from reportlab.graphics.shapes import _PATH_OP_ARG_COUNT  # (2, 2, 6, 0)
from svglib.svglib import svg2rlg

HERE = os.path.dirname(os.path.abspath(__file__))

PIECES = ["wK", "wQ", "wR", "wB", "wN", "wP",
          "bK", "bQ", "bR", "bB", "bN", "bP"]

# Palettes. The body colour is chosen by the piece's own colour; the STROKE
# colour is chosen by what the SVG's stroke actually IS (see module docstring).
PALETTE = {
    "w": {"body": (255, 255, 255, 255)},
    "b": {"body": (26, 26, 26, 255)},
}

# A stroke is treated as "inner detail" (rather than contour) when the SVG
# paints it noticeably lighter than black. #ECECEC = 0.925.
DETAIL_LUM = 0.5
# Stroke colours we emit for each role, per piece colour.
STROKE = {
    "w": {"contour": (17, 17, 17, 255), "detail": (17, 17, 17, 255)},
    "b": {"contour": (26, 26, 26, 255), "detail": (236, 236, 236, 255)},
}

SS = 4          # supersampling factor
CURVE_STEPS = 24  # subdivisions per cubic Bezier
MIN_STROKE_SS = 2


def iter_leaves(node, out=None):
    """Depth-first walk, collecting drawable leaves."""
    if out is None:
        out = []
    contents = getattr(node, "contents", None)
    if not contents:
        out.append(node)
        return out
    for child in contents:
        iter_leaves(child, out)
    return out


def mul(a, b):
    """Compose two reportlab-style affine matrices (a after b)."""
    a0, a1, a2, a3, a4, a5 = a
    b0, b1, b2, b3, b4, b5 = b
    return (a0 * b0 + a2 * b1,
            a1 * b0 + a3 * b1,
            a0 * b2 + a2 * b3,
            a1 * b2 + a3 * b3,
            a0 * b4 + a2 * b5 + a4,
            a1 * b4 + a3 * b5 + a5)


def collect_transform(node, parent=(1, 0, 0, 1, 0, 0)):
    """Return (leaf, composed_transform) for every drawable leaf.

    svglib emits reportlab (y-UP) coordinates, so its group transform carries a
    Y flip: (s, 0, 0, -s, 0, H). PIL's raster Y axis grows DOWNWARD, exactly like
    SVG's, so that flip has to be undone or every piece comes out mirrored
    vertically. We cancel it here by negating the flip in each composed matrix,
    which also keeps stroke orientation consistent.
    """
    t = getattr(node, "transform", None)
    if t:
        a, b, c, d, e, f = t
        # reportlab stores the flip as a negative y scale; remove it (and the
        # compensating translation) so the result is in SVG's y-down space.
        if d < 0:
            d = -d
            f = 0.0
        cur = mul(parent, (a, b, c, d, e, f))
    else:
        cur = parent
    contents = getattr(node, "contents", None)
    if not contents:
        return [(node, cur)]
    out = []
    for child in contents:
        out.extend(collect_transform(child, cur))
    return out


def apply_pt(m, x, y):
    a0, a1, a2, a3, a4, a5 = m
    return (a0 * x + a2 * y + a4, a1 * x + a3 * y + a5)


def flatten(path, m):
    """Turn a reportlab Path into subpaths of device-space (x, y) points."""
    pts = path.points
    ops = path.operators
    subpaths = []
    cur = []
    i = 0
    x = y = 0.0
    start = (0.0, 0.0)

    for op in ops:
        n = _PATH_OP_ARG_COUNT[op]
        if op == 0:            # moveTo
            if len(cur) > 1:
                subpaths.append(cur)
            x, y = pts[i], pts[i + 1]
            start = (x, y)
            cur = [apply_pt(m, x, y)]
        elif op == 1:          # lineTo
            x, y = pts[i], pts[i + 1]
            cur.append(apply_pt(m, x, y))
        elif op == 2:          # curveTo
            c1x, c1y, c2x, c2y, ex, ey = pts[i:i + 6]
            for s in range(1, CURVE_STEPS + 1):
                t = s / CURVE_STEPS
                mt = 1 - t
                bx = (mt ** 3) * x + 3 * (mt ** 2) * t * c1x + 3 * mt * (t ** 2) * c2x + (t ** 3) * ex
                by = (mt ** 3) * y + 3 * (mt ** 2) * t * c1y + 3 * mt * (t ** 2) * c2y + (t ** 3) * ey
                cur.append(apply_pt(m, bx, by))
            x, y = ex, ey
        elif op == 3:          # closePath
            if len(cur) > 1:
                subpaths.append(cur)
            cur = [apply_pt(m, start[0], start[1])]
        i += n

    if len(cur) > 1:
        subpaths.append(cur)
    return subpaths


def rgba(color, opacity):
    if color is None:
        return None
    r = int(round(color.red * 255))
    g = int(round(color.green * 255))
    b = int(round(color.blue * 255))
    a = int(round((opacity if opacity is not None else 1.0) * 255))
    return (r, g, b, a)


def scale_of(m):
    """Uniform scale factor implied by the matrix (magnitude of the x basis)."""
    return math.hypot(m[0], m[1]) or 1.0


def render(svg_path, out_path, size, colour):
    drawing = svg2rlg(svg_path)
    if drawing is None:
        raise RuntimeError("svglib could not parse " + svg_path)
    palette = PALETTE[colour]

    shapes = []   # (subpaths, fill_rgba|None, is_detail|None, stroke_w_px)
    for leaf, m in collect_transform(drawing):
        cls = type(leaf).__name__
        if cls not in ("Path", "NoStrokePath"):
            continue
        subs = flatten(leaf, m)
        if not subs:
            continue
        fill = rgba(getattr(leaf, "fillColor", None), getattr(leaf, "fillOpacity", None))
        line = rgba(getattr(leaf, "strokeColor", None), getattr(leaf, "strokeOpacity", None))
        sw = getattr(leaf, "strokeWidth", None) or 0
        # Classify the stroke by the SVG's own colour: anything clearly lighter
        # than black is "inner detail" and must stay light on black pieces.
        is_detail = None
        if line is not None:
            is_detail = (0.299 * line[0] + 0.587 * line[1] + 0.114 * line[2]) / 255.0 > DETAIL_LUM
        shapes.append((subs, fill, is_detail, sw * scale_of(m)))

    if not shapes:
        raise RuntimeError("no drawable geometry in " + svg_path)

    # Map the SVG's own user space onto the sprite. Do NOT fit the geometry
    # bounds: cburnett pieces are drawn inside a 45-unit viewBox but their ink
    # only spans ~24 units (deliberate padding). Fitting the ink would inflate
    # the scale by ~2.6x and, with it, the 1.5-unit outline — turning every
    # piece into a chunky blob with a heavy black border.
    #
    # svglib bakes the viewBox scale into the group transform (45 -> 33.75), so
    # the coordinate space we receive is already scaled; drawing.width/height
    # reports exactly that box.
    box = drawing.width or 45.0
    vx = vy = 0.0
    vw = vh = box

    # A little optical enlargement: cburnett's padding is generous, so shrink
    # the box slightly about its centre so the piece fills more of the square
    # (important on a ~24dp board square). Stroke scales with it.
    ZOOM = 1.14
    cxc, cyc = vx + vw / 2.0, vy + vh / 2.0
    vw /= ZOOM
    vh /= ZOOM
    vx = cxc - vw / 2.0
    vy = cyc - vh / 2.0

    work = size * SS
    k = work / max(vw, vh)
    offx = (work - vw * k) / 2.0 - vx * k
    offy = (work - vh * k) / 2.0 - vy * k

    img = Image.new("RGBA", (work, work), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    def tx(p):
        x, y = p
        return (x * k + offx, y * k + offy)

    for subs, fill, is_detail, sw in shapes:
        closed = [sp for sp in subs if len(sp) >= 3]
        # Body first (so the outline sits on top). Both #FFF and #000 fills
        # resolve to the same piece body colour: cburnett paints the shape and
        # then draws the contour, so we only need "there is a fill" as a signal.
        if fill is not None and fill[3] > 0 and closed:
            for sp in closed:
                draw.polygon([tx(p) for p in sp], fill=palette["body"])
        # Stroke: contour vs inner detail.
        if is_detail is not None:
            stroke = STROKE[colour]["detail" if is_detail else "contour"]
            width = max(MIN_STROKE_SS, sw * k)
            for sp in subs:
                pts = [tx(p) for p in sp]
                if len(pts) < 2:
                    continue
                draw.line(pts, fill=stroke, width=int(round(width)), joint="curve")

    img = img.resize((size, size), Image.LANCZOS)
    img.save(out_path, "PNG", optimize=True)
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=64)
    ap.add_argument("--out", default=None)
    ap.add_argument("--set", dest="set_name", default="lichess",
                    choices=["lichess", "meridian"])
    args = ap.parse_args()

    src_dir = os.path.join(HERE, "_icons", args.set_name)
    if not os.path.isdir(src_dir):
        sys.exit("missing SVG source dir: " + src_dir)

    out_dir = args.out or os.path.join(HERE, "_pieces_out")
    os.makedirs(out_dir, exist_ok=True)

    for name in PIECES:
        src = os.path.join(src_dir, name.lower() + ".svg")
        if not os.path.isfile(src):
            sys.exit("missing source svg: " + src)
        colour = name[0]
        dst = os.path.join(out_dir, name + ".png")
        render(src, dst, args.size, colour)
        print("  %-4s -> %s  (%d bytes)" % (name, os.path.basename(dst), os.path.getsize(dst)))

    print("\n%d piece sprites (%s) written to %s" % (len(PIECES), args.set_name, out_dir))


if __name__ == "__main__":
    main()
