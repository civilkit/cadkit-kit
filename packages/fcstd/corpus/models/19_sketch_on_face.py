# Sketch on a face of a previous Pad (top face found by geometry), used for a boss and a through pocket.
# Covers sketch Support = (Pad, FaceN) FlatFace, Pocket ThroughAll, Pad on face.
# Base 20x30x10 = 6000; boss circle R4 height 5: +pi*16*5 = 251.327; the pocket sketch lies on the top face,
# so ThroughAll cuts only the 10 mm base: -pi*4*10 = -125.664. Expected volume 6125.664.
from _helpers import *

def build(doc):
    bd = body(doc)
    base = pad_box(doc, bd, 20, 30, 10)
    doc.recompute()
    top = find_face(base, V(0, 0, 1), 10)
    sk = bd.newObject("Sketcher::SketchObject", "BossSketch")
    attach(sk, base, top)
    circle(sk, 10, 15, 4, "BossR")
    feat(bd, "PartDesign::Pad", "Boss", Profile=sk, Length=5)
    doc.recompute()
    sk2 = bd.newObject("Sketcher::SketchObject", "HoleSketch")
    attach(sk2, base, top)
    circle(sk2, 10, 15, 2, "HoleR")
    feat(bd, "PartDesign::Pocket", "Hole", Profile=sk2, Type=1)  # Type 1 = ThroughAll

def variant(doc):
    doc.BossSketch.setDatum("BossR", App.Units.Quantity("6 mm"))
    return "BossR 4 -> 6"
