# Part::Revolution of a sketch rectangle (x 10..20, y 2..8) about the X axis (Source = line through origin along X).
#  Full 360: 600*pi = 1884.956; 90 deg: 471.239; Solid=False gives a shell.
from _helpers import *

def build(doc):
    sk = doc.addObject("Sketcher::SketchObject", "Sketch")
    sk.AttacherEngine = "Engine Plane"
    rect(sk, 10, 2, 20, 8)
    def rv(name, angle, solid=True):
        r = doc.addObject("Part::Revolution", name)
        r.Source = sk
        r.Axis = V(1, 0, 0)
        r.Base = V(0, 0, 0)
        r.Angle = angle
        r.Solid = solid
        return r
    rv("Rev360", 360)
    rv("Rev90", 90)
    rv("RevShell", 360, False)

def variant(doc):
    doc.Rev90.Angle = 200
    return "Rev90.Angle 90 -> 200 (1047.198)"
