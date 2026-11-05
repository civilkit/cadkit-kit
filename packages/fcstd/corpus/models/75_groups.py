# App::DocumentObjectGroup nesting: Outer group contains a Part::Box, an Inner group (Part::Cylinder + Part::Sphere).
# Groups have no Placement/Shape. The dump lists their Group membership under "parts".
from _helpers import *

def build(doc):
    outer = doc.addObject("App::DocumentObjectGroup", "Outer")
    inner = doc.addObject("App::DocumentObjectGroup", "Inner")
    box = doc.addObject("Part::Box", "Box")
    cyl = doc.addObject("Part::Cylinder", "Cyl")
    sph = doc.addObject("Part::Sphere", "Sph")
    cyl.Placement = App.Placement(V(30, 0, 0), App.Rotation())
    sph.Placement = App.Placement(V(60, 0, 0), App.Rotation())
    inner.addObject(cyl)
    inner.addObject(sph)
    outer.addObject(box)
    outer.addObject(inner)
    outer.Label = "Outer group"
    inner.Label = "Inner group"

def variant(doc):
    doc.Box.Length = 30
    doc.Cyl.Radius = 9
    return "Box.Length 10 -> 30, Cyl.Radius 2 -> 9"
