# Refine on/off: two Pads fused on coplanar faces (20 x 10 block then a 20 x 10 block beside it, both height 10).
# Expected: volume 4000 in both; the Refine=True body has 6 faces, Refine=False keeps the seam (more faces).
from _helpers import *

def one(doc, tag, refine):
    bd = body(doc, "Body" + tag)
    sk = sketch(doc, bd, "SketchA" + tag)
    rect(sk, 0, 0, 20, 10)
    feat(bd, "PartDesign::Pad", "PadA" + tag, Profile=sk, Length=10, Refine=refine)
    sk2 = sketch(doc, bd, "SketchB" + tag)
    rect(sk2, 0, 10, 20, 20)
    feat(bd, "PartDesign::Pad", "PadB" + tag, Profile=sk2, Length=10, Refine=refine)

def build(doc):
    one(doc, "On", True)
    one(doc, "Off", False)

def variant(doc):
    doc.PadBOn.Length = 6
    doc.PadBOff.Length = 6
    return "PadB Length 10 -> 6 in both (volume 3200, shape now has a step)"
