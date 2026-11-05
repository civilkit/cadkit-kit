# Part::Mirroring of a box 10 x 10 x 10 at (5,0,0) about the YZ plane (Base (0,0,0), Normal (1,0,0)) and about
# an oblique plane. The mirror image is a separate shape of the same volume 1000 at x -15..-5.
from _helpers import *

def build(doc):
    bx = doc.addObject("Part::Box", "Box")
    bx.Length = bx.Width = bx.Height = 10
    bx.Placement = App.Placement(V(5, 0, 0), App.Rotation())
    m = doc.addObject("Part::Mirroring", "MirrorYZ")
    m.Source = bx
    m.Base = V(0, 0, 0)
    m.Normal = V(1, 0, 0)
    m2 = doc.addObject("Part::Mirroring", "MirrorOblique")
    m2.Source = bx
    m2.Base = V(0, 0, 0)
    m2.Normal = V(1, 1, 0)

def variant(doc):
    doc.MirrorYZ.Base = V(3, 0, 0)
    doc.Box.Length = 20
    return "MirrorYZ.Base x 0 -> 3, Box.Length 10 -> 20 (volume 2000)"
