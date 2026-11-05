# Revolution: profile rectangle x 10..20, y 2..8 on XY revolved about different axes/angles.
# Full ring about H_Axis (global X): pi*(8^2-2^2)*10 = 600*pi = 1884.956.
#  RevFull 360 about sketch H_Axis; RevPart 90 deg (471.239); RevMid 90 deg symmetric; RevRev 90 deg Reversed;
#  RevCons about a construction line (Axis0) at y=0; RevOrigin about the Body origin X_Axis feature.
# RevV: profile x 2..8, y 0..10 about V_Axis (global Y): pi*(64-4)*10 = 1884.956.
from _helpers import *

def prof(doc, bd, tag, x0=10, y0=2, x1=20, y1=8, cons=False):
    sk = sketch(doc, bd, "Sketch" + tag)
    rect(sk, x0, y0, x1, y1)
    if cons:
        sk.addGeometry(Part.LineSegment(V(0, 0, 0), V(30, 0, 0)), True)
    return sk

def one(doc, tag, axis, **kw):
    bd = body(doc, "Body" + tag)
    sk = prof(doc, bd, tag, cons=(axis == "cons"))
    f = feat(bd, "PartDesign::Revolution", "Rev" + tag, Profile=sk, Angle=kw.pop("Angle", 360), **kw)
    if axis == "H":
        f.ReferenceAxis = (sk, ["H_Axis"])
    elif axis == "cons":
        f.ReferenceAxis = (sk, ["Axis0"])
    elif axis == "origin":
        f.ReferenceAxis = (origin_axis(bd, "X"), [""])
    return f

def build(doc):
    one(doc, "Full", "H")
    one(doc, "Part", "H", Angle=90)
    one(doc, "Mid", "H", Angle=90, Midplane=True)
    one(doc, "Rev", "H", Angle=90, Reversed=True)
    one(doc, "Cons", "cons", Angle=180)
    one(doc, "Origin", "origin", Angle=270)
    bd = body(doc, "BodyV")
    sk = prof(doc, bd, "V", 2, 0, 8, 10)
    f = feat(bd, "PartDesign::Revolution", "RevV", Profile=sk, Angle=360)
    f.ReferenceAxis = (sk, ["V_Axis"])

def variant(doc):
    doc.RevPart.Angle = 180
    doc.RevOrigin.Angle = 90
    return "RevPart.Angle 90 -> 180 (942.478); RevOrigin.Angle 270 -> 90 (471.239)"
