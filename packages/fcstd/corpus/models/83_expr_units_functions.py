# Expressions with units, functions and conditionals on a 2-pad body.
#  Sketch Width = cos(60 deg) * 40 mm (= 20), Height = 3 * 10 mm (= 30)
#  Pad.Length = max(5 mm; 8 mm) + floor(2.7) * 1 mm (= 10)  [function arguments separated by ';']
#  Pad2.Length = Pad.Length > 9 mm ? 4 mm : 2 mm (= 4)
#  Box (Part): Length = 1 in (25.4), Width = 2 cm + 3 mm (23), Height = sqrt(16) * 1 mm + pi * 0 mm + abs(-3 mm) (7)
# Expected: Pad 6000, Pad2 on the top face 20x30x4 -> 8400 total; Box 25.4 x 23 x 7 = 4089.4.
from _helpers import *

def build(doc):
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    rect_origin(sk, 20, 30)
    sk.setExpression("Constraints.Width", "cos(60 deg) * 40 mm")
    sk.setExpression("Constraints.Height", "3 * 10 mm")
    pad = feat(bd, "PartDesign::Pad", "Pad", Profile=sk)
    pad.setExpression("Length", "max(5 mm; 8 mm) + floor(2.7) * 1 mm")
    doc.recompute()
    sk2 = bd.newObject("Sketcher::SketchObject", "Sketch2")
    attach(sk2, pad, find_face(pad, V(0, 0, 1), 10))
    rect_origin(sk2, 20, 30)
    p2 = feat(bd, "PartDesign::Pad", "Pad2", Profile=sk2)
    p2.setExpression("Length", "Pad.Length > 9 mm ? 4 mm : 2 mm")
    box = doc.addObject("Part::Box", "Box")
    box.setExpression("Length", "1 in")
    box.setExpression("Width", "2 cm + 3 mm")
    box.setExpression("Height", "sqrt(16) * 1 mm + pi * 0 mm + abs(-3 mm)")

def variant(doc):
    doc.Sketch.setExpression("Constraints.Width", "cos(60 deg) * 60 mm")
    doc.Pad.setExpression("Length", "max(5 mm; 8 mm) + floor(0.7) * 1 mm")
    return "Width expr -> cos(60 deg)*60 mm (30); Pad.Length -> 8 mm (Pad2 conditional becomes 2 mm)"
