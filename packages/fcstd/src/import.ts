// FreeCAD FCStd -> feature tree. Parses Document.xml (the parametric object tree) and maps the PartDesign subset that has a
// clean equivalent: Sketch + Pad/Pocket/Revolution/Groove/Mirrored/LinearPattern/PolarPattern. Everything else becomes a
// warning (never a throw). Coordinates are kept as FreeCAD has them (no Y-up rotation); sketch planes are mapped to our
// standard planes by normal, plus an offset plane when the sketch is not through the origin. See docs/fcstd.md.
import { zipFile } from './zip';

export interface FcWarning { object: string; code: string; message: string }
export interface FcStep { fc: string; type: string; features: string[]; shape?: string }
export interface FcImport {
  name: string;
  part: { format: 'ck-part'; version: number; name: string; features: Array<Record<string, unknown>>; seq: number } & Record<string, unknown>;
  warnings: FcWarning[];
  /** One entry per mapped FreeCAD feature, in order: which of our feature ids it produced and its cached shape file. */
  steps: FcStep[];
  /** FreeCAD features that could not be mapped (their names, in order). */
  skipped: string[];
  /** Names of all PartDesign bodies in the file (only one is imported, see opts.body). */
  bodies: string[];
  /** FreeCAD object type counts, for reports. */
  objectTypes: Record<string, number>;
  /** Cached final shape of the Body Tip (view-only fallback needs a BRep reader). */
  finalShape?: string;
}

type Obj = { name: string; type: string; props: Map<string, Element> };
type V3 = [number, number, number];
type Feat = Record<string, unknown>;

const EPS = 1e-6;
const num = (s: string | null | undefined, d = 0) => { const v = Number(s); return Number.isFinite(v) ? v : d; };

function parseObjects(doc: Document): Map<string, Obj> {
  const out = new Map<string, Obj>();
  const types = new Map<string, string>();
  for (const o of Array.from(doc.querySelectorAll('Objects > Object'))) types.set(o.getAttribute('name') ?? '', o.getAttribute('type') ?? '');
  for (const od of Array.from(doc.querySelectorAll('ObjectData > Object'))) {
    const name = od.getAttribute('name') ?? '';
    const props = new Map<string, Element>();
    for (const p of Array.from(od.children).filter((c) => c.tagName === 'Properties').flatMap((c) => Array.from(c.children))) props.set(p.getAttribute('name') ?? '', p);
    out.set(name, { name, type: types.get(name) ?? '?', props });
  }
  return out;
}

const first = (p: Element | undefined) => p?.firstElementChild ?? undefined;
const pNum = (o: Obj, k: string, d = 0) => num(first(o.props.get(k))?.getAttribute('value'), d);
const pBool = (o: Obj, k: string, d = false) => { const v = first(o.props.get(k))?.getAttribute('value'); return v == null ? d : v === 'true' || v === '1'; };
const pLink = (o: Obj, k: string) => first(o.props.get(k))?.getAttribute('value') ?? '';
const pLinkSub = (o: Obj, k: string): { obj: string; sub: string } => {
  const ls = first(o.props.get(k));
  return { obj: ls?.getAttribute('value') ?? '', sub: ls?.querySelector('Sub')?.getAttribute('value') ?? '' };
};
const pLinks = (o: Obj, k: string) => Array.from(o.props.get(k)?.querySelectorAll('Link') ?? []).map((l) => l.getAttribute('value') ?? '').filter(Boolean);

