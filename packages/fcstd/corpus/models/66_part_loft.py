# Part::Loft between wires. Sections: square 20 at z=0 and square 10 at z=15 (sketches): frustum 3500 (Solid, Ruled).
# LoftOpen: Solid=False (the lateral faces only). LoftThreeSmooth: 20 -> 10 -> 20, not ruled.
from _helpers import *

def sq(doc, name, size, z):
    sk = doc.addObject("Sketcher::SketchObject", name)
    sk.AttacherEngine = "Engine Plane"
    sk.Placement = App.Placement(V(0, 0, z), App.Rotation())
    h = size / 2.0
    rect(sk, -h, -h, h, h)
    return sk

def build(doc):
    a, b, c = sq(doc, "A", 20, 0), sq(doc, "B", 10, 15), sq(doc, "C", 20, 30)
    l1 = doc.addObject("Part::Loft", "LoftRuled"); l1.Sections = [a, b]; l1.Solid = True; l1.Ruled = True
    l2 = doc.addObject("Part::Loft", "LoftOpen"); l2.Sections = [a, b]; l2.Solid = False; l2.Ruled = True
    l3 = doc.addObject("Part::Loft", "LoftThreeSmooth"); l3.Sections = [a, b, c]; l3.Solid = True; l3.Ruled = False

def variant(doc):
    doc.B.Placement = App.Placement(V(0, 0, 25), App.Rotation())
    return "Section B moved to z = 25 (the sketches have no attachment here)"
