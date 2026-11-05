# Additive primitives, one per Body, attached to the XY origin plane with an AttachmentOffset (all start at (10, 20, 30)).
#  Box 10 x 20 x 30 = 6000; Cylinder R5 H10 = 785.398; Sphere R6 = 904.779; Cone R1 10 R2 5 H10 = 1832.596;
#  Torus R1 10 R2 3 = 2*pi^2*10*9 = 1776.529; Wedge: (Xmin..Xmax 0..10, Ymin..Ymax 0..10, Zmin..Zmax 0..10, X2 2..8, Z2 2..8) = 10*... FreeCAD value;
#  Prism hexagon circumradius 6 H10: 3*sqrt(3)/2*36*10 = 935.307; Ellipsoid 3 x 4 x 5 = 251.327.
from _helpers import *

OFF = App.Placement(V(10, 20, 30), App.Rotation())

def prim(doc, kind, **kw):
    bd = body(doc, "Body" + kind)
    p = bd.newObject("PartDesign::Additive" + kind, "Add" + kind)
    attach(p, origin_plane(bd, "XY"))
    p.AttachmentOffset = OFF
    for k, v in kw.items():
        setattr(p, k, v)
    return p

def build(doc):
    prim(doc, "Box", Length=10, Width=20, Height=30)
    prim(doc, "Cylinder", Radius=5, Height=10)
    prim(doc, "Sphere", Radius=6)
    prim(doc, "Cone", Radius1=10, Radius2=5, Height=10)
    prim(doc, "Torus", Radius1=10, Radius2=3)
    prim(doc, "Wedge", Xmin=0, Xmax=10, Ymin=0, Ymax=10, Zmin=0, Zmax=10, X2min=2, X2max=8, Z2min=2, Z2max=8)
    prim(doc, "Prism", Polygon=6, Circumradius=6, Height=10)
    prim(doc, "Ellipsoid", Radius1=3, Radius2=4, Radius3=5)

def variant(doc):
    doc.AddBox.Length = 20
    doc.AddCylinder.Radius = 8
    doc.AddSphere.Radius = 9
    return "AddBox.Length 10 -> 20 (12000); AddCylinder.Radius 5 -> 8; AddSphere.Radius 6 -> 9"
