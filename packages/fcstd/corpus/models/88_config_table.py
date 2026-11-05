# Configuration-style parameters: a selector cell (Config!B1 = 1..3) picks one row of a table with IF-style formulas;
# the dimensions of a plate with holes follow the selected configuration.
#  Config 1: 40 x 20 x 5, hole 4; config 2: 60 x 30 x 8, hole 6; config 3: 80 x 40 x 10, hole 8.
# Plate volume minus a through hole of the configured diameter: config 1: 4000 - pi*4*5 = 3937.168.
from _helpers import *

def build(doc):
    c = doc.addObject("Spreadsheet::Sheet", "Config")
    c.set("A1", "select"); c.set("B1", "1"); c.setAlias("B1", "select")
    rows = {"plate_w": (40, 60, 80), "plate_h": (20, 30, 40), "plate_t": (5, 8, 10), "hole_d": (4, 6, 8)}
    for r, (name, vals) in enumerate(rows.items(), start=3):
        c.set("A%d" % r, name)
        for k, v in enumerate(vals):
            c.set("%s%d" % ("BCD"[k], r), "%d mm" % v)
        c.set("F%d" % r, "=select == 1 ? B%d : (select == 2 ? C%d : D%d)" % (r, r, r))
        c.setAlias("F%d" % r, name)
    doc.recompute()
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    rect_origin(sk, 40, 20)
    sk.setExpression("Constraints.Width", "Config.plate_w")
    sk.setExpression("Constraints.Height", "Config.plate_h")
    pad = feat(bd, "PartDesign::Pad", "Pad", Profile=sk)
    pad.setExpression("Length", "Config.plate_t")
    doc.recompute()
    hs = bd.newObject("Sketcher::SketchObject", "HoleSketch")
    attach(hs, pad, find_face(pad, V(0, 0, 1), 5))
    circle(hs, 10, 10, 2, "R")
    hs.setExpression("Constraints.R", "Config.hole_d / 2")
    feat(bd, "PartDesign::Pocket", "Pocket", Profile=hs, Type="ThroughAll")

def variant(doc):
    doc.Config.set("B1", "3")
    return "select 1 -> 3: 80 x 40 x 10 plate with an 8 mm hole: 32000 - pi*16*10 = 31497.3"
