// FreeCAD FCStd -> feature tree. Parses Document.xml (the parametric object tree) and maps the PartDesign subset that has a
// clean equivalent: Sketch + Pad/Pocket/Revolution/Groove/Mirrored/LinearPattern/PolarPattern. Everything else becomes a
// warning (never a throw). Coordinates are kept as FreeCAD has them (no Y-up rotation); sketch planes are mapped to our
// standard planes by normal, plus an offset plane when the sketch is not through the origin. See docs/fcstd.md.
import { zipFile, zipEntries, zipRead } from './zip';
import { brepEdges, brepFaces, type BrepFace } from './brep';
import { makeParams } from './fcparams';

export interface FcWarning { object: string; code: string; message: string }
/** A FreeCAD parameter the import keeps editable: `path` is `Object.Property` (or `Sheet.alias`), `set` writes a new value (FreeCAD units: mm, degrees) into the imported part. */
export interface FcParam { path: string; set(part: FcImport['part'], value: number): void }
export interface FaceFrame { o: number[]; x: number[]; y: number[]; z: number[] }
/** A feature that needs kernel faces: the faces are described by their outward normal and a point in them, as FreeCAD's stored shape has them. */
export interface FaceRequest {
  /** our id of the feature that gets the ids (and is removed when they are not found, unless `optional`) */
  feature: string;
  fc: string;
  /** the first feature of the FreeCAD step: the faces are looked up in the body just before it */
  before: string;
  names: string[];
  faces: Array<{ normal: [number, number, number]; at: [number, number, number] }>;
  apply(part: FcImport['part'], ids: string[], frames?: Array<FaceFrame | undefined>): void;
  /** also ask for the frame (origin and axes) of a sketch plane on each face */
  needFrame?: boolean;
  /** the feature stays as it is when the faces are not found */
  optional?: boolean;
}
export interface FcStep { fc: string; type: string; features: string[]; shape?: string }
export interface FcImport {
  name: string;
  part: { format: 'ck-part'; version: number; name: string; features: Array<Record<string, unknown>>; seq: number } & Record<string, unknown>;
  warnings: FcWarning[];
  /** One entry per mapped FreeCAD feature, in order: which of our feature ids it produced and its cached shape file. */
  steps: FcStep[];
  /** FreeCAD features that could not be mapped (their names, in order). */
  skipped: string[];
  /** Fillet / chamfer features waiting for their edges: the edge points (from the cached BRep) to be resolved by the kernel, see resolveEdges. */
  edgeRequests: Array<{ feature: string; fc: string; names: string[]; points: Array<[number, number, number]> }>;
  /** Features waiting for faces of the body before them (Thickness, Draft, up to face, sketches on faces): see resolveFaces. */
  faceRequests?: FaceRequest[];
  /** Names of all PartDesign bodies in the file (only one is imported, see opts.body). */
  bodies: string[];
  /** Editable FreeCAD parameters of what was imported (see FcParam). */
  params?: FcParam[];
  /** FreeCAD object type counts, for reports. */
  objectTypes: Record<string, number>;
  /** Cached final shape of the Body Tip (view-only fallback needs a BRep reader). */
  finalShape?: string;
}

export type Obj = { name: string; type: string; props: Map<string, Element> };
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
/** A sub-element name: FreeCAD 1.x writes a mapped name in `value` and the index name in `shadowed` (`value="Axis" shadowed="Axis0"`); the index name wins when the visible one is not an index. */
const subName = (e: Element | null | undefined): string => {
  const v = e?.getAttribute('value') ?? '';
  const sh = e?.getAttribute('shadowed') ?? '';
  return sh && !/^[A-Za-z_]+\d+$/.test(v) && /^[A-Za-z_]+\d+$/.test(sh) ? sh : v;
};
const pLinkSub = (o: Obj, k: string): { obj: string; sub: string } => {
  const ls = first(o.props.get(k));
  return { obj: ls?.getAttribute('value') ?? '', sub: subName(ls?.querySelector('Sub')) };
};
/** The origin features of the second and later Bodies are called XY_Plane001, X_Axis002 ...; the role is the name without the number. */
const originRole = (n: string) => n.replace(/^((?:[XYZ]_Axis|XY_Plane|XZ_Plane|YZ_Plane))\d+$/, '$1');
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
const PART_PRIMITIVES = new Set(['Part::Box', 'Part::Cylinder', 'Part::Sphere', 'Part::Cone', 'Part::Torus', 'Part::Prism']);
const PLANE_OF_ORIGIN_ROLE: Record<string, string> = { XY_Plane: 'front', XZ_Plane: 'top', YZ_Plane: 'right' };
const AXIS_OF_ORIGIN_ROLE: Record<string, V3> = { X_Axis: [1, 0, 0], Y_Axis: [0, 1, 0], Z_Axis: [0, 0, 1] };
const PLANE_OF_ORIGIN = { get: (n: string) => PLANE_OF_ORIGIN_ROLE[originRole(n)] };
const AXIS_OF_ORIGIN = { get: (n: string) => AXIS_OF_ORIGIN_ROLE[originRole(n)] };

function axisLetter(d: V3): { axis: 'x' | 'y' | 'z'; sign: 1 | -1 } | null {
  for (let i = 0; i < 3; i++) if (Math.abs(Math.abs(d[i]) - 1) < 1e-6) return { axis: (['x', 'y', 'z'] as const)[i], sign: d[i] > 0 ? 1 : -1 };
  return null;
}

interface SketchGeo { type: string; construction: boolean; a: Record<string, number> }
interface SketchCons { name: string; type: number; first: number; firstPos: number; second: number; secondPos: number; value: number; driving: boolean }

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
    name: c.getAttribute('Name') ?? '', type: num(c.getAttribute('Type')), first: num(c.getAttribute('First'), -2000), firstPos: num(c.getAttribute('FirstPos')),
    second: num(c.getAttribute('Second'), -2000), secondPos: num(c.getAttribute('SecondPos')), value: num(c.getAttribute('Value')),
    driving: c.getAttribute('IsDriving') !== '0',
  }));
  return { geo, cons };
}

