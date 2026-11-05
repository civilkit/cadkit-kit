# App::Link to an App::Part that contains a Body: the part is rotated 90 deg about Z, the links add their own placements.
# Global placement of the objects inside a linked part is only defined through the link (the dump records link placements).
from _helpers import *

def build(doc):
    part = doc.addObject("App::Part", "Unit")
    part.Placement = App.Placement(V(0, 0, 0), App.Rotation(V(0, 0, 1), 90))
    bd = body(doc, "Inner")
    part.addObject(bd)
    pad_box(doc, bd, 20, 30, 10, name="Pad")
    doc.recompute()
    for i, (x, ang) in enumerate(((100, 0), (200, 45))):
        l = doc.addObject("App::Link", "Link%d" % (i + 1))
        l.LinkedObject = part
        l.Placement = App.Placement(V(x, 0, 0), App.Rotation(V(0, 0, 1), ang))

def variant(doc):
    doc.Unit.Placement = App.Placement(V(0, 0, 5), App.Rotation(V(0, 0, 1), 0))
    return "Unit.Placement rotation 90 -> 0 deg and z = 5"
