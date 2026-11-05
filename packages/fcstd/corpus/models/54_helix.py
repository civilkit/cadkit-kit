# AdditiveHelix / SubtractiveHelix. Profile: circle R2 centred at x=10 on the XZ plane, axis = sketch V_Axis (global Z).
#  HelixPitchHeight: Pitch 5, Height 10 (2 turns). Pappus estimate pi*4 * 2 * sqrt((2*pi*10)^2+5^2) = 1584 (FreeCAD's value is the reference).
#  HelixTurns: Mode 'Pitch-Turns-Angle' pitch 5 turns 2.  HelixHeightTurns: 'Height-Turns-Angle' 10 over 1 turn.
#  HelixLeft: left handed. HelixSub: subtractive helix groove in a cylinder R12 x 25.
from _helpers import *

def prof(doc, bd, tag, r=2, cx=10):
    sk = sketch(doc, bd, "Sketch" + tag, "XZ")
    circle(sk, cx, 0, r, "R")
    return sk

def helix(doc, tag, mode, typ="PartDesign::AdditiveHelix", **kw):
    bd = body(doc, "Body" + tag)
    sk = prof(doc, bd, tag)
    h = feat(bd, typ, "Helix" + tag, Profile=sk, Mode=mode, **kw)
    h.ReferenceAxis = (sk, ["V_Axis"])
    return h

def build(doc):
    helix(doc, "PitchHeight", "pitch-height-angle", Pitch=5, Height=10)
    helix(doc, "Turns", "pitch-turns-angle", Pitch=5, Turns=2)
    helix(doc, "HeightTurns", "height-turns-angle", Height=10, Turns=1)
    helix(doc, "Left", "pitch-height-angle", Pitch=5, Height=10, LeftHanded=True)
    bd = body(doc, "BodySub")
    s0 = sketch(doc, bd, "BaseSketch")
    circle(s0, 0, 0, 12, "R", at_origin=True)
    feat(bd, "PartDesign::Pad", "Base", Profile=s0, Length=25)
    doc.recompute()
    sk = sketch(doc, bd, "SketchSub", "XZ")
    circle(sk, 12, 0, 2, "R")
    h = feat(bd, "PartDesign::SubtractiveHelix", "HelixSub", Profile=sk, Mode="pitch-height-angle", Pitch=6, Height=12)
    h.ReferenceAxis = (sk, ["V_Axis"])

def variant(doc):
    doc.HelixPitchHeight.Pitch = 8
    doc.HelixSub.Height = 8
    return "HelixPitchHeight.Pitch 5 -> 8; HelixSub.Height 18 -> 12"
