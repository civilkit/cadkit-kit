# Spreadsheet-driven model: sheet "Params" with aliases width, height, depth, hole. The sketch constraints are bound with
# expressions (Constraints.Width = Params.width ...), the Pad length with Params.depth and the hole sketch radius = Params.hole / 2.
# Expected (20, 30, 10, hole 6): block 6000 minus a through-hole pocket of pi*9*10 = 282.743 -> 5717.257.
from _helpers import *

def build(doc):
    sh = doc.addObject("Spreadsheet::Sheet", "Params")
    for row, (alias, val) in enumerate((("width", "20 mm"), ("height", "30 mm"), ("depth", "10 mm"), ("hole", "6 mm")), start=1):
        sh.set("A%d" % row, alias)
        sh.set("B%d" % row, val)
        sh.setAlias("B%d" % row, alias)
    doc.recompute()
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    rect_origin(sk, 20, 30)
    sk.setExpression("Constraints.Width", "Params.width")
    sk.setExpression("Constraints.Height", "Params.height")
    pad = feat(bd, "PartDesign::Pad", "Pad", Profile=sk)
    pad.setExpression("Length", "Params.depth")
    doc.recompute()
    hs = bd.newObject("Sketcher::SketchObject", "HoleSketch")
    attach(hs, pad, find_face(pad, V(0, 0, 1), 10))
    circle(hs, 10, 15, 3, "R")
    hs.setExpression("Constraints.R", "Params.hole / 2")
    feat(bd, "PartDesign::Pocket", "Pocket", Profile=hs, Type="ThroughAll")

def variant(doc):
    doc.Params.set("B1", "40 mm")
    doc.Params.set("B3", "15 mm")
    doc.Params.set("B4", "10 mm")
    return "width 20 -> 40, depth 10 -> 15, hole 6 -> 10: 40*30*15 - pi*25*15 = 16821.7"
