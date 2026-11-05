# A Body inside an App::Part: the Body's sketch attached to the Body Origin plane, Body.Placement non-zero and a Pad.
# Also a second sketch attached to the *Part's* Origin XY plane (a sketch outside any Body lying in an App::Part).
from _helpers import *

def build(doc):
    part = doc.addObject("App::Part", "Part")
    part.Placement = App.Placement(V(10, 20, 30), App.Rotation(V(0, 1, 0), 90))
    bd = body(doc, "Body")
    part.addObject(bd)
    bd.Placement = App.Placement(V(1, 2, 3), App.Rotation())
    pad_box(doc, bd, 20, 30, 10, name="Pad")
    sk = doc.addObject("Sketcher::SketchObject", "LooseSketch")
    sk.AttacherEngine = "Engine Plane"
    part.addObject(sk)
    xy = [f for f in part.Origin.OriginFeatures if f.Role == "XY_Plane"][0]
    attach(sk, xy)
    rect(sk, 0, 0, 8, 4)

def variant(doc):
    doc.Part.Placement = App.Placement(V(10, 20, 30), App.Rotation(V(0, 1, 0), 0))
    return "Part.Placement rotation 90 -> 0 deg"
