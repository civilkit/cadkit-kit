# Hole feature, plain holes in a 30 x 30 x 15 block (13500; hole sketch circle on the top face; sketch circle centre = hole position).
#  HoleDepth: diameter 6, depth 8, flat bottom: DrillPoint Flat: removes pi*9*8 = 226.195 -> 13273.805.
#  HoleThrough: through all: pi*9*15 = 424.115 -> 13075.885.
#  HoleAngled: depth 8, drill point 118 deg, DrillForDepth False: flat depth 8 plus a cone tip (value from FreeCAD).
#  HoleAngledDepth: same with DrillForDepth True (depth measured to the cone tip).
#  HoleTwo: two holes (two circles in one sketch).
from _helpers import *

def one(doc, tag, centres=((15, 15),), **kw):
    bd = body(doc, "Body" + tag)
    base = pad_box(doc, bd, 30, 30, 15, name="Base" + tag)
    doc.recompute()
    sk = bd.newObject("Sketcher::SketchObject", "Sketch" + tag)
    attach(sk, base, find_face(base, V(0, 0, 1), 15))
    for (x, y) in centres:
        circle(sk, x, y, 3)
    h = feat(bd, "PartDesign::Hole", "Hole" + tag, Profile=sk, Diameter=6, **kw)
    return h

def build(doc):
    one(doc, "Depth", DepthType="Dimension", Depth=8, DrillPoint="Flat")  # FreeCAD default is Angled 118
    one(doc, "Through", DepthType="ThroughAll", DrillPoint="Flat")
    one(doc, "Angled", DepthType="Dimension", Depth=8, DrillPoint="Angled", DrillPointAngle=118, DrillForDepth=False)
    one(doc, "AngledDepth", DepthType="Dimension", Depth=8, DrillPoint="Angled", DrillPointAngle=118, DrillForDepth=True)
    one(doc, "Two", centres=((8, 8), (22, 22)), DepthType="Dimension", Depth=5, DrillPoint="Flat")  # 2*pi*9*5 = 282.743 -> 13217.257

def variant(doc):
    doc.HoleDepth.Depth = 12
    doc.HoleDepth.Diameter = 8
    return "HoleDepth.Depth 8 -> 12, Diameter 6 -> 8"
