// The Catalog's shapes and the edits each one stands for. Every shape is built from features the kernel already has: a
// sketch on the face (or on the Front plane for the first body) plus an extrude, a revolve or a hole. Nothing here touches
// the DOM or the kernel, so the ops are tested against the real kernel (catalog.kernel.test.ts) and compared with plain data.
import type { EditOp } from '@ck/session';
import { ISO_SIZES, ISO_TABLE, newHole, type HoleKind } from '../holeData';
import { niceSize } from '../featureCommands';
import type { V3 } from './geometry';
import { applyPlacement, type Placement, type PlaneRef } from './placement';

export type ShapeKind = 'block' | 'cylinder' | 'sphere' | 'cone' | 'boss' | 'slot' | 'hole' | 'cbore' | 'csink';
export type ShapeOp = 'add' | 'cut';

export interface CatalogItem {
  /** A parts-library (BOSL2) entry with its parameter values; the shape is then built by `buildBosl`, not by `buildShape`. */
  bosl?: { entryId: string; params: Record<string, number | boolean | string> };
  /** Stable id (`add-block`, `cut-slot`, `hole`...); also the end of the i18n key `catalog.item.<id>`. */
  id: string;
  kind: ShapeKind;
  /** Add material (left column) or remove it (right column). */
  op: ShapeOp;
}

/** Shapes that add material come first, then the ones that remove it, the left column adds, the right column removes. */
export const CATALOG: CatalogItem[] = [
  { id: 'add-block', kind: 'block', op: 'add' },
  { id: 'add-cylinder', kind: 'cylinder', op: 'add' },
  { id: 'add-sphere', kind: 'sphere', op: 'add' },
  { id: 'add-cone', kind: 'cone', op: 'add' },
  { id: 'add-boss', kind: 'boss', op: 'add' },
  { id: 'add-slot', kind: 'slot', op: 'add' },
  { id: 'cut-pocket', kind: 'block', op: 'cut' },
  { id: 'cut-cylinder', kind: 'cylinder', op: 'cut' },
  { id: 'cut-sphere', kind: 'sphere', op: 'cut' },
  { id: 'cut-cone', kind: 'cone', op: 'cut' },
  { id: 'cut-slot', kind: 'slot', op: 'cut' },
  { id: 'hole', kind: 'hole', op: 'cut' },
  { id: 'cbore', kind: 'cbore', op: 'cut' },
  { id: 'csink', kind: 'csink', op: 'cut' },
];
/** Parts-library items made on the fly (their id is `bosl:<entry>`): kept here so the ghost and the placement can find the armed one. */
const dynamic = new Map<string, CatalogItem>();
export function registerDynamicItem(item: CatalogItem): CatalogItem { dynamic.set(item.id, item); return item; }
export const catalogItem = (id: string): CatalogItem | undefined => CATALOG.find((c) => c.id === id) ?? dynamic.get(id);

/** What the placement knows about the spot: the face (or the ground) and where on it. */
export interface PlaceTarget {
  kind: 'ground' | 'face';
  face?: string;
  /** Flat face: the sketch frame the kernel gives a sketch on it. Curved: absent (a tangent plane touching at `point` is used). */
  planar?: boolean;
  frame?: { o: number[]; x: number[]; y: number[]; z: number[] };
  /** Where the shape's centre goes (world). */
  point: V3;
  /** The two largest sides of the face in its plane, and the part's size along the face normal. */
  extent?: [number, number];
  thickness?: number;
  /** Ground targets: the plane the first body (or a plane-feature drop) goes on (absent: the Front plane) and the point on it in its own coordinates. */
  plane?: PlaneRef;
  uv?: [number, number];
  /** How the shape stands on that plane (see placement.ts). */
  place?: Placement;
}

