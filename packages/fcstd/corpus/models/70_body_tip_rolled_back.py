# Body with Pad, Pocket and Fillet where the Tip is rolled back to the Pocket: Body.Shape is the Pocket's result and the
# Fillet (after the Tip) is not part of the Body. Pad 6000; Pocket (hole R3 through the block: pi*9*10) 5717.256;
# Fillet of the 4 vertical edges r=2 (-34.337) would give 5682.919.
from _helpers import *

def build(doc):
    bd = body(doc)
    base = pad_box(doc, bd, 20, 30, 10, name="Pad")
    doc.recompute()
    sk = bd.newObject("Sketcher::SketchObject", "HoleSketch")
    attach(sk, base, find_face(base, V(0, 0, 1), 10))
    circle(sk, 10, 15, 3, "R")
    pk = feat(bd, "PartDesign::Pocket", "Pocket", Profile=sk, Type="ThroughAll")
    doc.recompute()
    vert = edges_where(pk, lambda e: abs(e.Vertexes[0].Point.x - e.Vertexes[-1].Point.x) < 1e-9 and abs(e.Vertexes[0].Point.y - e.Vertexes[-1].Point.y) < 1e-9 and e.Length > 9 and (abs(e.Vertexes[0].Point.x) < 1e-9 or abs(e.Vertexes[0].Point.x - 20) < 1e-9))
    fl = feat(bd, "PartDesign::Fillet", "Fillet", Radius=2)
    fl.Base = (pk, vert)
    doc.recompute()
    bd.Tip = pk

def variant(doc):
    doc.Body.Tip = doc.Pad
    return "Body.Tip Pocket -> Pad (Body shape 6000)"
