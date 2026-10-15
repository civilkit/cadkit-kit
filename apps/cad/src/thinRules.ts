// Pure rules of the thin-wall option of Extrude, Extruded cut and Revolve (the kernel's `thin` field, see docs/thin-extrude.md):
// reading and patching the field, the default thickness, and what an OPEN profile needs (the gap between its loose ends, the
// edit that closes it with a line). No DOM, so they are tested without a browser (thinRules.test.ts) and against the kernel
// (thinExtrude.kernel.test.ts). A patch value of null means "remove this field" (same protocol as optionRules.ts).
import type { PartDoc } from '@ck/part-model';
import type { EditOp } from '@ck/session';
import { sketchOpenChains, sketchShapes, type SketchChain } from '@kit/sketch';

type Wire = Record<string, unknown>;
type Feat = { id: string; type: string; [k: string]: unknown };
type Pt = { id: string; x: number; y: number };
type Ent = { id: string; type?: string; construction?: boolean; p1?: string; p2?: string; pts?: string[]; c?: string; r?: number; [k: string]: unknown };

export type ThinSide = 'inside' | 'outside' | 'both' | 'mid';
export type ThinEnds = 'flat' | 'round';
export type ThinCorner = 'mitre' | 'round';
export const THIN_SIDES: ThinSide[] = ['inside', 'outside', 'both', 'mid'];
export const THIN_ENDS: ThinEnds[] = ['flat', 'round'];
export const THIN_CORNERS: ThinCorner[] = ['mitre', 'round'];

export interface ThinSpec { thickness: number | string; side: ThinSide; ends: ThinEnds; cornerStyle: ThinCorner; thickness2?: number | string }

const oneOf = <T extends string>(v: unknown, list: T[], d: T): T => ((list as string[]).includes(String(v)) ? (v as T) : d);

/** The `thin` option of a feature, or null when it is absent or switched off. */
export function thinOf(eff: Wire): ThinSpec | null {
  const t = eff.thin;
  if (!t || typeof t !== 'object' || (t as Wire).enabled === false) return null;
  const o = t as Wire;
  const num = (v: unknown): number | string | undefined => (typeof v === 'number' || typeof v === 'string' ? v : undefined);
  return {
    thickness: num(o.thickness) ?? 1,
    side: oneOf(o.side, THIN_SIDES, 'inside'),
    ends: oneOf(o.ends, THIN_ENDS, 'flat'),
    cornerStyle: oneOf(o.cornerStyle, THIN_CORNERS, 'mitre'),
    ...(num(o.thickness2) !== undefined ? { thickness2: num(o.thickness2) } : {}),
  };
}

const feats = (doc: PartDoc | null | undefined): Feat[] => ((doc?.features ?? []) as unknown as Feat[]);
const sketchOf = (doc: PartDoc | null | undefined, id: unknown): Feat | null => feats(doc).find((f) => f.type === 'sketch' && f.id === id) ?? null;

/** Size of the profile: the diagonal of the box around the points its curves use (circle radii included). */
export function profileSize(sk: Feat | null): number {
  if (!sk) return 10;
  const pts = new Map(((sk.points as Pt[] | undefined) ?? []).map((p) => [p.id, p]));
  const ents = ((sk.entities as Ent[] | undefined) ?? []).filter((e) => !e.construction);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const e of ents) {
    const ids = e.type === 'circle' || e.type === 'ellipse' ? [e.c] : e.type === 'arc' ? [e.c, e.p1, e.p2] : Array.isArray(e.pts) ? e.pts : [e.p1, e.p2];
    for (const id of ids) { const p = id ? pts.get(id) : undefined; if (p) add(p.x, p.y); }
    if (e.type === 'circle' && typeof e.r === 'number') { const c = e.c ? pts.get(e.c) : undefined; if (c) { add(c.x - e.r, c.y - e.r); add(c.x + e.r, c.y + e.r); } }
  }
  return x1 >= x0 ? Math.hypot(x1 - x0, y1 - y0) : 10;
}

/** 10% of the profile size, at least 1 mm, rounded to a tidy value. */
export function defaultThickness(sk: Feat | null): number {
  const v = Math.max(1, profileSize(sk) * 0.1);
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.round(v / (mag / 2)) * (mag / 2);
}

