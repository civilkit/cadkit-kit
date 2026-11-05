# ShapeBinder and SubShapeBinder. BodySrc: block 20 x 20 x 10 with a pad sketch. BodyUse refers to it:
#  a SubShapeBinder of the source sketch used as the Profile of a Pad (Length 5: volume 2000),
#  and a ShapeBinder to the source top face used as the support of a sketch with a circle R3 padded 4 (+ pi*9*4 = 113.097).
from _helpers import *

def build(doc):
    src = body(doc, "BodySrc")
    sk = sketch(doc, src, "SrcSketch")
    rect_origin(sk, 20, 20)
    pad = feat(src, "PartDesign::Pad", "SrcPad", Profile=sk, Length=10)
    doc.recompute()
    use = body(doc, "BodyUse")
    sb = use.newObject("PartDesign::SubShapeBinder", "SketchBinder")
    sb.Support = [(sk, "")]
    doc.recompute()
    p = feat(use, "PartDesign::Pad", "UsePad", Profile=(sb, [""]), Length=5)
    doc.recompute()
    fb = use.newObject("PartDesign::ShapeBinder", "FaceBinder")
    fb.Support = [(pad, find_face(pad, V(0, 0, 1), 10))]
    doc.recompute()
    s2 = use.newObject("Sketcher::SketchObject", "BossSketch")
    attach(s2, fb, "")
    circle(s2, 10, 10, 3, "R")
    feat(use, "PartDesign::Pad", "BossPad", Profile=s2, Length=4)

def variant(doc):
    doc.SrcSketch.setDatum("Width", App.Units.Quantity("30 mm"))
    return "SrcSketch Width 20 -> 30: the binder follows (UsePad volume 3000)"
