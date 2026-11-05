# Pad end conditions that need existing material: UpToFirst, UpToLast and UpToFace.
# Base box 20 x 30 x 10 (z 0..10); a circle R3 sketch sits on XY shifted to z = -15 and is padded +Z.
# UpToFirst/UpToFace stop at the box bottom (face z=0): added volume pi*9*15 = 424.115 -> 6424.115.
# UpToLast goes on to the last face (box top z=10): the part inside the box adds nothing -> 6424.115.
from _helpers import *

def one(doc, tag, typ):
    bd = body(doc, "Body" + tag)
    base = pad_box(doc, bd, 20, 30, 10, name="Base" + tag)
    doc.recompute()
    sk = sketch(doc, bd, "Sketch" + tag, "XY", App.Placement(V(0, 0, -15), App.Rotation()))
    circle(sk, 10, 15, 3, "R")
    kw = {}
    if typ == "UpToFace":
        kw["UpToFace"] = (base, [find_face(base, V(0, 0, -1), 0)])
    return feat(bd, "PartDesign::Pad", "Pad" + tag, Profile=sk, Type=typ, **kw)

def build(doc):
    for t in ("UpToFirst", "UpToLast", "UpToFace"):
        one(doc, t, t)

def variant(doc):
    doc.SketchUpToFirst.setDatum("R", App.Units.Quantity("5 mm"))
    return "SketchUpToFirst R 3 -> 5: volume 6000 + pi*25*15"
