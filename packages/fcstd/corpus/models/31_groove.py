# Groove (subtractive revolution): cylinder R10 x 20 along Z; rectangle r 8..12, z 8..12 drawn on XZ and revolved about V_Axis (global Z).
# Ring removed inside the cylinder: pi*(100-64)*4 = 144*pi = 452.389; cylinder 2000*pi = 6283.185.
#  GrooveFull 360 -> 5830.796; GroovePart 180 -> 6056.991; GrooveMid 180 symmetric -> 6056.991; GrooveRev 90 reversed -> 6170.088.
from _helpers import *

def one(doc, tag, **kw):
    bd = body(doc, "Body" + tag)
    s0 = sketch(doc, bd, "Base" + tag + "Sketch")
    circle(s0, 0, 0, 10, "R", at_origin=True)
    feat(bd, "PartDesign::Pad", "Base" + tag, Profile=s0, Length=20)
    doc.recompute()
    sk = sketch(doc, bd, "Sketch" + tag, "XZ")
    rect(sk, 8, 8, 12, 12)
    g = feat(bd, "PartDesign::Groove", "Groove" + tag, Profile=sk, Angle=kw.pop("Angle", 360), **kw)
    g.ReferenceAxis = (sk, ["V_Axis"])

def build(doc):
    one(doc, "Full")
    one(doc, "Part", Angle=180)
    one(doc, "Mid", Angle=180, Midplane=True)
    one(doc, "Rev", Angle=90, Reversed=True)

def variant(doc):
    doc.GroovePart.Angle = 270
    return "GroovePart.Angle 180 -> 270: removes 339.292, volume 5943.893"