export interface BuiltShape {
  ops: EditOp[];
  /** The feature that is the shape (extrude, revolve or hole): what gets selected after the drop. */
  mainId: string;
  /** The sketch under it. */
  sketchId: string;
  /** Helper sketches and planes made only to place the shape: hidden in the view after the drop (still in the tree). */
  helpers: string[];
  /** The size every dimension was derived from (millimetres). */
  size: number;
  /** Parts library: the variables and features as one step (instead of `ops`, which then only serve the preview). */
  patch?: import('../docFields').DocPatch;
  script?: string;
}
export type BuildResult = BuiltShape | { error: 'needsBody' | 'noFrame' | 'planarOnly' | 'invalid' | 'scriptFailed'; hint?: string };

/** First number of the 1, 1.5, 2, 2.5 ... 10 series nearest to x. */
const nice = (x: number): number => niceSize({ min: [0], max: [Math.max(x, 1e-6)] }, 1);

/** The size one shape is built from: 40% of the smaller side of the face it lands on, 30 mm for the first body. */
export function defaultSize(t: Pick<PlaceTarget, 'kind' | 'extent'>): number {
  if (t.kind === 'ground' || !t.extent) return 30;
  return Math.max(0.5, nice(Math.min(t.extent[0], t.extent[1]) * 0.4));
}

type Pt = { id: string; x: number; y: number; fixed?: boolean };
type Ent = Record<string, unknown>;
interface Profile { points: Pt[]; entities: Ent[] }

const O: Pt = { id: 'O', x: 0, y: 0, fixed: true };
const lines = (...pairs: Array<[string, string, string]>): Ent[] => pairs.map(([id, p1, p2]) => ({ id, type: 'line', p1, p2 }));

