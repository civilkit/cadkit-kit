# PartDesign::Boolean: three main blocks 20 x 20 x 20, each with its own tool body (cylinder R6 x 30 at (10,10)).
#  Cut: 8000 - pi*36*20 = 5738.053. Fuse and Common variants live in their own main bodies sharing the tool.
#  Fuse: 8000 + pi*36*10 (the 10 mm of the cylinder above the block) = 9130.973; Common: pi*36*20 = 2261.947.
from _helpers import *

def main(doc, tag, typ, tool):
    bd = body(doc, "Main" + tag)
    pad_box(doc, bd, 20, 20, 20, name="Block" + tag)
    doc.recompute()
    b = bd.newObject("PartDesign::Boolean", "Bool" + tag)
    b.Group = [tool]
    b.Type = typ

def tool(doc, tag):
    tb = body(doc, "BodyTool" + tag)
    sk = sketch(doc, tb, "ToolSketch" + tag)
    circle(sk, 10, 10, 6, "R")
    feat(tb, "PartDesign::Pad", "ToolPad" + tag, Profile=sk, Length=30)
    return tb

def build(doc):
    for t in ("Cut", "Fuse", "Common"):
        tb = tool(doc, t)
        doc.recompute()
        main(doc, t, t, tb)

def variant(doc):
    doc.ToolSketchCut.setDatum("R", App.Units.Quantity("8 mm"))
    return "ToolSketchCut R 6 -> 8 (cut = 8000 - pi*64*20 = 3978.76)"
