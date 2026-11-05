# Part::Compound of a Body and a Part::Box (volume 6000 + 1000 = 7000), a Part::Feature carrying a stored shape (no recipe)
# and a Part::Feature created from a Part.makeCylinder shape: the importer can only use the stored shape.
from _helpers import *

def build(doc):
    bd = body(doc, "Body")
    pad_box(doc, bd, 20, 30, 10, name="Pad")
    box = doc.addObject("Part::Box", "Box")
    box.Length = box.Width = box.Height = 10
    box.Placement = App.Placement(V(40, 0, 0), App.Rotation())
    doc.recompute()
    c = doc.addObject("Part::Compound", "Compound")
    c.Links = [bd, box]
    plain = doc.addObject("Part::Feature", "PlainShape")
    plain.Shape = Part.makeCylinder(4, 12, V(0, 60, 0))

def variant(doc):
    doc.Box.Length = 25
    return "Box.Length 10 -> 25 (compound volume 6000 + 2500)"
