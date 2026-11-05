# Custom (dynamic) properties on objects used by expressions: a document group object "Settings" carries "Wall" (Length 2 mm) and "Count" (Integer 4);
# a Part::Box carries "Scale" (Float). The pad Length = Settings.Wall * 5; pattern Occurrences = Settings.Count; the box Length = Box.Scale * 1 mm... (own dynamic property).
from _helpers import *

def build(doc):
    st = doc.addObject("App::DocumentObjectGroup", "Settings")   # a Body cannot be referenced from its own features (cycle)
    st.addProperty("App::PropertyLength", "Wall", "Custom", "wall thickness")
    st.addProperty("App::PropertyInteger", "Count", "Custom", "pattern count")
    st.Wall = 2
    st.Count = 4
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    rect_origin(sk, 6, 6)
    pad = feat(bd, "PartDesign::Pad", "Pad", Profile=sk)
    pad.setExpression("Length", "Settings.Wall * 5")
    doc.recompute()
    lp = bd.newObject("PartDesign::LinearPattern", "Pattern")
    lp.Originals = [pad]
    lp.Direction = (origin_axis(bd, "X"), [""])
    lp.Length = 30
    lp.setExpression("Occurrences", "Settings.Count")
    bd.Tip = lp
    box = doc.addObject("Part::Box", "Box")
    box.addProperty("App::PropertyFloat", "Scale", "Custom", "factor")
    box.Scale = 3.5
    box.setExpression("Length", "Box.Scale * 2 mm")
    box.setExpression("Width", "Box.Length")
    box.Height = 4

def variant(doc):
    doc.Settings.Wall = 3
    doc.Settings.Count = 2
    doc.Box.Scale = 6
    return "Settings.Wall 2 -> 3 (pad 15), Count 4 -> 2, Box.Scale 3.5 -> 6 (box 12 x 12 x 4)"