export function importFcDocument(xml: string, name = 'FreeCAD part', opts: { body?: string; /** import one Part workbench object (a primitive) instead of a Body */ object?: string; /** text of the cached BRep files by name; enables fillet / chamfer edge lookup */ brp?: (file: string) => string | undefined } = {}): FcImport {
  const warnings: FcWarning[] = [];
  const warn = (object: string, code: string, message: string) => warnings.push({ object, code, message });
  const objectTypes: Record<string, number> = {};
  const features: Feat[] = [];
  const steps: FcStep[] = [];
  const skipped: string[] = [];
  const edgeRequests: FcImport['edgeRequests'] = [];
  const faceRequests: FaceRequest[] = [];
  let seq = 1;
  const nextId = () => `F${seq++}`;

  let doc: Document;
  try { doc = new DOMParser().parseFromString(xml, 'text/xml'); } catch (e) { warn('Document', 'parse', (e as Error).message); doc = null as unknown as Document; }
  const bad = !doc || doc.querySelector('parsererror');
  let P: ReturnType<typeof makeParams> | undefined;
  const params: FcParam[] = [];
  const finish = (): FcImport => ({ name, part: { format: 'ck-part', version: 1, name, features, seq, ...(P?.variables.length ? { variables: P.variables.map((v) => ({ name: v.name, expr: v.expr })) } : {}) }, warnings, steps, objectTypes, bodies: [], skipped, edgeRequests, faceRequests, params });
  if (bad) { if (doc) warn('Document', 'parse', 'Document.xml is not valid XML'); return finish(); }

  const objs = parseObjects(doc);
  P = makeParams({ objs, warn, attr: (o, k) => first(o.props.get(k))?.getAttribute('value') ?? null, constraints: (sk) => readSketch(sk).cons.map((c) => ({ name: c.name, type: c.type, value: c.value })) });
  /** The faces named `Face<n>` of the stored shape of object `obj`, as planes with outward normals; null (with a warning) when one is not a plane or the shape is not available. */
  function planarFaces(fname: string, obj: string, subs: string[]): Array<{ normal: V3; at: V3; name: string }> | null {
    const file = objs.get(obj) ? first(objs.get(obj)!.props.get('Shape'))?.getAttribute('file') ?? undefined : undefined;
    const text = file && opts.brp ? opts.brp(file) : undefined;
    if (!text) { warn(fname, 'faceReferences', `${subs.join(', ')} of ${obj} need its stored shape (${file ?? 'no shape file'})`); return null; }
    const all = brepFaces(text);
    const out: Array<{ normal: V3; at: V3; name: string }> = [];
    for (const n of subs) {
      const f: BrepFace | undefined = all[Number(n.slice(4)) - 1];
      if (!f) { warn(fname, 'faceReferences', `${n} is out of range in ${file}`); return null; }
      if (f.surface !== 'plane' || !f.normal) { warn(fname, 'faceReferences', `${n} of ${obj} is a ${f.surface} face; only planar faces are mapped`); return null; }
      out.push({ normal: f.normal, at: f.at, name: n });
    }
    return out;
  }
  const finalizers: Array<() => void> = [];
  const usedExpr = new Set<string>(); // `Object.path` of the expressions the import used or reported
  const featOf = (part: FcImport['part'], id: string) => part.features.find((f) => f.id === id) as Feat | undefined;
  const setVar = (part: FcImport['part'], vname: string, v: number) => { const x = (part.variables as Array<{ name: string; expr: string }> | undefined)?.find((q) => q.name === vname); if (x) x.expr = String(v); };
  /**
   * Make numeric field `key` of feature `feat` follow property `prop` of FreeCAD object `o`: a bound expression becomes an expression over
   * variables; an unbound property becomes an editable parameter `Object.Prop` (and follows the variable made for it when another expression refers to it).
   */
  function bind(o: Obj, prop: string, feat: Feat, key: string, set?: (f: Feat, v: number) => void) {
    const stored = Number(feat[key]);
    usedExpr.add(`${o.name}.${prop}`);
    const b = P!.bound(o, prop, stored);
    if (b) feat[key] = '=' + b.expr;
    const id = feat.id as string, vkey = `${o.name}.${prop}`;
    // setting a bound property replaces its expression by the number
    params.push({ path: vkey, set: (part, v) => { const vr = P!.peek(vkey); if (vr) setVar(part, vr.name, v); const f = featOf(part, id); if (f && (b || !vr)) (set ?? ((ff, vv) => { ff[key] = vv; }))(f, v); } });
    if (b || P!.hasExpr(o, prop)) return;
    finalizers.push(() => { const vr = P!.peek(vkey); if (vr) feat[key] = '=' + vr.name; });
  }
  const legacy = /^0\.(1[0-6]|[0-9])(\D|$)/.test(doc.documentElement.getAttribute('ProgramVersion') ?? '');
  for (const o of objs.values()) objectTypes[o.type] = (objectTypes[o.type] ?? 0) + 1;

  const bodies = Array.from(objs.values()).filter((o) => o.type === 'PartDesign::Body');
  /** `opts.object`: a Part workbench object stands in for a Body that holds just it */
  let pseudo: Obj | undefined;
  if (opts.object) {
    const target = objs.get(opts.object);
    if (!target) { warn(opts.object, 'noObject', `no object ${opts.object} in the file`); return finish(); }
    const mk = (xml: string) => new DOMParser().parseFromString(`<r>${xml}</r>`, 'text/xml').documentElement.firstElementChild as Element;
    pseudo = { name: target.name, type: 'PartDesign::Body', props: new Map([['Group', mk(`<Property name="Group"><LinkList count="1"><Link value="${target.name}"/></LinkList></Property>`)], ['Tip', mk(`<Property name="Tip"><Link value="${target.name}"/></Property>`)]]) };
  }
  if (!bodies.length && !pseudo) {
    const kinds = Object.keys(objectTypes).filter((t) => !t.startsWith('App::')).slice(0, 6).join(', ');
    warn('Document', 'noBody', `no PartDesign::Body in the file (objects: ${kinds || 'none'}); nothing to import as a feature tree`);
    for (const o of objs.values()) if (/^(Part::|App::Link|App::Part|Assembly::)/.test(o.type) && o.type !== 'Part::DatumPlane') warn(o.name, 'unsupportedObject', `${o.type} is not imported (only PartDesign bodies are read)`);
    return finish();
  }
  // Nested bodies (inside App::Part / links) are listed too; import the first top-level one with features, mention the rest.
  const nFeat = (b: Obj) => pLinks(b, 'Group').filter((n) => /^PartDesign::(Pad|Pocket|Revolution|Groove|Fillet|Chamfer|Mirrored|LinearPattern|PolarPattern|Hole|Thickness|Draft)$/.test(objs.get(n)?.type ?? '')).length;
  const body = pseudo ?? bodies.find((b) => b.name === opts.body) ?? [...bodies].sort((a, b) => nFeat(b) - nFeat(a))[0];
  const bodyNames = bodies.map((b) => b.name);
  if (bodies.length > 1 && !pseudo) warn(body.name, 'multipleBodies', `${bodies.length} bodies in the file; only "${body.name}" is imported`);
  if (!isIdentity(placement(body))) warn(body.name, 'bodyPlacement', 'the Body has a non-identity Placement; it is ignored');

  const made = new Map<string, string>(); // FreeCAD feature name -> our id of the feature that carries its body result
  const sketchDone = new Map<string, { sketchId: string; plane: Feat; pl: Pl; std: string; flipSame: boolean; entityOfGeo: string[]; constructionLines: number[] }>();
  let tipName = pLink(body, 'Tip');

  /** Where a sketch lies relative to our standard planes: the plane, its offset, whether the normals agree, and the map from sketch to plane coordinates. */
  function framing(sk: Obj) {
    const pl = placement(sk);
    const u = col(pl.m, 0), v = col(pl.m, 1), n = col(pl.m, 2);
    const ax = axisLetter(n);
    if (!ax) { warn(sk.name, 'planeUnsupported', 'the sketch plane is not parallel to a standard plane (needs a custom plane frame in the kernel)'); return null; }
    const std = ax.axis === 'z' ? 'front' : ax.axis === 'y' ? 'top' : 'right';
    const S = STD[std];
    const offset = dot(pl.p, S.n);
    const to2 = (x: number, y: number): [number, number] => {
      const P: V3 = [pl.p[0] + u[0] * x + v[0] * y, pl.p[1] + u[1] * x + v[1] * y, pl.p[2] + u[2] * x + v[2] * y];
      return [dot(P, S.u), dot(P, S.v)];
    };
    const det = dot(u, S.u) * dot(v, S.v) - dot(v, S.u) * dot(u, S.v);
    let plane: Feat = { kind: 'std', id: std };
    if (Math.abs(offset) > EPS) {
      const pid = nextId();
      // a sketch lifted off its plane by an attachment offset that is bound by an expression keeps the expression
      let off: number | string = offset;
      const offKey = 'AttachmentOffset.Base.z';
      if (P!.hasExpr(sk, offKey)) {
        usedExpr.add(`${sk.name}.${offKey}`);
        const stored = placement(sk, 'AttachmentOffset').p[2], sgn = dot(n, S.n) > 0 ? 1 : -1;
        const b = Math.abs(offset - stored * sgn) < 1e-9 ? P!.bound(sk, offKey, stored) : null;
        if (b) off = sgn > 0 ? '=' + b.expr : `=-(${b.expr})`;
        else warn(sk.name, 'expressions', `${offKey} is bound by an expression that cannot drive the plane offset; the number is kept`);
      }
      features.push({ type: 'plane', id: pid, mode: 'offset', base: { kind: 'std', id: std }, offset: off });
      plane = { kind: 'feature', id: pid };
    }
    return { pl, std, plane, flipSame: dot(n, S.n) > 0, to2, mirrored: det < 0 };
  }

  /** The planar face a sketch is attached to (FlatFace on a face of another feature, no offset), if it is. */
  function supportFace(sk: Obj): { obj: string; sub: string } | null {
    if (pNum(sk, 'MapMode', 0) !== 5 || pBool(sk, 'MapReversed')) return null;
    if (!isIdentity(placement(sk, 'AttachmentOffset'))) return null;
    const link = sk.props.get('AttachmentSupport')?.querySelector('Link');
    const obj = link?.getAttribute('obj') ?? '', sub = (() => { const v = link?.getAttribute('sub') ?? ''; const sh = link?.getAttribute('shadow') ?? ''; return /^Face\d+$/.test(v) ? v : (sh.match(/Face\d+$/)?.[0] ?? v); })();
    return obj && /^Face\d+$/.test(sub) ? { obj, sub } : null;
  }

  /**
   * A sketch attached to a face follows the face when the part changes: once the kernel can name the face, the sketch is put on it
   * (`plane: {kind: 'face'}`) and its points are written in the kernel's frame for that plane. `dependents` are the features that read the
   * sketch; their direction flips when the kernel's normal is the opposite of the standard plane's.
   */
  function attachToFace(sk: Obj, fr: NonNullable<ReturnType<typeof framing>>, sketchId: string) {
    const sup = supportFace(sk);
    if (!sup) return;
    const faces = planarFaces(sk.name, sup.obj, [sup.sub]);
    if (!faces) return;
    const S = STD[fr.std];
    const nFc = col(fr.pl.m, 2);
    const offset = dot(fr.pl.p, S.n);
    const planeId = fr.plane.kind === 'feature' ? (fr.plane.id as string) : '';
    faceRequests.push({
      feature: sketchId, fc: sk.name, before: '', names: [sup.sub], faces, needFrame: true, optional: true,
      apply: (part, ids, frames) => {
        const f = frames?.[0];
        const skf = featOf(part, sketchId) as { points: Array<{ x: number; y: number }>; entities: Array<Record<string, unknown>>; plane: unknown } | undefined;
        if (!f || !skf) return;
        const o: V3 = [S.n[0] * offset, S.n[1] * offset, S.n[2] * offset];
        const world = (x: number, y: number): V3 => [o[0] + S.u[0] * x + S.v[0] * y, o[1] + S.u[1] * x + S.v[1] * y, o[2] + S.u[2] * x + S.v[2] * y];
        const fx = f.x as V3, fy = f.y as V3, fz = f.z as V3, fo = f.o as V3;
        for (const p of skf.points) {
          const P = world(p.x, p.y);
          const d: V3 = [P[0] - fo[0], P[1] - fo[1], P[2] - fo[2]];
          p.x = dot(d, fx); p.y = dot(d, fy);
        }
        const reflected = dot(fz, S.n) < 0;
        if (reflected) for (const e of skf.entities) if (e.type === 'arc') { const t = e.p1; e.p1 = e.p2; e.p2 = t; }
        skf.plane = { kind: 'face', id: ids[0] };
        if (planeId) part.features = part.features.filter((x) => x.id !== planeId);
        // the extrusion / revolution / hole direction was worked out against the standard plane's normal
        if ((dot(nFc, fz) > 0) !== (dot(nFc, S.n) > 0)) for (const x of part.features) if (x.sketch === sketchId && x.end !== 'mid') x.flip = !x.flip;
      },
    });
  }

  /** A sketch holding only points (the centres of the circles and arcs and the points of a FreeCAD sketch), for Hole. */
  function emitCentres(sk: Obj) {
    const fr = framing(sk);
    if (!fr) return null;
    const { geo } = readSketch(sk);
    const points: Array<Record<string, unknown>> = [{ id: 'O', x: 0, y: 0, fixed: true }];
    const entities: Array<Record<string, unknown>> = [];
    geo.forEach((g, i) => {
      if (g.construction) return;
      const A = g.a;
      const at = g.type === 'Part::GeomCircle' || g.type === 'Part::GeomArcOfCircle' ? fr.to2(A.CenterX, A.CenterY) : g.type === 'Part::GeomPoint' ? fr.to2(A.X, A.Y) : null;
      if (!at) return;
      points.push({ id: `p${i + 1}`, x: at[0], y: at[1] });
      entities.push({ type: 'point', id: `e${i + 1}`, p: `p${i + 1}` });
    });
    if (!entities.length) { warn(sk.name, 'holeCentres', 'the sketch has no circle, arc or point to put a hole at'); return null; }
    const id = nextId();
    features.push({ type: 'sketch', id, plane: fr.plane, points, entities, constraints: [] });
    attachToFace(sk, fr, id);
    return { sketchId: id, flipSame: fr.flipSame };
  }

  /** Emit (once) the sketch of a FreeCAD sketch object; returns what the features need. */
  function emitSketch(sk: Obj, wantAxis?: 'V' | 'H') {
    const done = sketchDone.get(sk.name);
    if (done && !wantAxis) return done;
    if (done && wantAxis) return done;
    const fr = framing(sk);
    if (!fr) return null;
    const { pl, std, plane, flipSame, to2, mirrored } = fr;
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
    const dims: Array<{ c: Record<string, unknown>; k: SketchCons; idx: number }> = [];
    const sameSource = new Map<string, string>();
    for (const k of cons) {
      if (k.type === 1) { // coincident: the points were merged by position; if not equal in position, keep a constraint
        const a = ref(k.first, k.firstPos), b = ref(k.second, k.secondPos);
        if (a && b && a !== b) out.push({ id: `k${++kid}`, type: 'coincident', refs: [a, b] });
        continue;
      }
      const e1 = entityOfGeo[k.first], e2 = entityOfGeo[k.second];
      const pa = k.firstPos ? ref(k.first, k.firstPos) : undefined, pb = k.secondPos ? ref(k.second, k.secondPos) : undefined;
      const add = (type: string, refs: string[], value?: number, extra: Record<string, unknown> = {}) => {
        const c = { id: `k${++kid}`, type, refs, ...(value !== undefined ? { value } : {}), ...extra };
        out.push(c);
        if ([6, 7, 8, 9, 11, 18].includes(k.type)) dims.push({ c, k, idx: cons.indexOf(k) });
      };
      const lineEnds = (gi: number): [string, string] | null => { const a = pointOf.get(`${gi}:1`), b = pointOf.get(`${gi}:2`); return a && b ? [a, b] : null; };
      const pt = (id: string) => points.find((p) => p.id === id) as { x: number; y: number };
      if (!k.driving && [6, 7, 8, 9, 11, 18].includes(k.type)) { skipped++; continue; }
      switch (k.type) {
        case 2: case 3: if (e1 && k.second === -2000) add(k.type === 2 ? 'horizontal' : 'vertical', [e1]); else skipped++; break;
        case 4: if (e1 && e2) add('parallel', [e1, e2]); else skipped++; break;
        case 10: if (e1 && e2) add('perpendicular', [e1, e2]); else skipped++; break;
        case 5: if (e1 && e2) add('tangent', [e1, e2]); else skipped++; break;
        case 12: if (e1 && e2) add('equal', [e1, e2]); else skipped++; break;
        case 9: { // angle between two lines (value in radians): from the first line's direction to the second's, a line read from its end when the position says 2
          const lines = e1 && e2 && geo[k.first]?.type === 'Part::GeomLineSegment' && geo[k.second]?.type === 'Part::GeomLineSegment';
          if (!lines) { skipped++; break; }
          add('angle', [e1, e2], (k.value * 180) / Math.PI, { s1: k.firstPos === 2 ? -1 : 1, s2: k.secondPos === 2 ? -1 : 1 });
          break;
        }
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
    // dimensions: a bound one follows its variable; every other one is an editable parameter `Sketch.Constraints.Name`
    const sketchId = nextId();
    for (const { c, k, idx } of dims) {
      const stored = k.type === 9 ? (k.value * 180) / Math.PI : Math.abs(k.value), key = k.name ? `Constraints.${k.name}` : '', label = k.name || `[${idx}]`;
      if (k.name && P!.hasExpr(sk, key)) {
        usedExpr.add(`${sk.name}.${key}`);
        const vr = P!.constraintVar(sk, k.name);
        if (vr && Math.abs(vr.value - stored) <= 1e-6 * Math.max(1, stored)) c.expr = vr.name;
        else warn(sk.name, 'expressions', `constraint ${k.name} is bound by an expression that cannot be used; its number ${stored} is kept`);
        params.push({ path: `${sk.name}.Constraints.${label}`, set: (part, v) => { const f = featOf(part, sketchId) as { constraints?: Array<Record<string, unknown>> } | undefined; const cc = f?.constraints?.find((x) => x.id === c.id); if (cc) cc.expr = String(v); } });
        continue;
      }
      const vkey = `${sk.name}.Constraints.${label}`;
      params.push({ path: vkey, set: (part, v) => {
        const vr = k.name ? P!.peek(`${sk.name}.Constraints.${k.name}`) : null;
        if (vr) { setVar(part, vr.name, v); return; }
        const f = featOf(part, sketchId) as { constraints?: Array<Record<string, unknown>> } | undefined;
        const cc = f?.constraints?.find((x) => x.id === c.id);
        if (cc) cc.expr = String(v); // an expression that differs from the constraint's value is what makes the kernel solve the sketch again
      } });
      if (k.name) finalizers.push(() => { const vr = P!.peek(`${sk.name}.Constraints.${k.name}`); if (vr) c.expr = vr.name; });
    }
    const droppedReal = geo.filter((g, i) => !entityOfGeo[i] && !g.construction).length;
    if (droppedReal) {
      warn(sk.name, 'sketchGeometry', `${droppedReal} profile curve(s) of ${geo.filter((g, i) => !entityOfGeo[i] && !g.construction).map((g) => g.type.replace('Part::Geom', '')).join(', ')} cannot be mapped, so the sketch cannot be built`);
      return null;
    }
    if (skipped || dropped) warn(sk.name, 'constraints', `${skipped} constraint(s) and ${dropped} geometry item(s) not carried (point-on-object, symmetric, angle, block, internal alignment, driven dimensions ...); the geometry keeps FreeCAD's solved positions`);
    const constructionLines = geo.map((g, i) => (g.construction && g.type === 'Part::GeomLineSegment' ? i : -1)).filter((i) => i >= 0);
    const id = sketchId;
    features.push({ type: 'sketch', id, plane, points, entities, constraints: out });
    attachToFace(sk, fr, id);
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
    const g = AXIS_OF_ORIGIN.get(obj) ?? AXIS_OF_ORIGIN.get(sub);
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
  // The Body ends at its Tip: features after it are not part of the result (FreeCAD rolled the Body back)
  const tipAt = group.indexOf(tipName);
  if (tipAt >= 0 && tipAt < group.length - 1) {
    const after = group.slice(tipAt + 1).filter((n) => objs.get(n)?.type.startsWith('PartDesign::') && !/^PartDesign::(Plane|Line|Point|CoordinateSystem)$/.test(objs.get(n)!.type));
    if (after.length) warn(body.name, 'afterTip', `the Body Tip is ${tipName}; the features after it (${after.join(', ')}) are not imported`);
    group = group.slice(0, tipAt + 1);
  }
  // everything that is not part of the imported Body is said once, so that nothing is dropped silently
  for (const o of objs.values()) {
    if (o === body || group.includes(o.name)) continue;
    if (/^(Part::|App::Link|App::Part|Assembly::)/.test(o.type) && o.type !== 'Part::DatumPlane') warn(o.name, 'unsupportedObject', `${o.type} is not imported (only the PartDesign body "${body.name}" is read)`);
  }
  for (const fname of group) {
    const o = objs.get(fname);
    if (!o) continue;
    const t = o.type;
    if (t === 'Sketcher::SketchObject' || t === 'PartDesign::Plane' || t === 'Part::DatumPlane' || t === 'PartDesign::Line' || t === 'PartDesign::Point' || t === 'PartDesign::CoordinateSystem') continue;
    if (pseudo && !(PART_PRIMITIVES.has(t))) { warn(fname, 'unsupportedObject', `${t} is not imported (Part workbench objects other than the primitives are not mapped yet)`); skipped.push(fname); continue; }
    if (!pseudo && !t.startsWith('PartDesign::')) { warn(fname, 'objectType', `${t} is not a PartDesign feature; ignored`); continue; }
    if (pBool(o, 'Suppressed')) { warn(fname, 'suppressed', 'suppressed feature skipped'); continue; }
    const produced: string[] = [];
    const mark = features.length;
    const profile = pLinkSub(o, 'Profile').obj || pLink(o, 'Sketch');
    const sk = objs.get(profile);
    const ok = (() => {
      switch (t) {
        case 'PartDesign::Pad': case 'PartDesign::Pocket': {
          if (!sk) { warn(fname, 'noProfile', 'no sketch profile'); return false; }
          if (sk.type !== 'Sketcher::SketchObject') { warn(fname, 'profileFace', `the profile is ${sk.type} ${pLinkSub(o, 'Profile').sub || ''}, not a sketch; profiles from faces of other features are not mapped`); return false; }
          if (pLinkSub(o, 'ReferenceAxis').obj) { warn(fname, 'customVector', 'extrusion along a reference axis is not mapped'); return false; }
          const cut = t === 'PartDesign::Pocket';
          const type = pNum(o, 'Type');
          const side = pNum(o, 'SideType', 0); // FreeCAD 1.0: 0 one side, 1 two sides, 2 symmetric (older files use Midplane)
          const mid = side === 2 || pBool(o, 'Midplane');
          const reversed = pBool(o, 'Reversed');
          const taper = pNum(o, 'TaperAngle');
          if (pBool(o, 'UseCustomVector')) { warn(fname, 'customVector', 'custom extrusion direction not mapped'); return false; }
          const s = emitSketch(sk);
          if (!s) return false;
          const base: Feat = { type: 'extrude', op: cut ? 'cut' : 'add', sketch: s.sketchId };
          let flip = reversed !== !s.flipSame;
          let L = pNum(o, 'Length');
          if (L < 0) { L = -L; flip = !flip; } // a negative length runs the other way
          const push = (extra: Feat) => { const id = nextId(); const f = { ...base, id, ...extra }; features.push(f); produced.push(id); return f; };
          const tapered = taper !== 0 ? { draft: Math.abs(taper), ...(taper > 0 ? { draftOut: true } : {}) } : {}; // FreeCAD: a positive angle grows the profile along the extrusion
          if (taper !== 0 && !(type === 0 && side !== 1 && !mid)) { warn(fname, 'taper', 'a taper is mapped only for a one-sided blind length'); return false; }
          const lengthPositive = pNum(o, 'Length') > 0;
          if (type === 0 && side !== 1) {
            const f = mid ? push({ end: 'mid', depth: L }) : push({ end: 'blind', depth: L, ...tapered, ...(flip ? { flip: true } : {}) });
            if (lengthPositive) bind(o, 'Length', f, 'depth');
            if (taper !== 0) bind(o, 'TaperAngle', f, 'draft', (ff, v) => { ff.draft = Math.abs(v); if (v > 0) ff.draftOut = true; else delete ff.draftOut; });
          } else if (cut && type === 1 && !legacy) { // (0.14 to 0.16 files: type 1 of a pocket is UpToFirst)
            push({ end: mid ? 'throughBoth' : 'through', ...(flip ? { flip: true } : {}) });
          } else if (type === 4 || (side === 1 && type === 0)) { // two lengths: one extrude each way
            const f1 = push({ end: 'blind', depth: L, ...(flip ? { flip: true } : {}) });
            const f2 = push({ end: 'blind', depth: pNum(o, 'Length2'), ...(!flip ? { flip: true } : {}) });
            if (lengthPositive) bind(o, 'Length', f1, 'depth');
            bind(o, 'Length2', f2, 'depth');
          } else if (!legacy && !mid && side !== 1 && (type === 2 || type === 3)) {
            // up to the first face, up to a face of an earlier feature (up to the last face has no kernel equivalent: `through` runs past it)
            if (type === 3) {
              const { obj, sub } = pLinkSub(o, 'UpToFace');
              if (!/^Face\d+$/.test(sub)) { warn(fname, 'endCondition', `up to face needs a face of an earlier feature (${obj || 'none'}.${sub || '-'})`); return false; }
              if (pNum(o, 'Offset') !== 0) { warn(fname, 'endCondition', 'up to face with an offset is not mapped'); return false; }
              const faces = planarFaces(fname, obj, [sub]);
              if (!faces) return false;
              const f = push({ end: 'upToFace', endRef: { kind: 'face', id: '' }, ...(flip ? { flip: true } : {}) });
              faceRequests.push({ feature: f.id as string, fc: fname, before: '', names: [sub], faces, apply: (part, ids) => { (featOf(part, f.id as string) as Feat).endRef = { kind: 'face', id: ids[0] }; } });
            } else push({ end: 'upToNext', ...(flip ? { flip: true } : {}) });
          } else { warn(fname, 'endCondition', `${t.slice(12)} end type ${type} (${type === 5 ? 'up to shape' : type === 1 ? 'up to last' : 'up to face / first / last'}) is not mapped`); return false; }
          return true;
        }
        case 'PartDesign::Revolution': case 'PartDesign::Groove': {
          if (!sk) { warn(fname, 'noProfile', 'no sketch profile'); return false; }
          if (sk.type !== 'Sketcher::SketchObject') { warn(fname, 'profileFace', `the profile is ${sk.type}, not a sketch; profiles from faces of other features are not mapped`); return false; }
          const s = emitSketch(sk);
          if (!s) return false;
          const axis = axisEntity(o, sk, s);
          if (!axis) return false;
          const angle = pNum(o, 'Angle', 360);
          if (pNum(o, 'Type') !== 0) { warn(fname, 'endCondition', 'revolve to face / two angles not mapped'); return false; }
          const id = nextId();
          const groove = t === 'PartDesign::Groove';
          const mid = pBool(o, 'Midplane') || pNum(o, 'SideType') === 2;
          // FreeCAD turns a Revolution with the right-hand rule about the axis; a Groove the other way round (as a Pocket cuts against the sketch normal)
          const flip = (pBool(o, 'Reversed') !== !s.flipSame) !== groove;
          const rf: Feat = { type: 'revolve', id, op: groove ? 'cut' : 'add', sketch: s.sketchId, axis, angle, ...(mid && angle < 360 ? { end: 'mid' } : {}), ...(angle < 360 && !mid && flip ? { flip: true } : {}) };
          features.push(rf);
          bind(o, 'Angle', rf, 'angle');
          produced.push(id);
          return true;
        }
        case 'PartDesign::Mirrored': {
          const orig = pLinks(o, 'Originals').map((n) => made.get(n)).filter(Boolean) as string[];
          const { obj, sub } = pLinkSub(o, 'MirrorPlane');
          let pl = PLANE_OF_ORIGIN.get(obj) ?? PLANE_OF_ORIGIN.get(sub);
          let planeRef: Feat | undefined = pl ? { kind: 'std', id: pl } : undefined;
          const msk = objs.get(obj);
          if (!pl && msk?.type === 'Sketcher::SketchObject' && (sub === 'H_Axis' || sub === 'V_Axis')) {
            // mirror about a sketch axis: the plane through that line that contains the sketch normal
            const spl = placement(msk), a = col(spl.m, sub === 'H_Axis' ? 0 : 1), n = col(spl.m, 2);
            const m: V3 = [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]];
            const ml = axisLetter(m);
            if (ml) {
              const std = ml.axis === 'z' ? 'front' : ml.axis === 'y' ? 'top' : 'right';
              const off = dot(spl.p, STD[std].n);
              if (Math.abs(off) < EPS) planeRef = { kind: 'std', id: std };
              else { const pid = nextId(); features.push({ type: 'plane', id: pid, mode: 'offset', base: { kind: 'std', id: std }, offset: off }); planeRef = { kind: 'feature', id: pid }; }
            }
          }
          if (!planeRef || !orig.length) { warn(fname, 'mirror', `mirror plane ${obj}.${sub} (only origin planes and sketch axes along a coordinate plane are mapped) or originals not mapped`); return false; }
          const id = nextId();
          features.push({ type: 'mirror', id, seeds: orig, plane: planeRef, body: false });
          produced.push(id);
          return true;
        }
        case 'PartDesign::LinearPattern': case 'PartDesign::PolarPattern': {
          const orig = pLinks(o, 'Originals').map((n) => made.get(n)).filter(Boolean) as string[];
          const linear = t === 'PartDesign::LinearPattern';
          const { obj, sub } = pLinkSub(o, linear ? 'Direction' : 'Axis');
          let d: V3 | undefined = AXIS_OF_ORIGIN.get(obj) ?? AXIS_OF_ORIGIN.get(sub);
          const ssk = objs.get(obj);
          if (!d && ssk?.type === 'Sketcher::SketchObject' && (sub === 'H_Axis' || sub === 'V_Axis' || sub === 'N_Axis')) {
            const spl = placement(ssk); const dd = col(spl.m, sub === 'H_Axis' ? 0 : sub === 'V_Axis' ? 1 : 2);
            const cr: V3 = [spl.p[1] * dd[2] - spl.p[2] * dd[1], spl.p[2] * dd[0] - spl.p[0] * dd[2], spl.p[0] * dd[1] - spl.p[1] * dd[0]];
            if (Math.hypot(...cr) < EPS) d = dd; // the kernel's axes pass through the origin
          }
          const L = d && axisLetter(d);
          if (!orig.length || !L) { warn(fname, 'pattern', `pattern direction ${obj}.${sub} (only origin axes and sketch axes through the origin are mapped) or originals not mapped`); return false; }
          if (pLinkSub(o, linear ? 'Direction2' : 'Axis2').obj || (linear && pNum(o, 'Occurrences2', 1) > 1)) { warn(fname, 'pattern', 'a second pattern direction is not mapped'); return false; }
          const id = nextId();
          const rev = pBool(o, 'Reversed') !== (L.sign < 0);
          const count = pNum(o, 'Occurrences', 2);
          const mode = pNum(o, 'Mode');
          const axisRef = { kind: 'axis', axis: L.axis };
          let pf: Feat;
          if (linear) {
            const spacing = mode === 0 ? pNum(o, 'Length') / Math.max(1, count - 1) : pNum(o, 'Offset');
            pf = { type: 'lpattern', id, seeds: orig, dir: axisRef, count, spacing, reverse: rev };
          } else if (mode === 0) {
            pf = { type: 'cpattern', id, seeds: orig, axis: axisRef, count, angle: pNum(o, 'Angle', 360), equal: true, ...(rev ? { reverse: true } : {}) };
          } else { // offset mode: the angle between neighbours
            pf = { type: 'cpattern', id, seeds: orig, axis: axisRef, count, angle: pNum(o, 'Offset'), equal: false, ...(rev ? { reverse: true } : {}) };
          }
          features.push(pf);
          // parameters: the count, and the one of length / offset / angle that the mode uses (the spacing is derived from them)
          const st = { n: count, len: pNum(o, 'Length'), off: pNum(o, 'Offset'), ang: pNum(o, 'Angle', 360) };
          const respace = (f: Feat) => {
            f.count = st.n;
            if (linear) f.spacing = mode === 0 ? st.len / Math.max(1, st.n - 1) : st.off;
            else f.angle = mode === 0 ? st.ang : st.off;
          };
          // expressions: the kernel text of a property (bound expression, else its number)
          const txt = (prop: string, stored: number) => { usedExpr.add(`${o.name}.${prop}`); const b = P!.hasExpr(o, prop) ? P!.bound(o, prop, stored) : null; return { b: !!b, e: b ? b.expr : String(stored) }; };
          const nT = txt('Occurrences', count);
          const sT = linear ? (mode === 0 ? txt('Length', st.len) : txt('Offset', st.off)) : (mode === 0 ? txt('Angle', st.ang) : txt('Offset', st.off));
          if (nT.b) pf.count = '=' + nT.e;
          if (linear) {
            if (nT.b || sT.b) pf.spacing = mode === 0 ? `=(${sT.e})/max(1, (${nT.e})-1)` : '=' + sT.e;
          } else if (sT.b) pf.angle = '=' + sT.e;
          const reg = (prop: string, apply: (v: number) => void) => {
            params.push({ path: `${o.name}.${prop}`, set: (part, v) => { apply(v); const f = featOf(part, id); if (f) respace(f); } });
          };
          reg('Occurrences', (v) => { st.n = v; });
          if (linear) reg(mode === 0 ? 'Length' : 'Offset', (v) => { if (mode === 0) st.len = v; else st.off = v; });
          else reg(mode === 0 ? 'Angle' : 'Offset', (v) => { if (mode === 0) st.ang = v; else st.off = v; });
          produced.push(id);
          return true;
        }
        case 'PartDesign::Fillet': case 'PartDesign::Chamfer': {
          const { obj } = pLinkSub(o, 'Base');
          const allEdges = pBool(o, 'UseAllEdges');
          let names = Array.from(o.props.get('Base')?.querySelectorAll('Sub') ?? []).map((x) => subName(x)).filter((n) => /^Edge\d+$/.test(n));
          const baseFile = objs.get(obj) ? shapeFile(objs.get(obj)!) : undefined;
          const text = baseFile && opts.brp ? opts.brp(baseFile) : undefined;
          if (!allEdges && !names.length) { warn(fname, 'edgeReferences', `${t.slice(12)} has no edge names (sub-elements: ${Array.from(o.props.get('Base')?.querySelectorAll('Sub') ?? []).map((x) => x.getAttribute('value')).join(', ') || 'none'})`); return false; }
          if (!text) { warn(fname, 'edgeReferences', `${t.slice(12)} refers to ${allEdges ? 'all edges' : names.join(', ')} of ${obj}; resolving them needs its cached BRep (${baseFile ?? 'no shape file'})`); return false; }
          const all = brepEdges(text);
          if (allEdges) names = all.map((_, i) => `Edge${i + 1}`);
          const pts = names.map((n) => all[Number(n.slice(4)) - 1]);
          if (pts.some((e) => !e)) { warn(fname, 'edgeReferences', `edge name out of range in ${baseFile}`); return false; }
          if (pts.some((e) => e.approx)) warn(fname, 'edgeApprox', 'some edges are free-form curves; their point is the vertex midpoint, which may not lie on the edge');
          const id = nextId();
          if (t === 'PartDesign::Fillet') { const ff: Feat = { type: 'fillet', id, radius: pNum(o, 'Radius'), edges: [] }; features.push(ff); bind(o, 'Radius', ff, 'radius'); }
          else {
            const ct = pNum(o, 'ChamferType');
            const flip = pBool(o, 'FlipDirection');
            const cf: Feat = { type: 'chamfer', id, edges: [] };
            if (ct === 0) Object.assign(cf, { chamferType: 'equal', distance: pNum(o, 'Size') });
            else if (ct === 1) Object.assign(cf, { chamferType: 'distanceDistance', distance: pNum(o, 'Size'), distance2: pNum(o, 'Size2'), ...(!flip ? { flip: true } : {}) }); // (the kernel's first distance lies on the other face)
            else if (ct === 2) Object.assign(cf, { chamferType: 'angleDistance', distance: pNum(o, 'Size'), angle: pNum(o, 'Angle'), ...(flip ? { flip: true } : {}) });
            else { warn(fname, 'chamferType', `chamfer type ${ct} is not mapped`); seq--; return false; }
            features.push(cf);
            bind(o, 'Size', cf, 'distance');
            if (ct === 1) bind(o, 'Size2', cf, 'distance2');
            if (ct === 2) bind(o, 'Angle', cf, 'angle');
          }
          edgeRequests.push({ feature: id, fc: fname, names, points: pts.map((e) => e.at) });
          produced.push(id);
          return true;
        }
        case 'PartDesign::Hole': {
          if (!sk) { warn(fname, 'noProfile', 'no sketch profile'); return false; }
          if (sk.type !== 'Sketcher::SketchObject') { warn(fname, 'profileFace', `the profile is ${sk.type}, not a sketch`); return false; }
          const cut = pNum(o, 'HoleCutType'); // 0 none, 1 counterbore, 2 countersink, 3 counterdrill
          const depthType = pNum(o, 'DepthType'); // 0 dimension, 1 through all
          const angled = pNum(o, 'DrillPoint') === 1, tipAngle = pNum(o, 'DrillPointAngle', 118);
          if (cut === 3) { warn(fname, 'holeCut', 'counterdrill holes are not mapped'); return false; }
          if (pBool(o, 'Tapered')) { warn(fname, 'holeTapered', 'tapered holes are not mapped'); return false; }
          if (pBool(o, 'ModelThread')) { warn(fname, 'holeThread', 'modelled threads are not mapped'); return false; }
          if (depthType > 1) { warn(fname, 'endCondition', `hole depth type ${depthType} (up to first) is not mapped`); return false; }
          if (angled && depthType === 0 && Math.abs(tipAngle - 118) > 1e-6) { warn(fname, 'holeDrillPoint', `a drill point of ${tipAngle} degrees is not mapped (the kernel's is 118)`); return false; }
          const d = pNum(o, 'Diameter');
          const r = d / 2;
          let depth = pNum(o, 'Depth');
          if (angled && depthType === 0 && pBool(o, 'DrillForDepth')) depth -= r / Math.tan(tipAngle * Math.PI / 360); // the depth includes the cone
          const hs = emitCentres(sk);
          if (!hs) return false;
          // FreeCAD drills against the sketch normal (into the material); Reversed drills along it. Ours drills against ITS normal unless flipped.
          const flip = pBool(o, 'Reversed') !== !hs.flipSame;
          const id = nextId();
          const hf: Feat = {
            type: 'hole', id, sketch: hs.sketchId, kind: cut === 1 ? 'cbore' : cut === 2 ? 'countersink' : 'simple', diameter: d,
            ...(depthType === 1 ? { end: 'through' } : { end: 'blind', depth, ...(angled ? { tip: true } : {}) }),
            ...(cut === 1 ? { cboreDiameter: pNum(o, 'HoleCutDiameter'), cboreDepth: pNum(o, 'HoleCutDepth') } : {}),
            ...(cut === 2 ? { cskDiameter: pNum(o, 'HoleCutDiameter'), cskAngle: pNum(o, 'HoleCutCountersinkAngle', 90) } : {}),
            ...(flip ? { flip: true } : {}),
          };
          features.push(hf);
          bind(o, 'Diameter', hf, 'diameter');
          if (depthType === 0 && !(angled && pBool(o, 'DrillForDepth'))) bind(o, 'Depth', hf, 'depth');
          if (cut === 1) { bind(o, 'HoleCutDiameter', hf, 'cboreDiameter'); bind(o, 'HoleCutDepth', hf, 'cboreDepth'); }
          if (cut === 2) { bind(o, 'HoleCutDiameter', hf, 'cskDiameter'); bind(o, 'HoleCutCountersinkAngle', hf, 'cskAngle'); }
          if (pBool(o, 'Threaded')) warn(fname, 'holeThread', 'the cosmetic thread is not imported; the hole has the tapped diameter FreeCAD stored');
          produced.push(id);
          return true;
        }
        case 'PartDesign::Thickness': {
          const { obj } = pLinkSub(o, 'Base');
          const subs = Array.from(o.props.get('Base')?.querySelectorAll('Sub') ?? []).map((x) => subName(x)).filter((n) => /^Face\d+$/.test(n));
          if (!subs.length) { warn(fname, 'faceReferences', 'Thickness without faces to remove is not mapped'); return false; }
          if (pNum(o, 'Mode') !== 0) { warn(fname, 'thicknessMode', 'only Mode Skin is mapped'); return false; }
          const faces = planarFaces(fname, obj, subs);
          if (!faces) return false;
          const id = nextId();
          if (!pBool(o, 'Reversed') && pNum(o, 'Join') === 0) { warn(fname, 'thicknessJoin', 'an outward thickness with rounded (Arc) corners is not mapped; the kernel makes sharp corners'); return false; }
          const th: Feat = { type: 'shell', id, faces: [], thickness: pNum(o, 'Value'), ...(pBool(o, 'Reversed') ? {} : { outward: true }) }; // FreeCAD: Reversed grows the wall inward
          features.push(th);
          bind(o, 'Value', th, 'thickness');
          faceRequests.push({ feature: id, fc: fname, before: '', names: subs, faces, apply: (part, ids) => { (featOf(part, id) as Feat).faces = ids; } });
          produced.push(id);
          return true;
        }
        case 'PartDesign::Draft': {
          const { obj, sub: neutralSub } = pLinkSub(o, 'NeutralPlane');
          const { obj: bobj } = pLinkSub(o, 'Base');
          const subs = Array.from(o.props.get('Base')?.querySelectorAll('Sub') ?? []).map((x) => subName(x)).filter((n) => /^Face\d+$/.test(n));
          if (!subs.length || !/^Face\d+$/.test(neutralSub)) { warn(fname, 'faceReferences', `Draft needs faces and a neutral plane that is a face (neutral: ${obj}.${neutralSub || '-'})`); return false; }
          if (pLinkSub(o, 'PullDirection').obj) { warn(fname, 'draftPull', 'a pull direction is not mapped'); return false; }
          const faces = planarFaces(fname, bobj, subs);
          const neutral = planarFaces(fname, obj, [neutralSub]);
          if (!faces || !neutral) return false;
          const id = nextId();
          const df: Feat = { type: 'draft', id, neutral: { kind: 'face', id: '' }, faces: [], angle: pNum(o, 'Angle'), ...(pBool(o, 'Reversed') ? { flip: true } : {}) };
          features.push(df);
          bind(o, 'Angle', df, 'angle');
          faceRequests.push({ feature: id, fc: fname, before: '', names: [...subs, neutralSub], faces: [...faces, ...neutral], apply: (part, ids) => { const f = featOf(part, id) as Feat; f.faces = ids.slice(0, -1); f.neutral = { kind: 'face', id: ids[ids.length - 1] }; } });
          produced.push(id);
          return true;
        }
        case 'Part::Box': case 'Part::Cylinder': case 'Part::Sphere': case 'Part::Cone': case 'Part::Torus': case 'Part::Prism':
        case 'PartDesign::AdditiveBox': case 'PartDesign::SubtractiveBox': case 'PartDesign::AdditiveCylinder': case 'PartDesign::SubtractiveCylinder':
        case 'PartDesign::AdditiveSphere': case 'PartDesign::SubtractiveSphere': case 'PartDesign::AdditiveCone': case 'PartDesign::SubtractiveCone':
        case 'PartDesign::AdditiveTorus': case 'PartDesign::SubtractiveTorus': case 'PartDesign::AdditivePrism': case 'PartDesign::SubtractivePrism': {
          const kind = t.replace(/^(PartDesign::(Additive|Subtractive)|Part::)/, '');
          const op = t.startsWith('PartDesign::Subtractive') ? 'cut' : 'add';
          const pp = placement(o); // the resolved placement of the primitive
          const m = pp.m;
          // a turn about the Z axis is carried (the round primitives do not care, a box and a prism are rotated); other turns are not
          const turnZ = Math.abs(m[8] - 1) < 1e-9 && [2, 5, 6, 7].every((i) => Math.abs(m[i]) < 1e-9) && Math.abs(m[0] - m[4]) < 1e-9 && Math.abs(m[1] + m[3]) < 1e-9;
          if (!turnZ) { warn(fname, 'primitivePlacement', 'a primitive that is turned about an axis other than Z is not mapped'); return false; }
          const th = Math.atan2(m[3], m[0]), turned = Math.abs(th) > 1e-12;
          const rot = (x: number, y: number): [number, number] => [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)];
          const [px, py, pz] = pp.p;
          const full = (prop: string, v: number) => Math.abs(pNum(o, prop, v) - v) < 1e-9;
          if ((kind === 'Cylinder' || kind === 'Cone') && !full('Angle', 360)) { warn(fname, 'primitiveAngle', 'a partial cylinder / cone is not mapped'); return false; }
          if (kind === 'Sphere' && !(full('Angle1', -90) && full('Angle2', 90) && full('Angle3', 360))) { warn(fname, 'primitiveAngle', 'a partial sphere is not mapped'); return false; }
          if (kind === 'Torus' && !(full('Angle1', -180) && full('Angle2', 180) && full('Angle3', 360))) { warn(fname, 'primitiveAngle', 'a partial torus is not mapped'); return false; }
          if (kind === 'Prism' && (pNum(o, 'FirstAngle') !== 0 || pNum(o, 'SecondAngle') !== 0)) { warn(fname, 'primitiveAngle', 'a tapered prism is not mapped'); return false; }
          /** a sketch on our standard plane `std` at `off`, with the given geometry; returns its id */
          const mk = (std: 'front' | 'top', off: number, points: Array<Record<string, unknown>>, entities: Array<Record<string, unknown>>, constraints: Array<Record<string, unknown>> = []) => {
            let plane: Feat = { kind: 'std', id: std };
            if (Math.abs(off) > EPS) { const pid = nextId(); features.push({ type: 'plane', id: pid, mode: 'offset', base: { kind: 'std', id: std }, offset: off }); plane = { kind: 'feature', id: pid }; }
            const sid = nextId();
            features.push({ type: 'sketch', id: sid, plane, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...points], entities, constraints });
            return sid;
          };
          /** bind a dimension constraint of the sketch to property `prop` of the primitive */
          const dim = (prop: string, sid: string, c: Record<string, unknown>) => {
            usedExpr.add(`${o.name}.${prop}`);
            const b = P!.hasExpr(o, prop) ? P!.bound(o, prop, Number(c.value)) : null;
            if (b) { c.expr = b.expr; return; }
            if (P!.hasExpr(o, prop)) return;
            params.push({ path: `${o.name}.${prop}`, set: (part, v) => { const vr = P!.peek(`${o.name}.${prop}`); if (vr) { setVar(part, vr.name, v); return; } const f = featOf(part, sid) as { constraints?: Array<Record<string, unknown>> } | undefined; const cc = f?.constraints?.find((x) => x.id === c.id); if (cc) cc.expr = String(v); } });
            finalizers.push(() => { const vr = P!.peek(`${o.name}.${prop}`); if (vr) c.expr = vr.name; });
          };
          const ext = (sid: string, depthProp: string) => {
            const id = nextId();
            const ef: Feat = { type: 'extrude', id, op, sketch: sid, end: 'blind', depth: pNum(o, depthProp) };
            features.push(ef); bind(o, depthProp, ef, 'depth'); produced.push(id);
          };
          const revolveAbout = (sid: string, axisFrom: [number, number], axisTo: [number, number]) => {
            const f = features.find((x) => x.id === sid) as { points: Array<Record<string, unknown>>; entities: Array<Record<string, unknown>> };
            f.points.push({ id: 'ax1', x: axisFrom[0], y: axisFrom[1] }, { id: 'ax2', x: axisTo[0], y: axisTo[1] });
            f.entities.push({ type: 'line', id: 'axis', p1: 'ax1', p2: 'ax2', construction: true });
            const id = nextId();
            features.push({ type: 'revolve', id, op, sketch: sid, axis: 'axis', angle: 360 });
            produced.push(id);
          };
          if (kind === 'Box') {
            const L = pNum(o, 'Length'), W = pNum(o, 'Width');
            const at = ([x, y]: [number, number]) => { const [rx, ry] = rot(x, y); return { x: px + rx, y: py + ry }; };
            const corners = [at([0, 0]), at([L, 0]), at([L, W]), at([0, W])];
            // a turned box keeps its direction through a fixed construction line the first edge is parallel to
            const sid = mk('front', pz, [...corners.map((c, k) => ({ id: `p${k + 1}`, ...c, ...(k === 0 ? { fixed: true } : {}) })), ...(turned ? [{ id: 'q1', x: px, y: py, fixed: true }, { id: 'q2', x: px + 10 * Math.cos(th), y: py + 10 * Math.sin(th), fixed: true }] : [])],
              [...[['p1', 'p2'], ['p2', 'p3'], ['p3', 'p4'], ['p4', 'p1']].map(([a, b], i) => ({ type: 'line', id: `e${i + 1}`, p1: a, p2: b })), ...(turned ? [{ type: 'line', id: 'e0', p1: 'q1', p2: 'q2', construction: true }] : [])],
              turned
                ? [{ id: 'k0', type: 'parallel', refs: ['e0', 'e1'] }, { id: 'k1', type: 'perpendicular', refs: ['e1', 'e2'] }, { id: 'k2', type: 'perpendicular', refs: ['e2', 'e3'] }, { id: 'k3', type: 'perpendicular', refs: ['e3', 'e4'] },
                  { id: 'k4', type: 'distance', refs: ['p1', 'p2'], value: L }, { id: 'k5', type: 'distance', refs: ['p1', 'p4'], value: W }]
                : [{ id: 'k1', type: 'horizontal', refs: ['e1'] }, { id: 'k2', type: 'vertical', refs: ['e2'] }, { id: 'k3', type: 'horizontal', refs: ['e3'] }, { id: 'k4', type: 'vertical', refs: ['e4'] },
                  { id: 'k5', type: 'hdist', refs: ['p1', 'p2'], value: L }, { id: 'k6', type: 'vdist', refs: ['p1', 'p4'], value: W }]);
            const sf = features.find((x) => x.id === sid) as { constraints: Array<Record<string, unknown>> };
            const nc = sf.constraints.length;
            dim('Length', sid, sf.constraints[nc - 2]); dim('Width', sid, sf.constraints[nc - 1]);
            ext(sid, 'Height');
          } else if (kind === 'Cylinder') {
            const r = pNum(o, 'Radius');
            const sid = mk('front', pz, [{ id: 'c', x: px, y: py, fixed: true }], [{ type: 'circle', id: 'e1', c: 'c', r }], [{ id: 'k1', type: 'radius', refs: ['e1'], value: r }]);
            dim('Radius', sid, (features.find((x) => x.id === sid) as { constraints: Array<Record<string, unknown>> }).constraints[0]);
            ext(sid, 'Height');
          } else if (kind === 'Prism') {
            const n = Math.round(pNum(o, 'Polygon', 3)), R = pNum(o, 'Circumradius');
            if (n < 3) { warn(fname, 'primitive', 'a prism needs at least 3 sides'); return false; }
            const pts = Array.from({ length: n }, (_, k) => { const [rx, ry] = rot(R * Math.cos((2 * Math.PI * k) / n), R * Math.sin((2 * Math.PI * k) / n)); return { id: `p${k + 1}`, x: px + rx, y: py + ry }; });
            const sid = mk('front', pz, pts, pts.map((q, k) => ({ type: 'line', id: `e${k + 1}`, p1: q.id, p2: pts[(k + 1) % n].id })));
            ext(sid, 'Height');
          } else if (kind === 'Sphere') {
            const id = nextId();
            const sf: Feat = { type: 'sphere', id, op, center: [px, py, pz], radius: pNum(o, 'Radius') };
            features.push(sf); bind(o, 'Radius', sf, 'radius'); produced.push(id);
          } else if (kind === 'Cone') {
            const R1 = pNum(o, 'Radius1'), R2 = pNum(o, 'Radius2'), H = pNum(o, 'Height');
            const pts: Array<[number, number]> = [[px, -pz], [px + R1, -pz], [px + R2, -(pz + H)], [px, -(pz + H)]].filter(([x, y], i, a) => { const q = a[(i + 1) % a.length]; return Math.hypot(x - q[0], y - q[1]) > 1e-12; }) as Array<[number, number]>;
            const sid = mk('top', py, pts.map((q, k) => ({ id: `p${k + 1}`, x: q[0], y: q[1] })), pts.map((_, k) => ({ type: 'line', id: `e${k + 1}`, p1: `p${k + 1}`, p2: `p${((k + 1) % pts.length) + 1}` })));
            revolveAbout(sid, [px, -pz], [px, -(pz + H)]);
          } else { // Torus
            const R1 = pNum(o, 'Radius1'), R2 = pNum(o, 'Radius2');
            const sid = mk('top', py, [{ id: 'c', x: px + R1, y: -pz }], [{ type: 'circle', id: 'e1', c: 'c', r: R2 }]);
            revolveAbout(sid, [px, -pz], [px, -(pz + 10)]);
          }
          return true;
        }
        case 'PartDesign::Boolean': case 'PartDesign::SubShapeBinder': case 'PartDesign::AdditiveLoft': case 'PartDesign::SubtractiveLoft': case 'PartDesign::AdditivePipe': case 'PartDesign::SubtractivePipe': case 'PartDesign::AdditiveHelix': case 'PartDesign::SubtractiveHelix': case 'PartDesign::MultiTransform': case 'PartDesign::Scaled': case 'PartDesign::FeatureBase': 
          warn(fname, 'unsupportedFeature', `${t} is not mapped yet`);
          return false;
        default:
          warn(fname, 'unsupportedFeature', `${t} is not mapped`);
          return false;
      }
    })();
    if (ok) {
      for (const rq of faceRequests) if (!rq.before) rq.before = (features[mark]?.id as string) ?? rq.feature;
      const result = produced[produced.length - 1];
      made.set(fname, result);
      end(fname, t, true, features.slice(mark).map((f) => f.id as string), shapeFile(o));
    } else {
      skipped.push(fname);
      for (let q = faceRequests.length - 1; q >= 0; q--) if (!faceRequests[q].before) faceRequests.splice(q, 1);
      if (!warnings.some((w) => w.object === fname)) {
        const why = sk ? warnings.filter((w) => w.object === sk.name).map((w) => `${w.code}: ${w.message}`).join('; ') : '';
        warn(fname, 'notImported', why ? `its sketch ${sk!.name} cannot be built (${why})` : 'no reason was recorded');
      }
      // a sketch emitted for a feature that failed stays out of the tree
      features.length = mark;
      for (const [k, v] of sketchDone) if (!features.some((f) => f.id === v.sketchId)) sketchDone.delete(k);
    }
  }
  for (const fz of finalizers) fz();
  // an expression the import did not use is said, the number FreeCAD computed for it stays
  for (const n of [...made.keys(), ...sketchDone.keys()]) {
    const ob = objs.get(n);
    if (!ob) continue;
    for (const path of P.exprPaths(ob)) if (!usedExpr.has(`${n}.${path}`)) warn(n, 'expressions', `${path} is bound by an expression that is not imported; the number FreeCAD computed is kept`);
  }
  for (const v of P.variables) params.push({ path: v.path, set: (part, val) => setVar(part, v.name, val) });
  if (!tipName) tipName = group[group.length - 1] ?? '';
  const tip = objs.get(tipName);
  const res = finish();
  res.bodies = bodyNames;
  res.edgeRequests = edgeRequests;
  res.faceRequests = faceRequests;
  if (!steps.length) warn(body.name, 'noFeatures', 'no PartDesign feature could be mapped (the body may be built from a loft, pipe, binder, Part workbench objects or imported shapes)');
  res.finalShape = (tip && shapeFile(tip)) ?? shapeFile(body);
  return res;
}

