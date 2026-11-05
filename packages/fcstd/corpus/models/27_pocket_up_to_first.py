# Pocket UpToFirst and UpToFace in material with an internal wall: block 30 x 30 x 20 with a slot cavity? Simpler:
# two stacked blocks (z 0..10 and z 12..22, gap of 2 between them is air only because the second pad is offset by a sketch offset).
# A circle R3 sketch on a plane at z = 22 pocketed UpToFirst stops at the first face met (the top of the upper block region it
# starts in?). Values from FreeCAD; the dump records both results.
from _helpers import *

def build(doc):
    bd = body(doc, "BodyFirst")
    b1 = pad_box(doc, bd, 30, 30, 10, name="Lower")
    doc.recompute()
    s2 = sketch(doc, bd, "UpperSketch", "XY", App.Placement(V(0, 0, 14), App.Rotation()))
    rect_origin(s2, 30, 30)
    up = feat(bd, "PartDesign::Pad", "Upper", Profile=s2, Length=8)       # z 14..22, disconnected from the lower block
    doc.recompute()
    c = sketch(doc, bd, "CutSketch", "XY", App.Placement(V(0, 0, 22), App.Rotation()))
    circle(c, 15, 15, 3, "R")
    feat(bd, "PartDesign::Pocket", "PocketFirst", Profile=c, Type="UpToFirst")
    bd2 = body(doc, "BodyFace")
    lo = pad_box(doc, bd2, 30, 30, 10, name="Lower2")
    doc.recompute()
    c2 = sketch(doc, bd2, "CutSketch2", "XY", App.Placement(V(0, 0, 10), App.Rotation()))
    circle(c2, 15, 15, 3, "R")
    feat(bd2, "PartDesign::Pocket", "PocketToFace", Profile=c2, Type="UpToFace", UpToFace=(lo, [find_face(lo, V(0, 0, -1), 0)]))

def variant(doc):
    doc.CutSketch2.setDatum("R", App.Units.Quantity("5 mm"))
    return "CutSketch2 R 3 -> 5 (through the 10 mm block: -pi*25*10)"
