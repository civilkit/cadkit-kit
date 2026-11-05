# Sketch with four independent figures exercising many constraint types, padded 5.
#  fig 1 skewed rectangle: Perpendicular, Parallel, Distance (line length), Angle, Coincident
#  fig 2 circle: Diameter, DistanceX, DistanceY
#  fig 3 isosceles triangle: Symmetric about a construction line, PointOnObject, DistanceY, Vertical
#  fig 4 two circles: Equal radius, Radius; construction line with Block
# Expected: areas 200 + 16pi + 150 + 2*25pi = 350 + 66pi = 557.3451, volume 2786.7257.
from _helpers import *

def build(doc):
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    # fig 1
    a = sk.GeometryCount
    for (p, q) in [((0, 0), (20, 1)), ((20, 1), (19, 11)), ((19, 11), (-1, 10)), ((-1, 10), (0, 0))]:
        sk.addGeometry(Part.LineSegment(V(p[0], p[1], 0), V(q[0], q[1], 0)), False)
    for k in range(4):
        sk.addConstraint(Sketcher.Constraint("Coincident", a + k, 2, a + (k + 1) % 4, 1))
    sk.addConstraint(Sketcher.Constraint("Coincident", a, 1, -1, 1))
    sk.addConstraint(Sketcher.Constraint("Perpendicular", a, a + 1))
    sk.addConstraint(Sketcher.Constraint("Parallel", a, a + 2))
    sk.addConstraint(Sketcher.Constraint("Parallel", a + 1, a + 3))
    named(sk, Sketcher.Constraint("Distance", a, 20), "Len")
    named(sk, Sketcher.Constraint("Distance", a + 1, 10), "Hgt")
    named(sk, Sketcher.Constraint("Angle", a, 0.0), "Tilt")
    # fig 2
    c = sk.addGeometry(Part.Circle(V(40, 5, 0), V(0, 0, 1), 4), False)
    named(sk, Sketcher.Constraint("Diameter", c, 8), "Dia")
    sk.addConstraint(Sketcher.Constraint("DistanceX", -1, 1, c, 3, 40))
    sk.addConstraint(Sketcher.Constraint("DistanceY", -1, 1, c, 3, 5))
    # fig 3
    t = sk.GeometryCount
    sk.addGeometry(Part.LineSegment(V(60, 0, 0), V(80, 0, 0)), False)
    sk.addGeometry(Part.LineSegment(V(80, 0, 0), V(70, 15, 0)), False)
    sk.addGeometry(Part.LineSegment(V(70, 15, 0), V(60, 0, 0)), False)
    ax = sk.addGeometry(Part.LineSegment(V(70, -5, 0), V(70, 20, 0)), True)
    sk.addConstraint(Sketcher.Constraint("Coincident", t, 2, t + 1, 1))
    sk.addConstraint(Sketcher.Constraint("Coincident", t + 1, 2, t + 2, 1))
    sk.addConstraint(Sketcher.Constraint("Coincident", t + 2, 2, t, 1))
    sk.addConstraint(Sketcher.Constraint("Vertical", ax))
    sk.addConstraint(Sketcher.Constraint("DistanceX", -1, 1, ax, 1, 70))
    sk.addConstraint(Sketcher.Constraint("PointOnObject", t, 1, -1))
    sk.addConstraint(Sketcher.Constraint("Symmetric", t, 1, t, 2, ax))
    sk.addConstraint(Sketcher.Constraint("PointOnObject", t + 1, 2, ax))
    named(sk, Sketcher.Constraint("DistanceY", t, 1, t + 1, 2, 15), "Apex")
    named(sk, Sketcher.Constraint("Distance", t, 20), "Base")
    # fig 4
    u = sk.addGeometry(Part.Circle(V(100, 5, 0), V(0, 0, 1), 5), False)
    w = sk.addGeometry(Part.Circle(V(120, 5, 0), V(0, 0, 1), 5), False)
    sk.addConstraint(Sketcher.Constraint("Equal", u, w))
    named(sk, Sketcher.Constraint("Radius", u, 5), "R4")
    sk.addConstraint(Sketcher.Constraint("DistanceX", -1, 1, u, 3, 100))
    sk.addConstraint(Sketcher.Constraint("DistanceY", -1, 1, u, 3, 5))
    sk.addConstraint(Sketcher.Constraint("DistanceX", u, 3, w, 3, 20))
    sk.addConstraint(Sketcher.Constraint("Horizontal", u, 3, w, 3))
    b = sk.addGeometry(Part.LineSegment(V(100, -10, 0), V(120, -10, 0)), True)
    sk.addConstraint(Sketcher.Constraint("Block", b))
    feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=5)

def variant(doc):
    doc.Sketch.setDatum("Dia", App.Units.Quantity("12 mm"))
    doc.Sketch.setDatum("Len", App.Units.Quantity("30 mm"))
    return "Dia 8 -> 12, Len 20 -> 30 (rectangle area 300)"