/** Read an FCStd (zip) and map it. */
export async function importFcstd(bytes: Uint8Array, name = 'FreeCAD part', opts: { body?: string; object?: string } = {}): Promise<FcImport> {
  let xml: Uint8Array | null = null;
  try { xml = await zipFile(bytes, 'Document.xml'); } catch (e) {
    return { name, part: { format: 'ck-part', version: 1, name, features: [], seq: 1 }, warnings: [{ object: 'file', code: 'zip', message: (e as Error).message }], steps: [], objectTypes: {}, bodies: [], skipped: [], edgeRequests: [] };
  }
  if (!xml) return { name, part: { format: 'ck-part', version: 1, name, features: [], seq: 1 }, warnings: [{ object: 'file', code: 'noDocument', message: 'no Document.xml in the archive' }], steps: [], objectTypes: {}, bodies: [], skipped: [], edgeRequests: [] };
  // cached BRep files (up to 4 MB each) for fillet / chamfer edge lookup
  const brp = new Map<string, string>();
  try { for (const e of zipEntries(bytes)) if (/\.brp$/i.test(e.name) && e.size <= 4e6) brp.set(e.name, new TextDecoder().decode(await zipRead(bytes, e))); } catch { /* the document still imports */ }
  return importFcDocument(new TextDecoder().decode(xml), name, { ...opts, brp: (f) => brp.get(f) });
}

