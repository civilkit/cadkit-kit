# Cross-object references: Pad2.Length = Pad.Length * 0.5; sketch2 constraint Width = Sketch.Constraints.Width / 2 (by name);
# a label-based reference <<Base Pad>>.Length; pattern Occurrences = Pad.Length / 5 mm (dimensionless).
# Base Pad 20 x 30 x 10; Pad2 10 x 30 x 5 on the top; cubes pattern of 5 mm cubes, 2 occurrences.
from _helpers import *

def build(doc):
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    rect_origin(sk, 20, 30)
    pad = feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=10)
    pad.Label = "Base Pad"
    doc.recompute()
    sk2 = bd.newObject("Sketcher::SketchObject", "Sketch2")
    attach(sk2, pad, find_face(pad, V(0, 0, 1), 10))
    rect_origin(sk2, 10, 30)
    sk2.setExpression("Constraints.Width", "Sketch.Constraints.Width / 2")
    p2 = feat(bd, "PartDesign::Pad", "Pad2", Profile=sk2)
    p2.setExpression("Length", "<<Base Pad>>.Length * 0.5")
    doc.recompute()
    s3 = bd.newObject("Sketcher::SketchObject", "Sketch3")
    attach(s3, p2, find_face(p2, V(0, 0, 1), 15))
    rect_origin(s3, 3, 3)
    p3 = feat(bd, "PartDesign::Pad", "Pad3", Profile=s3, Length=3)
    doc.recompute()
    lp = bd.newObject("PartDesign::LinearPattern", "Pattern")
    lp.Originals = [p3]
    lp.Direction = (origin_axis(bd, "Y"), [""])
    lp.Length = 20
    lp.setExpression("Occurrences", "Pad.Length / 5 mm")
    bd.Tip = lp

def variant(doc):
    doc.Pad.Length = 20
    doc.Sketch.setDatum("Width", App.Units.Quantity("30 mm"))
    return "Pad.Length 10 -> 20, Sketch Width 20 -> 30 (Pad2 and the pattern follow: 4 occurrences)"
