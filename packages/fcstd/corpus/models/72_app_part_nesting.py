# App::Part nesting: Assembly (placed at (100,0,0) rotated 30 deg about Z) contains SubPart (at (0,50,0), rotated 90 deg about X)
# which contains a Body (Placement (5,0,0)) with a 20 x 30 x 10 pad. A second Body sits directly in Assembly.
# getGlobalPlacement of every object is recorded in the dump (globalPlacement).
from _helpers import *

def build(doc):
    asm = doc.addObject("App::Part", "Assembly")
    asm.Placement = App.Placement(V(100, 0, 0), App.Rotation(V(0, 0, 1), 30))
    sub = doc.addObject("App::Part", "SubPart")
    sub.Placement = App.Placement(V(0, 50, 0), App.Rotation(V(1, 0, 0), 90))
    asm.addObject(sub)
    b1 = body(doc, "BodyInSub")
    sub.addObject(b1)
    b1.Placement = App.Placement(V(5, 0, 0), App.Rotation())
    pad_box(doc, b1, 20, 30, 10, name="PadInSub")
    b2 = body(doc, "BodyInAsm")
    asm.addObject(b2)
    pad_box(doc, b2, 10, 10, 10, name="PadInAsm")

def variant(doc):
    doc.Assembly.Placement = App.Placement(V(100, 20, 0), App.Rotation(V(0, 0, 1), 60))
    doc.PadInSub.Length = 25
    return "Assembly rotated 60 deg and moved; PadInSub.Length 10 -> 25"
