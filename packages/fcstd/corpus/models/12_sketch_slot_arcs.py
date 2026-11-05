# Sketch: slot from 2 lines and 2 arcs joined by endpoint tangent constraints, equal radii, radius 5, padded 4.
# Covers ArcOfCircle, Tangent (endpoint to endpoint), Equal, Radius, Horizontal.
# Expected: area 30*10 + pi*25 = 378.5398163, Pad volume 1514.159265.
from _helpers import *

def build(doc):
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    sk.addGeometry(Part.LineSegment(V(0, 5, 0), V(30, 5, 0)), False)                                 # 0 top
    sk.addGeometry(Part.ArcOfCircle(Part.Circle(V(30, 0, 0), V(0, 0, 1), 5), -math.pi / 2, math.pi / 2), False)  # 1 right cap
    sk.addGeometry(Part.LineSegment(V(30, -5, 0), V(0, -5, 0)), False)                               # 2 bottom
    sk.addGeometry(Part.ArcOfCircle(Part.Circle(V(0, 0, 0), V(0, 0, 1), 5), math.pi / 2, 3 * math.pi / 2), False)  # 3 left cap
    sk.addConstraint(Sketcher.Constraint("Tangent", 0, 2, 1, 2))
    sk.addConstraint(Sketcher.Constraint("Tangent", 2, 1, 1, 1))
    sk.addConstraint(Sketcher.Constraint("Tangent", 2, 2, 3, 2))
    sk.addConstraint(Sketcher.Constraint("Tangent", 3, 1, 0, 1))
    sk.addConstraint(Sketcher.Constraint("Horizontal", 0))
    sk.addConstraint(Sketcher.Constraint("Equal", 1, 3))
    sk.addConstraint(Sketcher.Constraint("Coincident", 3, 3, -1, 1))
    named(sk, Sketcher.Constraint("Radius", 3, 5), "CapRadius")
    named(sk, Sketcher.Constraint("DistanceX", 3, 3, 1, 3, 30), "Centres")
    feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=4)

def variant(doc):
    doc.Sketch.setDatum("Centres", App.Units.Quantity("50 mm"))
    doc.Sketch.setDatum("CapRadius", App.Units.Quantity("8 mm"))
    return "Centres 30 -> 50, CapRadius 5 -> 8: area 50*16 + pi*64"
