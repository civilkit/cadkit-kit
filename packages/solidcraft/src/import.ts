// SolidCraft (.solidcraft) -> feature tree. A .solidcraft file is a zip whose `document.json` ("solidcraft/N") holds the parametric
// feature list; the rest (`cache/`) is derived and ignored. Mapped from the sample files only: sketch (line, arc, circle; coincident,
// horizontal, vertical, length), extrude (total distance), box, cylinder and a constant-radius fillet. Everything else is reported
// per feature and kept as a suppressed placeholder carrying the original JSON, so the tree still regenerates and nothing is lost
// silently. Assemblies are refused as a whole. See docs/solidcraft.md.
import { zipFile } from '@kit/fcstd';
import { evalExpr, ExprError } from './expr';

export type V3 = [number, number, number];
export type FeatureJson = Record<string, unknown>;
export interface ScPart { format: 'ck-part'; version: number; name: string; features: FeatureJson[]; seq: number }

/** One line of the import report: what became of one feature of the file. */
export interface ScRow {
  id: number | string;
  name: string;
  /** SolidCraft's feature type ("sketch", "extrude", "box", ...). */
  type: string;
  status: 'converted' | 'unsupported' | 'skipped';
  /** Why a feature was not converted (unsupported) or left alone (skipped). */
  reason?: string;
  /** Things dropped from a feature that was converted (a constraint kind we do not carry): the geometry is kept as stored. */
  notes?: string[];
}
export interface ScImport {
  name: string;
  /** The part, or null when the file is refused as a whole (see `refused`). */
  part: ScPart | null;
  rows: ScRow[];
  summary: { converted: number; unsupported: number; skipped: number; notes: number };
  /** False when any feature was not converted: the geometry is then partial. */
  geometryComplete: boolean;
  /** Set when nothing was imported: not a SolidCraft file, an unknown format version family, units, or an assembly. */
  refused?: string;
}
/** Resolves points on the body built so far to kernel edge references ({faces, at}); null for a point that matches no edge. */
export type EdgeResolver = (partBefore: ScPart, points: V3[]) => Promise<Array<Record<string, unknown> | null>>;
export interface ImportOpts {
  /** Needed for fillets: without it a fillet is reported as unsupported. */
  resolver?: EdgeResolver;
  /** Keep a suppressed `importedUnsupported` feature (with the original JSON) in the tree for each unsupported feature. Default true. */
  placeholders?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

class Unsupported extends Error {}

/** SolidCraft's origin planes and ours: XY / XZ / YZ are our front / top / right with the same in-plane axes and normals. */
const STD: Record<string, string> = { XY: 'front', XZ: 'top', YZ: 'right' };

const refuse = (name: string, why: string): ScImport => ({ name, part: null, rows: [], summary: { converted: 0, unsupported: 0, skipped: 0, notes: 0 }, geometryComplete: false, refused: why });

/** A .solidcraft file (zip bytes) as a part plus the report. Never throws on a bad file: the reason is in `refused`. */
export async function importSolidcraft(bytes: Uint8Array, name = 'SolidCraft part', opts: ImportOpts = {}): Promise<ScImport> {
  let raw: Uint8Array | null;
  try { raw = await zipFile(bytes, 'document.json'); } catch (e) { return refuse(name, `not a SolidCraft file (${(e as Error).message})`); }
  if (!raw) return refuse(name, 'no document.json in the file');
  let doc: Rec;
  try { doc = JSON.parse(new TextDecoder().decode(raw)); } catch { return refuse(name, 'document.json is not valid JSON'); }
  return importSolidcraftDocument(doc, name, opts);
}

/** The same from an already parsed document.json. */
export async function importSolidcraftDocument(doc: Rec, name = 'SolidCraft part', opts: ImportOpts = {}): Promise<ScImport> {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.features)) return refuse(name, 'document.json has no feature list');
  if (!/^solidcraft\/\d+$/.test(String(doc.format ?? ''))) return refuse(name, `unknown document format "${doc.format}"`);
  if (doc.units && doc.units !== 'mm') return refuse(name, `units are ${doc.units}; only mm is supported`);
  if (doc.assembly || doc.occurrences?.length) return refuse(name, `assemblies are not supported (${doc.occurrences?.length ?? 0} occurrences in ${doc.components?.length ?? 0} components)`);

  const vars: Record<string, number> = {};
  try { for (const p of doc.params ?? []) vars[p.name] = evalExpr(p.expr, vars); } catch (e) { return refuse(name, `a parameter cannot be evaluated: ${(e as Error).message}`); }
  const num = (x: unknown, what: string): number => {
    try { return evalExpr(x as string | number, vars); } catch (e) {
      if (e instanceof ExprError) throw new Unsupported(`${what}: ${e.message}`);
      throw e;
    }
  };

  const features: FeatureJson[] = [];
  const part = (): ScPart => ({ format: 'ck-part', version: 1, name, features, seq: 1 });
  const rows: ScRow[] = [];
  let n = 0;
  const nid = () => `F${++n}`;
  let bodies = 0;
  const sketches = new Map<number | string, { id: string }>();
  const failedSketches = new Set<number | string>();
  const placeholders = opts.placeholders !== false;

  const operation = (f: Rec): 'add' | 'cut' => {
    const op = f.operation;
    if (op === 'new_body') {
      if (bodies > 0) throw new Unsupported(`"${f.name}" starts a separate body; this kit keeps one connected body per part`);
      bodies++; return 'add';
    }
    if (op === 'join') { bodies = Math.max(bodies, 1); return 'add'; }
    if (op === 'cut') {
      if (bodies === 0) throw new Unsupported(`"${f.name}" cuts but there is nothing to cut yet`);
      return 'cut';
    }
    throw new Unsupported(`operation "${op}" of "${f.name}"`);
  };

  /** The sketch plane for an origin plane, or an offset of one; adds the offset plane feature when needed. */
  const planeFor = (pl: Rec): Record<string, unknown> => {
    if (pl?.type === 'origin' && STD[pl.name]) return { kind: 'std', id: STD[pl.name] };
    if (pl?.type === 'offset' && pl.base?.type === 'origin' && STD[pl.base.name]) {
      const id = nid();
      features.push({ type: 'plane', id, mode: 'offset', base: { kind: 'std', id: STD[pl.base.name] }, offset: num(pl.distance, 'plane offset') });
      return { kind: 'feature', id };
    }
    throw new Unsupported(`sketch on a ${pl?.type ?? 'unknown'} plane`);
  };

  /** A flat offset plane of one of ours (or the plane itself at offset 0) for the primitives. */
  const flatPlane = (std: string, offset: number): Record<string, unknown> => {
    if (Math.abs(offset) < 1e-12) return { kind: 'std', id: std };
    const id = nid();
    features.push({ type: 'plane', id, mode: 'offset', base: { kind: 'std', id: std }, offset });
    return { kind: 'feature', id };
  };

  const extrudeOf = (f: Rec, sketchId: string, depth: number, positive: boolean): FeatureJson => {
    const op = operation(f);
    // a boss grows along the plane normal and a cut goes against it; `flip` reverses
    const flip = op === 'cut' ? positive : !positive;
    const e: FeatureJson = { type: 'extrude', id: nid(), op, sketch: sketchId, end: 'blind', depth, name: f.name };
    if (flip) e.flip = true;
    return e;
  };

  const sketchOf = (f: Rec): { notes: string[] } => {
    const plane = planeFor(f.plane);
    const sk = f.sketch as Rec;
    const pts: Rec[] = sk.points ?? [];
    const curves: Rec[] = sk.curves ?? [];
    // coincident points are one point here (the geometry is then closed without the solver)
    const parent = pts.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const k of sk.constraints ?? []) if (k.type === 'coincident' && pts[k.p] && pts[k.q]) parent[find(k.p)] = find(k.q);
    const originRoot = pts.findIndex((p) => p.id === 'origin');
    const ids = new Map<number, string>();
    const outPts: FeatureJson[] = [{ id: 'O', x: 0, y: 0, fixed: true }];
    const pid = (i: number): string => {
      const r = find(i);
      if (originRoot >= 0 && r === find(originRoot)) return 'O';
      let id = ids.get(r);
      if (!id) {
        id = `p${ids.size + 1}`;
        ids.set(r, id);
        const [x, y] = pts[r].pos as [number, number];
        outPts.push({ id, x, y });
      }
      return id;
    };
    const eid = (i: number) => `e${i + 1}`;
    const entities = curves.map((c, i): FeatureJson => {
      const e: FeatureJson = { id: eid(i) };
      if (c.type === 'line') Object.assign(e, { type: 'line', p1: pid(c.a), p2: pid(c.b) });
      else if (c.type === 'arc') Object.assign(e, { type: 'arc', c: pid(c.c), p1: pid(c.a), p2: pid(c.b) });   // counter-clockwise from start to end
      else if (c.type === 'circle') Object.assign(e, { type: 'circle', c: pid(c.c), r: c.r });
      else throw new Unsupported(`sketch curve "${c.type}"`);
      if (c.construction) e.construction = true;
      return e;
    });
    const notes: string[] = [];
    const constraints: FeatureJson[] = [];
    let kn = 0;
    for (const k of sk.constraints ?? []) {
      if (k.type === 'coincident') continue;
      if (k.type === 'horizontal' || k.type === 'vertical') { constraints.push({ id: `k${++kn}`, type: k.type, refs: [eid(k.l)] }); continue; }
      if (k.type === 'length' && curves[k.l]?.type === 'line') {
        const c = curves[k.l];
        const [a, b] = [pid(c.a), pid(c.b)];
        if (a !== b) constraints.push({ id: `k${++kn}`, type: 'distance', refs: [a, b], value: Number(k.value) });
        continue;
      }
      notes.push(`${k.type} constraint dropped (the geometry is kept as stored)`);
    }
    const id = nid();
    features.push({ type: 'sketch', id, name: f.name, plane, points: outPts, entities, constraints });
    sketches.set(f.id, { id });
    return { notes };
  };

  const convert = async (f: Rec): Promise<string[]> => {
    switch (f.type) {
      case 'sketch': return sketchOf(f).notes;
      case 'extrude': {
        const s = sketches.get(f.sketch);
        if (!s) throw new Unsupported(failedSketches.has(f.sketch) ? `depends on sketch ${f.sketch}, which was not imported` : `refers to sketch ${f.sketch}, which is not in the file`);
        if (f.profiles?.type !== 'all') throw new Unsupported('extrude of chosen profiles only');
        if (f.extent?.convention !== 'total_distance') throw new Unsupported(`extrude extent "${f.extent?.convention}"`);
        if (f.extent.direction !== 'positive' && f.extent.direction !== 'negative') throw new Unsupported(`extrude direction "${f.extent.direction}"`);
        features.push(extrudeOf(f, s.id, num(f.extent.distance, 'extrude distance'), f.extent.direction === 'positive'));
        return [];
      }
      case 'box': {
        const [cx, cy, cz] = f.corner as V3;
        const L = num(f.length, 'box length'), W = num(f.width, 'box width'), H = num(f.height, 'box height');
        const plane = flatPlane('front', cz);
        const sid = nid();
        const c = [[cx, cy], [cx + L, cy], [cx + L, cy + W], [cx, cy + W]];
        features.push({ type: 'sketch', id: sid, name: `${f.name} sketch`, plane, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...c.map(([x, y], i) => ({ id: `p${i + 1}`, x, y }))], entities: [1, 2, 3, 4].map((i) => ({ id: `e${i}`, type: 'line', p1: `p${i}`, p2: `p${i % 4 + 1}` })), constraints: [] });
        features.push(extrudeOf(f, sid, H, true));
        return [];
      }
      case 'cylinder': {
        const ax = f.axis as V3, b = f.base as V3;
        const unit = (i: number) => ax.every((v, j) => Math.abs(v - (j === i ? 1 : 0)) < 1e-9);
        // axis +X: our right plane (in-plane x = -Z, y = Y); +Y: top (x = X, y = -Z); +Z: front (x = X, y = Y)
        const spec = unit(0) ? { std: 'right', off: b[0], c: [-b[2], b[1]] } : unit(1) ? { std: 'top', off: b[1], c: [b[0], -b[2]] } : unit(2) ? { std: 'front', off: b[2], c: [b[0], b[1]] } : null;
        if (!spec) throw new Unsupported('cylinder along an axis other than +X, +Y or +Z');
        const plane = flatPlane(spec.std, spec.off);
        const sid = nid();
        features.push({ type: 'sketch', id: sid, name: `${f.name} sketch`, plane, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: spec.c[0], y: spec.c[1] }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: num(f.radius, 'cylinder radius') }], constraints: [] });
        features.push(extrudeOf(f, sid, num(f.height, 'cylinder height'), true));
        return [];
      }
      case 'fillet': {
        if (!opts.resolver) throw new Unsupported('needs the kernel to find its edges');
        const points = f.edges as V3[] | undefined;
        if (!points?.length) throw new Unsupported('no edge positions in the file');
        const refs = await opts.resolver(part(), points).catch(() => null);
        if (!refs || !refs.every(Boolean)) throw new Unsupported('an edge was not found on the body built so far');
        features.push({ type: 'fillet', id: nid(), name: f.name, radius: num(f.radius, 'fillet radius'), edges: refs });
        return [];
      }
      default: throw new Unsupported(`feature type "${f.type}"`);
    }
  };

  for (const f of doc.features as Rec[]) {
    const row = { id: f.id, name: String(f.name ?? f.type), type: String(f.type) };
    if (f.suppressed) { rows.push({ ...row, status: 'skipped', reason: 'suppressed in the file' }); continue; }
    const mark = features.length, bodiesBefore = bodies, nBefore = n;
    try {
      const notes = await convert(f);
      rows.push({ ...row, status: 'converted', ...(notes.length ? { notes } : {}) });
    } catch (e) {
      features.length = mark; bodies = bodiesBefore; n = nBefore;   // drop what the feature half-added
      if (f.type === 'sketch') failedSketches.add(f.id);
      // a feature we do not understand, or one whose data is not what we expect, is reported; a bad file never aborts the import
      const reason = e instanceof Unsupported || e instanceof ExprError ? e.message : `could not read this feature (${(e as Error).message})`;
      if (placeholders) features.push({ type: 'importedUnsupported', id: nid(), name: row.name, suppressed: true, reason, original: f });
      rows.push({ ...row, status: 'unsupported', reason });
    }
  }
  const count = (s: ScRow['status']) => rows.filter((r) => r.status === s).length;
  const unsupported = count('unsupported');
  return {
    name, part: part(), rows,
    summary: { converted: count('converted'), unsupported, skipped: count('skipped'), notes: rows.reduce((a, r) => a + (r.notes?.length ?? 0), 0) },
    geometryComplete: unsupported === 0,
  };
}
