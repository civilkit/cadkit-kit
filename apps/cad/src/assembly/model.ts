// Assembly logic without DOM or kernel: which component a face or edge name belongs to, the component rows, the operations that
// insert / place / delete components, the bill of materials and the exploded-view offsets.
import type { EditOp } from '@ck/session';
import { densityOf } from '../inspect/mass';

export type V3 = [number, number, number];
type Feat = { id: string; type: string; name?: string; suppressed?: boolean; fixed?: boolean; [k: string]: unknown };
export interface DocLike { features: Feat[]; material?: string }

// ---- names -> components --------------------------------------------------------------------------------------------------
// A face of an inserted part is `<face name in the part>@<insert id>.1` ("F2.S.e12@F2.1"); pattern copies add `@<pattern id>.<k>` after it
// ("F4.C0@F6.1@F12.1"); faces of a pattern nested in the part keep their suffix in front ("F8.S.h1@F9.1@F1.1"). Edge keys join face names with `|`.

const SUFFIX = /@(F\d+)\.(\d+)/g;

/** The insert ids a face / edge name carries, in order of appearance. */
export function suffixIds(name: string): string[] {
  const first = name.split('|')[0].replace(/#\d+$/, '');
  return [...first.matchAll(SUFFIX)].map((m) => m[1]);
}

/** The component (insertPart feature id) that owns a face or edge name, or null for the root part. The last suffix naming an insertPart wins. */
export function componentOfName(name: string, inserts: ReadonlySet<string>): string | null {
  const ids = suffixIds(name);
  for (let i = ids.length - 1; i >= 0; i--) if (inserts.has(ids[i])) return ids[i];
  return null;
}

/** The component and the instance key of a name: the component id for the part itself, `F6@F12.1` for its first copy in pattern F12. */
export function instanceOfName(name: string, inserts: ReadonlySet<string>): { comp: string; key: string } | null {
  const first = name.split('|')[0].replace(/#\d+$/, '');
  const toks = [...first.matchAll(SUFFIX)].map((m) => ({ id: m[1], text: m[0] }));
  for (let i = toks.length - 1; i >= 0; i--) {
    if (inserts.has(toks[i].id)) return { comp: toks[i].id, key: toks[i].id + toks.slice(i + 1).map((x) => x.text).join('') };
  }
  return null;
}

export const insertIds = (doc: DocLike): Set<string> => new Set(doc.features.filter((f) => f.type === 'insertPart').map((f) => f.id));
export const namer = (doc: DocLike | null): ((n: string) => string | null) => { const s = doc ? insertIds(doc) : new Set<string>(); return (n) => componentOfName(n, s); };

// ---- component rows ---------------------------------------------------------------------------------------------------------

export interface ComponentRow {
  id: string; name: string; partName: string; suppressed: boolean; fixed: boolean;
  dx: number; dy: number; dz: number; axis: 'x' | 'y' | 'z' | null; angle: number;
  /** the kernel's remaining degrees of freedom (null before a rebuild reported it) */
  dof: number | null;
}

const axisOf = (v: unknown): 'x' | 'y' | 'z' | null => { const a = (v as { axis?: unknown } | null | undefined)?.axis; return a === 'x' || a === 'y' || a === 'z' ? a : null; };
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function componentRows(doc: DocLike | null, dof: ReadonlyMap<string, number> = new Map()): ComponentRow[] {
  if (!doc) return [];
  return doc.features.filter((f) => f.type === 'insertPart').map((f) => ({
    id: f.id, name: f.name ?? f.id, partName: String((f.part as { name?: string } | undefined)?.name ?? ''), suppressed: f.suppressed === true, fixed: f.fixed === true,
    dx: num(f.dx), dy: num(f.dy), dz: num(f.dz), axis: axisOf(f.axis), angle: num(f.angle, 0), dof: dof.get(f.id) ?? null,
  }));
}

export interface Placement { dx: number; dy: number; dz: number; axis: 'x' | 'y' | 'z' | null; angle: number }
export const NO_PLACEMENT: Placement = { dx: 0, dy: 0, dz: 0, axis: null, angle: 90 };

/** The insertPart feature for a part document. The part is kept in the feature (a component is its own body, also where it touches). */
export function insertFeature(part: Record<string, unknown>, p: Placement, o: { name?: string; source?: string; fixed?: boolean } = {}): Record<string, unknown> {
  const f: Record<string, unknown> = { type: 'insertPart', name: o.name ?? String(part.name ?? 'Part'), part };
  if (o.source) f.source = o.source;
  if (p.dx) f.dx = p.dx; if (p.dy) f.dy = p.dy; if (p.dz) f.dz = p.dz;
  if (p.axis && p.angle) { f.axis = { kind: 'axis', axis: p.axis }; f.angle = p.angle; }
  if (o.fixed) f.fixed = true;
  return f;
}

/** Operations that set the placement of an inserted part (only what differs from `old`). */
export function placementOps(id: string, old: ComponentRow, p: Placement): EditOp[] {
  const ops: EditOp[] = [];
  const set = (path: string, value: unknown) => ops.push({ op: 'set', id, path, value });
  if (p.dx !== old.dx) set('dx', p.dx);
  if (p.dy !== old.dy) set('dy', p.dy);
  if (p.dz !== old.dz) set('dz', p.dz);
  if (p.axis !== old.axis || p.angle !== old.angle) {
    if (p.axis && p.angle) { set('axis', { kind: 'axis', axis: p.axis }); set('angle', p.angle); }
    else if (old.axis) { set('angle', 0); }
  }
  return ops;
}

/** Mates and component patterns that name a face of component `id`. */
export function dependentsOfComponent(doc: DocLike, id: string): string[] {
  const ins = insertIds(doc);
  const owns = (v: unknown): boolean => typeof v === 'string' && componentOfName(v, ins) === id;
  const out: string[] = [];
  for (const f of doc.features) {
    if (f.type === 'mate' && (owns(f.a) || owns(f.b) || owns(f.c))) out.push(f.id);
    else if (f.type === 'cpattern' || f.type === 'lpattern') {
      const bodies = Array.isArray(f.bodies) ? (f.bodies as Array<{ face?: unknown }>) : [];
      if (bodies.length && bodies.some((b) => owns(b.face))) out.push(f.id);
    }
  }
  return out;
}

/** Ops that delete a component with the mates and patterns that name it. */
export function deleteComponentOps(doc: DocLike, id: string): EditOp[] {
  return [...dependentsOfComponent(doc, id), id].map((x) => ({ op: 'remove' as const, id: x }));
}

/** The mover of a mate, as the kernel picks it: the component of `a` unless it is fixed. */
export function mateComponents(doc: DocLike, f: Feat): string[] {
  const ins = insertIds(doc);
  return ['a', 'b', 'c'].map((k) => (typeof f[k] === 'string' ? componentOfName(f[k] as string, ins) : null)).filter((x): x is string => !!x);
}

// ---- bill of materials ----------------------------------------------------------------------------------------------------

export interface BomItem { no: number; part: string; qty: number; components: string[]; massEach: number | null; massTotal: number | null; material: string }

const partKey = (p: unknown): string => JSON.stringify(p ?? null);

/** Items by part: the same inserted part (same document) is one item with a quantity; suppressed components are left out; the copies a
 *  component pattern makes count too. `volumeOf` gives a part's volume (mm3, unit density) once the kernel measured it. */
export function bomItems(doc: DocLike | null, volumeOf: (part: unknown) => number | null): BomItem[] {
  if (!doc) return [];
  const items: BomItem[] = [];
  const byKey = new Map<string, BomItem>();
  const byComp = new Map<string, BomItem>();
  for (const f of doc.features) {
    if (f.type !== 'insertPart' || f.suppressed === true || !f.part) continue;
    const key = partKey(f.part);
    let it = byKey.get(key);
    if (!it) {
      const part = f.part as { name?: string; material?: string };
      const dens = densityOf(part.material);
      const vol = volumeOf(f.part);
      const massEach = vol !== null && dens !== null ? vol * dens / 1000 : null;
      it = { no: items.length + 1, part: String(part.name ?? f.name ?? f.id), qty: 0, components: [], massEach, massTotal: null, material: String(part.material ?? '') };
      byKey.set(key, it); items.push(it);
    }
    it.qty += 1; it.components.push(f.id); byComp.set(f.id, it);
  }
  const ins = insertIds(doc);
  for (const f of doc.features) {
    if (f.type !== 'cpattern' || f.suppressed === true) continue;
    const bodies = Array.isArray(f.bodies) ? (f.bodies as Array<{ face?: string }>) : [];
    const extra = Math.max(0, Math.round(num(f.count, 1)) - 1);
    const seen = new Set<string>();
    for (const b of bodies) {
      const c = b.face ? componentOfName(b.face, ins) : null;
      if (c && !seen.has(c) && byComp.has(c)) { seen.add(c); byComp.get(c)!.qty += extra; }
    }
  }
  for (const it of items) it.massTotal = it.massEach === null ? null : it.massEach * it.qty;
  return items;
}

export const bomTotal = (items: BomItem[]): number | null => (items.length && items.every((i) => i.massTotal !== null) ? items.reduce((s, i) => s + (i.massTotal ?? 0), 0) : null);

const csvCell = (v: string | number): string => { const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const fix = (g: number | null): string => (g === null ? '' : String(+g.toPrecision(6)));

/** The BOM as CSV (RFC 4180): No., Part, Qty, Material, Mass each (g), Mass total (g), and a Total row. */
export function bomCsv(items: BomItem[], head = ['No.', 'Part', 'Qty', 'Material', 'Mass each (g)', 'Mass total (g)'], totalLabel = 'Total'): string {
  const lines = [head.map(csvCell).join(',')];
  for (const i of items) lines.push([i.no, i.part, i.qty, i.material, fix(i.massEach), fix(i.massTotal)].map(csvCell).join(','));
  lines.push(['', totalLabel, items.reduce((s, i) => s + i.qty, 0), '', '', fix(bomTotal(items))].map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

// ---- exploded view ---------------------------------------------------------------------------------------------------------

export type ExplodeDir = 'auto' | 'x' | 'y' | 'z';
export interface ExplodeState { spread: number; dir: ExplodeDir; /** extra offset of a component dragged along an axis, mm */ manual: Record<string, V3> }
export const NO_EXPLODE: ExplodeState = { spread: 0, dir: 'auto', manual: {} };

/** Sanitise a value read from a file. */
export function readExplode(raw: unknown): ExplodeState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const manual: Record<string, V3> = {};
  if (r.manual && typeof r.manual === 'object') for (const [k, v] of Object.entries(r.manual as Record<string, unknown>)) if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) manual[k] = [v[0], v[1], v[2]];
  const spread = typeof r.spread === 'number' && Number.isFinite(r.spread) ? Math.max(0, Math.min(5, r.spread)) : 0;
  return { spread, dir: r.dir === 'x' || r.dir === 'y' || r.dir === 'z' ? r.dir : 'auto', manual };
}
export const isExploded = (e: ExplodeState): boolean => e.spread > 0 || Object.values(e.manual).some((v) => v.some((x) => x !== 0));

/** Where each component moves: away from the middle of all of them, `spread` times its distance from it (along the chosen axis only when
 *  the direction is x, y or z), plus the component's own drag. `centres` are component centres; `middle` the centre of them all. */
export function explodeOffsets(centres: ReadonlyMap<string, V3>, middle: V3, e: ExplodeState, turn?: (key: string, v: V3) => V3): Map<string, V3> {
  const out = new Map<string, V3>();
  for (const [id, c] of centres) {
    const d: V3 = [c[0] - middle[0], c[1] - middle[1], c[2] - middle[2]];
    const keep: V3 = e.dir === 'auto' ? [1, 1, 1] : [e.dir === 'x' ? 1 : 0, e.dir === 'y' ? 1 : 0, e.dir === 'z' ? 1 : 0];
    const m0 = e.manual[id.split('@')[0]] ?? [0, 0, 0];
    const m = turn ? turn(id, m0) : m0;
    out.set(id, [d[0] * keep[0] * e.spread + m[0], d[1] * keep[1] * e.spread + m[1], d[2] * keep[2] * e.spread + m[2]]);
  }
  return out;
}

/** A drag offset is set on the component itself; a copy a circular component pattern makes carries it turned with the copy (a coil pulled
 *  outwards stays pulled outwards in every copy). `key` is an instance key (`F30@F34.2`): the offset is turned about the pattern's axis by that
 *  copy's angle (equal spacing: angle / count per copy, otherwise angle / (count - 1); `reverse` turns the other way). Linear copies and
 *  keys without a pattern keep the offset as it is. */
export function copyTurner(features: readonly Feat[]): (key: string, v: V3) => V3 {
  const pats = new Map(features.filter((f) => f.type === 'cpattern' && f.suppressed !== true).map((f) => [f.id, f]));
  return (key, v) => {
    let out = v;
    for (const m of key.matchAll(/@(F\d+)\.(\d+)/g)) {
      const f = pats.get(m[1]);
      const ax = (f?.axis as { axis?: string } | undefined)?.axis;
      if (!f || (ax !== 'x' && ax !== 'y' && ax !== 'z')) continue;
      const count = Math.max(1, Math.round(num(f.count, 1))), angle = num(f.angle, 360);
      const step = f.equal === true ? angle / count : count > 1 ? angle / (count - 1) : 0;
      const a = (+m[2] * step * (f.reverse === true ? -1 : 1)) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
      const [x, y, z] = out;
      out = ax === 'z' ? [c * x - sn * y, sn * x + c * y, z] : ax === 'x' ? [x, c * y - sn * z, sn * y + c * z] : [c * x + sn * z, y, -sn * x + c * z];
    }
    return out;
  };
}
