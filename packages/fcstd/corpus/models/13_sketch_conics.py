# Sketch with conic arcs: an arc of ellipse closed by its chord, an arc of hyperbola and an arc of parabola
# (the last two are open, so they are construction geometry), and a Point. Pad of the ellipse segment only.
# Ellipse (major 10 along X, minor 6) from angle 0 to 180 deg closed by the chord on the X axis: half ellipse area
# pi*10*6/2 = 94.248, Pad 4 -> 376.991.
from _helpers import *

def build(doc):
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    el = Part.Ellipse(V(0, 0, 0), 10, 6)
    arc = Part.ArcOfEllipse(el, 0, math.pi)
    a = sk.addGeometry(arc, False)
    l = sk.addGeometry(Part.LineSegment(V(-10, 0, 0), V(10, 0, 0)), False)
    sk.addConstraint(Sketcher.Constraint("Coincident", a, 1, l, 2))
    sk.addConstraint(Sketcher.Constraint("Coincident", a, 2, l, 1))
    sk.addConstraint(Sketcher.Constraint("Horizontal", l))
    h = Part.ArcOfHyperbola(Part.Hyperbola(V(30, 0, 0), 5, 3), -1.0, 1.0)
    ih = sk.addGeometry(h, True)
    sk.addConstraint(Sketcher.Constraint("Block", ih))   # unconstrained conics drift between solver runs
    pb = Part.Parabola()
    pb.Focal = 2
    pb.Center = V(50, 0, 0)
    p = Part.ArcOfParabola(pb, -3, 3)
    ip = sk.addGeometry(p, True)
    sk.addConstraint(Sketcher.Constraint("Block", ip))
    sk.addGeometry(Part.Point(V(20, 20, 0)), True)
    feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=4)

def variant(doc):
    doc.Pad.Length = 9
    return "Pad.Length 4 -> 9 (volume 848.230)"
