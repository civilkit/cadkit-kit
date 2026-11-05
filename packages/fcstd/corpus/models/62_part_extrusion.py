# Part::Extrusion of a sketch face: straight 10 (volume 20*30*10 = 6000), tapered 5 deg, along a custom direction,
# symmetric, and without Solid (a shell of faces). Sketch: 20 x 30 rectangle on XY (outside a Body).
from _helpers import *

def build(doc):
    sk = doc.addObject("Sketcher::SketchObject", "Sketch")
    sk.AttacherEngine = "Engine Plane"
    rect_origin(sk, 20, 30)
    def ex(name, **kw):
        e = doc.addObject("Part::Extrusion", name)
        e.Base = sk
        e.DirMode = kw.pop("DirMode", "Normal")
        e.LengthFwd = kw.pop("LengthFwd", 10)
        for k, v in kw.items():
            setattr(e, k, v)
        return e
    ex("ExStraight", Solid=True)
    ex("ExTaper", Solid=True, TaperAngle=5)
    ex("ExSym", Solid=True, Symmetric=True)
    ex("ExTwo", Solid=True, LengthRev=4)
    ex("ExCustom", Solid=True, DirMode="Custom", Dir=V(0, 1, 1))
    ex("ExHollow", Solid=False)

def variant(doc):
    doc.ExStraight.LengthFwd = 25
    doc.ExTaper.TaperAngle = 10
    return "ExStraight.LengthFwd 10 -> 25 (15000); ExTaper.TaperAngle 5 -> 10"