/** Turn the thin wall on (with its default thickness) or off. */
export function patchThinOn(eff: Wire, doc: PartDoc | null | undefined, on: boolean): Wire {
  if (!on) return { thin: null };
  const prev = thinOf({ thin: (eff as Wire).thin });
  return { thin: { thickness: prev?.thickness ?? defaultThickness(sketchOf(doc, eff.sketch)), side: prev?.side ?? 'inside', ends: prev?.ends ?? 'flat', cornerStyle: prev?.cornerStyle ?? 'mitre' } };
}

/** Change one field of the thin option. The second thickness only exists for `both`. */
export function patchThin(eff: Wire, key: keyof ThinSpec, value: unknown): Wire {
  const cur = thinOf(eff);
  if (!cur) return {};
  const next: Wire = { ...cur, [key]: value };
  if (next.side !== 'both' || next.thickness2 === '' || next.thickness2 === undefined) delete next.thickness2;
  if (key === 'side' && value === 'both' && next.thickness2 === undefined) next.thickness2 = cur.thickness;
  return { thin: next };
}

/** The thickness as a number, when it is one (an expression has none until the kernel evaluates it). */
export const thicknessValue = (t: ThinSpec | null): number | null => (t && typeof t.thickness === 'number' ? t.thickness : null);

// ---- open profiles ----

export interface Gap { a: [number, number]; b: [number, number]; distance: number; /** Small against the profile: the loop is almost closed. */ near: boolean }
export interface OpenProfile {
  sketchId: string;
  chains: SketchChain[];
  /** Closed shapes the sketch also has. */
  closedShapes: number;
  /** The gap between the loose ends of the chain that closes with one line (the longest such chain). */
  gap: Gap | null;
  /** Entities of the chain with that gap. */
  gapEntities: string[];
}

/** What an Extrude without a thin wall runs into: the sketch has open chains and no closed shape. Null when the sketch is fine (or missing). */
export function openProfile(doc: PartDoc | null | undefined, sketchId: unknown): OpenProfile | null {
  const sk = sketchOf(doc, sketchId);
  if (!sk) return null;
  const chains = sketchOpenChains(sk as never);
  const closedShapes = sketchShapes(sk as never).length;
  if (!chains.length || closedShapes > 0) return null;
  const pts = new Map(((sk.points as Pt[] | undefined) ?? []).map((p) => [p.id, p]));
  let gap: Gap | null = null;
  let gapEntities: string[] = [];
  const size = profileSize(sk);
  for (const c of chains) {
    if (!c.ends) continue;
    const a = pts.get(c.ends[0]), b = pts.get(c.ends[1]);
    if (!a || !b) continue;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (distance < 1e-9) continue;
    if (!gap || c.entityIds.length > gapEntities.length) {
      gap = { a: [a.x, a.y], b: [b.x, b.y], distance, near: distance <= 0.15 * size };
      gapEntities = c.entityIds;
    }
  }
  return { sketchId: String(sketchId), chains, closedShapes, gap, gapEntities };
}

/** The edit that closes the profile: the sketch with one more line between the loose ends of its chain, or null (no chain with two loose ends). */
export function closeWithLineOp(doc: PartDoc | null | undefined, sketchId: unknown): EditOp | null {
  const sk = sketchOf(doc, sketchId);
  const open = openProfile(doc, sketchId);
  if (!sk || !open?.gap) return null;
  const chain = open.chains.find((c) => c.ends && c.entityIds.length === open.gapEntities.length && c.entityIds.every((e) => open.gapEntities.includes(e)));
  if (!chain?.ends) return null;
  const ents = (sk.entities as Ent[] | undefined) ?? [];
  const used = new Set([...ents.map((e) => e.id), ...((sk.points as Pt[] | undefined) ?? []).map((p) => p.id)]);
  let n = ents.length + 1;
  while (used.has('e' + n)) n++;
  const feature = { ...sk, entities: [...ents, { type: 'line', id: 'e' + n, p1: chain.ends[0], p2: chain.ends[1] }] };
  return { op: 'replace', id: sk.id, feature } as unknown as EditOp;
}

/** The edit that turns the extrude into a surface extrude of the same sketch (the open profile is what a surface takes). */
export function asSurfaceOp(eff: Wire): EditOp {
  const keep: Wire = { type: 'surfaceExtrude', id: eff.id, sketch: eff.sketch, end: eff.end === 'mid' ? 'mid' : 'blind', depth: typeof eff.depth === 'number' ? eff.depth : 10 };
  if (eff.flip) keep.flip = true;
  if (eff.name) keep.name = eff.name;
  return { op: 'replace', id: String(eff.id), feature: keep } as unknown as EditOp;
}
