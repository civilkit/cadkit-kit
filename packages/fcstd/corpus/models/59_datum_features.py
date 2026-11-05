# Datum plane/line/point with attachment modes, in a Body that has a base block 20 x 30 x 10 (z 0..10).
#  PlaneTop: FlatFace on the top face with offset z=5; PlaneMid: ParallelPlane? (via origin XY plane + offset);
#  PlaneEdge: NormalToEdge on a base edge (MapPathParameter 0.5); Plane3Pt: ThreePointsPlane from 3 vertices;
#  LineZ: ObjectZ of the XZ plane; LineTwo: TwoPointLine through two vertices; PointVertex: Vertex; PointCenter: CenterOfMass? of a face;
#  CS: PartDesign::CoordinateSystem at a vertex with offset rotation. The datum Placements are the reference.
from _helpers import *

def build(doc):
    bd = body(doc)
    base = pad_box(doc, bd, 20, 30, 10, name="Base")
    doc.recompute()
    top = find_face(base, V(0, 0, 1), 10)
    e0 = find_edge(base, V(0, 0, 0), V(20, 0, 0))
    def d(typ, name, mode, subs, off=None, support=None, param=None):
        o = bd.newObject(typ, name)
        attach(o, support or base, "", mode)
        o.AttachmentSupport = [(support or base, s) for s in subs]
        o.MapMode = mode
        if off is not None:
            o.AttachmentOffset = off
        if param is not None:
            o.MapPathParameter = param
        return o
    d("PartDesign::Plane", "PlaneTop", "FlatFace", [top], App.Placement(V(0, 0, 5), App.Rotation()))
    d("PartDesign::Plane", "PlaneOrigin", "FlatFace", [""], App.Placement(V(0, 0, 3), App.Rotation(V(0, 1, 0), 20)), support=origin_plane(bd, "XY"))
    d("PartDesign::Plane", "PlaneEdge", "NormalToEdge", [e0], param=0.5)
    d("PartDesign::Plane", "Plane3Pt", "ThreePointsPlane", ["Vertex1", "Vertex2", "Vertex4"])
    d("PartDesign::Line", "LineZ", "ObjectZ", [""], App.Placement(V(1, 2, 3), App.Rotation()), support=origin_plane(bd, "XZ"))
    d("PartDesign::Line", "LineTwo", "TwoPointLine", ["Vertex1", "Vertex8"])
    d("PartDesign::Point", "PointVertex", "Vertex", ["Vertex3"])
    d("PartDesign::Point", "PointFace", "CenterOfMass", [top])
    d("PartDesign::CoordinateSystem", "CS", "ObjectXY", [""], App.Placement(V(0, 0, 0), App.Rotation(V(0, 0, 1), 45)), support=origin_plane(bd, "XY"))

def variant(doc):
    doc.PlaneTop.AttachmentOffset = App.Placement(V(0, 0, 9), App.Rotation())
    doc.LineZ.AttachmentOffset = App.Placement(V(4, 5, 6), App.Rotation())
    return "PlaneTop offset z 5 -> 9, LineZ offset (1,2,3) -> (4,5,6)"
