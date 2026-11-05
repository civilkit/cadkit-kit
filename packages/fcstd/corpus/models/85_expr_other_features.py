# Expressions on other feature properties: Revolution Angle (Params.angle), Fillet Radius, Hole Diameter and Depth,
# Thickness Value, AttachmentOffset.Base.z of a sketch on the XY plane, Draft angle, Chamfer size.
# Values come from a spreadsheet with unit-bearing cells (angle 90 deg, radius 2 mm, ...).
from _helpers import *

def build(doc):
    sh = doc.addObject("Spreadsheet::Sheet", "Params")
    cells = (("angle", "90 deg"), ("radius", "2 mm"), ("dia", "6 mm"), ("depth", "8 mm"), ("wall", "1.5 mm"), ("lift", "4 mm"), ("size", "1 mm"))
    for i, (alias, val) in enumerate(cells, start=1):
        sh.set("B%d" % i, val)
        sh.setAlias("B%d" % i, alias)
    doc.recompute()
    # revolution
    b1 = body(doc, "BodyRev")
    s1 = sketch(doc, b1, "RevSketch")
    rect(s1, 10, 2, 20, 8)
    rv = feat(b1, "PartDesign::Revolution", "Rev", Profile=s1)
    rv.ReferenceAxis = (s1, ["H_Axis"])
    rv.setExpression("Angle", "Params.angle")
    # fillet + hole + thickness on blocks
    for tag in ("Fillet", "Hole", "Thick", "Chamfer"):
        bd = body(doc, "Body" + tag)
        base = pad_box(doc, bd, 20, 30, 10, name="Base" + tag)
        doc.recompute()
        if tag == "Fillet":
            f = feat(bd, "PartDesign::Fillet", "Fillet")
            f.Base = (base, edges_where(base, lambda e: abs(e.Vertexes[0].Point.x) < 1e-9 and abs(e.Vertexes[-1].Point.x) < 1e-9 and e.Length > 25))
            f.setExpression("Radius", "Params.radius")
        elif tag == "Hole":
            sk = bd.newObject("Sketcher::SketchObject", "HoleSketch")
            attach(sk, base, find_face(base, V(0, 0, 1), 10))
            circle(sk, 10, 15, 3)
            h = feat(bd, "PartDesign::Hole", "Hole", Profile=sk, DepthType="Dimension", DrillPoint="Flat")
            h.setExpression("Diameter", "Params.dia")
            h.setExpression("Depth", "Params.depth")
        elif tag == "Thick":
            t = feat(bd, "PartDesign::Thickness", "Thick")
            t.Base = (base, [find_face(base, V(0, 0, 1), 10)])
            t.setExpression("Value", "Params.wall")
        else:
            c = feat(bd, "PartDesign::Chamfer", "Chamfer", ChamferType="Equal distance")
            c.Base = (base, edges_where(base, lambda e: abs(e.Vertexes[0].Point.x) < 1e-9 and abs(e.Vertexes[-1].Point.x) < 1e-9 and e.Length > 25))
            c.setExpression("Size", "Params.size")
    # sketch lifted by an expression
    b5 = body(doc, "BodyLift")
    s5 = sketch(doc, b5, "LiftSketch")
    s5.setExpression("AttachmentOffset.Base.z", "Params.lift")
    rect_origin(s5, 10, 10)
    feat(b5, "PartDesign::Pad", "LiftPad", Profile=s5, Length=5)

def variant(doc):
    doc.Params.set("B1", "180 deg")
    doc.Params.set("B2", "4 mm")
    doc.Params.set("B3", "10 mm")
    doc.Params.set("B6", "9 mm")
    return "angle 90 -> 180 deg, radius 2 -> 4, dia 6 -> 10, lift 4 -> 9"
