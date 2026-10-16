#!/usr/bin/env python3
"""Packs BRAWLPIT's character portraits into one small atlas for the web build.

The native client loads eight 1024x1024 PNGs (BRAWLPIT/apps/lobby/assets/sprites/, ~7 MB). The web
page draws a fighter about 100 px tall, so each portrait is downscaled to a 128x128 tile and the
eight tiles are packed 4 across x 2 down into BRAWLPIT/sprites.png. Tile i is character id i + 2
(characters 0 and 1, Petalia and Vexar, have no portrait in the native client either and keep their
flat-colour bodies). The page's host code (generated from PARENA, bp_host.prn) decodes the atlas with
the browser's own PNG decoder and copies the tiles into the wasm module's sprite memory.

    python3 scripts/build-brawlpit-sprites.py [path/to/BRAWLPIT/apps/lobby/assets/sprites]
"""
import os
import sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "BRAWLPIT", "apps", "lobby", "assets", "sprites")
ORDER = ["understudy", "rosie", "sunlit_draw", "sequel_duck", "medusa", "raccoon", "second_tree", "uncrowned"]
TILE = 128
atlas = Image.new("RGBA", (TILE * 4, TILE * 2), (0, 0, 0, 0))
for i, name in enumerate(ORDER):
    im = Image.open(os.path.join(SRC, name + ".png")).convert("RGBA").resize((TILE, TILE), Image.LANCZOS)
    atlas.paste(im, ((i % 4) * TILE, (i // 4) * TILE))
out = os.path.join(os.path.dirname(__file__), "..", "BRAWLPIT", "sprites.png")
atlas.save(out, optimize=True)
print("wrote", os.path.normpath(out), os.path.getsize(out), "bytes")
