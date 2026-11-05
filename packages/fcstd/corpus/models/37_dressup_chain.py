# Feature chain with dress-ups: Pad 30 x 30 x 10 -> Pocket (hole R4 through) -> Fillet of the hole's top circular edge (r=1)
# -> Chamfer of a vertical outer edge (2) -> Draft? no. Each step's stored shape is the base of the next
# (BaseFeature chain). Volume after Pad 9000; Pocket -pi*16*10 = 8497.345; Fillet/Chamfer values from FreeCAD.
from _helpers import *

def build(doc):
    bd = body(doc)
    base = pad_box(doc, bd, 30, 30, 10, name="Pad")
    doc.recompute()
    hs = bd.newObject("Sketcher::SketchObject", "HoleSketch")
    attach(hs, base, find_face(base, V(0, 0, 1), 10))
    circle(hs, 15, 15, 4, "R")
    pk = feat(bd, "PartDesign::Pocket", "Pocket", Profile=hs, Type="ThroughAll")
    doc.recompute()
    top_circle = edges_where(pk, lambda e: e.Curve.__class__.__name__ == "Circle" and abs(e.Vertexes[0].Point.z - 10) < 1e-9)
    fl = feat(bd, "PartDesign::Fillet", "Fillet", Radius=1)
    fl.Base = (pk, top_circle)
    doc.recompute()
    corner = edges_where(fl, lambda e: e.Curve.__class__.__name__ == "Line" and abs(e.Vertexes[0].Point.x) < 1e-9 and abs(e.Vertexes[0].Point.y) < 1e-9 and e.Length > 9)
    ch = feat(bd, "PartDesign::Chamfer", "Chamfer", Size=2)
    ch.Base = (fl, corner)

def variant(doc):
    doc.Fillet.Radius = 2
    doc.Chamfer.Size = 4
    return "Fillet.Radius 1 -> 2, Chamfer.Size 2 -> 4"