/** Resolves points on the current body to kernel edge references ({faces, at}); null for a point that matches no edge. */
export type EdgeResolver = (partBefore: FcImport['part'], points: Array<[number, number, number]>) => Promise<Array<Record<string, unknown> | null>>;
/** Resolves planar faces of the body before a feature (outward normal and a point in the face) to the kernel's face ids; null for one that is not found. */
export type FaceResolver = (partBefore: FcImport['part'], faces: Array<{ normal: [number, number, number]; at: [number, number, number] }>, opts?: { frames?: boolean }) => Promise<Array<{ id: string; frame?: FaceFrame } | null>>;

/** Take a FreeCAD step out of the part again (its features, its entry in `steps`) and say why. */
function dropStep(imp: FcImport, fc: string, fallbackId: string, code: string, message: string) {
  const st = imp.steps.findIndex((x) => x.fc === fc);
  const ids = new Set(st >= 0 ? imp.steps[st].features : [fallbackId]);
  imp.part.features = imp.part.features.filter((f) => !ids.has(f.id as string));
  if (st >= 0) imp.steps.splice(st, 1);
  imp.skipped.push(fc);
  imp.warnings.push({ object: fc, code, message });
}

/**
 * Fill in the references that need the kernel: the edges of fillets / chamfers and the faces of Thickness, Draft and up-to-face
 * extrusions, in feature order (each is looked up in the body of the features before it). A feature whose references do not
 * resolve is removed again and reported, so the tree stays regenerable. Without a resolver those features are removed too.
 */
