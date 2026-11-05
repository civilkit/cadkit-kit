# MultiTransform: a 4 x 4 x 4 cube at the origin, then a LinearPattern (3 along X, step 10) followed by a
# Mirrored about the YZ plane inside one MultiTransform. Expected: 3 * 64 = 192 mirrored to 6 cubes = 384.
from _helpers import *

def build(doc):
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    rect(sk, 5, 0, 9, 4)
    pad = feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=4)
    doc.recompute()
    mt = bd.newObject("PartDesign::MultiTransform", "MultiTransform")
    mt.Originals = [pad]
    lp = bd.newObject("PartDesign::LinearPattern", "LinearPattern")
    lp.Direction = (origin_axis(bd, "X"), [""])
    lp.Length = 20
    lp.Occurrences = 3
    mi = bd.newObject("PartDesign::Mirrored", "Mirrored")
    mi.MirrorPlane = (origin_plane(bd, "YZ"), [""])
    mt.Transformations = [lp, mi]
    bd.Tip = mt

def variant(doc):
    doc.LinearPattern.Occurrences = 2
    return "LinearPattern.Occurrences 3 -> 2: 4 cubes (256)"
