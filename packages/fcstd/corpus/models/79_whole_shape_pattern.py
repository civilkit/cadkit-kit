# TransformMode "Whole shape" (FreeCAD 1.1; 'Transform body' in 1.0): a LinearPattern and a Mirrored that repeat the whole
# shape of the Body so far (Pad + Pocket) instead of selected features.
# Pad 20 x 20 x 5 (2000), Pocket hole R3 through (-141.372): 1858.628; LinearPattern whole shape, 2 occurrences over 40: 2 copies.
from _helpers import *

def build(doc):
    bd = body(doc)
    base = pad_box(doc, bd, 20, 20, 5, name="Pad")
    doc.recompute()
    hs = bd.newObject("Sketcher::SketchObject", "HoleSketch")
    attach(hs, base, find_face(base, V(0, 0, 1), 5))
    circle(hs, 10, 10, 3, "R")
    pk = feat(bd, "PartDesign::Pocket", "Pocket", Profile=hs, Type="ThroughAll")
    doc.recompute()
    lp = bd.newObject("PartDesign::LinearPattern", "Pattern")
    lp.TransformMode = "Whole shape"
    lp.Direction = (origin_axis(bd, "X"), [""])
    lp.Length = 40
    lp.Occurrences = 2
    bd.Tip = lp
    doc.recompute()
    mi = bd.newObject("PartDesign::Mirrored", "Mirrored")
    mi.TransformMode = "Whole shape"
    mi.MirrorPlane = (origin_plane(bd, "XZ"), [""])
    bd.Tip = mi

def variant(doc):
    doc.Pattern.Occurrences = 3
    return "Pattern.Occurrences 2 -> 3"
