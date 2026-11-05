# Part::Thickness: hollow box 20 x 30 x 10 removing the top face, wall 2 inward (value -2) -> 2672, outward (2) and Join Arc.
from _helpers import *

def build(doc):
    for n in ("In", "Out", "Arc"):
        b = doc.addObject("Part::Box", "Box" + n)
        b.Length, b.Width, b.Height = 20, 30, 10
    doc.recompute()
    top = find_face(doc.BoxIn, V(0, 0, 1), 10)
    for name, val, join, box in (("ThickIn", -2, 2, "BoxIn"), ("ThickOut", 2, 2, "BoxOut"), ("ThickArc", 2, 0, "BoxArc")):
        t = doc.addObject("Part::Thickness", name)
        t.Faces = (getattr(doc, box), [top])
        t.Value = val
        t.Mode = 0
        t.Join = join

def variant(doc):
    doc.ThickIn.Value = -3
    return "ThickIn.Value -2 -> -3 (cavity 14 x 24 x 7: 3648)"
