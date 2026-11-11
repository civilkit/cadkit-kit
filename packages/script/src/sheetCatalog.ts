// The sheet metal catalogue: every sheet feature and request of the kernel (docs/sheet-metal.md there) with its fields, defaults, units, a
// worked wire example and the script method that writes it. ONE data table feeds the MCP `sheet_reference` tool, the repair hints and the
// guide text, so a feature the kernel gains later is one more entry here (status 'coming' -> 'available', plus its fields), nothing else.
export type SheetStatus = 'available' | 'coming';

export interface SheetField {
  name: string;
  /** wire type: number | string | boolean | enum | pick[] | point | object | array */
  type: string;
  required?: boolean;
  /** what the kernel uses when the field is absent */
  default?: string;
  /** mm, deg, or '' */
  unit?: string;
  description: string;
  /** allowed values of an enum */
  values?: string[];
}
export interface SheetFeatureDoc {
  /** the kernel wire type, e.g. 'edgeFlange' */
  type: string;
  status: SheetStatus;
  summary: string;
  /** the part-chain method of the script API that writes it (null: raw feature() / request only) */
  scriptMethod: string | null;
  fields: SheetField[];
  /** the feature JSON as the kernel takes it */
  example: Record<string, unknown> | null;
  /** the same in the script API */
  scriptExample: string | null;
  /** kernel error codes this feature can raise, with the usual cause */
  errors?: Array<{ code: string; when: string }>;
  notes?: string[];
}

/** Wire types that are sheet metal features (they build the sheet body). Requests (sheetDxf, sheetBendTable) are not features. */
export const SHEET_FEATURE_TYPES = ['sheetRules', 'baseFlange', 'edgeFlange', 'hem', 'fold', 'contourFlange', 'unfold', 'refold', 'sheetConvert', 'sheetCut', 'sheetCorner'] as const;
/** Features the kernel announces but has no wire shape for yet (listed with status 'coming'). Empty now. */
export const SHEET_COMING_TYPES = [] as const;

const num = (name: string, description: string, o: Partial<SheetField> = {}): SheetField => ({ name, type: 'number', description, ...o });
const PICK = "an edge of the base outline: a point on it [x,y,z] (world mm; the nearest outline edge wins), {at:[x,y,z]}, {edge:n} (index into the outline, counter-clockwise from the sketch), or by role {role:'P0.side.e2'} / 'P0.side.e2' / {curve:'e2'}. On the panel tree any panel takes a flange: {role:'P2.side.e3'}, 'P2.tip' (free end of leg 2), 'P1.side.start', or {edge:n, panel:k} (n indexes the ring of panel k); a point pick takes the nearest wall of the folded sheet. An object pick may carry its own height, angle, radius, heightFrom, position, flip. A point on the face the base ended on (the cap side) bends the flange towards the cap ('up' in the bend table), a point on the face it started from bends it the other way ('down')";

