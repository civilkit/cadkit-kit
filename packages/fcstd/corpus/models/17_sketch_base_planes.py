# Sketches on each origin base plane (XY, XZ, YZ), each in its own Body with a Pad of 5 from a 10 x 20 rectangle.
# Covers sketch Placement/MapMode FlatFace on XY_Plane/XZ_Plane/YZ_Plane; the pad directions follow the
# sketch normals (XY +Z, XZ -Y, YZ +X in FreeCAD). Expected: 3 bodies of volume 1000 each.
from _helpers import *

def build(doc):
    for pl in ("XY", "XZ", "YZ"):
        bd = body(doc, "Body" + pl)
        sk = sketch(doc, bd, "Sketch" + pl, pl)
        rect_origin(sk, 10, 20)
        feat(bd, "PartDesign::Pad", "Pad" + pl, Profile=sk, Length=5)

def variant(doc):
    doc.SketchXZ.setDatum("Width", App.Units.Quantity("30 mm"))
    return "SketchXZ Width 10 -> 30: BodyXZ volume 3000"
