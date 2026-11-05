# Hole with counterbore, countersink and counterdrill in a 30 x 30 x 15 block. Hole diameter 6 depth 10, block 13500, flat drill point.
#  Counterbore: diameter 12 depth 3 -> extra removal pi*(36-9)*3 = 254.469 on top of pi*9*10 = 282.743.
#  Countersink: diameter 12 at 90 deg: cone from r=6 to r=3, height 3 (value from FreeCAD).
#  Counterdrill (1.0+): diameter 12 depth 3 with its own drill point angle.
from _helpers import *

def one(doc, tag, **kw):
    bd = body(doc, "Body" + tag)
    base = pad_box(doc, bd, 30, 30, 15, name="Base" + tag)
    doc.recompute()
    sk = bd.newObject("Sketcher::SketchObject", "Sketch" + tag)
    attach(sk, base, find_face(base, V(0, 0, 1), 15))
    circle(sk, 15, 15, 3)
    return feat(bd, "PartDesign::Hole", "Hole" + tag, Profile=sk, Diameter=6, DepthType="Dimension", Depth=10, DrillPoint="Flat", **kw)

def build(doc):
    one(doc, "Bore", HoleCutType="Counterbore", HoleCutDiameter=12, HoleCutDepth=3)
    one(doc, "Sink", HoleCutType="Countersink", HoleCutDiameter=12, HoleCutCountersinkAngle=90)
    one(doc, "Drill", HoleCutType="Counterdrill", HoleCutDiameter=12, HoleCutDepth=3, HoleCutCountersinkAngle=90)

def variant(doc):
    doc.HoleBore.HoleCutDiameter = 16
    doc.HoleBore.HoleCutDepth = 5
    return "HoleBore cut diameter 12 -> 16, depth 3 -> 5"