export const SHEET_CATALOG: SheetFeatureDoc[] = [
  {
    type: 'sheetRules',
    status: 'available',
    summary: 'The stock: thickness, k-factor, bend radius, relief and gap. The rule named in a baseFlange (or the active one) gives the whole sheet its thickness and bend arithmetic.',
    scriptMethod: 'sheetRules',
    fields: [
      { name: 'name', type: 'string', required: true, description: 'rule name; a rule with an existing name replaces it' },
      num('thickness', 'stock thickness; also the variable Thickness inside the other fields of the rule', { default: '2.5', unit: 'mm' }),
      num('kFactor', 'position of the neutral line in the bend, 0..1', { default: '0.44' }),
      num('bendRadius', 'inside bend radius used when a flange gives none', { default: 'thickness', unit: 'mm' }),
      num('reliefWidth', 'bend relief width (matters for partial-width flanges)', { default: 'thickness', unit: 'mm' }),
      num('reliefDepth', 'bend relief depth', { default: 'thickness / 2', unit: 'mm' }),
      num('cornerRelief', 'corner relief size', { default: '4 x thickness', unit: 'mm' }),
      { name: 'cornerReliefShape', type: 'enum', default: 'notch', values: ['notch', 'round', 'rectangular', 'tear'], description: 'corner relief shape, built in the plate and shown in the flat pattern and DXF: round (circle of diameter cornerRelief on the corner), rectangular (square of side cornerRelief), tear (slit reliefWidth wide, cornerRelief / 2 deep along the bisector); notch is the plain corner. A relief larger than the edge beside it is sheetMetalUnsupported' },
      num('hemGap', 'inside radius of a hem when it gives none', { default: '0.01', unit: 'mm' }),
      num('gap', 'gap between the legs of flanges on neighbouring edges made in one feature', { default: 'thickness', unit: 'mm' }),
      { name: 'active', type: 'boolean', default: 'true', description: 'make this the rule of the next base flange' },
    ],
    example: { type: 'sheetRules', id: 'R1', name: 'Steel2', thickness: 2, kFactor: 0.44, bendRadius: 2 },
    scriptExample: "part('Tray').sheetRules({ name: 'Steel2', thickness: 2, kFactor: 0.44, bendRadius: 2 })",
    errors: [{ code: 'invalidValue', when: 'thickness <= 0, a value outside its range (kFactor 0..1, bendRadius > 0), or an expression that does not evaluate; the error names the field' }],
    notes: ['Any number may be an expression string ("=Thickness*4") or carry a unit ("2 mm", "90 deg").', 'Set the rule before the base flange; the base flange fixes the thickness of the whole part.'],
  },
  {
    type: 'baseFlange',
    status: 'available',
    summary: 'The first plate: one closed sketch region (holes allowed) extruded by the rule thickness along the sketch normal.',
    scriptMethod: 'baseFlange',
    fields: [
      { name: 'sketch', type: 'string', required: true, description: 'id of the sketch with ONE closed region (the script method takes the last sketch)' },
      { name: 'rule', type: 'string', default: 'the active rule, else the defaults', description: 'name of a sheetRules rule' },
      { name: 'flip', type: 'boolean', default: 'false', description: 'extrude against the sketch normal' },
      { name: 'regions', type: 'array', description: 'which regions of the sketch to use (as for extrude)' },
    ],
    example: { type: 'baseFlange', id: 'B1', sketch: 'S1', rule: 'Steel2' },
    scriptExample: "part('Tray').sheetRules({ name: 'Steel2', thickness: 2 }).sketch('front', (s) => s.rect(100, 60)).baseFlange({ rule: 'Steel2' })",
    errors: [
      { code: 'missingSketch', when: 'the sketch id does not exist' },
      { code: 'noClosedProfile', when: 'the sketch has no closed outline' },
      { code: 'invalidValue', when: 'field sketch: more than one closed region (draw a single outline; holes inside it are fine)' },
      { code: 'sheetMetalUnsupported', when: 'a second base flange, or one that is not the first body feature' },
    ],
    notes: ['One base flange per part, as the first body feature. The sketch sits on a plane; the sheet extends along the sketch normal (front +Z, top +Y, right +X), the face the sketch is on is the "front" face.'],
  },
  {
    type: 'edgeFlange',
    status: 'available',
    summary: 'A bent flange on one or more edges of the base outline, optionally continued by chained bends.',
    scriptMethod: 'edgeFlange',
    fields: [
      { name: 'edges', type: 'pick[]', required: true, description: PICK },
      num('height', 'flange height measured as heightFrom says', { required: true, unit: 'mm' }),
      num('angle', 'angle the leg turns through, 0 < angle < 180', { default: '90', unit: 'deg' }),
      num('radius', 'inside bend radius', { default: "the rule's bendRadius", unit: 'mm' }),
      { name: 'heightFrom', type: 'enum', default: 'outer', values: ['outer', 'inner', 'tangent'], description: 'outer: from the outer virtual sharp (leg = height - (r+t) tan(a/2)); inner: leg = height - r tan(a/2); tangent: leg = height - (r+t) min(1, tan(a/2))' },
      { name: 'position', type: 'enum', default: 'inside', values: ['inside', 'outside', 'middle'], description: 'inside: the outer face of the flange stays within the outline (the base stops (r+t) tan(a/2) short of the edge); outside: the bend starts at the outline edge; middle: half of the inside offset' },
      { name: 'flip', type: 'boolean', default: 'false', description: 'bend the other way (cap side <-> front side)' },
      { name: 'then', type: 'object[]', description: 'chained bends (at most 16): each { angle (default 90), height, flip } is a flange on the far edge of the leg before it; radius, heightFrom and position are the flange\'s. Each height must reach the end of its bend' },
      num('start', 'PART OF THE EDGE: mm along the picked edge from its start vertex (the outline runs counter-clockwise: the left end seen from inside the sheet) to where the flange begins; alone it runs to the end of the edge', { unit: 'mm' }),
      num('length', 'PART OF THE EDGE: how far the flange runs along the edge from start (default from the vertex); the bend is as wide as this and the bend table row has this length', { unit: 'mm' }),
      { name: 'from', type: 'point', description: 'PART OF THE EDGE, by two world points [x, y, z] on the edge (with to; any order, projected onto the edge): the flange covers the span between them. They win over start / length. For a profile, v runs from from towards to' },
      { name: 'to', type: 'point', description: 'the second point of from / to' },
      { name: 'profile', type: 'object', description: "SHAPED LEG: the outline of the leg as one closed loop in the flange's own (v, h) frame (v along the flange from the start of the span, h outward from the height reference line; a rectangle [0, w] x [0, H] is the plain flange). Inline: [{ line: [[v, h], [v, h]] }, { arc: { center: [v, h], from: [v, h], to: [v, h], ccw: true } }, ...] (each segment starts where the one before ends); or { sketch: 'S2' }: the outer loop of that sketch (drawn anywhere in its plane: x is v, y is h, the lower left corner of its box is the origin; followed when the sketch changes; circles inside it are holes). height is then the top of the outline (do not give it). The part below the end of the bend is the bend, the leg is the part beyond; the outline must reach down to the bend line. then is not allowed with a profile" },
      { name: 'holes', type: 'object[]', description: "HOLES in a shaped leg (profile only): [{ circle: { center: [v, h], radius } }] (a true cylinder) or closed loops of segments (faceted), in the profile's (v, h); beyond the end of the bend. With a sketch profile the inner loops of its region are holes already; listing the same circle again is refused (booleanFailed)" },
      { name: 'relief', type: 'enum|object', default: 'none', values: ['none', 'rectangular', '{ width, depth }'], description: "RELIEF beside a partial flange: 'rectangular' cuts the rule's reliefWidth x reliefDepth rectangle into the plate beside each end of the span that stops inside the edge, { width, depth } your own size (each defaults to the rule's), 'none' only the notch. Not made where the span meets a corner" },
    ],
    example: { type: 'edgeFlange', id: 'E1', edges: [[50, 0, 2], [50, 60, 2]], height: 20, angle: 90, radius: 2 },
    scriptExample: "part('Tray')/* ... base flange ... */.edgeFlange([[50, 0, 2], [50, 60, 2]], { height: 20, angle: 90, radius: 2 })\n// part of the edge: .edgeFlange([[50, 0, 2]], { height: 20, start: 20, length: 40, relief: 'rectangular' })  or  { from: [20, 0, 1], to: [60, 0, 1] }\n// shaped leg from the last sketch: .sketch('front', (s) => s.rect(40, 20)).edgeFlange([[50, 0, 2]], { profile: 'sketch', from: [20, 0, 1], to: [60, 0, 1] })",
    errors: [
      { code: 'flangeHeightTooLow', when: 'the height does not reach the end of the bend; params minHeight (and bend for chains). Exactly the minimum gives a bend without a leg' },
      { code: 'invalidValue', when: 'field edges: pick not recognised, edge index out of range, role names no wall, the edge is curved; field angle: not in 0..180; field radius: not above 0' },
      { code: 'sheetMetalUnsupported', when: 'a second flange on the same edge, a flange that leaves no width, a curved outline, a folded base, an unfolded sheet, a non-sheet feature between' },
      { code: 'nothingToCut', when: 'there is no base flange yet' },
      { code: 'invalidValue', when: 'field profile: not closed, a segment does not start where the one before ends, no edge on the end of the bend (the outline must reach down to the bend line), a sketch with no closed region; field length: not above 0; field from: from and to come as a pair; field holes: a circle needs centre and radius' },
      { code: 'sheetMetalUnsupported', when: 'a span that is not inside one free piece of the edge (past its end, over another flange); a whole-edge flange on an edge a partial one split; a hole that reaches the bend; then with a profile' },
    ],
    notes: [
      'Partial width and shaped legs (start / length, from / to, profile, holes, relief) run on the panel tree. A pick may carry any of them (its own value wins over the feature\'s): { at: [50, 0, 2], start: 20, length: 40 }. After a partial flange the edge is split in pieces: a later pick names the piece it is nearest to (start counts from the start of that piece; use from / to for positions that do not depend on it).',
      'A profile on a span given by from / to needs the span to run the same way as the edge (v from the first point to the second, the edge runs counter-clockwise): if the outline comes out mirrored its cut at the end of the bend fails (sheetMetalUnsupported: the profile does not reach beyond the bend); swap from and to and mirror the outline (an outline that never reaches below the end of the bend is not cut, so the problem shows only for outlines that start at the bend line).',
      'Flat length grows by the bend allowance BA = (r + k t) a (a in radians) plus the leg.',
      'Two flanges on neighbouring edges meet at a corner (notch shape); flanges made in ONE edgeFlange stay `gap` apart, a flange added by a later feature trims the neighbour\'s bend zone.',
      'Flanges only on straight edges, one flange per edge. Between sheet features only sheet features may sit (a plain hole or cut breaks the sheet; use sheetCut). Legs that overlap in the flat layout are refused: give the corner a relief.',
    ],
  },
  {
    type: 'hem',
    status: 'available',
    summary: 'A 180 degree bend that lays a leg back against the sheet.',
    scriptMethod: 'hem',
    fields: [
      { name: 'edges', type: 'pick[]', required: true, description: PICK },
      num('length', 'length to the OUTER face of the hem; the leg is length - (gap + t)', { required: true, unit: 'mm' }),
      num('gap', 'inside radius of the hem', { default: "the rule's hemGap (0.01)", unit: 'mm' }),
      { name: 'flip', type: 'boolean', default: 'false', description: 'curl the other way' },
      num('start', 'PART OF THE EDGE: mm along the picked edge from its start vertex; the hem then runs to the end of the edge (the hem has no length for the span: its length is the hem\'s size)', { unit: 'mm' }),
      { name: 'from', type: 'point', description: 'PART OF THE EDGE, by two world points [x, y, z] on the edge (with to; any order): the hem covers the span between them' },
      { name: 'to', type: 'point', description: 'the second point of from / to' },
      { name: 'relief', type: 'enum|object', default: 'none', values: ['none', 'rectangular', '{ width, depth }'], description: 'RELIEF beside a partial hem: as for edgeFlange' },
    ],
    example: { type: 'hem', id: 'H1', edges: [[50, 0, 2]], length: 10 },
    scriptExample: "part('Tray')/* ... */.hem([[50, 0, 2]], { length: 10 })",
    errors: [
      { code: 'flangeHeightTooLow', when: 'length < gap + thickness (params minHeight)' },
      { code: 'sheetMetalUnsupported', when: 'hems on neighbouring edges collide, or a hem beside an edge flange' },
    ],
    notes: ['A pick on the top (cap) face curls the hem towards the bottom (direction down), a pick on the bottom face towards the cap.'],
  },
  {
    type: 'fold',
    status: 'available',
    summary: 'Bend the flat base along a line: the moving side turns through the angle, the bend zone is BA wide.',
    scriptMethod: 'fold',
    fields: [
      { name: 'points', type: 'point[2]', description: 'two world points [x,y,z] that give the fold line (extended across the base); or use line' },
      { name: 'line', type: 'object', description: '{ sketch, curve }: a line of a sketch, followed when the sketch changes (the script method takes { curve } of the last sketch)' },
      num('angle', 'angle the moving side turns through, 0 < angle < 180', { default: '90', unit: 'deg' }),
      num('radius', 'inside bend radius', { default: "the rule's bendRadius", unit: 'mm' }),
      { name: 'position', type: 'enum', default: 'centerline', values: ['centerline', 'start', 'end', 'mould'], description: 'where the line sits in the bend zone: centerline [-BA/2, BA/2], start [0, BA], end [-BA, 0], mould (the line is the outer virtual sharp)' },
      { name: 'panel', type: 'integer', description: 'panel number k the line is on (folds on folded panels, when the points are ambiguous); the side that stays is the one the panel hangs on' },
      { name: 'fixed', type: 'point | role', description: 'a point [x,y,z] on the side that stays, or a wall by role such as "P0.side.e4"; default the larger side' },
      { name: 'flip', type: 'boolean', default: 'false', description: 'turn the moving side towards the bottom (direction down)' },
    ],
    example: { type: 'fold', id: 'F1', points: [[40, 0, 2], [40, 60, 2]], angle: 60, position: 'centerline' },
    scriptExample: "part('Fold').sheetRules({ name: 'S', thickness: 2 }).sketch('front', (s) => s.rect(100, 60)).baseFlange().fold({ points: [[40, 0, 2], [40, 60, 2]], angle: 60 })",
    errors: [
      { code: 'invalidValue', when: 'fields angle, radius, points (no length, or the line does not cross the base), fixed' },
      { code: 'sheetMetalUnsupported', when: 'overlapping zones, a hole in the zone, a corner of the panel inside the zone, a fold crossing the edge a flange hangs on, a zig-zag chain on a concave base' },
    ],
    notes: ['The flat pattern keeps its size (the zone is part of the sheet). Several folds, in any order, with flanges and hems on the same base; oblique lines and concave (L, U) bases work (an oblique bend body has square ends, so its volume differs from flat area x thickness by a sliver).'],
  },
  {
    type: 'contourFlange',
    status: 'available',
    summary: 'The base from an OPEN chain of sketch lines extruded by a distance (an L, U or Z section).',
    scriptMethod: 'contourFlange',
    fields: [
      { name: 'sketch', type: 'string', required: true, description: 'id of the sketch with the lines (the script method takes the last sketch)' },
      { name: 'curves', type: 'string[]', default: 'every line of the sketch', description: 'ids of the sketch lines, joined end to end into one open chain' },
      num('distance', 'extrusion length of the section', { required: true, unit: 'mm' }),
      { name: 'rule', type: 'string', description: 'sheetRules rule name' },
      { name: 'flip', type: 'boolean', default: 'false', description: 'material on the left of the direction of travel instead of the right' },
      { name: 'reverse', type: 'boolean', default: 'false', description: 'extrude against the sketch normal' },
    ],
    example: { type: 'contourFlange', id: 'C1', sketch: 'S1', distance: 40, rule: 'Steel2' },
    scriptExample: "part('Angle').sheetRules({ name: 'S', thickness: 2 }).sketch('front', (s) => { s.line([0, 0], [0, 20]); s.line([0, 20], [30, 20]); }).contourFlange({ distance: 40, rule: 'S' })",
    errors: [{ code: 'invalidValue', when: 'field curves: not lines, a closed loop, a branch or a gap in the chain; field distance: not above 0' }],
    notes: ['It is the base of the part (use it instead of baseFlange). A segment must be at least as long as its two setbacks. Arcs in the chain and several chains come later; flanges and hems can go on its legs (panel picks).'],
  },
  {
    type: 'unfold',
    status: 'available',
    summary: 'Turn the body into the flat sheet. While unfolded, flanges, hems and folds are refused.',
    scriptMethod: 'unfold',
    fields: [],
    example: { type: 'unfold', id: 'U1' },
    scriptExample: "part('Tray')/* ... */.unfold()",
    errors: [{ code: 'sheetMetalUnsupported', when: 'already unfolded, or another feature changed the sheet body' }, { code: 'nothingToCut', when: 'no sheet yet' }],
  },
  {
    type: 'refold',
    status: 'available',
    summary: 'Rebuild the folded solid from the bend table after an unfold (round-trips exactly).',
    scriptMethod: 'refold',
    fields: [],
    example: { type: 'refold', id: 'U2' },
    scriptExample: "part('Tray')/* ... */.unfold().refold()",
    errors: [{ code: 'sheetMetalUnsupported', when: 'the sheet is not unfolded' }, { code: 'nothingToCut', when: 'no sheet yet' }],
  },
  {
    type: 'sheetConvert',
    status: 'available',
    summary: 'Turn the current bent-plate solid into a sheet (panels, bends, flat pattern, bend table, DXF).',
    scriptMethod: 'sheetConvert',
    fields: [
      num('thickness', 'sheet thickness', { default: 'read from the body (smallest gap between facing planar faces)', unit: 'mm' }),
      { name: 'rule', type: 'string', default: 'the active rule, else the defaults', description: 'rule that supplies the k-factor; the converted rule is named Converted (thickness, bend radius of the first bend) and becomes active' },
    ],
    example: { type: 'sheetConvert', id: 'V1', thickness: 2, rule: 'Steel2' },
    scriptExample: "part('Bracket').sketch('front', (s) => s.polyline([[0, 0], [0, 20], [30, 20]])).extrude(40, { thin: 2 }).sheetConvert({ thickness: 2 })",
    errors: [
      { code: 'nothingToCut', when: 'no body yet' },
      { code: 'sheetMetalUnsupported', when: 'sharp corners between panels (no bend radius), cones / tori / free-form bends, more than one chain of panels, reliefs or embossed features (the volume of the rebuilt sheet must be within 1 % of the body\'s)' },
    ],
    notes: ['The body must be a constant-thickness bent plate: planar panels (parallel faces t apart), straight cylindrical bends (coaxial faces t apart in radius), planar walls. The panels are walked from the largest and unfolded into its plane.'],
  },
  {
    type: 'sheetCut',
    status: 'available',
    summary: 'Cut closed sketch regions out of the sheet through the flat pattern, across bends too.',
    scriptMethod: 'sheetCut',
    fields: [
      { name: 'sketch', type: 'string', required: true, description: 'sketch read in the FLAT layout: on the plane of the base or parallel to it, coordinates are flat coordinates (the script method takes the last sketch)' },
      { name: 'regions', type: 'array', description: 'which sketch regions to cut, as for extrude (default all)' },
    ],
    example: { type: 'sheetCut', id: 'X1', sketch: 'S2' },
    scriptExample: "part('Slot')/* ... sheet ... */.sketch('front', (s) => s.rect(10, 4)).sheetCut()",
    errors: [{ code: 'sheetMetalUnsupported', when: 'a region that misses the sheet, removes or splits a panel, or has an island' }, { code: 'nothingToCut', when: 'no sheet yet' }],
    notes: ['A region is subtracted from every panel it meets; a bend zone it crosses loses it from the flat pattern (the DXF shows the hole across the bend) and the bend solid loses the matching wedge. Rectangular cuts along and across a bend are exact; other boundaries are a staircase of wedges 0.25 mm of zone wide (the flat pattern is exact). The bend table keeps the full bend lines. Do not follow the sketch onto folded panels: use a sketch parallel to the base plane.'],
  },
  {
    type: 'sheetCorner',
    status: 'available',
    summary: 'Round or chamfer free convex corners of a panel.',
    scriptMethod: 'sheetCorner',
    fields: [
      { name: 'corners', type: 'corner[]', required: true, description: 'world points [x,y,z] (the nearest panel vertex wins) or {panel:k, vertex:i} (vertex i of the ring of panel k)' },
      { name: 'mode', type: 'enum', default: 'round', values: ['round', 'chamfer'], description: 'fillet or flat cut' },
      num('radius', 'fillet radius (mode round)', { unit: 'mm' }),
      num('distance', 'chamfer distance along each wall (mode chamfer)', { unit: 'mm' }),
      num('size', 'accepted for either mode instead of radius / distance', { unit: 'mm' }),
    ],
    example: { type: 'sheetCorner', id: 'K1', corners: [[50, 30, 2], { panel: 1, vertex: 2 }], mode: 'round', radius: 5 },
    scriptExample: "part('Plate')/* ... sheet ... */.sheetCorner([[50, 30, 2]], { mode: 'round', radius: 5 })",
    errors: [
      { code: 'invalidValue', when: 'fields corners, mode, radius, distance: missing, unknown or not above 0' },
      { code: 'sheetMetalUnsupported', when: 'the corner is not convex, a wall is a bend or zone side, or the walls are shorter than the tangent length (r tan(turn/2), or the distance)' },
    ],
    notes: ['Corners of free walls of ONE panel only (no corners across bends). The fillet is a true cylinder face in the solid and an arc in the DXF.'],
  },
];

