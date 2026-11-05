# Sketch: non-periodic B-spline (interpolated through 4 points) closed by a line, padded 3.
# Covers BSplineCurve (degree, poles, knots, multiplicities) and a Coincident to close the wire.
# Expected: no closed form; FreeCAD's area and volume are the reference.
from _helpers import *

def build(doc):
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    bs = Part.BSplineCurve()
    bs.interpolate([V(0, 0, 0), V(10, 8, 0), V(20, 6, 0), V(30, 0, 0)])
    i = sk.addGeometry(bs, False)
    j = sk.addGeometry(Part.LineSegment(V(30, 0, 0), V(0, 0, 0)), False)
    sk.addConstraint(Sketcher.Constraint("Coincident", i, 2, j, 1))
    sk.addConstraint(Sketcher.Constraint("Coincident", j, 2, i, 1))
    sk.addConstraint(Sketcher.Constraint("Coincident", i, 1, -1, 1))
    sk.addConstraint(Sketcher.Constraint("Horizontal", j))
    feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=3)
