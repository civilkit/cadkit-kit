# LinearPattern of a 5 x 5 x 5 cube at the origin: along the X axis, 3 occurrences.
#  PatLength: Length mode 40 -> copies at x = 0, 20, 40 (total 3*125 = 375; the last copy ends at 45).
#  PatSpacing: Spacing mode, Offset 12 -> copies at x = 0, 12, 24 (375). PatRev: Reversed along X (copies at -20, -40).
#  PatY: direction = sketch V_Axis (global Y), 4 occurrences, length 30 -> 4*125 = 500.
from _helpers import *

def one(doc, tag, **kw):
    bd = body(doc, "Body" + tag)
    sk = sketch(doc, bd, "Sketch" + tag)
    rect_origin(sk, 5, 5)
    pad = feat(bd, "PartDesign::Pad", "Pad" + tag, Profile=sk, Length=5)
    doc.recompute()
    p = bd.newObject("PartDesign::LinearPattern", "Pattern" + tag)
    p.Originals = [pad]
    p.Direction = kw.pop("Direction", (origin_axis(bd, "X"), [""]))
    for k, v in kw.items():
        setattr(p, k, v)
    bd.Tip = p
    return p

def build(doc):
    one(doc, "Length", Length=40, Occurrences=3)
    one(doc, "Offset", Mode="Spacing", Offset=12, Occurrences=3)
    one(doc, "Rev", Length=40, Occurrences=3, Reversed=True)
    b = body(doc, "BodyY")
    sk = sketch(doc, b, "SketchY")
    rect_origin(sk, 5, 5)
    pad = feat(b, "PartDesign::Pad", "PadY", Profile=sk, Length=5)
    doc.recompute()
    p = b.newObject("PartDesign::LinearPattern", "PatternY")
    p.Originals = [pad]
    p.Direction = (sk, ["V_Axis"])
    p.Length = 30
    p.Occurrences = 4
    b.Tip = p

def variant(doc):
    doc.PatternLength.Occurrences = 5
    doc.PatternOffset.Offset = 8
    return "PatternLength.Occurrences 3 -> 5 (625); PatternOffset.Offset 12 -> 8 (copies overlap: 125 + 3 mm slabs)"
