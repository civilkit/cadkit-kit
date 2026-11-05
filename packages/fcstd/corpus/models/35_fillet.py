# Fillet: block 20 x 30 x 10, radius 2.
#  FilletVert: the 4 vertical edges. Each loses (1 - pi/4) r^2 h = 8.5841 -> 5965.663.
#  FilletAll: UseAllEdges with radius 1 (all 12 edges).
#  FilletTop: the 4 top edges r=3 (corner blends are spherical patches; value from FreeCAD).
from _helpers import *

def is_vertical(e):
    a, b = e.Vertexes[0].Point, e.Vertexes[-1].Point
    return abs(a.x - b.x) < 1e-9 and abs(a.y - b.y) < 1e-9

def is_top(e):
    return all(abs(v.Point.z - 10) < 1e-9 for v in e.Vertexes)

def one(doc, tag, pick, radius, **kw):
    bd = body(doc, "Body" + tag)
    base = pad_box(doc, bd, 20, 30, 10, name="Base" + tag)
    doc.recompute()
    names = edges_where(base, pick) if pick else []
    f = feat(bd, "PartDesign::Fillet", "Fillet" + tag, Radius=radius, **kw)
    f.Base = (base, names)

def build(doc):
    one(doc, "Vert", is_vertical, 2)
    one(doc, "All", None, 1, UseAllEdges=True)
    one(doc, "Top", is_top, 3)

def variant(doc):
    doc.FilletVert.Radius = 4
    doc.FilletAll.Radius = 2
    return "FilletVert.Radius 2 -> 4 (4*(1-pi/4)*16*10 = 137.35 removed); FilletAll.Radius 1 -> 2"
