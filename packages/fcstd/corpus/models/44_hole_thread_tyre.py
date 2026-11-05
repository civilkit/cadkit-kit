# ISO tyre valve thread (ThreadType ISOTyre, sizes like 5v1) as a cosmetic thread. The tapped diameter FreeCAD derives is in the volume. Block 30 x 30 x 15, depth 10.
from _helpers import *

def one(doc, tag, ttype, idx=0):
    bd = body(doc, "Body" + tag)
    base = pad_box(doc, bd, 30, 30, 15, name="Base" + tag)
    doc.recompute()
    sk = bd.newObject("Sketcher::SketchObject", "Sketch" + tag)
    attach(sk, base, find_face(base, V(0, 0, 1), 15))
    circle(sk, 15, 15, 3)
    h = feat(bd, "PartDesign::Hole", "Hole" + tag, Profile=sk, DepthType="Dimension", Depth=10)
    h.Threaded = True
    h.ThreadType = ttype
    doc.recompute()
    h.ThreadSize = h.getEnumerationsOfProperty("ThreadSize")[idx]
    doc.recompute()

def build(doc):
    one(doc, "Tyre", "ISOTyre", 1)

def variant(doc):
    doc.HoleTyre.ThreadSize = doc.HoleTyre.getEnumerationsOfProperty("ThreadSize")[4]
    return "HoleTyre.ThreadSize index 1 -> 4"
