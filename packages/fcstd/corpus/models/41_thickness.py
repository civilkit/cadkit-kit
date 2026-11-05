# Thickness (hollow) on a 20 x 30 x 10 block, wall 2, top face removed.
#  Inward ('ThickIn', FreeCAD default Reversed=True): cavity 16 x 26 x 8 = 3328 -> 2672 (Join: Intersection).
#  ThickOut Reversed=False (outward growth, the wall sits outside the block) and ThickArc with Join = Arc (rounded convex corners): values from FreeCAD.
from _helpers import *

def one(doc, tag, **kw):
    bd = body(doc, "Body" + tag)
    base = pad_box(doc, bd, 20, 30, 10, name="Base" + tag)
    doc.recompute()
    t = feat(bd, "PartDesign::Thickness", "Thick" + tag, Value=2, **kw)
    t.Base = (base, [find_face(base, V(0, 0, 1), 10)])

def build(doc):
    one(doc, "In", Join="Intersection")                    # Reversed defaults to True = grow inwards
    one(doc, "Out", Join="Intersection", Reversed=False)   # grow outwards
    one(doc, "Arc", Join="Arc", Reversed=False)

def variant(doc):
    doc.ThickIn.Value = 3
    return "ThickIn.Value 2 -> 3: cavity 14 x 24 x 7 = 2352 -> 3648"
