# Modelled threads (ModelThread=True) in a 20 x 20 x 15 block, M6, depth 5.
# The thread groove is a swept helical cut; the volume and face count are the reference (no closed form).
# No variant: the modelled thread is the largest stored shape of the corpus (about 0.4 MB).
from _helpers import *

def one(doc, tag, size, **kw):
    bd = body(doc, "Body" + tag)
    base = pad_box(doc, bd, 20, 20, 15, name="Base" + tag)
    doc.recompute()
    sk = bd.newObject("Sketcher::SketchObject", "Sketch" + tag)
    attach(sk, base, find_face(base, V(0, 0, 1), 15))
    circle(sk, 10, 10, 3)
    h = feat(bd, "PartDesign::Hole", "Hole" + tag, Profile=sk, DepthType="Dimension", Depth=5)
    h.Threaded = True
    h.ThreadType = "ISOMetricProfile"
    doc.recompute()
    h.ThreadSize = size
    h.ModelThread = True
    for k, v in kw.items():
        setattr(h, k, v)
    return h

def build(doc):
    one(doc, "M6", "M6x1.0")
