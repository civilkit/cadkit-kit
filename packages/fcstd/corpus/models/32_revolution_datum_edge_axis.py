# Revolution about other axis kinds: a PartDesign datum line (tilted), and an edge of the previous pad.
# BodyEdge: block 20 x 20 x 10 at x 0..20; a profile rectangle on the XZ plane (x 25..30, z 0..8) revolved 360 about the block's
# vertical edge at (20,0) -> we use the edge from (20,0,0) to (20,0,10) (Edge index found by geometry): ring r 5..10 height 8.
# Ring volume: pi*(10^2 - 5^2)*8 = 600*pi = 1884.956 (outside the block, except where the ring overlaps the block).
from _helpers import *

def build(doc):
    bd = body(doc, "BodyEdge")
    base = pad_box(doc, bd, 20, 20, 10, name="Base")
    doc.recompute()
    ed = find_edge(base, V(20, 0, 0), V(20, 0, 10))
    sk = sketch(doc, bd, "Profile", "XZ")
    rect(sk, 25, 0, 30, 8)
    rv = feat(bd, "PartDesign::Revolution", "Rev", Profile=sk, Angle=360)
    rv.ReferenceAxis = (base, [ed])
    bd2 = body(doc, "BodyDatum")
    ln = bd2.newObject("PartDesign::Line", "AxisLine")
    attach(ln, origin_plane(bd2, "XY"), "", "ObjectZ")
    ln.AttachmentOffset = App.Placement(V(0, 0, 0), App.Rotation(V(1, 0, 0), 20))
    doc.recompute()
    s2 = sketch(doc, bd2, "Profile2", "XZ")
    rect(s2, 10, 5, 15, 12)
    r2 = feat(bd2, "PartDesign::Revolution", "RevDatum", Profile=s2, Angle=180)
    r2.ReferenceAxis = (ln, [""])

def variant(doc):
    doc.Rev.Angle = 180
    doc.RevDatum.Angle = 270
    return "Rev.Angle 360 -> 180, RevDatum.Angle 180 -> 270"
