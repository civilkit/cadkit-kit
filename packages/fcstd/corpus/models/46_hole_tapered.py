# Tapered hole (Tapered=True, angle 80 deg between wall and top face) and a deeper one at 85 deg.
# 30 x 30 x 15 block, diameter 6, depth 10: the cone narrows downwards; FreeCAD's volume is the reference.
from _helpers import *

def one(doc, tag, **kw):
    bd = body(doc, "Body" + tag)
    base = pad_box(doc, bd, 30, 30, 15, name="Base" + tag)
    doc.recompute()
    sk = bd.newObject("Sketcher::SketchObject", "Sketch" + tag)
    attach(sk, base, find_face(base, V(0, 0, 1), 15))
    circle(sk, 15, 15, 3)
    return feat(bd, "PartDesign::Hole", "Hole" + tag, Profile=sk, Diameter=6, **kw)

def build(doc):
    one(doc, "Taper", DepthType="Dimension", Depth=10, Tapered=True, TaperedAngle=80, DrillPoint="Flat")
    one(doc, "TaperDeep", DepthType="Dimension", Depth=14, Tapered=True, TaperedAngle=85, DrillPoint="Flat")

def variant(doc):
    doc.HoleTaper.TaperedAngle = 76
    return "HoleTaper.TaperedAngle 80 -> 76"
