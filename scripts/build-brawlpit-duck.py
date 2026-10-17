#!/usr/bin/env python3
"""Cuts scripts/brawlpit-duck-sheet.jpg (the BRAWLPIT sprite-assets sheet) into BRAWLPIT/duck.png.

Every fighter uses the same duck animation set (same moves), so the page needs one atlas of 33 frames,
8 columns x 5 rows of 80x68 cells. Each frame is keyed off its grey panel by flood fill from the panel
edge (so the shotgun's grey barrel survives), halved by nearest-neighbour, bottom-aligned, and anchored
so the duck's body sits at cell x = 40 in every frame. The wasm engine (bp_view.prn) picks frames and
recolours the tuxedo and beak per fighter; it knows the frame numbers below -- keep FRAMES in step with
`duck-frame-*` in bp_view.prn.

    python3 scripts/build-brawlpit-duck.py
"""
import os
from collections import deque
from PIL import Image

HERE = os.path.dirname(__file__)
CELL_W, CELL_H, COLS = 80, 68, 8
M = 6  # panel border to trim, source px

def row(y0, y1, xs):
    return [(a, y0, b, y1) for a, b in xs]

FOUR = [(14, 126), (135, 248), (260, 374), (385, 497)]
# (name, boxes) in atlas order -- frame index = running count
FRAMES = [
    ("walk", row(110, 226, FOUR)),                                                   # 0-3
    ("idle", row(413, 529, FOUR)),                                                   # 4-7
    ("jab", row(110, 226, [(576, 697), (704, 826)])),                                # 8-9
    ("dash", row(238, 353, [(576, 697), (704, 843), (852, 972), (980, 1092)])),      # 10-13
    ("kick", row(390, 521, [(576, 697), (704, 843), (852, 972), (980, 1092)])),      # 14-17
    ("jump", row(590, 734, [(14, 126), (135, 250), (260, 374), (385, 497)])),        # 18-21
    ("hurt", row(590, 734, [(549, 690), (698, 840)])),                               # 22-23
    ("gun", row(800, 921, [(14, 126), (135, 248), (260, 374), (385, 529), (542, 660)])),  # 24-28
]

def is_bg(p):
    r, g, b = p
    return abs(r - g) < 14 and abs(g - b) < 14 and 95 < (r + g + b) // 3 < 160

def cut(sheet, box):
    x0, y0, x1, y1 = box
    # drop the panel border (a few px of dark frame, uneven from box to box)
    x0 += M; y0 += M; x1 -= M; y1 -= M
    w, h = x1 - x0, y1 - y0
    px = sheet.load()
    keep = [[True] * w for _ in range(h)]
    seen = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y][x]:
            continue
        seen[y][x] = True
        if not is_bg(px[x0 + x, y0 + y]):
            continue
        keep[y][x] = False
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    po = out.load()
    for y in range(h):
        for x in range(w):
            if keep[y][x]:
                r, g, b = px[x0 + x, y0 + y]
                po[x, y] = (r, g, b, 255)
    return out

def main():
    sheet = Image.open(os.path.join(HERE, "brawlpit-duck-sheet.jpg")).convert("RGB")
    atlas = Image.new("RGBA", (CELL_W * COLS, CELL_H * 5), (0, 0, 0, 0))
    n = 0
    for _name, boxes in FRAMES:
        for box in boxes:
            fr = cut(sheet, box)
            fr = fr.resize((fr.width // 2, fr.height // 2), Image.NEAREST)
            # body anchor: the standard panel is 112 wide, its centre (56 px) lands on cell x 40
            ax = 40 - (56 - M) // 2
            ox = ax
            oy = CELL_H - fr.height - M // 2 + 1
            atlas.alpha_composite(fr, ((n % COLS) * CELL_W + ox, (n // COLS) * CELL_H + oy))
            n += 1
    out = os.path.join(HERE, "..", "BRAWLPIT", "duck.png")
    atlas.save(out, optimize=True)
    print("wrote", os.path.normpath(out), n, "frames", os.path.getsize(out), "bytes")

main()
