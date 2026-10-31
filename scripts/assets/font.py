"""Font helpers for the README assets.

  python font.py paths <font.ttf> <text>     JSON: SVG path data per glyph and total advance, in font units
  python font.py subset <font.ttf> <out.woff2>  printable-ASCII subset as WOFF2

Needs `pip install fonttools brotli`. Only used to regenerate docs/assets.
"""
import json
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont


def paths(font_path: str, text: str) -> None:
    font = TTFont(font_path)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    x = 0
    out = []
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(glyph_set)
        # Flip the y axis and shift by the running advance so paths can be used as-is.
        glyph_set[name].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        out.append(pen.getCommands())
        x += glyph_set[name].width
    head = font["head"]
    os2 = font["OS/2"]
    print(json.dumps({"d": " ".join(out), "advance": x, "unitsPerEm": head.unitsPerEm, "capHeight": os2.sCapHeight, "xHeight": os2.sxHeight}))


def subset(font_path: str, out_path: str) -> None:
    options = Options()
    options.flavor = "woff2"
    options.layout_features = ["kern", "liga", "calt"]
    font = TTFont(font_path)
    subsetter = Subsetter(options)
    subsetter.populate(text="".join(chr(c) for c in range(0x20, 0x7F)))
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(out_path)


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    {"paths": paths, "subset": subset}[command](*args)
