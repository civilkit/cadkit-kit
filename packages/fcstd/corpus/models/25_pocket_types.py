# Pocket types on a 20 x 30 x 10 block (z 0..10); circle R3 sketch at (10,15) on XY shifted to z = 5.
# Pocket cuts against the sketch normal by default (down). Hole area pi*9 = 28.2743.
#  Length 4: cut z 1..5 -> 113.097; Reversed: z 5..9 -> 113.097; ThroughAll: z 0..5 -> 141.372;
#  ThroughAll+Midplane: z 0..10 -> 282.743; TwoLengths 4 down + 2 up: 169.646; UpToFace (bottom): 141.372;
#  Midplane Length 4: z 3..7 -> 113.097.
from _helpers import *

def one(doc, tag, **kw):
    bd = body(doc, "Body" + tag)
    base = pad_box(doc, bd, 20, 30, 10, name="Base" + tag)
    doc.recompute()
    sk = sketch(doc, bd, "Sketch" + tag, "XY", App.Placement(V(0, 0, 5), App.Rotation()))
    circle(sk, 10, 15, 3, "R")
    if kw.pop("_uptoface", False):
        kw["UpToFace"] = (base, [find_face(base, V(0, 0, -1), 0)])
    return feat(bd, "PartDesign::Pocket", "Pocket" + tag, Profile=sk, **kw)

def build(doc):
    one(doc, "Length", Type="Length", Length=4)
    one(doc, "Rev", Type="Length", Length=4, Reversed=True)
    one(doc, "Through", Type="ThroughAll")
    one(doc, "ThroughMid", Type="ThroughAll", SideType="Symmetric")
    one(doc, "Two", Type="Length", Length=4, SideType="Two sides", Length2=2)
    one(doc, "UpToFace", Type="UpToFace", _uptoface=True)
    one(doc, "Mid", Type="Length", Length=4, SideType="Symmetric")

def variant(doc):
    doc.PocketLength.Length = 8
    doc.PocketTwo.Length2 = 5
    return "PocketLength.Length 4 -> 8 (cut z 0..5 limited by the block: 141.372); PocketTwo.Length2 2 -> 5"
