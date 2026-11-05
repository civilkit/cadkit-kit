# Fillet and Chamfer on curved edges: a cylinder R10 x 20; fillet r=2 on the top circle (torus patch), chamfer 1.5 on the bottom circle.
# Cylinder 2000*pi = 6283.185; fillet removes (1 - pi/4) r^2 * 2*pi*(R - r*(10-3pi)/(3*(4-pi)))...: use FreeCAD's value.
from _helpers import *

def build(doc):
    bd = body(doc)
    s0 = sketch(doc, bd, "Sketch")
    circle(s0, 0, 0, 10, "R", at_origin=True)
    cyl = feat(bd, "PartDesign::Pad", "Pad", Profile=s0, Length=20)
    doc.recompute()
    top = edges_where(cyl, lambda e: e.Curve.__class__.__name__ == "Circle" and abs(e.Vertexes[0].Point.z - 20) < 1e-9)
    bot = edges_where(cyl, lambda e: e.Curve.__class__.__name__ == "Circle" and abs(e.Vertexes[0].Point.z) < 1e-9)
    fl = feat(bd, "PartDesign::Fillet", "Fillet", Radius=2)
    fl.Base = (cyl, top)
    doc.recompute()
    bot2 = edges_where(fl, lambda e: e.Curve.__class__.__name__ == "Circle" and abs(e.Vertexes[0].Point.z) < 1e-9)
    ch = feat(bd, "PartDesign::Chamfer", "Chamfer", Size=1.5)
    ch.Base = (fl, bot2)

def variant(doc):
    doc.Fillet.Radius = 4
    doc.Chamfer.Size = 3
    return "Fillet.Radius 2 -> 4, Chamfer.Size 1.5 -> 3"
