# Pocket with taper angle (circle R4 on the top face z = 10, depth 6, taper 5 deg) and with a custom direction.
# Expected: untapered cut would be pi*16*6 = 301.593; taper changes it by FreeCAD's sign convention.
from _helpers import *

def build(doc):
    bd = body(doc, "BodyTaper")
    base = pad_box(doc, bd, 30, 30, 10, name="Base")
    doc.recompute()
    sk = sketch(doc, bd, "Sketch", "XY", App.Placement(V(0, 0, 10), App.Rotation()))
    circle(sk, 15, 15, 4, "R")
    feat(bd, "PartDesign::Pocket", "Pocket", Profile=sk, Type="Length", Length=6, TaperAngle=5)
    bd2 = body(doc, "BodyDir")
    base2 = pad_box(doc, bd2, 30, 30, 10, name="Base2")
    doc.recompute()
    sk2 = sketch(doc, bd2, "Sketch2", "XY", App.Placement(V(0, 0, 10), App.Rotation()))
    circle(sk2, 15, 15, 4, "R")
    p = feat(bd2, "PartDesign::Pocket", "Pocket2", Profile=sk2, Type="Length", Length=6)
    p.UseCustomVector = True
    p.AlongSketchNormal = False
    p.Direction = V(0.5, 0, -1)

def variant(doc):
    doc.Pocket.TaperAngle = 12
    return "Pocket.TaperAngle 5 -> 12"
