# Hole with thread settings (cosmetic: Threaded=True, ModelThread=False) for several standards.
# 30 x 30 x 15 block, depth 10. The tapped diameter FreeCAD derives is recorded in the shape volume.
#  ThreadType enum values: ISOMetricProfile (M6x1.0), ISOMetricFineProfile (M8x1), UNC (1/4), NPT (1/8); left hand variant.
# Block 13500; DrillPoint is left at FreeCAD's default (Angled).
from _helpers import *

def pick(h, prop, wanted):
    items = h.getEnumerationsOfProperty(prop)
    for w in wanted:
        for it in items:
            if it == w or it.startswith(w):
                return it
    return items[0]

def one(doc, tag, ttype, size, **kw):
    bd = body(doc, "Body" + tag)
    base = pad_box(doc, bd, 30, 30, 15, name="Base" + tag)
    doc.recompute()
    sk = bd.newObject("Sketcher::SketchObject", "Sketch" + tag)
    attach(sk, base, find_face(base, V(0, 0, 1), 15))
    circle(sk, 15, 15, 3)
    h = feat(bd, "PartDesign::Hole", "Hole" + tag, Profile=sk, DepthType="Dimension", Depth=10)
    h.Threaded = True
    h.ThreadType = ttype
    doc.recompute()
    h.ThreadSize = pick(h, "ThreadSize", size)
    doc.recompute()
    for k, v in kw.items():
        setattr(h, k, v)
    return h

def build(doc):
    one(doc, "M6", "ISOMetricProfile", ["M6x"])
    one(doc, "M8x1", "ISOMetricFineProfile", ["M8x1"])
    one(doc, "M6Left", "ISOMetricProfile", ["M6x"], ThreadDirection="Left")
    one(doc, "UNC", "UNC", ["1/4"])
    one(doc, "NPT", "NPT", ["1/8"])

def variant(doc):
    doc.HoleM6.ThreadSize = "M8x1.25"
    return "HoleM6.ThreadSize M6x1.0 -> M8x1.25"
