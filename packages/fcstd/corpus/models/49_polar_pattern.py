# PolarPattern of a cylinder R2 x 5 at (20,0) about the Z axis.
#  PolarFull: 360 deg, 6 occurrences: 6 * pi*4*5 = 376.991.
#  PolarPart: 90 deg, 4 occurrences (FreeCAD spaces them by 90/3 when the angle is below 360): 251.327.
#  PolarOffset: Mode Spacing, Offset 45 deg, 3 occurrences: 188.496.
from _helpers import *

def one(doc, tag, **kw):
    bd = body(doc, "Body" + tag)
    sk = sketch(doc, bd, "Sketch" + tag)
    circle(sk, 20, 0, 2, "R")
    pad = feat(bd, "PartDesign::Pad", "Pad" + tag, Profile=sk, Length=5)
    doc.recompute()
    p = bd.newObject("PartDesign::PolarPattern", "Pattern" + tag)
    p.Originals = [pad]
    p.Axis = (origin_axis(bd, "Z"), [""])
    for k, v in kw.items():
        setattr(p, k, v)
    bd.Tip = p

def build(doc):
    one(doc, "Full", Angle=360, Occurrences=6)
    one(doc, "Part", Angle=90, Occurrences=4)
    one(doc, "Offset", Mode="Spacing", Offset=45, Occurrences=3)

def variant(doc):
    doc.PatternFull.Occurrences = 8
    doc.PatternOffset.Offset = 20
    return "PatternFull.Occurrences 6 -> 8 (503.3); PatternOffset.Offset 45 -> 20 deg"