export async function resolveReferences(imp: FcImport, resolvers: { edges?: EdgeResolver; faces?: FaceResolver } = {}): Promise<FcImport> {
  type Item = { at: number; run: () => Promise<void> };
  const items: Item[] = [];
  const idx = (id: string) => imp.part.features.findIndex((f) => f.id === id);
  for (const rq of imp.edgeRequests) {
    items.push({ at: idx(rq.feature), run: async () => {
      const at = idx(rq.feature);
      if (at < 0) return;
      const refs = resolvers.edges ? await resolvers.edges({ ...imp.part, features: imp.part.features.slice(0, at) }, rq.points).catch(() => null) : null;
      if (refs && refs.every(Boolean)) { (imp.part.features[at] as { edges: unknown }).edges = refs; return; }
      dropStep(imp, rq.fc, rq.feature, 'edgeReferences', resolvers.edges ? `could not find ${rq.names.join(', ')} on the rebuilt body; feature left out` : 'edge lookup needs the kernel; feature left out');
    } });
  }
  for (const rq of imp.faceRequests ?? []) {
    items.push({ at: idx(rq.before), run: async () => {
      const at = idx(rq.before);
      if (at < 0) return;
      const hits = resolvers.faces ? await resolvers.faces({ ...imp.part, features: imp.part.features.slice(0, at) }, rq.faces, { frames: !!rq.needFrame }).catch(() => null) : null;
      if (hits && hits.every((h) => h && (!rq.needFrame || h.frame))) { rq.apply(imp.part, hits.map((h) => h!.id), hits.map((h) => h!.frame)); return; }
      const msg = resolvers.faces ? `could not find ${rq.names.join(', ')} on the rebuilt body` : 'face lookup needs the kernel';
      if (rq.optional) { imp.warnings.push({ object: rq.fc, code: 'faceReferences', message: `${msg}; the feature keeps its fixed placement` }); return; }
      dropStep(imp, rq.fc, rq.feature, 'faceReferences', `${msg}; feature left out`);
    } });
  }
  items.sort((a, b) => a.at - b.at);
  for (const it of items) await it.run();
  imp.edgeRequests = [];
  imp.faceRequests = [];
  return imp;
}

/** Edges only (see resolveReferences). */
export const resolveEdges = (imp: FcImport, resolver?: EdgeResolver): Promise<FcImport> => resolveReferences(imp, { edges: resolver });
