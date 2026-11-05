# Sketches outside any Body attached to a Part::Box with different MapModes and offsets.
# Covers ObjectXY, ObjectXZ, ObjectYZ, Translate (vertex), NormalToEdge (+MapPathParameter), FlatFace + offset,
# ThreePointsPlane, MapReversed and Deactivated with a free Placement. Each sketch holds a 4 x 2 rectangle.
# The Box is 10 x 20 x 30 placed at (5,6,7) rotated 20 deg about Z. The sketch Placement values are the reference.
from _helpers import *

def rect_sketch(doc, name):
    sk = doc.addObject("Sketcher::SketchObject", name)
    sk.AttacherEngine = "Engine Plane"
    rect(sk, 0, 0, 4, 2)
    return sk

def build(doc):
    bx = doc.addObject("Part::Box", "Box")
    bx.Length, bx.Width, bx.Height = 10, 20, 30
    bx.Placement = App.Placement(V(5, 6, 7), App.Rotation(V(0, 0, 1), 20))
    doc.recompute()
    def mk(name, mode, subs, off=None, rev=False, param=None):
        sk = rect_sketch(doc, name)
        sk.AttachmentSupport = [(bx, s) for s in subs]
        sk.MapMode = mode
        if off is not None:
            sk.AttachmentOffset = off
        if rev:
            sk.MapReversed = True
        if param is not None:
            sk.MapPathParameter = param
        return sk
    mk("SkObjXY", "ObjectXY", [""])
    mk("SkObjXZ", "ObjectXZ", [""])
    mk("SkObjYZ", "ObjectYZ", [""])
    mk("SkTranslate", "Translate", ["Vertex7"])
    mk("SkNormalEdge", "NormalToEdge", ["Edge1"], param=0.5)
    mk("SkFace6Off", "FlatFace", ["Face6"], App.Placement(V(1, 2, 3), App.Rotation(V(0, 0, 1), 45)))
    mk("SkFace1Rev", "FlatFace", ["Face1"], rev=True)
    mk("Sk3Points", "ThreePointsPlane", ["Vertex1", "Vertex2", "Vertex5"])
    free = rect_sketch(doc, "SkFree")
    free.MapMode = "Deactivated"
    free.Placement = App.Placement(V(1, 1, 1), App.Rotation(V(0, 1, 0), 90))

def variant(doc):
    doc.Box.Length = 14
    doc.Box.Placement = App.Placement(V(5, 6, 7), App.Rotation(V(0, 0, 1), 50))
    return "Box.Length 10 -> 14 and rotation 20 -> 50 deg: attached sketches follow"
