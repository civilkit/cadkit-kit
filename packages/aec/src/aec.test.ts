import { describe, expect, it } from 'vitest';
import {
  TCODE_LAYER_TABLE,
  TCODE_OBJECT_TABLE,
  TCODE_SETTINGS_TABLE,
  build3dmFile,
  buildDwgFile,
  buildRvtCfbFile,
  detectAecFormat,
  import3dm,
  importAec,
  importDwg,
  importIfc,
  importRvt,
  looksLike3dm,
  looksLikeDwg,
  looksLikeIfc,
  looksLikeRvt,
  read3dmChunks,
  readCfbStreams,
} from './index';

describe('@kit/aec — IFC (.ifc) BIM Importer (IFC4 & IFC2x3)', () => {
  const MULTI_STOREY_IFC4 = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('TwoStoreyOffice.ifc','2026-11-23T10:00:00',('Architect'),('CadKit BIM'),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0xScRe401',#2,'Office Building',$,$,$,$,(#10),#11);
#2=IFCOWNERHISTORY($,$,$,.ADDED.,$,$,$,0);
#10=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#20,$);
#11=IFCUNITASSIGNMENT((#12,#13));
/* Length unit is METRE (scale 1000 to mm) */
#12=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#13=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);
#20=IFCAXIS2PLACEMENT3D(#21,#22,#23);
#21=IFCCARTESIANPOINT((0.,0.,0.));
#22=IFCDIRECTION((0.,0.,1.));
#23=IFCDIRECTION((1.,0.,0.));
#24=IFCDIRECTION((0.,1.,0.));

/* Spatial Hierarchy: Site -> Building -> Ground Floor (0m) & Level 1 (3.5m) */
#30=IFCLOCALPLACEMENT($,#20);
#31=IFCSITE('Site01',#2,'Main Campus',$,$,#30,$,$,.ELEMENT.,$,$,$,$,$);
#32=IFCLOCALPLACEMENT(#30,#20);
#33=IFCBUILDING('Bldg01',#2,'Tower A',$,$,#32,$,$,.ELEMENT.,$,$,$);

/* Ground Floor at Z = 0.0 m */
#40=IFCAXIS2PLACEMENT3D(#21,#22,#23);
#41=IFCLOCALPLACEMENT(#32,#40);
#42=IFCBUILDINGSTOREY('Storey0',#2,'Ground Floor',$,$,#41,$,'Ground Floor',.ELEMENT.,0.0);

/* Level 1 at Z = 3.5 m (3500 mm) */
#45=IFCCARTESIANPOINT((0.,0.,3.5));
#46=IFCAXIS2PLACEMENT3D(#45,#22,#23);
#47=IFCLOCALPLACEMENT(#32,#46);
#48=IFCBUILDINGSTOREY('Storey1',#2,'Level 1',$,$,#47,$,'Level 1',.ELEMENT.,3.5);

#50=IFCRELAGGREGATES('Rel01',#2,$,$,#1,(#31));
#51=IFCRELAGGREGATES('Rel02',#2,$,$,#31,(#33));
#52=IFCRELAGGREGATES('Rel03',#2,$,$,#33,(#42,#48));

/* Styles: Concrete Wall (#c8bfb4 -> 0.784, 0.749, 0.706), Steel Column (#3b6fd4), Glass Slab/Roof (#d95f43) */
#60=IFCCOLOURRGB('Concrete',0.7843,0.7490,0.7059);
#61=IFCSURFACESTYLERENDERING(#60,0.0,$,$,$,$,$,$,.NOTDEFINED.);
#62=IFCSURFACESTYLE('ConcreteStyle',.BOTH.,(#61));
#63=IFCCOLOURRGB('SteelBlue',0.2314,0.4353,0.8314);
#64=IFCSURFACESTYLESHADING(#63,$);
#65=IFCSURFACESTYLE('SteelStyle',.BOTH.,(#64));
#66=IFCCOLOURRGB('TerracottaRoof',0.8510,0.3725,0.2627);
#67=IFCSURFACESTYLESHADING(#66,$);
#68=IFCSURFACESTYLE('RoofStyle',.BOTH.,(#67));

/* 1. Ground Floor North Wall (RectangleProfileDef: 6.0m x 0.25m, Height 3.5m, placed at (0, 4.0m, 0)) */
#100=IFCCARTESIANPOINT((0.,4.0,0.));
#101=IFCAXIS2PLACEMENT3D(#100,#22,#23);
#102=IFCLOCALPLACEMENT(#41,#101);
#103=IFCCARTESIANPOINT((3.0,0.125));
#104=IFCAXIS2PLACEMENT2D(#103,$);
#105=IFCRECTANGLEPROFILEDEF(.AREA.,'WallRect',#104,6.0,0.25);
#106=IFCEXTRUDEDAREASOLID(#105,#20,#22,3.5);
#107=IFCSTYLEDITEM(#106,(#62),'WallStyle');
#108=IFCSHAPEREPRESENTATION(#10,'Body','SweptSolid',(#106));
#109=IFCPRODUCTDEFINITIONSHAPE($,$,(#108));
#110=IFCWALLSTANDARDCASE('Wall01',#2,'North Exterior Wall',$,$,#102,#109,'W-01');

/* 2. Ground Floor Circular Column (CircleHollowProfileDef: Radius 0.25m, WallThickness 0.05m, Height 3.5m at (6.0m, 0, 0)) */
#120=IFCCARTESIANPOINT((6.0,0.,0.));
#121=IFCAXIS2PLACEMENT3D(#120,#22,#23);
#122=IFCLOCALPLACEMENT(#41,#121);
#123=IFCCIRCLEHOLLOWPROFILEDEF(.AREA.,'PipeCol',$,0.25,0.05);
#124=IFCEXTRUDEDAREASOLID(#123,#20,#22,3.5);
#125=IFCSTYLEDITEM(#124,(#65),'ColStyle');
#126=IFCSHAPEREPRESENTATION(#10,'Body','SweptSolid',(#124));
#127=IFCPRODUCTDEFINITIONSHAPE($,$,(#126));
#128=IFCCOLUMN('Col01',#2,'Hollow Steel Column',$,$,#122,#127,'C-01');

/* 3. Level 1 Floor Slab (ArbitraryClosedProfileDef with IfcPolyline L-shape, Thickness 0.3m at Z=3.5m) */
#140=IFCLOCALPLACEMENT(#47,#20);
#141=IFCCARTESIANPOINT((0.,0.));
#142=IFCCARTESIANPOINT((6.0,0.));
#143=IFCCARTESIANPOINT((6.0,4.0));
#144=IFCCARTESIANPOINT((3.0,4.0));
#145=IFCCARTESIANPOINT((3.0,2.0));
#146=IFCCARTESIANPOINT((0.,2.0));
#147=IFCPOLYLINE((#141,#142,#143,#144,#145,#146,#141));
#148=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'LSlabProfile',#147);
#149=IFCEXTRUDEDAREASOLID(#148,#20,#22,0.3);
#150=IFCSHAPEREPRESENTATION(#10,'Body','SweptSolid',(#149));
#151=IFCPRODUCTDEFINITIONSHAPE($,$,(#150));
#152=IFCSLAB('Slab01',#2,'Level 1 Floor Slab',$,$,#140,#151,'S-01',.FLOOR.);

/* 4. Level 1 Steel I-Column (IfcIShapeProfileDef: 0.3m x 0.3m, web 0.015m, flange 0.025m, Height 3.2m at (3.0m, 2.0m, 3.5m)) */
#160=IFCCARTESIANPOINT((3.0,2.0,0.3));
#161=IFCAXIS2PLACEMENT3D(#160,#22,#23);
#162=IFCLOCALPLACEMENT(#47,#161);
#163=IFCISHAPEPROFILEDEF(.AREA.,'HEB300',$,0.3,0.3,0.015,0.025,0.015,$,$);
#164=IFCEXTRUDEDAREASOLID(#163,#20,#22,3.2);
#165=IFCSTYLEDITEM(#164,(#65),'HEBStyle');
#166=IFCSHAPEREPRESENTATION(#10,'Body','SweptSolid',(#164));
#167=IFCPRODUCTDEFINITIONSHAPE($,$,(#166));
#168=IFCCOLUMN('Col02',#2,'HEB300 Steel Column',$,$,#162,#167,'C-02');

/* 5. Level 1 Roof Canopy (IfcTriangulatedFaceSet closed pyramid mesh on Level 1 at Z=6.7m) */
#180=IFCCARTESIANPOINT((0.,0.,3.2));
#181=IFCAXIS2PLACEMENT3D(#180,#22,#23);
#182=IFCLOCALPLACEMENT(#47,#181);
#183=IFCCARTESIANPOINTLIST3D(((0.,0.,0.),(6.0,0.,0.),(6.0,4.0,0.),(0.,4.0,0.),(3.0,2.0,1.5)));
#184=IFCTRIANGULATEDFACESET(#183,$,.T.,((1,3,2),(1,4,3),(1,2,5),(2,3,5),(3,4,5),(4,1,5)),$);
#185=IFCSTYLEDITEM(#184,(#68),'RoofMeshStyle');
#186=IFCSHAPEREPRESENTATION(#10,'Body','Tessellation',(#184));
#187=IFCPRODUCTDEFINITIONSHAPE($,$,(#186));
#188=IFCROOF('Roof01',#2,'Pyramid Roof Canopy',$,$,#182,#187,'R-01',.HIP_ROOF.);

#200=IFCRELCONTAINEDINSPATIALSTRUCTURE('RelStorey0',#2,$,$,(#110,#128),#42);
#201=IFCRELCONTAINEDINSPATIALSTRUCTURE('RelStorey1',#2,$,$,(#152,#168,#188),#48);
ENDSEC;
END-ISO-10303-21;`;

  it('detects IFC files and parses multi-storey IFC4 buildings with unit scaling (m -> mm), nested placements, profiles, meshes, and styles', () => {
    expect(looksLikeIfc(MULTI_STOREY_IFC4)).toBe(true);
    expect(detectAecFormat(MULTI_STOREY_IFC4, 'TwoStoreyOffice.ifc')).toBe('ifc');

    const report = importIfc(MULTI_STOREY_IFC4, 'TwoStoreyOffice.ifc');
    expect(report.format).toBe('ifc');
    expect(report.schemaVersion).toBe('IFC4');
    expect(report.unitScaleToMm).toBe(1000);
    expect(report.name).toBe('Office Building');
    expect(report.elementCount).toBe(5);
    expect(report.warnings).toHaveLength(0);

    // Verify storeys and elevations in mm
    expect(report.storeys).toHaveLength(2);
    expect(report.storeys[0].name).toBe('Ground Floor');
    expect(report.storeys[0].elevationMm).toBe(0);
    expect(report.storeys[0].elementIds).toEqual(['#110', '#128']);

    expect(report.storeys[1].name).toBe('Level 1');
    expect(report.storeys[1].elevationMm).toBe(3500);
    expect(report.storeys[1].elementIds).toEqual(['#152', '#168', '#188']);

    // Verify 1: North Exterior Wall (Rectangle 6000x250, depth 3500, placed at Y=4000, Ground Floor)
    const wall = report.elements.find((e) => e.name === 'North Exterior Wall')!;
    expect(wall).toBeDefined();
    expect(wall.storey).toBe('Ground Floor');
    expect(wall.placement.o).toEqual([0, 4000, 0]);
    expect(wall.color).toBe('#c8bfb4');
    const wallExtrude = report.part.features.find((f) => f.type === 'extrude' && f.name === 'North Exterior Wall')!;
    expect(wallExtrude).toBeDefined();
    expect(wallExtrude.depth).toBe(3500);
    expect(wallExtrude.group).toBe('Ground Floor');
    expect(report.part.appearance?.[wallExtrude.id as string]?.color).toBe('#c8bfb4');

    // Verify 2: Hollow Steel Column (CircleHollowProfileDef R=250mm, inner R=200mm, depth=3500mm at X=6000mm)
    const col1 = report.elements.find((e) => e.name === 'Hollow Steel Column')!;
    expect(col1).toBeDefined();
    expect(col1.placement.o).toEqual([6000, 0, 0]);
    expect(col1.color).toBe('#3b6fd4');
    const col1Extrude = report.part.features.find((f) => f.type === 'extrude' && f.name === 'Hollow Steel Column')!;
    const col1Sketch = report.part.features.find((f) => f.id === col1Extrude.sketch)!;
    const circles = (col1Sketch.entities as Array<Record<string, unknown>>).filter((e) => e.type === 'circle');
    expect(circles).toHaveLength(2);
    expect(circles.map((c) => c.r)).toEqual([250, 200]);

    // Verify 3: Level 1 Floor Slab (L-shaped arbitrary closed polyline at Z=3500mm, depth=300mm)
    const slab = report.elements.find((e) => e.name === 'Level 1 Floor Slab')!;
    expect(slab).toBeDefined();
    expect(slab.storey).toBe('Level 1');
    expect(slab.placement.o).toEqual([0, 0, 3500]);
    const slabExtrude = report.part.features.find((f) => f.type === 'extrude' && f.name === 'Level 1 Floor Slab')!;
    expect(slabExtrude.depth).toBe(300);
    expect(slabExtrude.group).toBe('Level 1');
    const slabSketch = report.part.features.find((f) => f.id === slabExtrude.sketch)!;
    expect((slabSketch.entities as unknown[]).length).toBe(6);

    // Verify 4: Level 1 HEB300 I-Shape Column (12-segment I-profile at (3000, 2000, 3800), depth 3200mm)
    const col2 = report.elements.find((e) => e.name === 'HEB300 Steel Column')!;
    expect(col2).toBeDefined();
    expect(col2.storey).toBe('Level 1');
    expect(col2.placement.o).toEqual([3000, 2000, 3800]);
    expect(col2.color).toBe('#3b6fd4');
    const col2Extrude = report.part.features.find((f) => f.type === 'extrude' && f.name === 'HEB300 Steel Column')!;
    const col2Sketch = report.part.features.find((f) => f.id === col2Extrude.sketch)!;
    expect((col2Sketch.entities as unknown[]).length).toBe(12);

    // Verify 5: Level 1 Pyramid Roof Canopy (IfcTriangulatedFaceSet at Z = 3500 + 3200 = 6700mm)
    expect(report.meshes).toHaveLength(1);
    const roofMesh = report.meshes[0];
    expect(roofMesh.name).toBe('Pyramid Roof Canopy');
    expect(roofMesh.storey).toBe('Level 1');
    expect(roofMesh.color).toBe('#d95f43');
    expect(roofMesh.vertices.length).toBe(15); // 5 vertices * 3
    expect(roofMesh.indices.length).toBe(18); // 6 triangles * 3
    expect(roofMesh.watertight).toBe(true);
    // Apex vertex (3.0, 2.0, 1.5) in local space -> (3000, 2000, 3500 + 3200 + 1500 = 8200 mm) in world space
    expect(roofMesh.vertices[12]).toBe(3000);
    expect(roofMesh.vertices[13]).toBe(2000);
    expect(roofMesh.vertices[14]).toBe(8200);
    expect(roofMesh.stepFacetedBrep).toContain('FACETED_BREP');
    expect(report.part.meshes).toHaveLength(1);
  });

  it('parses IFC2x3 faceted B-rep (IfcFacetedBrep / IfcPolyLoop) and composite curves in millimetres', () => {
    const ifc2x3 = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('IFC2X3 Test'),'2;1');
FILE_NAME('BrepBox.ifc','2026-11-23T10:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#1=IFCPROJECT('P1',$,'IFC2x3 Brep Test',$,$,$,$,$,#2);
#2=IFCUNITASSIGNMENT((#3));
#3=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#10=IFCCARTESIANPOINT((0.,0.,0.));
#11=IFCCARTESIANPOINT((1000.,0.,0.));
#12=IFCCARTESIANPOINT((1000.,500.,0.));
#13=IFCCARTESIANPOINT((0.,500.,0.));
#14=IFCCARTESIANPOINT((0.,0.,400.));
#15=IFCPOLYLOOP((#10,#11,#12,#13));
#16=IFCPOLYLOOP((#10,#11,#14));
#17=IFCFACEOUTERBOUND(#15,.T.);
#18=IFCFACEOUTERBOUND(#16,.T.);
#19=IFCFACE((#17));
#20=IFCFACE((#18));
#21=IFCCLOSEDSHELL((#19,#20));
#22=IFCFACETEDBREP(#21);
#23=IFCSHAPEREPRESENTATION($,'Body','Brep',(#22));
#24=IFCPRODUCTDEFINITIONSHAPE($,$,(#23));
#25=IFCFOOTING('F1',$,'Concrete Pad Footing',$,$,$,#24,$);
ENDSEC;
END-ISO-10303-21;`;

    const report = importIfc(ifc2x3, 'BrepBox.ifc');
    expect(report.schemaVersion).toBe('IFC2X3');
    expect(report.unitScaleToMm).toBe(1);
    expect(report.elementCount).toBe(1);
    expect(report.meshes).toHaveLength(1);
    expect(report.meshes[0].name).toBe('Concrete Pad Footing');
    expect(report.meshes[0].indices.length).toBe(9); // quad (2 tris) + triangle (1 tri) = 3 tris
  });

  it('handles rotated nested placements, IfcCompositeCurve profiles, IfcPolygonalFaceSet, and window transparency', () => {
    const rotatedIfc = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('IFC4 Rotated & Composite'),'2;1');
FILE_NAME('Rotated.ifc','2026-11-23T10:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('P2',$,'Rotated Studio',$,$,$,$,$,#2);
#2=IFCUNITASSIGNMENT((#3));
#3=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#10=IFCCARTESIANPOINT((0.,0.,0.));
#11=IFCDIRECTION((0.,0.,1.));
#12=IFCDIRECTION((1.,0.,0.));
#13=IFCDIRECTION((0.,1.,0.));
#14=IFCAXIS2PLACEMENT3D(#10,#11,#12);
#15=IFCLOCALPLACEMENT($,#14);
#16=IFCBUILDINGSTOREY('S0',$,'Main Level',$,$,#15,$,'Main Level',.ELEMENT.,0.);

/* East Wall rotated 90 deg in plan (RefDirection = (0, 1, 0)) at (5000, 0, 0) */
#20=IFCCARTESIANPOINT((5000.,0.,0.));
#21=IFCAXIS2PLACEMENT3D(#20,#11,#13);
#22=IFCLOCALPLACEMENT(#15,#21);
#23=IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,.T.,#24);
#24=IFCPOLYLINE((#25,#26,#27,#28,#25));
#25=IFCCARTESIANPOINT((0.,0.));
#26=IFCCARTESIANPOINT((4000.,0.));
#27=IFCCARTESIANPOINT((4000.,200.));
#28=IFCCARTESIANPOINT((0.,200.));
#29=IFCCOMPOSITECURVE((#23),.F.);
#30=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'CompWall',#29);
#31=IFCEXTRUDEDAREASOLID(#30,#14,#11,3000.);
#32=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#31));
#33=IFCPRODUCTDEFINITIONSHAPE($,$,(#32));
#34=IFCWALL('W2',$,'East Composite Wall',$,$,#22,#33,$);

/* Glazed Window with 60% transparency (opacity = 0.4) */
#40=IFCCOLOURRGB('GlassCyan',0.5,0.8,0.9);
#41=IFCSURFACESTYLERENDERING(#40,0.6,$,$,$,$,$,$,.NOTDEFINED.);
#42=IFCSURFACESTYLE('Glass',.BOTH.,(#41));
#43=IFCRECTANGLEPROFILEDEF(.AREA.,'WinRect',$,1500.,60.);
#44=IFCEXTRUDEDAREASOLID(#43,#14,#11,1200.);
#45=IFCSTYLEDITEM(#44,(#42),$);
#46=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#44));
#47=IFCPRODUCTDEFINITIONSHAPE($,$,(#46));
#48=IFCWINDOW('Win1',$,'Studio Window',$,$,#22,#47,$,1200.,1500.);

/* PolygonalFaceSet stair block */
#60=IFCCARTESIANPOINTLIST3D(((0.,0.,0.),(1000.,0.,0.),(1000.,1000.,0.),(0.,1000.,0.),(0.,0.,500.)));
#61=IFCINDEXEDPOLYGONALFACE((1,2,3,4));
#62=IFCINDEXEDPOLYGONALFACE((1,2,5));
#63=IFCPOLYGONALFACESET(#60,.F.,(#61,#62),$);
#64=IFCSHAPEREPRESENTATION($,'Body','Tessellation',(#63));
#65=IFCPRODUCTDEFINITIONSHAPE($,$,(#64));
#66=IFCSTAIR('St1',$,'Entry Step',$,$,#15,#65,$,.STRAIGHT_RUN_STAIR.);
ENDSEC;
END-ISO-10303-21;`;

    const report = importIfc(rotatedIfc, 'Rotated.ifc');
    expect(report.elementCount).toBe(3);

    // Check rotated East Composite Wall: local point (4000, 0) rotated 90 deg at (5000, 0) -> world (5000, 4000)
    const eastWall = report.part.features.find((f) => f.type === 'extrude' && f.name === 'East Composite Wall')!;
    expect(eastWall).toBeDefined();
    const eastSketch = report.part.features.find((f) => f.id === eastWall.sketch)!;
    const pts = eastSketch.points as Array<{ id: string; x: number; y: number }>;
    expect(pts.some((p) => p.x === 5000 && p.y === 4000)).toBe(true);
    expect(pts.some((p) => p.x === 4800 && p.y === 4000)).toBe(true);

    // Check window opacity from Transparency=0.6 -> opacity=0.4
    const winFeat = report.part.features.find((f) => f.type === 'extrude' && f.name === 'Studio Window')!;
    expect(report.part.appearance?.[winFeat.id as string]?.opacity).toBe(0.4);

    // Check IfcPolygonalFaceSet mesh
    expect(report.meshes).toHaveLength(1);
    expect(report.meshes[0].name).toBe('Entry Step');
  });
});

describe('@kit/aec — Rhino 3DM (.3dm OpenNURBS) Importer', () => {
  it('detects and imports binary OpenNURBS .3dm chunk tables with layers, colours, extrusions, primitives, and meshes', () => {
    const bytes = build3dmFile({
      version: 70,
      unitSystem: 3, // centimeters (scale 10 -> mm)
      layers: [
        { index: 0, name: 'Hull Shell', color: '#2b6cb0', visible: true },
        { index: 1, name: 'Deck Hardware', color: [224, 122, 53], visible: true },
        { index: 2, name: 'Interior Mesh', color: '#38a169', visible: true },
      ],
      objects: [
        {
          kind: 'extrusion',
          name: 'Main Bulkhead',
          layerIndex: 0,
          origin: [0, 0, 5], // 50 mm in Z
          height: 20, // 200 mm
          profile: [
            [0, 0],
            [40, 0],
            [40, 15],
            [0, 15],
          ],
        },
        {
          kind: 'box',
          name: 'Equipment Locker',
          layerIndex: 0,
          origin: [10, 10, 0],
          dx: 12,
          dy: 8,
          dz: 6,
        },
        {
          kind: 'cylinder',
          name: 'Mast Base',
          layerIndex: 1,
          origin: [20, 7.5, 25],
          radius: 2.5, // 25 mm
          height: 30, // 300 mm
        },
        {
          kind: 'sphere',
          name: 'Radar Dome',
          layerIndex: 1,
          center: [20, 7.5, 60], // [200, 75, 600] mm
          radius: 4, // 40 mm
        },
        {
          kind: 'mesh',
          name: 'Cabin Canopy Mesh',
          layerIndex: 2,
          vertices: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 0, 5],
          indices: [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3],
        },
      ],
    });

    expect(looksLike3dm(bytes)).toBe(true);
    expect(detectAecFormat(bytes, 'Yacht.3dm')).toBe('3dm');

    const topChunks = read3dmChunks(bytes, 32);
    const tcodes = topChunks.map((c) => c.tcode & 0x7fff);
    expect(tcodes).toContain(TCODE_SETTINGS_TABLE);
    expect(tcodes).toContain(TCODE_LAYER_TABLE);
    expect(tcodes).toContain(TCODE_OBJECT_TABLE);

    const report = import3dm(bytes, 'Yacht.3dm');
    expect(report.format).toBe('3dm');
    expect(report.unitScaleToMm).toBe(10); // cm -> mm
    expect(report.layers).toHaveLength(3);
    expect(report.layers.map((l) => [l.name, l.color])).toEqual([
      ['Hull Shell', '#2b6cb0'],
      ['Deck Hardware', '#e07a35'],
      ['Interior Mesh', '#38a169'],
    ]);
    expect(report.elementCount).toBe(5);

    // Check scaled extrusion (height 20 cm -> 200 mm)
    const bulkhead = report.part.features.find((f) => f.type === 'extrude' && f.name === 'Main Bulkhead')!;
    expect(bulkhead).toBeDefined();
    expect(bulkhead.depth).toBe(200);
    expect(bulkhead.group).toBe('Hull Shell');
    expect(report.part.appearance?.[bulkhead.id as string]?.color).toBe('#2b6cb0');

    // Check scaled cylinder (radius 2.5 cm -> 25 mm, height 30 cm -> 300 mm)
    const mast = report.part.features.find((f) => f.type === 'extrude' && f.name === 'Mast Base')!;
    expect(mast).toBeDefined();
    expect(mast.depth).toBe(300);
    expect(mast.group).toBe('Deck Hardware');
    expect(report.part.appearance?.[mast.id as string]?.color).toBe('#e07a35');

    // Check scaled sphere (center [200, 75, 600], radius 40 mm)
    const dome = report.part.features.find((f) => f.type === 'sphere' && f.name === 'Radar Dome')!;
    expect(dome).toBeDefined();
    expect(dome.center).toEqual([200, 75, 600]);
    expect(dome.radius).toBe(40);

    // Check mesh scaling (10 cm -> 100 mm)
    expect(report.meshes).toHaveLength(1);
    expect(report.meshes[0].name).toBe('Cabin Canopy Mesh');
    expect(report.meshes[0].color).toBe('#38a169');
    expect(report.meshes[0].watertight).toBe(true);
    expect(report.meshes[0].vertices[3]).toBe(100);
  });
});

describe('@kit/aec — AutoCAD DWG (.dwg) & Revit (.rvt OLE2/CFB) Importers', () => {
  it('detects and imports AutoCAD .dwg (AC1027 / AC1032) 2D sketch entities, 3D solids/extrusions, and ACIS 3DSOLID SAT payloads', () => {
    const sampleSat = `700 0 1 0
10CadKit 1.0 17 ACIS 7.0 24 Mon Nov 23 10:00:00 2026
1 9.9999999999999995e-07 1e-10
body $-1 -1 $-1 $1 $-1 $-1 #
point $-1 -1 100 200 0 #
point $-1 -1 500 450 300 #
End-of-ACIS-data`;

    const dwgBytes = buildDwgFile({
      version: 'AC1032',
      insUnits: 4, // millimeters
      layers: [
        { name: 'A-WALL-2D', aci: 1 },
        { name: 'A-STRUCT-3D', aci: 5 },
      ],
      entities: [
        { type: 'LINE', layer: 'A-WALL-2D', p1: [0, 0, 0], p2: [2000, 0, 0] },
        { type: 'ARC', layer: 'A-WALL-2D', center: [2000, 500, 0], radius: 500, startAngleDeg: -90, endAngleDeg: 90 },
        { type: 'CIRCLE', layer: 'A-WALL-2D', center: [1000, 500, 0], radius: 150 },
        {
          type: 'LWPOLYLINE',
          name: 'Extruded Room Core',
          layer: 'A-STRUCT-3D',
          points: [
            [0, 0],
            [3000, 0],
            [3000, 2000],
            [0, 2000],
          ],
          closed: true,
          elevation: 0,
          thickness: 2800,
        },
        {
          type: 'CYLINDER',
          name: 'DWG Pillar',
          layer: 'A-STRUCT-3D',
          origin: [1500, 1000, 0],
          radius: 200,
          height: 2800,
        },
      ],
      obfuscatedSatPayloads: [sampleSat],
    });

    expect(looksLikeDwg(dwgBytes)).toBe(true);
    expect(detectAecFormat(dwgBytes, 'FloorPlan.dwg')).toBe('dwg');

    const report = importDwg(dwgBytes, 'FloorPlan.dwg');
    expect(report.format).toBe('dwg');
    expect(report.schemaVersion).toContain('AC1032');
    expect(report.unitScaleToMm).toBe(1);
    expect(report.satBodies).toHaveLength(1);
    expect(report.satBodies[0].sat).toContain('End-of-ACIS-data');

    // Verify 2D sketch on A-WALL-2D and 3D extrudes on A-STRUCT-3D
    const sketch2d = report.part.features.find((f) => f.type === 'sketch' && f.name === 'A-WALL-2D Sketch')!;
    expect(sketch2d).toBeDefined();
    expect((sketch2d.entities as unknown[]).length).toBe(3); // line + arc + circle

    const roomExtrude = report.part.features.find((f) => f.type === 'extrude' && f.name === 'Extruded Room Core')!;
    expect(roomExtrude).toBeDefined();
    expect(roomExtrude.depth).toBe(2800);
    expect(roomExtrude.group).toBe('A-STRUCT-3D');

    const satExtrude = report.part.features.find((f) => f.type === 'extrude' && String(f.name).startsWith('3DSolid'))!;
    expect(satExtrude).toBeDefined();
    expect(satExtrude.depth).toBe(300);
  });

  it('detects and imports Revit .rvt OLE2/CFB container with BasicFileInfo, PartAtom XML parameters, and BIM geometry', () => {
    const basicFileInfo = `Worksharing: Not enabled\r\nFormat: 2025\r\nBuild: 20250401_1515(x64)\r\nUnits: mm\r\n`;
    const partAtomXml = `<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="http://www.w3.org/2005/Atom" xmlns:A="urn:schemas-autodesk-com:partatom">
  <title>Structural Precast Column</title>
  <A:Parameter name="Width" value="600" unit="mm" />
  <A:Parameter name="Depth" value="400" unit="mm" />
  <A:Parameter name="ClearHeight" value="4.2" unit="m" />
</entry>`;
    const geometryJson = JSON.stringify({
      levels: [
        { id: 'L0', name: 'Level 0', elevation: 0 },
        { id: 'L1', name: 'Level 1', elevation: 4200 },
      ],
      elements: [
        {
          id: 'rvt-col-1',
          name: 'Precast Column C1',
          category: 'Ost_StructuralColumns',
          level: 'Level 0',
          kind: 'extrude',
          origin: [0, 0, 0],
          dx: 600,
          dy: 400,
          depth: 4200,
          color: '#7b8b9e',
        },
        {
          id: 'rvt-slab-1',
          name: 'Composite Deck S1',
          category: 'Ost_Floors',
          level: 'Level 1',
          kind: 'extrude',
          origin: [0, 0, 4200],
          dx: 6000,
          dy: 4000,
          depth: 250,
          color: '#9ea7b0',
        },
      ],
    });

    const rvtBytes = buildRvtCfbFile({
      BasicFileInfo: basicFileInfo,
      PartAtom: partAtomXml,
      Geometry: geometryJson,
    });

    expect(looksLikeRvt(rvtBytes)).toBe(true);
    expect(detectAecFormat(rvtBytes, 'PrecastFrame.rvt')).toBe('rvt');

    const cfbStreams = readCfbStreams(rvtBytes);
    expect([...cfbStreams.keys()]).toEqual(['BasicFileInfo', 'PartAtom', 'Geometry']);

    const report = importAec(rvtBytes, 'PrecastFrame.rvt');
    expect(report.format).toBe('rvt');
    expect(report.schemaVersion).toBe('Revit 2025');
    expect(report.parameters).toEqual([
      { name: 'Width', expr: '600', rawValue: 600, unit: 'mm' },
      { name: 'Depth', expr: '400', rawValue: 400, unit: 'mm' },
      { name: 'ClearHeight', expr: '4200', rawValue: 4.2, unit: 'mm' },
    ]);
    expect(report.part.variables).toEqual([
      { name: 'Width', expr: '600' },
      { name: 'Depth', expr: '400' },
      { name: 'ClearHeight', expr: '4200' },
    ]);
    expect(report.storeys).toHaveLength(2);
    expect(report.elementCount).toBe(2);
    const slabFeat = report.part.features.find((f) => f.type === 'extrude' && f.name === 'Composite Deck S1')!;
    expect(slabFeat).toBeDefined();
    expect(slabFeat.group).toBe('Level 1');
    expect(slabFeat.depth).toBe(250);
  });

  it('handles AC1027 DWG in inches, 3DM revolve surfaces, RVT family parameter synthesis, and corrupt inputs gracefully', () => {
    // 1. AC1027 DWG in inches ($INSUNITS = 1 -> 25.4 mm/in)
    const dwgInches = buildDwgFile({
      version: 'AC1027',
      insUnits: 1,
      entities: [
        { type: 'BOX', name: 'Inch Block', layer: 'MECH', origin: [0, 0, 0], dx: 10, dy: 5, height: 2 },
        { type: 'SPHERE', name: 'Inch Ball', layer: 'MECH', center: [0, 0, 10], radius: 1 },
      ],
    });
    const dwgRep = importAec(dwgInches, 'InchPart.dwg');
    expect(dwgRep.format).toBe('dwg');
    expect(dwgRep.schemaVersion).toContain('AC1027');
    expect(dwgRep.unitScaleToMm).toBe(25.4);
    const boxFeat = dwgRep.part.features.find((f) => f.type === 'extrude' && f.name === 'Inch Block')!;
    expect(boxFeat.depth).toBe(50.8); // 2 inches = 50.8 mm
    const sphereFeat = dwgRep.part.features.find((f) => f.type === 'sphere' && f.name === 'Inch Ball')!;
    expect(sphereFeat.radius).toBe(25.4);

    // 2. Rhino 3DM revolve surface
    const r3dmBytes = build3dmFile({
      layers: [{ index: 0, name: 'Turned', color: '#805ad5' }],
      objects: [
        {
          kind: 'revolve',
          name: 'Lathe Dome',
          layerIndex: 0,
          profile: [
            [10, 0],
            [25, 0],
            [20, 40],
            [10, 40],
          ],
          angle: 360,
        },
      ],
    });
    const r3dmRep = importAec(r3dmBytes, 'Lathe.3dm');
    expect(r3dmRep.part.features.some((f) => f.type === 'revolve' && f.name === 'Lathe Dome')).toBe(true);

    // 3. Corrupt / empty inputs return structured error without throwing
    expect(importIfc('not an ifc file', 'bad.ifc').error).toBeDefined();
    expect(import3dm(new Uint8Array([1, 2, 3]), 'bad.3dm').error).toBeDefined();
    expect(importDwg(new Uint8Array([1, 2, 3]), 'bad.dwg').error).toBeDefined();
    expect(importRvt(new Uint8Array([1, 2, 3]), 'bad.rvt').error).toBeDefined();
  });
});
