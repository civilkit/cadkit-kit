# Pad whose Profile is a face of an earlier feature (no sketch): the top face of a 20 x 30 x 10 pad padded again by 6
# (Profile = (Pad, ['FaceN'])). Result 20 x 30 x 16 = 9600. The importer must take the profile from the stored shape of Pad.
from _helpers import *

def build(doc):
    bd = body(doc)
    base = pad_box(doc, bd, 20, 30, 10, name="Pad")
    doc.recompute()
    p = feat(bd, "PartDesign::Pad", "FacePad", Length=6)
    p.Profile = (base, [find_face(base, V(0, 0, 1), 10)])

def variant(doc):
    doc.FacePad.Length = 12
    return "FacePad.Length 6 -> 12 (volume 13200)"