/** The stateless export requests (not features). */
export const SHEET_REQUESTS = [
  {
    type: 'sheetDxf',
    summary: 'Flat pattern as a DXF (used by the MCP tool sheet_export).',
    fields: [
      { name: 'version', type: 'enum', default: 'R2000', values: ['R2000', 'R12'], description: 'DXF version' },
      { name: 'units', type: 'enum', default: 'mm', values: ['mm', 'cm', 'm', 'in', 'ft'], description: 'drawing units (coordinates, radii and text heights are scaled)' },
      { name: 'bendLines', type: 'boolean', default: 'true', description: 'write the bend centre lines (false for a cutter that would cut them)' },
      { name: 'tangentLines', type: 'boolean', default: 'false', description: 'also write two tangent lines per bend, half a bend allowance either side of the centre line' },
      { name: 'bendNotes', type: 'boolean', default: 'false', description: 'a TEXT per bend reading e.g. "B1 UP 90%%d R2"' },
      { name: 'noteHeight', type: 'number', default: '3', unit: 'mm', description: 'text height of the notes' },
      { name: 'layers', type: 'enum', default: 'roles', values: ['roles', 'single'], description: 'roles: CUT_OUTER, CUT_INNER, BEND_UP, BEND_DOWN, BEND_TANGENT, BEND_NOTES; single: everything on layer 0' },
      { name: 'layerNames', type: 'enum', default: 'cadkit', values: ['cadkit', 'reference'], description: "reference names the contour layers OUTLINE and CUT" },
    ],
  },
  {
    type: 'sheetBendTable',
    summary: 'The bend table as CSV or JSON (used by the MCP tool sheet_export).',
    fields: [
      { name: 'format', type: 'enum', default: 'csv', values: ['csv', 'json'], description: 'csv: one row per bend; json: bends, outline, cutouts, flat size' },
      { name: 'body', type: 'string', description: 'body name written into the table' },
    ],
  },
] as const;

