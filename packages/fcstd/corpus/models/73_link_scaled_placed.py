# App::Link to a Body: placed and scaled. LinkA: Placement (50,0,0), no scale. LinkB: scale 2, Placement (0,50,0) (volume x8: 8*6000 = 48000).
# LinkC: ScaleVector (1,2,3) non-uniform; link to a Part::Box too (LinkBox).
from _helpers import *

def build(doc):
    bd = body(doc, "Src")
    pad_box(doc, bd, 20, 30, 10, name="Pad")
    box = doc.addObject("Part::Box", "Box")
    box.Length = box.Width = box.Height = 10
    doc.recompute()
    def lk(name, target, pl, scale=None, sv=None):
        l = doc.addObject("App::Link", name)
        l.LinkedObject = target
        l.Placement = pl
        if scale is not None:
            l.Scale = scale
        if sv is not None:
            l.ScaleVector = sv
        return l
    lk("LinkA", bd, App.Placement(V(50, 0, 0), App.Rotation()))
    lk("LinkB", bd, App.Placement(V(0, 50, 0), App.Rotation()), scale=2)
    lk("LinkC", bd, App.Placement(V(0, 100, 0), App.Rotation(V(0, 0, 1), 45)), sv=V(1, 2, 3))
    lk("LinkBox", box, App.Placement(V(0, 0, 50), App.Rotation()))

def variant(doc):
    doc.LinkB.Scale = 3
    doc.Pad.Length = 20
    return "LinkB.Scale 2 -> 3, Pad.Length 10 -> 20 (the links follow the source)"
