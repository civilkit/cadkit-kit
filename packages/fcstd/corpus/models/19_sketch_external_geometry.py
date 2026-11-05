# Sketch with external geometry: a sketch on the top face of a 20 x 30 x 10 block links the top edge along x
# (external geometry index -3) and puts a circle R3 centred on it (PointOnObject to the external edge), padded 5.
# Covers ExternalGeometry links, constraints referencing negative geometry ids, sketch on a face.
# Expected: block 6000 + the boss pi*9*5 = 141.372 (the circle centre sits on the block's edge, so half of it overhangs).
from _helpers import *

def build(doc):
    bd = body(doc)
    base = pad_box(doc, bd, 20, 30, 10)
    doc.recompute()
    top = find_face(base, V(0, 0, 1), 10)
    edge = edges_where(base, lambda e: all(abs(v.Point.z - 10) < 1e-9 and abs(v.Point.y) < 1e-9 for v in e.Vertexes))[0]
    sk = bd.newObject("Sketcher::SketchObject", "BossSketch")
    attach(sk, base, top)
    sk.addExternal(base.Name, edge)
    c = circle(sk, 10, 0, 3, "R")
    sk.addConstraint(Sketcher.Constraint("PointOnObject", c, 3, -3))
    named(sk, Sketcher.Constraint("DistanceX", -1, 1, c, 3, 10), "CentreX")
    feat(bd, "PartDesign::Pad", "Boss", Profile=sk, Length=5)

def variant(doc):
    doc.BossSketch.setDatum("CentreX", App.Units.Quantity("14 mm"))
    return "CentreX 10 -> 14"
