# Part::Fillet and Part::Chamfer on a box 20 x 30 x 10 (6000).
#  FilletConst: 4 vertical edges r=2 -> 5965.663; FilletVar: one vertical edge with radius 1 at one end and 4 at the other (variable);
#  ChamferEq: one vertical edge (length 10) size 2: 0.5*2*2*10 = 20 -> 5980; ChamferTwo: sizes 2 and 3: 30 -> 5970.
# Edges are given as (index, r1, r2) tuples as FreeCAD stores them in the FilletEdges property.
from _helpers import *

def build(doc):
    for n in ("A", "B", "C", "D"):
        b = doc.addObject("Part::Box", "Box" + n)
        b.Length, b.Width, b.Height = 20, 30, 10
    doc.recompute()
    vert = edges_where(doc.BoxA, lambda e: abs(e.Vertexes[0].Point.x - e.Vertexes[-1].Point.x) < 1e-9 and abs(e.Vertexes[0].Point.y - e.Vertexes[-1].Point.y) < 1e-9)
    idx = [int(v[4:]) for v in vert]
    f = doc.addObject("Part::Fillet", "FilletConst"); f.Base = doc.BoxA
    f.Edges = [(i, 2.0, 2.0) for i in idx]
    g = doc.addObject("Part::Fillet", "FilletVar"); g.Base = doc.BoxB
    g.Edges = [(idx[0], 1.0, 4.0)]
    c = doc.addObject("Part::Chamfer", "ChamferEq"); c.Base = doc.BoxC
    c.Edges = [(idx[0], 2.0, 2.0)]
    d = doc.addObject("Part::Chamfer", "ChamferTwo"); d.Base = doc.BoxD
    d.Edges = [(idx[1], 2.0, 3.0)]

def variant(doc):
    doc.BoxA.Height = 20
    doc.FilletConst.Edges = [(e[0], 3.0, 3.0) for e in doc.FilletConst.Edges]
    return "BoxA.Height 10 -> 20 and FilletConst radius 2 -> 3"
