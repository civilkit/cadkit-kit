# Chamfer on one 30 mm edge (top edge at x = 0, z = 10) of a 20 x 30 x 10 block.
#  ChEqual size 2: removes 0.5*2*2*30 = 60 -> 5940. ChTwo sizes 2 and 3: 0.5*2*3*30 = 90 -> 5910 (and flipped).
#  ChAngle size 2 at 45 deg: 60 -> 5940. ChAll: all edges size 1 (value from FreeCAD).
from _helpers import *

def edge_top_x0(e):
    return all(abs(v.Point.z - 10) < 1e-9 and abs(v.Point.x) < 1e-9 for v in e.Vertexes)

def one(doc, tag, edges=True, **kw):
    bd = body(doc, "Body" + tag)
    base = pad_box(doc, bd, 20, 30, 10, name="Base" + tag)
    doc.recompute()
    f = feat(bd, "PartDesign::Chamfer", "Ch" + tag, **kw)
    if edges:
        f.Base = (base, edges_where(base, edge_top_x0))
    else:
        f.Base = (base, [])
        f.UseAllEdges = True
    return f

def build(doc):
    one(doc, "Equal", ChamferType="Equal distance", Size=2)
    one(doc, "Two", ChamferType="Two distances", Size=2, Size2=3)
    one(doc, "TwoFlip", ChamferType="Two distances", Size=2, Size2=3, FlipDirection=True)
    one(doc, "Angle", ChamferType="Distance and Angle", Size=2, Angle=45)
    one(doc, "All", edges=False, ChamferType="Equal distance", Size=1)

def variant(doc):
    doc.ChEqual.Size = 4
    doc.ChTwo.Size2 = 5
    return "ChEqual.Size 2 -> 4 (240 removed); ChTwo.Size2 3 -> 5 (150 removed)"
