// Repair hints for the sheet metal features, keyed by the kernel's real error kinds (docs/sheet-metal.md, "Errors"):
//   flangeHeightTooLow {minHeight, bend, detail, hint}, invalidValue {field, detail, hint}, sheetMetalUnsupported {detail, hint},
//   nothingToCut (no sheet yet), missingSketch, noClosedProfile.
// The kernel's own `detail` and `hint` ride in the error params and are quoted; the kit adds what an agent needs to act on them.
import { SHEET_FEATURE_TYPES } from '@kit/script';

const TYPES = new Set<string>(SHEET_FEATURE_TYPES);
export const isSheetType = (t: unknown): boolean => typeof t === 'string' && TYPES.has(t);

const s = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));

/** Facts by invalidValue `field`: what the field means and the usual fix. */
const FIELD_HINT: Record<string, string> = {
  edges: "an edge pick must name an edge of the BASE OUTLINE. A point pick [x, y, z] snaps to the nearest straight outline edge in WORLD coordinates (rect(100, 60) on 'front' is centred on the origin: its edges are at x = +-50 and y = +-30, and z = the thickness is the cap face, z = 0 the front face), so a wrong edge usually means the point is nearer another edge. Other picks: {edge: n} (index 0..N-1 of the outline, counter-clockwise from the sketch), {role: 'P0.side.e2'} (the wall along sketch curve e2: tree/inspect the sketch for its curve ids). Curved edges cannot take a flange",
  angle: 'angle is the angle the leg turns through in degrees, above 0 and below 180 (90 for a right angle)',
  radius: 'radius is the inside bend radius in mm and must be above 0 (use the rule thickness or more)',
  gap: 'gap is the inside radius of a hem in mm and must be above 0 (the rule hemGap is 0.01)',
  height: 'height / length must be above 0 mm',
  length: 'height / length must be above 0 mm (for a partial flange, length is how far it runs along the edge from start)',
  distance: 'distance is how far the contour is extruded, in mm, above 0',
  thickness: 'thickness must be above 0 mm',
  kFactor: 'kFactor is the neutral line position, 0..1 (about 0.33 to 0.5 for steel and aluminium)',
  bendRadius: 'bendRadius must be above 0 mm',
  sketch: 'the base flange needs exactly ONE closed region (holes inside it are allowed): draw a single closed outline, no loose or overlapping loops',
  curves: 'contour flange curves must be sketch LINES that join end to end into one OPEN chain (no closed loop, no branch, no gap, no arc yet)',
  line: 'a fold line is a LINE of a sketch: pass the id of a line entity, or give points instead',
  points: 'a fold needs two different points whose line crosses the base outline',
  fixed: 'fixed is a point [x, y, z] on the side that stays, or a wall by role such as "P0.side.e4"',
  corners: 'corners are world points [x, y, z] (the nearest panel vertex wins) or { panel: k, vertex: i }; give at least one',
  mode: "mode is 'round' (with radius) or 'chamfer' (with distance)",
  regions: 'regions names regions of the cut sketch; leave it out to cut all',
  start: "start is mm along the picked edge from its start vertex (the outline runs counter-clockwise, so it is the left end seen from inside the sheet); with length it limits the flange to part of the edge, alone it runs to the end of the edge. Use from / to (two world points on the edge) for a position that does not depend on which end is the start",
  from: 'from and to come as a pair: two world points [x, y, z] on the edge (any order, projected onto the edge) that bound a partial flange; with a profile, v runs from from towards to',
  to: 'from and to come as a pair: two world points [x, y, z] on the edge (any order, projected onto the edge) that bound a partial flange',
  profile: "profile is ONE closed loop in the flange's own frame (v along the flange from the start of the span, h outward from the height line): [{ line: [[v, h], [v, h]] }, { arc: { center, from, to, ccw } }, ...] with each segment starting where the one before ends and an edge on the end of the bend (the outline must reach down to h = the end of the bend, a rectangle [0, w] x [0, H] does), or { sketch: id } (its outer loop; circles inside are holes). A full circle is two arcs",
  holes: "holes need a profile and lie beyond the end of the bend (h above it): [{ circle: { center: [v, h], radius } }] (radius above 0) or closed loops. Circles inside a sketch outline are holes already: list each hole once",
  relief: "relief is 'none', 'rectangular' (the rule's reliefWidth x reliefDepth) or { width, depth }; it cuts beside each end of a partial flange that stops inside the edge",
  then: 'then lists at most 16 chained bends, each with an angle in (0, 180) and a height above 0',
};