/** Kernel error kinds the sheet features raise, for the repair hints (the details arrive in the error's own params). */
export const SHEET_ERROR_CODES = ['flangeHeightTooLow', 'sheetMetalUnsupported', 'invalidValue', 'nothingToCut', 'missingSketch', 'noClosedProfile'] as const;

/** Guidance that no kernel error carries: sheet rule values that are legal but poor practice. Returned by sheet_info as `advice`. */
export function ruleAdvice(rule: { name?: string; thickness?: number; bendRadius?: number; kFactor?: number; reliefWidth?: number; reliefDepth?: number; cornerRelief?: number }): string[] {
  const out: string[] = [];
  const t = rule.thickness;
  if (typeof t !== 'number' || t <= 0) return out;
  const nm = rule.name ? `rule ${rule.name}: ` : '';
  if (typeof rule.bendRadius === 'number' && rule.bendRadius < t) out.push(`${nm}bend radius ${rule.bendRadius} mm is below the thickness ${t} mm: the kernel builds it, but most sheet materials crack at an inside radius under 1 x thickness; use bendRadius >= ${t}`);
  if (typeof rule.reliefWidth === 'number' && rule.reliefWidth < t) out.push(`${nm}relief width ${rule.reliefWidth} mm is below the thickness ${t} mm: the relief may tear at the bend; use reliefWidth >= ${t}`);
  if (typeof rule.reliefDepth === 'number' && typeof rule.bendRadius === 'number' && rule.reliefDepth < rule.bendRadius / 2) out.push(`${nm}relief depth ${rule.reliefDepth} mm is small against the bend radius ${rule.bendRadius} mm: the relief should run past the bend, at least bendRadius / 2`);
  if (typeof rule.kFactor === 'number' && (rule.kFactor < 0.25 || rule.kFactor > 0.5)) out.push(`${nm}k-factor ${rule.kFactor} is outside the usual 0.25..0.5; check the material table`);
  return out;
}
