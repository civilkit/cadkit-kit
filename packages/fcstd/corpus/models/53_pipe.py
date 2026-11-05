# AdditivePipe and SubtractivePipe. Profile: circle R3 on XY at the origin.
#  PipeLine: spine = straight line along Z, length 30: pi*9*30 = 848.230.
#  PipeArc: spine = quarter circle radius 20 in the XZ plane from (0,0) up to (20,20): Pappus pi*9 * (pi*20/2) = 888.264.
#  PipeFrenet: same arc with Mode Frenet.  PipeSub: subtractive pipe along the line through a block 20 x 20 x 40 at z 0..40.
from _helpers import *

def prof(doc, bd, tag, plane="XY", offset=None):
    sk = sketch(doc, bd, "Profile" + tag, plane, offset)
    circle(sk, 0, 0, 3, "R", at_origin=True)
    return sk

def spine_line(doc, bd, tag):
    sk = sketch(doc, bd, "Spine" + tag, "XZ")
    sk.addGeometry(Part.LineSegment(V(0, 0, 0), V(0, 30, 0)), False)
    return sk

def spine_arc(doc, bd, tag):
    sk = sketch(doc, bd, "Spine" + tag, "XZ")
    sk.addGeometry(Part.ArcOfCircle(Part.Circle(V(20, 0, 0), V(0, 0, 1), 20), math.pi / 2, math.pi), False)
    return sk

def build(doc):
    bd = body(doc, "BodyLine")
    p = prof(doc, bd, "Line"); s = spine_line(doc, bd, "Line")
    feat(bd, "PartDesign::AdditivePipe", "PipeLine", Profile=p, Spine=(s, ["Edge1"]))
    for tag, mode in (("Arc", "Standard"), ("Frenet", "Frenet")):
        bd = body(doc, "Body" + tag)
        p = prof(doc, bd, tag); s = spine_arc(doc, bd, tag)
        feat(bd, "PartDesign::AdditivePipe", "Pipe" + tag, Profile=p, Spine=(s, ["Edge1"]), Mode=mode)
    bd = body(doc, "BodySub")
    base = pad_box(doc, bd, 20, 20, 40, name="Base")
    doc.recompute()
    p = sketch(doc, bd, "ProfileSub", "XY", App.Placement(V(10, 10, 0), App.Rotation()))
    circle(p, 0, 0, 3, "R", at_origin=True)
    s = sketch(doc, bd, "SpineSub", "XZ", App.Placement(V(10, 0, 0), App.Rotation()))
    s.addGeometry(Part.LineSegment(V(0, 0, 0), V(0, 30, 0)), False)
    feat(bd, "PartDesign::SubtractivePipe", "PipeSub", Profile=p, Spine=(s, ["Edge1"]))

def variant(doc):
    doc.ProfileLine.setDatum("R", App.Units.Quantity("5 mm"))
    doc.ProfileSub.setDatum("R", App.Units.Quantity("4 mm"))
    return "ProfileLine R 3 -> 5 (pi*25*30 = 2356.19); ProfileSub R 3 -> 4"
