# App::Link array (ElementCount = 3) of a Body, with per-element placements (x = 0, 40, 80) and a LinkGroup holding two links.
# The array elements are App::LinkElement objects; ShowElement=True creates them explicitly.
from _helpers import *

def build(doc):
    bd = body(doc, "Src")
    pad_box(doc, bd, 20, 30, 10, name="Pad")
    doc.recompute()
    arr = doc.addObject("App::Link", "Array")
    arr.LinkedObject = bd
    arr.ElementCount = 3
    arr.ShowElement = True
    doc.recompute()
    for i, el in enumerate(arr.ElementList):
        el.Placement = App.Placement(V(40 * i, 0, 0), App.Rotation(V(0, 0, 1), 10 * i))
    lg = doc.addObject("App::LinkGroup", "Group")
    l1 = doc.addObject("App::Link", "InGroup1"); l1.LinkedObject = bd
    l2 = doc.addObject("App::Link", "InGroup2"); l2.LinkedObject = bd
    l2.Placement = App.Placement(V(0, 60, 0), App.Rotation())
    lg.ElementList = [l1, l2]

def variant(doc):
    doc.Array.ElementCount = 4
    doc.Pad.Length = 6
    return "Array.ElementCount 3 -> 4, Pad.Length 10 -> 6"
