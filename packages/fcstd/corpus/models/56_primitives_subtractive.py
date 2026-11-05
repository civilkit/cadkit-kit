# Subtractive primitives cutting a 60 x 60 x 40 block (volume 144000) centred offset (30,30,20) of the cut.
# Each Body: Pad block, then SubtractiveX attached to XY with offset (20,20,10) so the cut lies inside the block.
#  Box 10x10x10 -> 143000; Cylinder R5 H10 -> 144000-785.398; Sphere R6 centred -> 144000-904.779 (sphere centre = origin of the primitive,
#  half outside the block? no: z 10 +- 6 is inside); Cone, Torus (R1 10, R2 3 around the offset origin), Wedge, Prism, Ellipsoid analogous.
from _helpers import *

def cut(doc, kind, **kw):
    bd = body(doc, "Body" + kind)
    base = pad_box(doc, bd, 60, 60, 40, name="Base" + kind)
    doc.recompute()
    p = bd.newObject("PartDesign::Subtractive" + kind, "Sub" + kind)
    attach(p, origin_plane(bd, "XY"))
    p.AttachmentOffset = App.Placement(V(30, 30, 10), App.Rotation())
    for k, v in kw.items():
        setattr(p, k, v)

def build(doc):
    cut(doc, "Box", Length=10, Width=10, Height=10)
    cut(doc, "Cylinder", Radius=5, Height=10)
    cut(doc, "Sphere", Radius=6)
    cut(doc, "Cone", Radius1=8, Radius2=3, Height=12)
    cut(doc, "Torus", Radius1=10, Radius2=3)
    cut(doc, "Wedge", Xmin=0, Xmax=10, Ymin=0, Ymax=10, Zmin=0, Zmax=10, X2min=2, X2max=8, Z2min=2, Z2max=8)
    cut(doc, "Prism", Polygon=5, Circumradius=6, Height=10)
    cut(doc, "Ellipsoid", Radius1=3, Radius2=4, Radius3=5)
# No variant (size budget): 55_primitives_additive carries the primitive parameter variants.
