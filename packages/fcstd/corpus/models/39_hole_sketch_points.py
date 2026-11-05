# Hole with a sketch of construction-free points and mixed circles: 3 points + 1 circle give 4 holes (the circle's centre and
# each point). Hole diameter 5 depth 6 flat; 40 x 40 x 10 block (16000): 4 * pi*6.25*6 = 471.239 -> 15528.761.
from _helpers import *

def build(doc):
    bd = body(doc)
    base = pad_box(doc, bd, 40, 40, 10, name="Pad")
    doc.recompute()
    sk = bd.newObject("Sketcher::SketchObject", "HoleSketch")
    attach(sk, base, find_face(base, V(0, 0, 1), 10))
    for (x, y) in ((8, 8), (32, 8), (8, 32)):
        sk.addGeometry(Part.Point(V(x, y, 0)), False)
    circle(sk, 32, 32, 2)
    feat(bd, "PartDesign::Hole", "Hole", Profile=sk, Diameter=5, DepthType="Dimension", Depth=6, DrillPoint="Flat")

def variant(doc):
    doc.Hole.Depth = 12
    doc.Hole.Diameter = 6
    return "Hole.Depth 6 -> 12, Diameter 5 -> 6 (4 * pi*9*10 limited by the 10 mm block)"
