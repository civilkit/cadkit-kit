# Sketch attached to a PartDesign datum plane (offset 10 above XY, then rotated 30 deg about X), padded 4.
# Covers PartDesign::Plane (MapMode FlatFace on origin plane, AttachmentOffset), sketch FlatFace on the datum.
# Expected: 20 x 10 rectangle pad 4 -> volume 800 (placement carries the offset and rotation).
from _helpers import *

def build(doc):
    bd = body(doc)
    dp = bd.newObject("PartDesign::Plane", "DatumPlane")
    attach(dp, origin_plane(bd, "XY"))
    dp.AttachmentOffset = App.Placement(V(0, 0, 10), App.Rotation(V(1, 0, 0), 30))
    sk = sketch(doc, bd, "Sketch", dp)
    rect_origin(sk, 20, 10)
    feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=4)

def variant(doc):
    doc.DatumPlane.AttachmentOffset = App.Placement(V(0, 0, 25), App.Rotation(V(1, 0, 0), 60))
    return "datum offset z 10 -> 25, angle 30 -> 60 deg"