/** The repair hint for a sheet feature error, or null when this is not a sheet metal feature. */
export function sheetHint(feature: string, type: unknown, code: string, params: Record<string, unknown>): string | null {
  if (!isSheetType(type)) return null;
  const detail = s(params.detail);
  const kernel = [detail, s(params.hint)].filter(Boolean).join(' - ');
  const tail = kernel ? ` (kernel: ${kernel})` : '';
  switch (code) {
    case 'flangeHeightTooLow': {
      const min = typeof params.minHeight === 'number' ? params.minHeight : null;
      const bend = typeof params.bend === 'number' ? ` (bend ${params.bend} of the chain)` : '';
      return `${feature}: the flange is too short for its bend${bend}: height / length must be at least ${min === null ? 'the end of the bend' : `${min.toFixed(3)} mm`} (exactly the minimum gives a bend with no leg). Raise the height, or reduce the radius or the angle. heightFrom changes what is measured: 'outer' (default) from the outer virtual sharp, 'inner' from the inner one. Minimum for 90 degrees with outer = radius + thickness${tail}`;
    }
    case 'invalidValue': {
      const field = s(params.field);
      return `${feature}: field '${field}' is not valid. ${FIELD_HINT[field] ?? 'check the value against sheet_reference'}${tail}`;
    }
    case 'sheetMetalUnsupported': {
      const d = detail.toLowerCase();
      let extra = 'run sheet_reference for what the sheet features can do and what comes later';
      if (d.includes('not on a free part')) extra = 'the span (start / length, or from / to) must lie inside one free piece of the edge: not past its ends and not over a flange that is already there. After a partial flange the edge is split in pieces; give from / to world points to name the position, or start counted from the start of the piece the pick is nearest to'
      else if (d.includes('split by a partial flange')) extra = 'a partial flange split this edge: give this flange its span too (start and length, or from and to)'
      else if (d.includes('does not reach beyond the bend')) extra = 'the leg outline (profile) must reach below the end of the bend and have a part beyond it. If it does and still fails, the span runs against the edge direction (the outline comes out mirrored): swap from and to and mirror the outline across the span. The outline must also start at v = 0 for a sketch'
      else if (d.includes('no edge on the end of the bend')) extra = 'the profile must reach down to the flange root: draw its bottom at the height reference line (h = 0, a rectangle [0, w] x [0, H] does) so it has an edge on the end of the bend'
      else if (d.includes('reaches the bend')) extra = 'holes of a shaped leg must lie beyond the end of the bend: move the hole up (larger h)'
      else if (d.includes('already has a flange')) extra = 'one flange per edge: change the existing flange, or pick another edge (use then:[...] for a second bend on the same edge)';
      else if (d.includes('another feature changed the sheet body')) extra = 'a hole, cut or other solid feature sits between the sheet features: put every sheet feature (baseFlange, edgeFlange, hem, fold) directly one after the other, before any hole or cut';
      else if (d.includes('one base flange')) extra = 'a part has one base flange (or one contour flange) and it comes first: do not add a second; model other plates as a separate part';
      else if (d.includes('unfolded')) extra = 'add refold before more flanges, hems or folds';
      else if (d.includes('folded')) extra = 'make the flanges and hems before the folds';
      else if (d.includes('leaves no width')) extra = 'the flange is wider than the edge allows after bends and corners: make the base larger, the bend radius smaller, or flange fewer neighbouring edges';
      else if (d.includes('relief')) extra = 'the corner relief is larger than the edge beside it: lower cornerRelief on the rule, or use cornerReliefShape notch';
      else if (d.includes('overlap')) extra = 'legs overlap in the flat layout: give the corner a relief (cornerReliefShape round | rectangular | tear) or a larger gap';
      else if (d.includes('misses') || d.includes('splits') || d.includes('removes') || d.includes('island')) extra = 'a sheetCut region must lie on the sheet, leave every panel in one piece and have no island: draw it in the flat layout (a sketch parallel to the base plane, flat coordinates), smaller, and across a bend only where the bend stays connected';
      else if (d.includes('volume') || d.includes('sharp') || d.includes('cone') || d.includes('chain of panels')) extra = 'sheetConvert needs a constant-thickness bent plate: planar panels, straight cylindrical bends with a radius, one connected chain; no sharp corners, reliefs or embossing';
      else if (d.includes('not convex') || d.includes('convex') || d.includes('free') || d.includes('tangent')) extra = 'sheetCorner needs a convex corner whose two walls are free (no bend beside them) and at least as long as the tangent length: lower the radius / distance or pick another corner';
      else if (d.includes('zone') || d.includes('fold')) extra = 'fold zones must not overlap, cross a hole, contain a corner of the panel or cross the edge a flange hangs on: move the line or the neighbouring feature';
      else if (d.includes('hem')) extra = 'hems go on edges that have no flange or hem beside them';
      else if (d.includes('curved')) extra = 'edge flanges need a base outline of straight edges: use lines in the base sketch (arcs are fine on edges that take no flange)';
      return `${feature}: not supported here: ${detail || 'sheet metal limit'}. ${extra}${tail && !detail ? tail : ''}`;
    }
    case 'nothingToCut':
      return `${feature}: there is no sheet yet. Start with sheetRules, a sketch with one closed outline and baseFlange (or an open line sketch and contourFlange), then flange it`;
    case 'missingSketch':
      return `${feature}: the sketch it names does not exist. Draw the outline with sketch(plane, (s) => ...) directly before baseFlange() / contourFlange()`;
    case 'noClosedProfile':
      return `${feature}: the sketch has no closed outline. A base flange needs one closed region (rect, polygon, circle or a closed chain of lines); an open chain of lines is for contourFlange`;
    default:
      return kernel ? `${feature}: ${code}${tail}` : null;
  }
}
