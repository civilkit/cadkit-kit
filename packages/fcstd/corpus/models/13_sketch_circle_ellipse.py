# Sketch: outer circle R20 with an elliptical hole (major 10, minor 6) and a small circular hole R3, padded 5.
# Covers Circle, Ellipse geometry (axis, major radius), Radius, Diameter, point-on-object, DistanceX.
# Expected: area pi*400 - pi*10*6 - pi*9 = 331*pi = 1039.867, volume 5199.336
from _helpers import *

def build(doc):
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    c = circle(sk, 0, 0, 20, "Outer", at_origin=True)
    e = Part.Ellipse()
    e.Center = V(-5, 0, 0)
    e.MajorRadius = 10
    e.MinorRadius = 6
    ie = sk.addGeometry(e, False)
    sk.addConstraint(Sketcher.Constraint("PointOnObject", ie, 3, -1))
    named(sk, Sketcher.Constraint("DistanceX", ie, 3, -1, 1, 5), "EllipseOffset")
    h = sk.addGeometry(Part.Circle(V(12, 0, 0), V(0, 0, 1), 3), False)
    named(sk, Sketcher.Constraint("Diameter", h, 6), "HoleDia")
    sk.addConstraint(Sketcher.Constraint("PointOnObject", h, 3, -1))
    sk.addConstraint(Sketcher.Constraint("DistanceX", -1, 1, h, 3, 12))
    feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=5)

def variant(doc):
    doc.Sketch.setDatum("HoleDia", App.Units.Quantity("8 mm"))
    return "HoleDia 6 -> 8: area 400pi - 60pi - 16pi"
