# App::VarSet "Vars" (FreeCAD 1.0+) with typed properties Wd, Ht, Dp (Length), Cnt (Integer) and Ang (Angle) (single letters such as W, H, N, A are unit names and do not parse in expressions) driving a pad, a
# LinearPattern (N occurrences) and a Revolution angle. Sketch 20 x 30 pad 10; the VarSet defaults: Wd=20 mm Ht=30 mm Dp=10 mm Cnt=3 Ang=90 deg.
# Cube pattern: 5 x 5 x 5 cube repeated N times over 40 mm (3 -> 375).
from _helpers import *

def build(doc):
    vs = doc.addObject("App::VarSet", "Vars")
    vs.addProperty("App::PropertyLength", "Wd", "Params", "width")
    vs.addProperty("App::PropertyLength", "Ht", "Params", "height")
    vs.addProperty("App::PropertyLength", "Dp", "Params", "depth")
    vs.addProperty("App::PropertyInteger", "Cnt", "Params", "count")
    vs.addProperty("App::PropertyAngle", "Ang", "Params", "angle")
    vs.Wd, vs.Ht, vs.Dp, vs.Cnt, vs.Ang = 20, 30, 10, 3, 90
    bd = body(doc, "BodyBlock")
    sk = sketch(doc, bd, "Sketch")
    rect_origin(sk, 20, 30)
    sk.setExpression("Constraints.Width", "Vars.Wd")
    sk.setExpression("Constraints.Height", "Vars.Ht")
    pad = feat(bd, "PartDesign::Pad", "Pad", Profile=sk)
    pad.setExpression("Length", "Vars.Dp")
    b2 = body(doc, "BodyPattern")
    s2 = sketch(doc, b2, "CubeSketch")
    rect_origin(s2, 5, 5)
    cube = feat(b2, "PartDesign::Pad", "Cube", Profile=s2, Length=5)
    doc.recompute()
    lp = b2.newObject("PartDesign::LinearPattern", "Pattern")
    lp.Originals = [cube]
    lp.Direction = (origin_axis(b2, "X"), [""])
    lp.Length = 40
    lp.setExpression("Occurrences", "Vars.Cnt")
    b2.Tip = lp
    b3 = body(doc, "BodyRev")
    s3 = sketch(doc, b3, "RevSketch")
    rect(s3, 10, 2, 20, 8)
    rv = feat(b3, "PartDesign::Revolution", "Rev", Profile=s3)
    rv.ReferenceAxis = (s3, ["H_Axis"])
    rv.setExpression("Angle", "Vars.Ang")

def variant(doc):
    doc.Vars.Wd = 35
    doc.Vars.Cnt = 5
    doc.Vars.Ang = 180
    return "Vars.Wd 20 -> 35, N 3 -> 5 (pattern 625), Ang 90 -> 180 (revolution 942.478)"
