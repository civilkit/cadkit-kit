# Groove using a sketch construction line as the axis (Axis0) and the origin Z axis. Base cylinder R10 x 20 along Z.
# GrooveCons: rectangle r 8..12 on XZ revolved about a construction line placed on the Z axis: ring cut 452.389 -> 5830.796.
# GrooveOrigin: same profile about the Body origin Z_Axis feature.
from _helpers import *

def one(doc, tag, mode):
    bd = body(doc, "Body" + tag)
    s0 = sketch(doc, bd, "BaseSketch" + tag)
    circle(s0, 0, 0, 10, "R", at_origin=True)
    feat(bd, "PartDesign::Pad", "Base" + tag, Profile=s0, Length=20)
    doc.recompute()
    sk = sketch(doc, bd, "Sketch" + tag, "XZ")
    rect(sk, 8, 8, 12, 12)
    if mode == "cons":
        sk.addGeometry(Part.LineSegment(V(0, -5, 0), V(0, 25, 0)), True)
    g = feat(bd, "PartDesign::Groove", "Groove" + tag, Profile=sk, Angle=360)
    g.ReferenceAxis = (sk, ["Axis0"]) if mode == "cons" else (origin_axis(bd, "Z"), [""])

def build(doc):
    one(doc, "Cons", "cons")
    one(doc, "Origin", "origin")

def variant(doc):
    doc.GrooveCons.Angle = 90
    doc.GrooveOrigin.Angle = 180
    return "GrooveCons.Angle 360 -> 90, GrooveOrigin.Angle 360 -> 180"
