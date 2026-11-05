# Additive and subtractive Loft.
#  LoftAdd: square 20 x 20 at z=0 to square 10 x 10 at z=15: frustum h/3 (400 + 100 + 200) = 3500 (Ruled and smooth are equal for two sections).
#  LoftThree: three sections 20 -> 10 -> 20 square at z 0, 10, 20: ruled (two frusta) or smooth (value from FreeCAD).
#  LoftSub: block 40 x 40 x 20, loft cuts from circle R8 at z=20 to R4 at z=5: pi*15/3*(64+16+32) = 560*pi = 1759.292 -> 32000 - 1759.292.
from _helpers import *

def sq(doc, bd, name, size, z, cx=0, cy=0):
    sk = sketch(doc, bd, name, "XY", App.Placement(V(0, 0, z), App.Rotation()))
    h = size / 2.0
    rect(sk, cx - h, cy - h, cx + h, cy + h)
    return sk

def build(doc):
    bd = body(doc, "BodyAdd")
    a = sq(doc, bd, "A", 20, 0)
    b = sq(doc, bd, "B", 10, 15)
    feat(bd, "PartDesign::AdditiveLoft", "Loft", Profile=a, Sections=[b], Ruled=True)
    for tag, ruled in (("Ruled", True), ("Smooth", False)):
        bd = body(doc, "Body3" + tag)
        s0, s1, s2 = sq(doc, bd, "S0" + tag, 20, 0), sq(doc, bd, "S1" + tag, 10, 10), sq(doc, bd, "S2" + tag, 20, 20)
        feat(bd, "PartDesign::AdditiveLoft", "Loft3" + tag, Profile=s0, Sections=[s1, s2], Ruled=ruled)
    bd = body(doc, "BodySub")
    base = pad_box(doc, bd, 40, 40, 20, name="Base")
    doc.recompute()
    c0 = sketch(doc, bd, "C0", "XY", App.Placement(V(0, 0, 20), App.Rotation()))
    circle(c0, 20, 20, 8, "R")
    c1 = sketch(doc, bd, "C1", "XY", App.Placement(V(0, 0, 5), App.Rotation()))
    circle(c1, 20, 20, 4, "R")
    feat(bd, "PartDesign::SubtractiveLoft", "LoftSub", Profile=c0, Sections=[c1])

def variant(doc):
    doc.B.AttachmentOffset = App.Placement(V(0, 0, 25), App.Rotation())
    doc.C1.setDatum("R", App.Units.Quantity("6 mm"))
    return "Sketch B moved to z = 25 (frustum h 25), C1 radius 4 -> 6"
