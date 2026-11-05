# Two Bodies with different Body.Placement. BodyA: block 20 x 30 x 10 at (100,0,0). BodyB: the same block rotated 90 deg about Z
# and lifted 50 (Placement carries the rotation; features are expressed in body-local coordinates).
# Expected: both volumes 6000; BodyB bounding box x -30..0, y 0..20 (+ translation), z 50..60.
from _helpers import *

def one(doc, tag, pl):
    bd = body(doc, "Body" + tag)
    bd.Placement = pl
    pad_box(doc, bd, 20, 30, 10, name="Pad" + tag)

def build(doc):
    one(doc, "A", App.Placement(V(100, 0, 0), App.Rotation()))
    one(doc, "B", App.Placement(V(0, 0, 50), App.Rotation(V(0, 0, 1), 90)))

def variant(doc):
    doc.BodyB.Placement = App.Placement(V(0, 40, 50), App.Rotation(V(0, 0, 1), 45))
    doc.PadA.Length = 14
    return "BodyB moved/rotated 45 deg; PadA.Length 10 -> 14"
