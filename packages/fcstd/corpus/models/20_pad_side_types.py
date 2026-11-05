# Pad: one Body per side type on a 20 x 30 rectangle sketch on XY, Length 10.
#  PadOne one side; PadTwo two sides (10 and 4); PadSym symmetric (midplane); PadRev reversed; PadNoRefine Refine off.
# Expected volumes: 6000, 8400, 6000, 6000, 6000. Bounding box z: 0..10, -4..10, -5..5, -10..0, 0..10.
from _helpers import *

def one(doc, tag, **kw):
    bd = body(doc, "Body" + tag)
    sk = sketch(doc, bd, "Sketch" + tag)
    rect_origin(sk, 20, 30)
    return feat(bd, "PartDesign::Pad", "Pad" + tag, Profile=sk, Length=10, **kw)

def build(doc):
    one(doc, "One")
    one(doc, "Two", SideType="Two sides", Length2=4)
    one(doc, "Sym", SideType="Symmetric")
    one(doc, "Rev", Reversed=True)
    one(doc, "NoRefine", Refine=False)

def variant(doc):
    doc.PadTwo.Length2 = 7
    doc.PadSym.Length = 16
    return "PadTwo.Length2 4 -> 7 (volume 10200); PadSym.Length 10 -> 16 (volume 9600)"
