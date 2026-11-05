# Part::Offset (3D) of a box 20 x 30 x 10: outward offset 2 with Arc join (rounded edges), with Intersection join,
# and an inward offset -1. Part::Offset2D of a sketch face (rectangle 20 x 30 offset +2, Arc and Intersection).
# Intersection join outward: 24 x 34 x 14 = 11424. Arc join: rounded; value from FreeCAD.
from _helpers import *

def build(doc):
    bx = doc.addObject("Part::Box", "Box")
    bx.Length, bx.Width, bx.Height = 20, 30, 10
    for name, val, join in (("OffArc", 2, 0), ("OffInter", 2, 2), ("OffIn", -1, 2)):
        o = doc.addObject("Part::Offset", name)
        o.Source = bx
        o.Value = val
        o.Mode = "Skin"
        o.Join = join
        o.Intersection = False
        o.SelfIntersection = False
    sk = doc.addObject("Sketcher::SketchObject", "Sketch")
    sk.AttacherEngine = "Engine Plane"
    rect_origin(sk, 20, 30)
    f = doc.addObject("Part::Offset2D", "Off2D")
    f.Source = sk
    f.Value = 2
    f.Join = "Arc"
    f2 = doc.addObject("Part::Offset2D", "Off2DInter")
    f2.Source = sk
    f2.Value = 2
    f2.Join = "Intersection"

def variant(doc):
    doc.OffInter.Value = 4
    doc.Off2D.Value = 1
    return "OffInter.Value 2 -> 4 (28 x 38 x 18 = 19152); Off2D.Value 2 -> 1"
