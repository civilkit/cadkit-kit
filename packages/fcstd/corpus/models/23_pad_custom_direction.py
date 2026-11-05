# Pad along a custom direction vector (UseCustomVector) and along a reference axis (ReferenceAxis = origin X axis edge).
# BodyAxis uses a PartDesign datum line (ObjectZ of XY plane, tilted 30 deg about Y) as ReferenceAxis.
# 20 x 30 rectangle, Length 10; direction (0,0,1) rotated: (1,0,1) -> sheared prism.
# Expected: base area 600; FreeCAD's volume shows whether Length is measured along the vector or its normal component.
from _helpers import *

def build(doc):
    bd = body(doc, "BodyVector")
    sk = sketch(doc, bd, "SketchVector")
    rect_origin(sk, 20, 30)
    f = feat(bd, "PartDesign::Pad", "PadVector", Profile=sk, Length=10)
    f.UseCustomVector = True
    f.AlongSketchNormal = False
    f.Direction = V(1, 0, 1)
    bd2 = body(doc, "BodyAxis")
    ln = bd2.newObject("PartDesign::Line", "DatumLine")   # tilted 30 deg from Z, not in the sketch plane
    attach(ln, origin_plane(bd2, "XY"), "", "ObjectZ")
    ln.AttachmentOffset = App.Placement(V(0, 0, 0), App.Rotation(V(0, 1, 0), 30))
    doc.recompute()
    sk2 = sketch(doc, bd2, "SketchAxis")
    rect_origin(sk2, 20, 30)
    f2 = feat(bd2, "PartDesign::Pad", "PadAxis", Profile=sk2, Length=10)
    f2.ReferenceAxis = (ln, [""])
    f2.AlongSketchNormal = False

def variant(doc):
    doc.PadVector.Direction = V(0, 1, 1)
    return "PadVector.Direction (1,0,1) -> (0,1,1)"
