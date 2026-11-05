# Pad with taper angle: 20 x 30 rectangle, Length 10, TaperAngle 10 deg (outward and inward).
# Expected: with t = 10*tan(10 deg) = 1.76327 the side offset per face; narrowing: A2 = (20-2t)(30-2t),
# V = h/3 (A1 + A2 + sqrt(A1 A2)). FreeCAD: positive angle grows the profile (A2 = (20+2t)(30+2t): 6923.09), negative narrows it (5159.82).
from _helpers import *

def one(doc, tag, ang):
    bd = body(doc, "Body" + tag)
    sk = sketch(doc, bd, "Sketch" + tag)
    rect_origin(sk, 20, 30)
    return feat(bd, "PartDesign::Pad", "Pad" + tag, Profile=sk, Length=10, TaperAngle=ang)

def build(doc):
    one(doc, "Pos", 10)
    one(doc, "Neg", -10)

def variant(doc):
    doc.PadPos.TaperAngle = 20
    return "PadPos.TaperAngle 10 -> 20"