export function rectProfile(u: number, v: number, w: number, h: number): Profile {
  const x0 = u - w / 2, x1 = u + w / 2, y0 = v - h / 2, y1 = v + h / 2;
  return {
    points: [O, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
    entities: lines(['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']),
  };
}
export function circleProfile(u: number, v: number, r: number): Profile {
  return { points: [O, { id: 'c', x: u, y: v }], entities: [{ id: 'k1', type: 'circle', c: 'c', r }] };
}
/** A stadium: two semicircles of radius w/2 joined by straight sides; `l` is the overall length along x. */
export function slotProfile(u: number, v: number, l: number, w: number): Profile {
  const r = w / 2, d = Math.max(l / 2 - r, r * 0.25);
  return {
    points: [O, { id: 'a', x: u - d, y: v }, { id: 'b', x: u + d, y: v },
      { id: 'at', x: u - d, y: v + r }, { id: 'ab', x: u - d, y: v - r }, { id: 'bt', x: u + d, y: v + r }, { id: 'bb', x: u + d, y: v - r }],
    entities: [
      { id: 'e1', type: 'line', p1: 'at', p2: 'bt' },
      { id: 'e2', type: 'arc', c: 'b', p1: 'bb', p2: 'bt' },
      { id: 'e3', type: 'line', p1: 'ab', p2: 'bb' },
      { id: 'e4', type: 'arc', c: 'a', p1: 'at', p2: 'ab' },
    ],
  };
}
/** Half a disc on a diameter along x, with that diameter as the revolve axis: turned 360 degrees it is a sphere. */
export function halfDiscProfile(u: number, v: number, r: number): Profile {
  return {
    points: [O, { id: 'c', x: u, y: v }, { id: 'pa', x: u + r, y: v }, { id: 'pb', x: u - r, y: v }],
    entities: [
      { id: 'e1', type: 'arc', c: 'c', p1: 'pa', p2: 'pb' },
      { id: 'e2', type: 'line', p1: 'pb', p2: 'pa' },
      { id: 'ax', type: 'line', p1: 'pb', p2: 'pa', construction: true },
    ],
  };
}
/**
 * A quarter disc standing on the face normal (y of a plane made by `perpendicular`), turned about that normal: a hemisphere
 * that rises out of the face (`up`) or sinks into it. A whole sphere cannot be used: the kernel does not mesh the sphere face
 * once a boolean trims it with the face plane (volume is right, the surface is missing), but a hemisphere on the plane is fine.
 */
export function domeProfile(r: number, up: boolean): Profile {
  const s = up ? 1 : -1;
  return {
    points: [O, { id: 'c', x: 0, y: 0 }, { id: 'pa', x: r, y: 0 }, { id: 'pb', x: 0, y: s * r }],
    entities: [
      up ? { id: 'e1', type: 'arc', c: 'c', p1: 'pa', p2: 'pb' } : { id: 'e1', type: 'arc', c: 'c', p1: 'pb', p2: 'pa' },
      { id: 'e2', type: 'line', p1: 'pb', p2: 'c' },
      { id: 'e3', type: 'line', p1: 'c', p2: 'pa' },
      { id: 'ax', type: 'line', p1: 'c', p2: 'pb', construction: true },
    ],
  };
}
export const pointProfile = (u: number, v: number): Profile => ({ points: [O, { id: 'P1', x: u, y: v }], entities: [{ id: 'pt1', type: 'point', p: 'P1' }] });

/** The ISO size a hole of this kind gets on a part of this size: the largest whose clearance (or head) fits in `size`. */
export function holeSizeFor(kind: HoleKind, size: number): string {
  let pick = ISO_SIZES[0];
  for (const s of ISO_SIZES) {
    const row = ISO_TABLE[s];
    const need = kind === 'cbore' ? row.cboreD / 0.7 : kind === 'csink' ? row.cskD / 0.7 : row.normal / 0.35;
    if (need <= size) pick = s;
  }
  return pick;
}

/** Cone: a circle extruded with a draft that takes the radius down to a fifth of itself over the height. */
export const coneDraft = (r: number, height: number): number => +(Math.atan((r * 0.8) / height) * 180 / Math.PI).toFixed(3);

const LABEL: Record<ShapeKind, string> = { block: 'Block', cylinder: 'Cylinder', sphere: 'Sphere', cone: 'Cone', boss: 'Boss', slot: 'Slot', hole: 'Hole', cbore: 'Counterbore', csink: 'Countersink' };
/** The feature name the tree shows (not translated: it is part of the document). */
export const shapeName = (item: CatalogItem): string => item.bosl ? (item.bosl.entryId.replace(/_/g, ' ')[0].toUpperCase() + item.bosl.entryId.replace(/_/g, ' ').slice(1)) : (item.op === 'cut' && item.kind === 'block' ? 'Pocket' : item.op === 'cut' && item.kind !== 'hole' && item.kind !== 'cbore' && item.kind !== 'csink' ? `${LABEL[item.kind]} cut` : LABEL[item.kind]);

/**
 * The edit for one shape at one spot. `seq` is the document's next feature number: ids are chosen here (F<seq>...) so the
 * preview, the committed edit and the selection afterwards all name the same features. All ops go in one `edit` = one undo step.
 */
export function buildShape(item: CatalogItem, target: PlaceTarget, seq: number, sizeOverride?: number): BuildResult {
  if (target.kind === 'ground' && item.op === 'cut') return { error: 'needsBody' };
  const size = sizeOverride ?? defaultSize(target);
  const ops: EditOp[] = [];
  let n = seq;
  let plane: Record<string, unknown>;
  let u = 0, v = 0;
  if (target.kind === 'ground') {
    plane = target.plane ? { ...target.plane } : { kind: 'std', id: 'front' };
    u = Math.round(target.uv ? target.uv[0] : target.point[0]); v = Math.round(target.uv ? target.uv[1] : target.point[1]);
  } else if (target.planar) {
    if (!target.frame) return { error: 'noFrame' };
    const f = target.frame;
    const d = [target.point[0] - f.o[0], target.point[1] - f.o[1], target.point[2] - f.o[2]];
    u = d[0] * f.x[0] + d[1] * f.x[1] + d[2] * f.x[2];
    v = d[0] * f.y[0] + d[1] * f.y[1] + d[2] * f.y[2];
    plane = { kind: 'face', id: target.face };
  } else {
    // a curved face has no flat plane: sketch on a plane that touches it at the spot (the sketch origin is that spot)
    const pid = `F${n++}`;
    ops.push({ op: 'add', feature: { type: 'plane', id: pid, mode: 'tangent', face: target.face, tangentTo: 'point', at: [...target.point], name: shapeName(item) + ' plane', visible: false } });
    plane = { kind: 'feature', id: pid };
  }
  const helpers: string[] = [];
  if (plane.kind === 'feature') helpers.push(plane.id as string);
  let dome = false;
  if (item.kind === 'sphere' && target.kind !== 'ground') {
    // On a face the sphere is a hemisphere turned about the face normal: a helper line on the face, a plane through it
    // perpendicular to the face (its y is the normal), the quarter-disc sketch there. See domeProfile for why not a whole sphere.
    dome = true;
    const hid = `F${n++}`, pid = `F${n++}`;
    helpers.push(hid, pid);
    ops.push({ op: 'add', feature: { type: 'sketch', id: hid, name: `${shapeName(item)} axis`, plane, points: [O, { id: 'a', x: u, y: v }, { id: 'b', x: u + 1, y: v }], entities: [{ id: 'ax', type: 'line', p1: 'a', p2: 'b', construction: true }], constraints: [], visible: false } });
    ops.push({ op: 'add', feature: { type: 'plane', id: pid, mode: 'perpendicular', base: plane, axis: { kind: 'sketchLine', sketch: hid, entity: 'ax' }, name: `${shapeName(item)} plane`, visible: false } });
    plane = { kind: 'feature', id: pid };
  }
  const sketchId = `F${n++}`;
  const mainId = `F${n++}`;
  const name = shapeName(item);
  const depth = item.op === 'add' ? size : nice(Math.min(size * 0.5, (target.thickness ?? size) * 0.5));
  let profile: Profile;
  let feature: Record<string, unknown>;
  const extrude = (extra: Record<string, unknown> = {}, d = depth) => ({ type: 'extrude', id: mainId, name, op: item.op, sketch: sketchId, end: 'blind', depth: d, ...extra });
  switch (item.kind) {
    case 'block': profile = rectProfile(u, v, size, size); feature = extrude(); break;
    case 'cylinder': profile = circleProfile(u, v, size / 2); feature = extrude(); break;
    case 'boss': profile = circleProfile(u, v, size * 0.3); feature = extrude({}, item.op === 'add' ? size * 0.5 : depth); break;
    case 'slot': profile = slotProfile(u, v, size * 1.5, size * 0.5); feature = extrude({}, item.op === 'add' ? size * 0.5 : depth); break;
    case 'cone': profile = circleProfile(u, v, size / 2); feature = extrude({ draft: coneDraft(size / 2, depth) }); break;
    case 'sphere':
      profile = dome ? domeProfile(size / 2, item.op === 'add') : halfDiscProfile(u, v, size / 2);
      feature = { type: 'revolve', id: mainId, name, op: item.op, sketch: sketchId, axis: 'ax', end: 'blind', angle: 360 };
      break;
    default: {
      // hole / counterbore / countersink: a point and a hole feature, through the part
      profile = pointProfile(u, v);
      const kind: HoleKind = item.kind === 'cbore' ? 'cbore' : item.kind === 'csink' ? 'csink' : 'simple';
      feature = { ...newHole(sketchId, false, { kind, size: holeSizeFor(kind, size), fit: 'normal' }), id: mainId, name };
    }
  }
  ops.push({ op: 'add', feature: { type: 'sketch', id: sketchId, name: `${name} sketch`, plane, points: profile.points, entities: profile.entities, constraints: [] } });
  ops.push({ op: 'add', feature });
  if (target.kind === 'ground' && target.place) applyPlacement(ops.map((o) => (o as { feature: Record<string, unknown> }).feature), target.place, [u, v], target.plane ?? { kind: 'std', id: 'front' });
  return { ops, mainId, sketchId, size, helpers };
}
