# Pad with Type UpToShape (FreeCAD 1.1: UpToShape link list) up to a datum-bounded body: sketch circle R3 at z = -15 padded
# up to a reference box of another Body (BodyRef: block z 0..10). The pad ends at the first face of the reference shape (z=0): +pi*9*15 = 424.115
# fused into BodyMain (a 20 x 30 x 5 plate at z -30..-25 so that the pad has something to attach to).
from _helpers import *

def build(doc):
    ref = body(doc, "BodyRef")
    pad_box(doc, ref, 20, 30, 10, name="RefPad")
    doc.recompute()
    bd = body(doc, "BodyMain")
    sk0 = sketch(doc, bd, "PlateSketch", "XY", App.Placement(V(0, 0, -30), App.Rotation()))
    rect_origin(sk0, 20, 30)
    feat(bd, "PartDesign::Pad", "Plate", Profile=sk0, Length=15)       # z -30..-15
    doc.recompute()
    sk = sketch(doc, bd, "Sketch", "XY", App.Placement(V(0, 0, -15), App.Rotation()))
    circle(sk, 10, 15, 3, "R")
    p = feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Type="UpToShape")
    p.UpToShape = [(doc.RefPad, [find_face(doc.RefPad, V(0, 0, -1), 0)])]

def variant(doc):
    doc.Sketch.setDatum("R", App.Units.Quantity("4 mm"))
    return "Sketch R 3 -> 4"
