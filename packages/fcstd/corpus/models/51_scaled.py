# Scaled: a 10 x 10 x 10 cube at 20..30 (centre 25,5,5) scaled by factor 2 with 2 occurrences about its centre of mass.
# FreeCAD keeps the original and adds the scaled copy (factor 2: 8000 ) - overlapping the original: result = the larger cube
# union the original which lies inside it. Expected volume 8000 for a concentric copy.
from _helpers import *

def build(doc):
    bd = body(doc)
    sk = sketch(doc, bd, "Sketch")
    rect(sk, 0, 0, 10, 10)
    pad = feat(bd, "PartDesign::Pad", "Pad", Profile=sk, Length=10)
    doc.recompute()
    s = bd.newObject("PartDesign::Scaled", "Scaled")
    s.Originals = [pad]
    s.Factor = 2
    s.Occurrences = 2
    bd.Tip = s

def variant(doc):
    doc.Scaled.Factor = 1.5
    return "Scaled.Factor 2 -> 1.5 (volume 3375)"
