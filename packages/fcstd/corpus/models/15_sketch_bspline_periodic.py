# Sketch: periodic (closed) B-spline through 5 points, padded 2. Covers periodic BSplineCurve.
# Expected: no closed form; FreeCAD's numbers are the reference (area roughly that of a 20 mm blob).
from _helpers import *

def build(doc):
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    bs = Part.BSplineCurve()
    bs.interpolate([V(10, 0, 0), V(3, 9, 0), V(-8, 6, 0), V(-9, -6, 0), V(4, -9, 0)], PeriodicFlag=True)
    sk.addGeometry(bs, False)
    feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=2)
