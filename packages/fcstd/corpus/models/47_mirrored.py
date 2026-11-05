# Mirrored: block 5..15 x 0..10 x 10 (volume 1000) mirrored about the YZ origin plane, and a second body mirrored
# about the horizontal axis of its sketch (global X).
# Expected: 2000 each (copies at x -15..-5 and y -15..-5).
from _helpers import *

def build(doc):
    bd = body(doc, "BodyPlane")
    sk = sketch(doc, bd, "Sketch")
    rect(sk, 5, 0, 15, 10)
    pad = feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=10)
    doc.recompute()
    m = bd.newObject("PartDesign::Mirrored", "Mirrored")
    m.Originals = [pad]
    m.MirrorPlane = (origin_plane(bd, "YZ"), [""])
    bd.Tip = m
    bd2 = body(doc, "BodyAxis")
    sk2 = sketch(doc, bd2, "Sketch2")
    rect(sk2, 5, 5, 15, 15)
    pad2 = feat(bd2, "PartDesign::Pad", "Pad2", Profile=sk2, Length=10)
    doc.recompute()
    m2 = bd2.newObject("PartDesign::Mirrored", "Mirrored2")
    m2.Originals = [pad2]
    m2.MirrorPlane = (sk2, ["H_Axis"])
    bd2.Tip = m2

def variant(doc):
    doc.Pad.Length = 25
    return "Pad.Length 10 -> 25 (volume 5000 after mirroring)"
