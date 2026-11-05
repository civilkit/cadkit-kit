# Draft on the 4 side faces of a 20 x 30 x 10 block, neutral plane = bottom face (z = 0), angle 5 deg.
# Faces lean so the top is smaller (or larger when Reversed). Narrowing: t = 10*tan(5deg) = 0.87489,
# V = 10/3 * (600 + (20-2t)(30-2t) + sqrt(600*(20-2t)(30-2t))) = 5572.76 (FreeCAD).
from _helpers import *

def one(doc, tag, ang, rev):
    bd = body(doc, "Body" + tag)
    base = pad_box(doc, bd, 20, 30, 10, name="Base" + tag)
    doc.recompute()
    sides = [("Face%d" % (i + 1)) for i, f in enumerate(base.Shape.Faces) if abs(f.normalAt(0, 0).z) < 1e-9]
    bottom = find_face(base, V(0, 0, -1), 0)
    d = feat(bd, "PartDesign::Draft", "Draft" + tag, Angle=ang, Reversed=rev)
    d.Base = (base, sides)
    d.NeutralPlane = (base, [bottom])

def build(doc):
    one(doc, "In", 5, False)
    one(doc, "Out", 5, True)

def variant(doc):
    doc.DraftIn.Angle = 10
    return "DraftIn.Angle 5 -> 10"