/** Rotation (unit quaternion x,y,z,w) as a 3x3 row-major matrix, plus translation. */
interface Pl { p: V3; m: number[] }
function placement(o: Obj, k = 'Placement'): Pl {
  const e = first(o.props.get(k));
  const [x, y, z, w] = ['Q0', 'Q1', 'Q2', 'Q3'].map((a) => num(e?.getAttribute(a), a === 'Q3' ? 1 : 0));
  const n = Math.hypot(x, y, z, w) || 1;
  const [a, b, c, d] = [x / n, y / n, z / n, w / n];
  return {
    p: [num(e?.getAttribute('Px')), num(e?.getAttribute('Py')), num(e?.getAttribute('Pz'))],
    m: [1 - 2 * (b * b + c * c), 2 * (a * b - c * d), 2 * (a * c + b * d), 2 * (a * b + c * d), 1 - 2 * (a * a + c * c), 2 * (b * c - a * d), 2 * (a * c - b * d), 2 * (b * c + a * d), 1 - 2 * (a * a + b * b)],
  };
}
const col = (m: number[], i: number): V3 => [m[i], m[3 + i], m[6 + i]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const isIdentity = (pl: Pl) => pl.p.every((v) => Math.abs(v) < EPS) && [0, 4, 8].every((i) => Math.abs(pl.m[i] - 1) < EPS) && [1, 2, 3, 5, 6, 7].every((i) => Math.abs(pl.m[i]) < EPS);

/** Our standard planes in global (= FreeCAD) coordinates: u, v in-plane axes and the normal n (u x v = n). */
const STD: Record<string, { u: V3; v: V3; n: V3 }> = {
  front: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  top: { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] },
  right: { u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
};
const PLANE_OF_ORIGIN: Record<string, string> = { XY_Plane: 'front', XZ_Plane: 'top', YZ_Plane: 'right' };
const AXIS_OF_ORIGIN: Record<string, V3> = { X_Axis: [1, 0, 0], Y_Axis: [0, 1, 0], Z_Axis: [0, 0, 1] };

function axisLetter(d: V3): { axis: 'x' | 'y' | 'z'; sign: 1 | -1 } | null {
  for (let i = 0; i < 3; i++) if (Math.abs(Math.abs(d[i]) - 1) < 1e-6) return { axis: (['x', 'y', 'z'] as const)[i], sign: d[i] > 0 ? 1 : -1 };
  return null;
}

interface SketchGeo { type: string; construction: boolean; a: Record<string, number> }
interface SketchCons { type: number; first: number; firstPos: number; second: number; secondPos: number; value: number; driving: boolean }

function readSketch(o: Obj) {
  const geo: SketchGeo[] = [];
  for (const g of Array.from(o.props.get('Geometry')?.querySelectorAll('Geometry') ?? [])) {
    const type = g.getAttribute('type') ?? '';
    const body = Array.from(g.children).find((c) => !['GeoExtensions', 'Construction', 'UID'].includes(c.tagName));
    const a: Record<string, number> = {};
    for (const at of Array.from(body?.attributes ?? [])) a[at.name] = num(at.value);
    geo.push({ type, construction: g.querySelector('Construction')?.getAttribute('value') === '1', a });
  }
  const cons: SketchCons[] = Array.from(o.props.get('Constraints')?.querySelectorAll('Constrain') ?? []).map((c) => ({
    type: num(c.getAttribute('Type')), first: num(c.getAttribute('First'), -2000), firstPos: num(c.getAttribute('FirstPos')),
    second: num(c.getAttribute('Second'), -2000), secondPos: num(c.getAttribute('SecondPos')), value: num(c.getAttribute('Value')),
    driving: c.getAttribute('IsDriving') !== '0',
  }));
  return { geo, cons };
}

export function importFcDocument(xml: string, name = 'FreeCAD part', opts: { body?: string } = {}): FcImport {
  const warnings: FcWarning[] = [];
  const warn = (object: string, code: string, message: string) => warnings.push({ object, code, message });
  const objectTypes: Record<string, number> = {};
  const features: Feat[] = [];
  const steps: FcStep[] = [];
  const skipped: string[] = [];
  let seq = 1;
  const nextId = () => `F${seq++}`;

  let doc: Document;
  try { doc = new DOMParser().parseFromString(xml, 'text/xml'); } catch (e) { warn('Document', 'parse', (e as Error).message); doc = null as unknown as Document; }
  const bad = !doc || doc.querySelector('parsererror');
  const finish = (): FcImport => ({ name, part: { format: 'ck-part', version: 1, name, features, seq }, warnings, steps, objectTypes, bodies: [], skipped });
  if (bad) { if (doc) warn('Document', 'parse', 'Document.xml is not valid XML'); return finish(); }

  const objs = parseObjects(doc);
  for (const o of objs.values()) objectTypes[o.type] = (objectTypes[o.type] ?? 0) + 1;

  const bodies = Array.from(objs.values()).filter((o) => o.type === 'PartDesign::Body');
  if (!bodies.length) {
    const kinds = Object.keys(objectTypes).filter((t) => !t.startsWith('App::')).slice(0, 6).join(', ');
    warn('Document', 'noBody', `no PartDesign::Body in the file (objects: ${kinds || 'none'}); nothing to import as a feature tree`);
    return finish();
  }
  // Nested bodies (inside App::Part / links) are listed too; import the first top-level one with features, mention the rest.
  const nFeat = (b: Obj) => pLinks(b, 'Group').filter((n) => /^PartDesign::(Pad|Pocket|Revolution|Groove|Fillet|Chamfer|Mirrored|LinearPattern|PolarPattern|Hole|Thickness|Draft)$/.test(objs.get(n)?.type ?? '')).length;
  const body = bodies.find((b) => b.name === opts.body) ?? [...bodies].sort((a, b) => nFeat(b) - nFeat(a))[0];
  const bodyNames = bodies.map((b) => b.name);
  if (bodies.length > 1) warn(body.name, 'multipleBodies', `${bodies.length} bodies in the file; only "${body.name}" is imported`);
  if (!isIdentity(placement(body))) warn(body.name, 'bodyPlacement', 'the Body has a non-identity Placement; it is ignored');

  const made = new Map<string, string>(); // FreeCAD feature name -> our id of the feature that carries its body result
  const sketchDone = new Map<string, { sketchId: string; plane: Feat; pl: Pl; std: string; flipSame: boolean; entityOfGeo: string[]; constructionLines: number[] }>();
  let tipName = pLink(body, 'Tip');

  /** Emit (once) the sketch of a FreeCAD sketch object; returns what the features need. */
  function emitSketch(sk: Obj, wantAxis?: 'V' | 'H') {
    const done = sketchDone.get(sk.name);
    if (done && !wantAxis) return done;
    if (done && wantAxis) return done;
    const pl = placement(sk);
    const u = col(pl.m, 0), v = col(pl.m, 1), n = col(pl.m, 2);
    const ax = axisLetter(n);
    if (!ax) { warn(sk.name, 'planeUnsupported', 'the sketch plane is not parallel to a standard plane (needs a custom plane frame in the kernel)'); return null; }
    const std = ax.axis === 'z' ? 'front' : ax.axis === 'y' ? 'top' : 'right';
    const S = STD[std];
    const offset = dot(pl.p, S.n);
    const flipSame = dot(n, S.n) > 0;
    const to2 = (x: number, y: number): [number, number] => {
      const P: V3 = [pl.p[0] + u[0] * x + v[0] * y, pl.p[1] + u[1] * x + v[1] * y, pl.p[2] + u[2] * x + v[2] * y];
      return [dot(P, S.u), dot(P, S.v)];
    };
    const det = dot(u, S.u) * dot(v, S.v) - dot(v, S.u) * dot(u, S.v);
    const mirrored = det < 0;
    let plane: Feat = { kind: 'std', id: std };
    if (Math.abs(offset) > EPS) {
      const pid = nextId();
      features.push({ type: 'plane', id: pid, mode: 'offset', base: { kind: 'std', id: std }, offset });
      plane = { kind: 'feature', id: pid };
    }
    const { geo, cons } = readSketch(sk);
    const points: Array<Record<string, unknown>> = [{ id: 'O', x: 0, y: 0, fixed: true }];
    const entities: Array<Record<string, unknown>> = [];
    const entityOfGeo: string[] = [];
    const pointOf = new Map<string, string>(); // "geo:pos" -> point id
    const endpoints: Array<{ id: string; x: number; y: number }> = [];
    let pn = 0;
    const addPoint = (key: string, x: number, y: number, merge: boolean) => {
      if (merge) { const hit = endpoints.find((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6); if (hit) { pointOf.set(key, hit.id); return hit.id; } }
      const id = `p${++pn}`;
      points.push({ id, x, y }); pointOf.set(key, id);
      if (merge) endpoints.push({ id, x, y });
      return id;
    };
    let dropped = 0;
    geo.forEach((g, i) => {
      const eid = `e${i + 1}`;
      entityOfGeo[i] = eid;
      const c = g.construction ? { construction: true } : {};
      const A = g.a;
      if (g.type === 'Part::GeomLineSegment') {
        const [x1, y1] = to2(A.StartX, A.StartY), [x2, y2] = to2(A.EndX, A.EndY);
        entities.push({ type: 'line', id: eid, p1: addPoint(`${i}:1`, x1, y1, true), p2: addPoint(`${i}:2`, x2, y2, true), ...c });
      } else if (g.type === 'Part::GeomCircle') {
        const [cx, cy] = to2(A.CenterX, A.CenterY);
        entities.push({ type: 'circle', id: eid, c: addPoint(`${i}:3`, cx, cy, false), r: A.Radius, ...c });
      } else if (g.type === 'Part::GeomArcOfCircle') {
        if (A.NormalZ < 0) { warn(sk.name, 'arcNormal', `arc ${i} has a reversed normal; skipped`); dropped++; entityOfGeo[i] = ''; return; }
        const r = A.Radius;
        const [cx, cy] = to2(A.CenterX, A.CenterY);
        const s = to2(A.CenterX + r * Math.cos(A.StartAngle), A.CenterY + r * Math.sin(A.StartAngle));
        const e = to2(A.CenterX + r * Math.cos(A.EndAngle), A.CenterY + r * Math.sin(A.EndAngle));
        const cp = addPoint(`${i}:3`, cx, cy, false);
        const ps = addPoint(`${i}:1`, s[0], s[1], true), pe = addPoint(`${i}:2`, e[0], e[1], true);
        // a mirroring plane map reverses the sweep direction: swap the ends so it stays counter-clockwise
        entities.push({ type: 'arc', id: eid, c: cp, p1: mirrored ? pe : ps, p2: mirrored ? ps : pe, ...c });
        if (mirrored) { pointOf.set(`${i}:1`, pe); pointOf.set(`${i}:2`, ps); }
      } else if (g.type === 'Part::GeomEllipse') {
        const [cx, cy] = to2(A.CenterX, A.CenterY);
        const [mx, my] = to2(A.CenterX + A.MajorRadius * Math.cos(A.AngleXU), A.CenterY + A.MajorRadius * Math.sin(A.AngleXU));
        entities.push({ type: 'ellipse', id: eid, c: addPoint(`${i}:3`, cx, cy, false), p: addPoint(`${i}:m`, mx, my, false), r: A.MinorRadius, ...c });
      } else if (g.type === 'Part::GeomPoint') {
        const [x, y] = to2(A.X, A.Y);
        entities.push({ type: 'point', id: eid, p: addPoint(`${i}:1`, x, y, false), ...c });
      } else {
        dropped++; entityOfGeo[i] = '';
        warn(sk.name, 'geometry', `${g.type.replace('Part::Geom', '')} (geometry ${i}) is not mapped`);
      }
    });
    // constraints: coincident merges points; the rest map when both refs exist
    const ref = (gi: number, pos: number) => (gi === -1 && pos === 1 ? 'O' : pointOf.get(`${gi}:${pos}`));
    const out: Array<Record<string, unknown>> = [];
    let kid = 0, skipped = 0;
    const sameSource = new Map<string, string>();
    for (const k of cons) {
      if (k.type === 1) { // coincident: the points were merged by position; if not equal in position, keep a constraint
        const a = ref(k.first, k.firstPos), b = ref(k.second, k.secondPos);
        if (a && b && a !== b) out.push({ id: `k${++kid}`, type: 'coincident', refs: [a, b] });
        continue;
      }
      const e1 = entityOfGeo[k.first], e2 = entityOfGeo[k.second];
      const pa = k.firstPos ? ref(k.first, k.firstPos) : undefined, pb = k.secondPos ? ref(k.second, k.secondPos) : undefined;
      const add = (type: string, refs: string[], value?: number) => out.push({ id: `k${++kid}`, type, refs, ...(value !== undefined ? { value } : {}) });
      const lineEnds = (gi: number): [string, string] | null => { const a = pointOf.get(`${gi}:1`), b = pointOf.get(`${gi}:2`); return a && b ? [a, b] : null; };
      const pt = (id: string) => points.find((p) => p.id === id) as { x: number; y: number };
      if (!k.driving && [6, 7, 8, 9, 11, 18].includes(k.type)) { skipped++; continue; }
      switch (k.type) {
        case 2: case 3: if (e1 && k.second === -2000) add(k.type === 2 ? 'horizontal' : 'vertical', [e1]); else skipped++; break;
        case 4: if (e1 && e2) add('parallel', [e1, e2]); else skipped++; break;
        case 10: if (e1 && e2) add('perpendicular', [e1, e2]); else skipped++; break;
        case 5: if (e1 && e2) add('tangent', [e1, e2]); else skipped++; break;
        case 12: if (e1 && e2) add('equal', [e1, e2]); else skipped++; break;
        case 11: if (e1) add('radius', [e1], k.value); else skipped++; break;
        case 18: if (e1) add('diameter', [e1], k.value); else skipped++; break;
        case 6: case 7: case 8: {
          let a = pa, b = pb;
          if (!k.secondPos && k.first >= 0 && !pa) { const le = lineEnds(k.first); if (le) [a, b] = le; } // length of a line
          if (a && b && a !== b) {
            const A = pt(a), B = pt(b);
            if (k.type === 6) add('distance', [a, b], Math.abs(k.value));
            else if (k.type === 7) { const [lo, hi] = A.x <= B.x ? [a, b] : [b, a]; add('hdist', [lo, hi], Math.abs(k.value)); }
            else { const [lo, hi] = A.y <= B.y ? [a, b] : [b, a]; add('vdist', [lo, hi], Math.abs(k.value)); }
          } else skipped++;
          break;
        }
        default: skipped++;
      }
    }
    void sameSource;
    if (skipped || dropped) warn(sk.name, 'constraints', `${skipped} constraint(s) and ${dropped} geometry item(s) not carried (point-on-object, symmetric, angle, block, internal alignment, driven dimensions ...); the geometry keeps FreeCAD's solved positions`);
    if (sk.props.get('ExpressionEngine')?.querySelector('Expression')) warn(sk.name, 'expressions', 'sketch expressions are dropped (cached values kept)');
    const constructionLines = geo.map((g, i) => (g.construction && g.type === 'Part::GeomLineSegment' ? i : -1)).filter((i) => i >= 0);
    const id = nextId();
    features.push({ type: 'sketch', id, plane, points, entities, constraints: out });
    const res = { sketchId: id, plane, pl, std, flipSame, entityOfGeo, constructionLines };
    sketchDone.set(sk.name, res);
    return res;
  }

  /** Add a construction axis line through the origin of the sketch (for V_Axis / H_Axis / a global axis) and return its entity id. */
  function addAxisLine(sketchFeatureId: string, a: [number, number], dir: [number, number]): string {
    const f = features.find((x) => x.id === sketchFeatureId) as { points: Array<Record<string, unknown>>; entities: Array<Record<string, unknown>> };
    const k = f.entities.length + 1;
    const p1 = `ax${k}a`, p2 = `ax${k}b`;
    f.points.push({ id: p1, x: a[0], y: a[1] }, { id: p2, x: a[0] + dir[0] * 10, y: a[1] + dir[1] * 10 });
    const id = `ax${k}`;
    f.entities.push({ type: 'line', id, p1, p2, construction: true });
    return id;
  }

  /** The revolve axis as an entity of the sketch, or null (warned). */
  function axisEntity(feat: Obj, sk: Obj, s: NonNullable<ReturnType<typeof emitSketch>>): string | null {
    const { obj, sub } = pLinkSub(feat, 'ReferenceAxis');
    const pl = s.pl; const u = col(pl.m, 0), v = col(pl.m, 1);
    const S = STD[s.std];
    const project = (d: V3): [number, number] | null => { // global direction -> sketch-plane direction, only when it lies in the plane
      if (Math.abs(dot(d, S.n)) > 1e-6) return null;
      return [dot(d, S.u), dot(d, S.v)];
    };
    const origin2: [number, number] = [dot(pl.p, S.u) * 0, 0];
    const originOfSketch: [number, number] = [dot(pl.p, S.u), dot(pl.p, S.v)];
    void origin2;
    if (obj === sk.name && (sub === 'V_Axis' || sub === 'H_Axis')) {
      const d = project(sub === 'V_Axis' ? v : u);
      return d ? addAxisLine(s.sketchId, originOfSketch, d) : null;
    }
    if (obj === sk.name && /^Axis\d+$/.test(sub)) {
      const li = s.constructionLines[Number(sub.slice(4))];
      if (li !== undefined && s.entityOfGeo[li]) return s.entityOfGeo[li];
    }
    const g = AXIS_OF_ORIGIN[obj] ?? AXIS_OF_ORIGIN[sub];
    if (g) {
      const d = project(g);
      const off = Math.abs(dot(pl.p, S.n) - 0);
      void off;
      if (d) return addAxisLine(s.sketchId, [0, 0], d);
    }
    warn(feat.name, 'axisUnsupported', `revolve axis ${obj}.${sub} is not a sketch axis, construction line or origin axis lying in the sketch plane`);
    return null;
  }

  const end = (name: string, kind: string, ok: boolean, produced: string[], shape?: string) => {
    if (ok) { steps.push({ fc: name, type: kind, features: produced, shape }); }
  };
  const shapeFile = (o: Obj) => first(o.props.get('Shape'))?.getAttribute('file') ?? undefined;

  let group = pLinks(body, 'Group');
  if (!group.length) { // FreeCAD 0.14-0.16 files have no Group: follow BaseFeature links back from the Tip
    const chain: string[] = [];
    let cur = tipName;
    while (cur && objs.has(cur) && !chain.includes(cur)) { chain.unshift(cur); cur = pLink(objs.get(cur)!, 'BaseFeature'); }
    group = chain;
    if (chain.length) warn(body.name, 'legacyFormat', 'old file format (no Body Group); features taken from the BaseFeature chain');
  }
  for (const fname of group) {
    const o = objs.get(fname);
    if (!o) continue;
    const t = o.type;
    if (t === 'Sketcher::SketchObject' || t.startsWith('PartDesign::Plane') || t === 'Part::DatumPlane' || t.startsWith('PartDesign::Line') || t.startsWith('PartDesign::Point') || t === 'PartDesign::CoordinateSystem') continue;
    if (!t.startsWith('PartDesign::')) { warn(fname, 'objectType', `${t} is not a PartDesign feature; ignored`); continue; }
    if (pBool(o, 'Suppressed')) { warn(fname, 'suppressed', 'suppressed feature skipped'); continue; }
    if (o.props.get('ExpressionEngine')?.querySelector('Expression')) warn(fname, 'expressions', 'parameter expressions are dropped (cached values kept)');
    const produced: string[] = [];
    const mark = features.length;
    const profile = pLinkSub(o, 'Profile').obj || pLink(o, 'Sketch');
    const sk = objs.get(profile);
    const ok = (() => {
      switch (t) {
        case 'PartDesign::Pad': case 'PartDesign::Pocket': {
          if (!sk) { warn(fname, 'noProfile', 'no sketch profile'); return false; }
          const cut = t === 'PartDesign::Pocket';
          const type = pNum(o, 'Type');
          const side = pNum(o, 'SideType', 0); // FreeCAD 1.0: 0 one side, 1 two sides, 2 symmetric (older files use Midplane)
          const mid = side === 2 || pBool(o, 'Midplane');
          const reversed = pBool(o, 'Reversed');
          if (pNum(o, 'TaperAngle') !== 0) { warn(fname, 'taper', 'tapered pad/pocket needs the draft option; not mapped'); return false; }
          if (pBool(o, 'UseCustomVector')) { warn(fname, 'customVector', 'custom extrusion direction not mapped'); return false; }
          const s = emitSketch(sk);
          if (!s) return false;
          const base: Feat = { type: 'extrude', op: cut ? 'cut' : 'add', sketch: s.sketchId };
          let flip = reversed !== !s.flipSame;
          let L = pNum(o, 'Length');
          if (L < 0) { L = -L; flip = !flip; } // a negative length runs the other way
          const push = (extra: Feat) => { const id = nextId(); features.push({ ...base, id, ...extra }); produced.push(id); };
          if (type === 0 && side !== 1) {
            if (mid) push({ end: 'mid', depth: L });
            else push({ end: 'blind', depth: L, ...(flip ? { flip: true } : {}) });
          } else if (cut && type === 1) {
            push({ end: mid ? 'throughBoth' : 'through', ...(flip ? { flip: true } : {}) });
          } else if (type === 4 || (side === 1 && type === 0)) { // two lengths: one extrude each way
            push({ end: 'blind', depth: L, ...(flip ? { flip: true } : {}) });
            push({ end: 'blind', depth: pNum(o, 'Length2'), ...(!flip ? { flip: true } : {}) });
          } else { warn(fname, 'endCondition', `${t.slice(12)} end type ${type} (up to face / first / last) is not mapped`); return false; }
          return true;
        }
        case 'PartDesign::Revolution': case 'PartDesign::Groove': {
          if (!sk) { warn(fname, 'noProfile', 'no sketch profile'); return false; }
          const s = emitSketch(sk);
          if (!s) return false;
          const axis = axisEntity(o, sk, s);
          if (!axis) return false;
          const angle = pNum(o, 'Angle', 360);
          if (pNum(o, 'Type') !== 0) { warn(fname, 'endCondition', 'revolve to face / two angles not mapped'); return false; }
          const id = nextId();
          const flip = pBool(o, 'Reversed') !== !s.flipSame;
          features.push({ type: 'revolve', id, op: t === 'PartDesign::Groove' ? 'cut' : 'add', sketch: s.sketchId, axis, angle, ...(angle < 360 && flip ? { flip: true } : {}) });
          if (angle < 360 && (pNum(o, 'SideType') !== 0 || pBool(o, 'Midplane'))) warn(fname, 'revolveSides', 'symmetric / two-sided partial revolve not mapped');
          if (angle < 360) warn(fname, 'partialRevolve', 'partial revolve direction is not verified against FreeCAD');
          produced.push(id);
          return true;
        }
        case 'PartDesign::Mirrored': {
          const orig = pLinks(o, 'Originals').map((n) => made.get(n)).filter(Boolean) as string[];
          const { obj, sub } = pLinkSub(o, 'MirrorPlane');
          const pl = PLANE_OF_ORIGIN[obj] ?? PLANE_OF_ORIGIN[sub];
          if (!pl || !orig.length) { warn(fname, 'mirror', `mirror plane ${obj}.${sub} or originals not mapped`); return false; }
          const id = nextId();
          features.push({ type: 'mirror', id, seeds: orig, plane: { kind: 'std', id: pl }, body: false });
          produced.push(id);
          return true;
        }
        case 'PartDesign::LinearPattern': case 'PartDesign::PolarPattern': {
          const orig = pLinks(o, 'Originals').map((n) => made.get(n)).filter(Boolean) as string[];
          const dirProp = t === 'PartDesign::LinearPattern' ? 'Direction' : 'Axis';
          const { obj, sub } = pLinkSub(o, dirProp);
          let d: V3 | undefined = AXIS_OF_ORIGIN[obj] ?? AXIS_OF_ORIGIN[sub];
          const ssk = objs.get(obj);
          if (!d && ssk && (sub === 'H_Axis' || sub === 'V_Axis' || sub === 'N_Axis')) { const m = placement(ssk).m; d = col(m, sub === 'H_Axis' ? 0 : sub === 'V_Axis' ? 1 : 2); }
          const L = d && axisLetter(d);
          if (!orig.length || !L) { warn(fname, 'pattern', `pattern direction ${obj}.${sub} (edge / custom) or originals not mapped`); return false; }
          const id = nextId();
          const rev = pBool(o, 'Reversed') !== (L.sign < 0);
          const count = pNum(o, 'Occurrences', 2);
          if (t === 'PartDesign::LinearPattern') {
            const mode = pNum(o, 'Mode');
            const spacing = mode === 0 ? pNum(o, 'Length') / Math.max(1, count - 1) : pNum(o, 'Offset');
            features.push({ type: 'lpattern', id, seeds: orig, dir: { kind: 'axis', axis: L.axis }, count, spacing, reverse: rev });
          } else {
            const angle = pNum(o, 'Angle', 360);
            if (pNum(o, 'Mode') !== 0) warn(fname, 'polarOffset', 'polar pattern in offset mode is approximated by the total angle');
            features.push({ type: 'cpattern', id, seeds: orig, axis: { kind: 'axis', axis: L.axis }, count, angle, equal: true, ...(rev ? { reverse: true } : {}) });
          }
          produced.push(id);
          return true;
        }
        case 'PartDesign::Fillet': case 'PartDesign::Chamfer': case 'PartDesign::Thickness': case 'PartDesign::Draft': {
          warn(fname, 'edgeReferences', `${t.slice(12)} refers to cached topology names (Edge/Face index); resolving them needs a BRep reader for ${fname}.Shape.brp`);
          return false;
        }
        case 'PartDesign::Hole': case 'PartDesign::Boolean': case 'PartDesign::SubShapeBinder': case 'PartDesign::AdditiveLoft': case 'PartDesign::SubtractiveLoft': case 'PartDesign::AdditivePipe': case 'PartDesign::SubtractivePipe': case 'PartDesign::AdditiveHelix': case 'PartDesign::SubtractiveHelix': case 'PartDesign::MultiTransform': case 'PartDesign::Scaled': case 'PartDesign::FeatureBase': case 'PartDesign::AdditiveBox': case 'PartDesign::SubtractiveBox': case 'PartDesign::AdditiveCylinder': case 'PartDesign::SubtractiveCylinder':
          warn(fname, 'unsupportedFeature', `${t} is not mapped yet`);
          return false;
        default:
          warn(fname, 'unsupportedFeature', `${t} is not mapped`);
          return false;
      }
    })();
    if (ok) {
      const result = produced[produced.length - 1];
      made.set(fname, result);
      end(fname, t, true, features.slice(mark).map((f) => f.id as string), shapeFile(o));
    } else {
      skipped.push(fname);
      // a sketch emitted for a feature that failed stays out of the tree
      features.length = mark;
      for (const [k, v] of sketchDone) if (!features.some((f) => f.id === v.sketchId)) sketchDone.delete(k);
    }
  }
  if (!tipName) tipName = group[group.length - 1] ?? '';
  const tip = objs.get(tipName);
  const res = finish();
  res.bodies = bodyNames;
  if (!steps.length) warn(body.name, 'noFeatures', 'no PartDesign feature could be mapped (the body may be built from a loft, pipe, binder, Part workbench objects or imported shapes)');
  res.finalShape = (tip && shapeFile(tip)) ?? shapeFile(body);
  return res;
}

/** Read an FCStd (zip) and map it. */
export async function importFcstd(bytes: Uint8Array, name = 'FreeCAD part', opts: { body?: string } = {}): Promise<FcImport> {
  let xml: Uint8Array | null = null;
  try { xml = await zipFile(bytes, 'Document.xml'); } catch (e) {
    return { name, part: { format: 'ck-part', version: 1, name, features: [], seq: 1 }, warnings: [{ object: 'file', code: 'zip', message: (e as Error).message }], steps: [], objectTypes: {}, bodies: [], skipped: [] };
  }
  if (!xml) return { name, part: { format: 'ck-part', version: 1, name, features: [], seq: 1 }, warnings: [{ object: 'file', code: 'noDocument', message: 'no Document.xml in the archive' }], steps: [], objectTypes: {}, bodies: [], skipped: [] };
  return importFcDocument(new TextDecoder().decode(xml), name, opts);
}
