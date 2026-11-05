# Sketch: closed 4-line rectangle (horizontal/vertical/coincident, named dimensions), padded.
# Covers: Sketcher lines, Horizontal, Vertical, Coincident, DistanceX/Y named constraints, Pad Length.
# Expected: 20 x 30 x 10 -> volume 6000, area 2*(600+200+300)=2200, centre of mass (10,15,5).
from _helpers import *

def build(doc):
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch", "XY")
    rect_origin(sk, 20, 30)
    feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=10)

def variant(doc):
    doc.Sketch.setDatum("Width", App.Units.Quantity("40 mm"))
    return "Width 20 -> 40: volume 12000"
