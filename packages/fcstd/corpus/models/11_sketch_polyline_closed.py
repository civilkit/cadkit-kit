# Sketch: closed L-shaped polyline of 6 lines (coincident chain, horizontal/vertical, named dimensions), padded 5.
# Expected: area 30*20 - 15*10 = 450, Pad volume 2250.
from _helpers import *

def build(doc):
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    pts = [(0, 0), (30, 0), (30, 10), (15, 10), (15, 20), (0, 20)]
    i = polygon(sk, pts)
    for k in (0, 2, 4):
        sk.addConstraint(Sketcher.Constraint("Horizontal", i + k))
    for k in (1, 3, 5):
        sk.addConstraint(Sketcher.Constraint("Vertical", i + k))
    sk.addConstraint(Sketcher.Constraint("Coincident", i, 1, -1, 1))
    named(sk, Sketcher.Constraint("DistanceX", i, 1, i, 2, 30), "Wide")
    named(sk, Sketcher.Constraint("DistanceY", i + 1, 1, i + 1, 2, 10), "Step")
    named(sk, Sketcher.Constraint("DistanceX", i + 4, 2, i + 4, 1, 15), "Arm")
    named(sk, Sketcher.Constraint("DistanceY", i + 5, 2, i + 5, 1, 20), "High")
    feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=5)

def variant(doc):
    doc.Sketch.setDatum("Wide", App.Units.Quantity("40 mm"))
    return "Wide 30 -> 40: area 40*20-25*10 = 550"
