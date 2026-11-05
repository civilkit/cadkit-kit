# Angle quantities: an Angle sketch constraint driven by a spreadsheet angle (Params.ang = 60 deg), a Distance constraint driven by
# an expression with trigonometry (Params.len * cos(Params.ang)), and a PolarPattern Angle from an expression.
# Triangle: base along X of length 20, apex angle at the origin 60 deg: Constraint 'Tilt' (radians in the sketch, degrees in the sheet).
from _helpers import *

def build(doc):
    sh = doc.addObject("Spreadsheet::Sheet", "Params")
    sh.set("B1", "60 deg"); sh.setAlias("B1", "ang")
    sh.set("B2", "20 mm"); sh.setAlias("B2", "len")
    sh.set("B3", "8"); sh.setAlias("B3", "n")
    doc.recompute()
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    sk.addGeometry(Part.LineSegment(V(0, 0, 0), V(20, 0, 0)), False)       # base
    sk.addGeometry(Part.LineSegment(V(20, 0, 0), V(10, 17, 0)), False)     # right side
    sk.addGeometry(Part.LineSegment(V(10, 17, 0), V(0, 0, 0)), False)      # left side
    sk.addConstraint(Sketcher.Constraint("Coincident", 0, 2, 1, 1))
    sk.addConstraint(Sketcher.Constraint("Coincident", 1, 2, 2, 1))
    sk.addConstraint(Sketcher.Constraint("Coincident", 2, 2, 0, 1))
    sk.addConstraint(Sketcher.Constraint("Coincident", 0, 1, -1, 1))
    sk.addConstraint(Sketcher.Constraint("Horizontal", 0))
    named(sk, Sketcher.Constraint("Distance", 0, 20), "Base")
    named(sk, Sketcher.Constraint("Angle", 0, 1, 2, 2, math.radians(60)), "Tilt")
    named(sk, Sketcher.Constraint("Distance", 2, 20), "Side")
    sk.setExpression("Constraints.Tilt", "Params.ang")
    sk.setExpression("Constraints.Base", "Params.len")
    sk.setExpression("Constraints.Side", "Params.len")
    pad = feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=3)
    doc.recompute()
    b2 = body(doc, "BodyPolar")
    s2 = sketch(doc, b2, "CubeSketch")
    circle(s2, 20, 0, 2, "R")
    c = feat(b2, "PartDesign::Pad", "Peg", Profile=s2, Length=4)
    doc.recompute()
    pp = b2.newObject("PartDesign::PolarPattern", "Pattern")
    pp.Originals = [c]
    pp.Axis = (origin_axis(b2, "Z"), [""])
    pp.Angle = 360
    pp.setExpression("Occurrences", "Params.n")
    b2.Tip = pp

def variant(doc):
    doc.Params.set("B1", "45 deg")
    doc.Params.set("B2", "30 mm")
    doc.Params.set("B3", "5")
    return "ang 60 -> 45 deg (isosceles sides 30 mm), len 20 -> 30, n 8 -> 5"
