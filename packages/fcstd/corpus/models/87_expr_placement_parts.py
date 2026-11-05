# Expressions on Placement components and Part primitive properties: Box.Placement.Base.x = Params.step * 2,
# Cylinder.Placement.Rotation.Angle = Params.tilt, Link.Scale from a cell, LinearPattern Length from a cell.
from _helpers import *

def build(doc):
    sh = doc.addObject("Spreadsheet::Sheet", "Params")
    for i, (alias, val) in enumerate((("step", "15 mm"), ("tilt", "30 deg"), ("scale", "2"), ("span", "40 mm")), start=1):
        sh.set("B%d" % i, val); sh.setAlias("B%d" % i, alias)
    doc.recompute()
    bx = doc.addObject("Part::Box", "Box")
    bx.setExpression("Placement.Base.x", "Params.step * 2")
    cy = doc.addObject("Part::Cylinder", "Cyl")
    cy.Placement = App.Placement(V(60, 0, 0), App.Rotation(V(0, 1, 0), 10))
    cy.setExpression("Placement.Rotation.Angle", "Params.tilt")
    bd = body(doc, "Src")
    pad_box(doc, bd, 5, 5, 5, name="Pad")
    doc.recompute()
    lk = doc.addObject("App::Link", "Link")
    lk.LinkedObject = bd
    lk.Placement = App.Placement(V(0, 80, 0), App.Rotation())
    lk.setExpression("Scale", "Params.scale")
    b2 = body(doc, "BodyPat")
    s = sketch(doc, b2, "S")
    rect_origin(s, 5, 5)
    pd = feat(b2, "PartDesign::Pad", "PatPad", Profile=s, Length=5)
    doc.recompute()
    lp = b2.newObject("PartDesign::LinearPattern", "Pattern")
    lp.Originals = [pd]
    lp.Direction = (origin_axis(b2, "X"), [""])
    lp.Occurrences = 3
    lp.setExpression("Length", "Params.span")
    b2.Tip = lp

def variant(doc):
    doc.Params.set("B1", "25 mm")
    doc.Params.set("B2", "60 deg")
    doc.Params.set("B3", "3")
    doc.Params.set("B4", "60 mm")
    return "step 15 -> 25, tilt 30 -> 60 deg, scale 2 -> 3, span 40 -> 60 mm"
