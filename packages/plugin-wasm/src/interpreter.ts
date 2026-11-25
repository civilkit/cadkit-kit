// Spike: a transactional command interpreter for the SolidCraft `commands.run` surface, five commands.
// Edits (parameters.add, solid.box, timeline.group) only RECORD; the open document is never touched. Reads (document.inspect,
// inspect.measure) build the recorded list as a script on a scratch AgentSession and answer from that. commit() is the one write.
// component.create / component.activate / occurrence.ground are NOT in the brief's list but the woodwork `cabinet` entry calls them
// unconditionally; here they are inert stubs so the run can complete, except that a component remembers its features and
// occurrence.move (a translation) moves the bodies it made: that is how the plugin's Place (right, left, above) takes effect. Everything else is refused.
import { faceInfo, edgeInfo } from './modelReads';
import { evalExpr, kernelExpr } from '@kit/solidcraft';
import { SketchRec, type Pt } from './sketchRec';
import type { SketchCurveIO } from '@kit/plugin';

/** What the interpreter needs from the kernel side: build a script on a scratch state and list its bodies; commit a script to the open document. */
export interface BodyRow { name: string; volume: number | null; bbox: { min: number[]; max: number[] } | null }
export interface Scratch { build(script: string): Promise<BodyRow[]> }
export interface Target { commit(script: string): Promise<{ created: number }> }

export const SUPPORTED = new Set(['parameters.add', 'solid.box', 'solid.cylinder', 'solid.cone', 'solid.combine', 'solid.move', 'selection.get', 'solid.hole', 'solid.extrude', 'solid.sweep', 'solid.sphere', 'sketch.circle.center', 'sketch.point', 'sketch.project', 'sketch.replace', 'construct.plane.along_path', 'construct.plane.axis_point', 'occurrence.copy', 'parameters.list', 'parameters.users', 'appearance.list', 'document.metadata.set', 'model.body_features', 'solid.pattern.circular', 'sketch.line', 'sketch.arc.three_point', 'sketch.spline.fit_point', 'component.properties', 'solid.pattern.rectangular', 'timeline.group', 'document.inspect', 'inspect.measure', 'material.list', 'material.create', 'material.assign', 'model.mesh', 'model.faces', 'model.edges', 'model.threads']);
export const STUBBED = new Set(['sketch.dimension', 'sketch.constraint.coincident', 'sketch.constraint.fix', 'occurrence.reparent', 'browser.visibility', 'component.create', 'component.activate', 'component.list', 'component.metadata', 'component.metadata.set', 'component.delete', 'occurrence.ground', 'occurrence.move', 'joint.as_built', 'joint.limits', 'joint.create', 'joint.edit', 'joint.list', 'construct.axis.two_planes', 'solid.chamfer', 'sketch.create', 'sketch.text', 'sketch.finish', 'parameters.change']);
/** SolidCraft classifies these as reads; everything else is an edit (a `read` entry may only call reads). */
/** reads answered from a build on the scratch kernel (the rest of the reads answer at once from what is recorded) */
const BUILT_READS = new Set(['document.inspect', 'inspect.measure', 'component.properties']);
export const READS = new Set(['component.properties', 'timeline.inspect', 'sketch.inspect', 'parameters.list', 'parameters.users', 'appearance.list', 'model.body_features', 'document.inspect', 'inspect.measure', 'model.mesh', 'model.faces', 'model.edges', 'model.threads', 'material.list', 'selection.get']);

/** What the open document offers a plugin that edits it (all in the DOCUMENT's frame: the interpreter turns it into the plugin's Z-up frame): its bodies with their boxes and what is selected. */
export interface DocSel { type: 'body' | 'face' | 'edge'; /** an edge's pick: a point on it, in the plugin's frame and millimetres (SolidCraft's selection reference carries one, and a plugin that takes edges reads it) */ point?: number[]; /** body items */ name?: string; /** face and edge items: the body they belong to */ body?: string; /** a face's place in its body's list */ index?: number; /** planar faces: the outward normal */ normal?: number[] }
export interface DocBody { name: string; bbox: { min: number[]; max: number[] } | null; volume?: number | null; /** the feature that made the body: a colour for it is written against that feature */ feature?: string }
/** The display mesh of the open document and which faces (by name, in the body's own order) belong to each body: what `model.mesh` answers from. Triangles are three vertices each (9 floats), millimetres, document frame. */
export interface DocMeshSource { mesh: { positions: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] }; faces: Record<string, string[]> }
/** `model.mesh` answers at most this many triangles in one call (the reply is JSON through the command channel); ask for fewer bodies at a time. */
export const MESH_MAX_TRIANGLES = 200000;
export interface DocContext { /** the bodies' triangles, for `model.mesh` and `model.faces` */ meshes?: DocMeshSource; /** each body's edges in its own order (the `index` an edge selection carries): the name and the polyline (document frame, mm), for `model.edges` */ edges?: Record<string, Array<{ name: string; pts: number[][] }>>; /** the cosmetic and modelled threads of the open document, for `model.threads` */ threads?: Array<Record<string, unknown>>; up?: 'y' | 'z'; bodies: DocBody[]; selection: DocSel[]; /** what generators stored for the components they made, by component name (kept with the run that made each folder) */ components?: Record<string, Record<string, unknown>>; /** the document's variables */ parameters?: ReadonlyArray<{ name: string; expression: string; value: number; comment?: string }> }

interface Box { name: string; body?: string; corner: number[]; size: number[]; cut: boolean; join?: boolean; inter?: boolean; targets: string[]; group?: string }
/** A cylinder, or a cone when `top` is set (diameters at the base and at the top), on an axis along one of x, y, z. */
interface Round { kind: 'round'; name: string; base: number[]; axis: number[]; d: number; top?: number; height: number; op: 'new' | 'join' | 'cut' | 'intersect'; body?: string; targets: string[] }
interface Combine { kind: 'combine'; name: string; target: string; tools: string[]; op: 'cut' | 'join' | 'intersect'; keep: boolean }
/** `solid.chamfer`: an equal-distance bevel on the edges that pass through the given points of a body */
interface Chamfer { kind: 'chamfer'; name: string; body: string; distance: number; near: number[][] }
/** `sketch.create` + `sketch.text`: a board's name, engraved 0.3 mm deep on the plane the plugin gives (a label the cut list names) */
interface Label { kind: 'label'; name: string; board: string; origin: number[]; xdir: number[]; ydir: number[]; text: string; height: number }
/** `solid.extrude` and `solid.sweep`: a recorded sketch's profiles pushed along the plane's normal, or swept along a path */
interface Extrude { kind: 'extrude'; /** the feature number it was given */ fid?: number; name: string; sketch: SketchRec; only?: Set<string>; distance: number; dir: 'positive' | 'negative' | 'symmetric'; op: 'new' | 'join' | 'cut' | 'intersect'; body?: string; targets: string[] }
interface Sweep { kind: 'sweep'; fid?: number; name: string; sketch: SketchRec; only?: Set<string>; path: SketchRec; pathCurves: string[]; op: 'new' | 'join' | 'cut' | 'intersect'; body?: string; targets: string[] }
/** `solid.sphere` */
interface Sphere { kind: 'sphere'; name: string; center: number[]; r: number; op: 'new' | 'join' | 'cut' | 'intersect'; body?: string; targets: string[] }
interface Move { kind: 'move'; name: string; /** a placement: made after everything else, copies of a component's bodies first, then its own bodies moved (a copy is of the part at the origin) */ late?: boolean; copies?: Array<{ from: string; to: string }>; bodies: string[]; translate?: number[]; rotate?: { origin: number[]; axis: number[]; angle: number } }
interface Hole { name: string; pos: number[]; dir: number[]; d: number; depth: number; targets: string[]; hole: true; /** the bore is already there: nothing to cut (a tap of a bore that is the tap drill) */ noop?: boolean }
export interface Param { name: string; expression: string; value: number; comment?: string }

/** Supported body finishes for plugin materials (matches CadKit's BodyFinish). */
export type MaterialFinish = 'matte' | 'plastic' | 'chrome' | 'glass' | 'brushed';
const MATERIAL_FINISHES = new Set<MaterialFinish>(['matte', 'plastic', 'chrome', 'glass', 'brushed']);

/** Rich appearance properties resolved for a plugin material. */
export interface MaterialLook {
  colour: string;
  finish?: MaterialFinish;
  metalness?: number;
  roughness?: number;
  opacity?: number;
  clearcoat?: number;
}
export interface MaterialDef {
  density?: number;
  look?: string;
  colour?: string;
  finish?: MaterialFinish;
  metalness?: number;
  roughness?: number;
  opacity?: number;
  clearcoat?: number;
}

/** Normalized joint/motion metadata declared by a plugin (hinges, slides, rigid links) in document coordinates. */
export interface PluginJointHint {
  name: string;
  kind: 'revolute' | 'prismatic' | 'rigid';
  bodies: string[];
  origin: [number, number, number];
  axis: [number, number, number];
  min: number;
  max: number;
  rest?: number;
  component?: string;
}

const vecLen = (v: number[]): number => Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
const unitVec = (v: number[]): [number, number, number] => { const l = vecLen(v); return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1]; };
const orthoX = (n: [number, number, number]): [number, number, number] => {
  const ref: [number, number, number] = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unitVec([n[1] * ref[2] - n[2] * ref[1], n[2] * ref[0] - n[0] * ref[2], n[0] * ref[1] - n[1] * ref[0]]);
};
const roundNum = (n: number): number => Math.round(n * 1e9) / 1e9 + 0;
const clampUnit = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined);
const clampOpacity = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0.05, v)) : undefined);
const parseFinish = (v: unknown): MaterialFinish | undefined => (typeof v === 'string' && MATERIAL_FINISHES.has(v.toLowerCase() as MaterialFinish) ? (v.toLowerCase() as MaterialFinish) : undefined);

function parseColor(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('').toLowerCase();
    return undefined;
  }
  if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x))) {
    const rgb = v.slice(0, 3) as number[];
    const scale = rgb.every((x) => x >= 0 && x <= 1) ? 255 : 1;
    return '#' + rgb.map((x) => Math.min(255, Math.max(0, Math.round(x * scale))).toString(16).padStart(2, '0')).join('');
  }
  return undefined;
}

/** Named material preset lookup (colour + PBR finish/metalness/roughness/opacity). Explicit colour or PBR overrides win over the preset. */
export function lookOf(name: string, look?: string | Partial<MaterialDef>): MaterialLook {
  const hint = typeof look === 'string' ? look : look?.look;
  const explicitColor = typeof look === 'string' ? parseColor(look) : (parseColor(look?.colour) ?? parseColor(look?.look));
  const n = `${name} ${hint ?? ''}`.toLowerCase();
  let base: MaterialLook = { colour: '#c9a87a', finish: 'matte', metalness: 0, roughness: 0.72 };
  if (n.includes('birch')) base = { colour: '#e3c995', finish: 'matte', metalness: 0, roughness: 0.7 };
  else if (n.includes('oak')) base = { colour: '#b78a56', finish: 'matte', metalness: 0, roughness: 0.72 };
  else if (n.includes('walnut')) base = { colour: '#6b4a32', finish: 'matte', metalness: 0, roughness: 0.68 };
  else if (n.includes('maple')) base = { colour: '#e6cfa6', finish: 'matte', metalness: 0, roughness: 0.65 };
  else if (n.includes('cherry')) base = { colour: '#b5683f', finish: 'matte', metalness: 0, roughness: 0.65 };
  else if (n.includes('pine')) base = { colour: '#d8b27a', finish: 'matte', metalness: 0, roughness: 0.74 };
  else if (n.includes('cedar')) base = { colour: '#b5764e', finish: 'matte', metalness: 0, roughness: 0.75 };
  else if (n.includes('teak')) base = { colour: '#a9753f', finish: 'matte', metalness: 0, roughness: 0.62 };
  else if (n.includes('mdf')) base = { colour: '#b79a76', finish: 'matte', metalness: 0, roughness: 0.85 };
  else if (n.includes('plywood')) base = { colour: '#e3c79a', finish: 'matte', metalness: 0, roughness: 0.72 };
  else if (n.includes('melamine') || n.includes('white')) base = { colour: '#f1f1ec', finish: 'plastic', metalness: 0, roughness: 0.45 };
  else if (n.includes('chrome')) base = { colour: '#d8dde3', finish: 'chrome', metalness: 1, roughness: 0.08 };
  else if (n.includes('stainless') || n.includes('steel')) base = { colour: '#b8c0c8', finish: 'brushed', metalness: 0.9, roughness: 0.32 };
  else if (n.includes('alumin')) base = { colour: '#c9d0d8', finish: 'brushed', metalness: 0.88, roughness: 0.28 };
  else if (n.includes('brass')) base = { colour: '#d3b04c', finish: 'brushed', metalness: 0.92, roughness: 0.26 };
  else if (n.includes('copper')) base = { colour: '#c8774a', finish: 'brushed', metalness: 0.92, roughness: 0.28 };
  else if (n.includes('bronze')) base = { colour: '#a8742f', finish: 'brushed', metalness: 0.88, roughness: 0.34 };
  else if (n.includes('titanium')) base = { colour: '#a7adb5', finish: 'brushed', metalness: 0.85, roughness: 0.35 };
  else if (n.includes('iron')) base = { colour: '#5f656c', finish: 'brushed', metalness: 0.8, roughness: 0.48 };
  else if (n.includes('glass')) base = { colour: '#bfe3ea', finish: 'glass', metalness: 0, roughness: 0.06, opacity: 0.35 };
  else if (n.includes('acrylic') || n.includes('polycarbonate')) base = { colour: '#d4e8f0', finish: 'glass', metalness: 0, roughness: 0.1, opacity: 0.45 };
  else if (n.includes('rubber')) base = { colour: '#2f3236', finish: 'matte', metalness: 0, roughness: 0.9 };
  else if (n.includes('plastic') || n.includes('abs') || n.includes('pla') || n.includes('nylon')) base = { colour: '#e6e0cf', finish: 'plastic', metalness: 0, roughness: 0.42 };
  const over = typeof look === 'object' && look ? look : undefined;
  return {
    ...base,
    ...(explicitColor ? { colour: explicitColor } : {}),
    ...(over?.finish ? { finish: over.finish } : {}),
    ...(over?.metalness !== undefined ? { metalness: over.metalness } : {}),
    ...(over?.roughness !== undefined ? { roughness: over.roughness } : {}),
    ...(over?.opacity !== undefined ? { opacity: over.opacity } : {}),
    ...(over?.clearcoat !== undefined ? { clearcoat: over.clearcoat } : {}),
  };
}

export class Unsupported extends Error {}

export class Interpreter {
  params = new Map<string, Param>();
  boxes: Box[] = [];
  holes: Hole[] = [];
  /** boxes and holes in call order: a hole needs its target body to exist first */
  order: Array<Box | Hole | Round | Combine | Move | Chamfer | Label | Extrude | Sweep | Sphere> = [];
  /** names of pattern features: groupable, but they only repeat holes that are already emitted */
  patterns = new Set<string>();
  materials = new Map<string, MaterialDef>();
  assigned = new Map<string, string>();
  groups: Array<{ name: string; features: string[] }> = [];
  calls: string[] = [];
  buildMs = 0; builds = 0;
  /** boxes of document bodies this run moved (translations only): a later measure sees them where the plugin put them */
  private shifted = new Map<string, number[]>();
  /** components a plugin made (component.create .. component.activate): where their features sit in `order`, to move their bodies as one */
  private components = new Map<string, { from: number; to: number }>();
  private openComponent: string | null = null;
  /** the component commands act in (component.activate) */
  private activeName = 'Root';
  /** SolidCraft names components and placements by number (u64 ids, 0 = the root); a plugin may send either. Ids are handed out in the order a name is first met. */
  private compIdList: string[] = ['Root'];
  private compId(name: string): number { let i = this.compIdList.indexOf(name); if (i < 0) { this.compIdList.push(name); i = this.compIdList.length - 1; } return i; }
  /** a component given by id or by name, as its name */
  private compName(v: unknown): string { const k = String(v ?? 'Root'); return /^\d+$/.test(k) && this.compIdList[Number(k)] !== undefined ? this.compIdList[Number(k)] : k; }
  /** a placement given by id ("N" = the placement of component N) or by name ("Name:1"), as its name */
  private occName(v: unknown): string { const k = String(v ?? ''); return /^\d+$/.test(k) && this.compIdList[Number(k)] !== undefined ? `${this.compIdList[Number(k)]}:1` : k; }
  /** how far a plugin moved a component of the open document (Joinery puts a cabinet on the origin to drill it): nothing really moves here, so what it cuts there is shifted back */
  private movedBy = new Map<string, number[]>();
  private shiftBack(v: number[]): number[] { const m = this.movedBy.get(this.activeName); return m ? v.map((x, i) => x - m[i]) : v; }
  /** the label sketch a plugin is drawing (sketch.create .. sketch.finish) */
  private sketch: { name: string; origin: number[]; xdir: number[]; ydir: number[]; texts: Array<{ text: string; height: number }> } | null = null;
  /** component metadata a plugin stored (it finds its own cabinets again by it) */
  private metadata = new Map<string, Record<string, unknown>>();
  /** every sketch of this run that drew curves (the extrudes and sweeps that follow use them), and the one being drawn */
  sketches: SketchRec[] = [];
  private activeRec: SketchRec | null = null;
  /** SolidCraft numbers every feature (sketches, solids, planes) from 1 in the order made; timeline.group and the like name them by that number */
  private feats: Array<{ id: number; name: string; type: string; component: string; def?: Record<string, unknown> }> = [];
  private newFeature(name: string, type = 'extrude'): number { const id = this.feats.length + 1; this.feats.push({ id, name, type, component: this.activeName }); return id; }
  private featureOf(ref: unknown): { id: number; name: string; type: string; component: string; def?: Record<string, unknown> } {
    const f = typeof ref === 'number' || (typeof ref === 'string' && /^\d+$/.test(ref)) ? this.feats.find((x) => x.id === Number(ref)) : this.feats.find((x) => x.name === String(ref));
    if (!f) throw new Error(`timeline.inspect: no feature \`${String(ref)}\``);
    return f;
  }
  /** what a feature command answers: the new feature's number and name, and the bodies it made or changed */
  private featureReply(name: string, created: string[], changed: string[] = [], type = 'extrude'): Record<string, unknown> {
    const bodies = [...new Set([...(this.opts.doc?.bodies ?? []).map((b) => b.name), ...this.order.flatMap((o) => this.made(o))])];
    return { feature: this.newFeature(name, type), name, bodies, created_bodies: created, changed_bodies: changed, removed_bodies: [], warning: null, ms: 0 };
  }
  /** the body an ordered item makes (none for a cut, a join or a hole) */
  private made(o: Box | Hole | Round | Combine | Move | Chamfer | Label | Extrude | Sweep | Sphere): string[] {
    return 'hole' in o ? [] : 'kind' in o ? (((o.kind === 'round' || o.kind === 'extrude' || o.kind === 'sweep' || o.kind === 'sphere') && o.op === 'new') ? [o.body ?? o.name] : []) : (!o.cut && !o.join && !o.inter ? [o.body ?? o.name] : []);
  }
  private openSketch(sk: { name: string; origin: number[]; xdir: number[]; ydir: number[] }): unknown {
    const rec = new SketchRec(this.newFeature(sk.name, 'sketch'), sk.name, sk.origin, sk.xdir, sk.ydir);
    this.sketches.push(rec); this.activeRec = rec;
    this.feats[rec.id - 1].def = { plane: { origin: sk.origin, x_dir: sk.xdir, y_dir: sk.ydir } };
    return { sketch: rec.id, name: rec.name };
  }
  /** every sketch a name or id can reach: the one the user has open (id 0, what selection.get hands out) and the ones the run made */
  private known(): SketchRec[] { return this.hostRec ? [this.hostRec, ...this.sketches.filter((k) => k !== this.hostRec)] : this.sketches; }
  /** a sketch named by its id, its name, or (none given) the active or last one */
  private sketchRef(v: unknown): SketchRec {
    const r = v === undefined || v === null ? (this.activeRec ?? this.hostRec ?? this.sketches[this.sketches.length - 1]) : this.known().find((k) => k.id === Number(v) && /^\d+$/.test(String(v))) ?? this.known().find((k) => k.name === String(v));
    if (!r) throw new Error(v === undefined ? 'no sketch is open' : `no sketch \`${String(v)}\``);
    return r;
  }
  private pt2(v: unknown): Pt {
    // a point may be named by its id in the open sketch (`hole1.center`): it is taken where that point is
    if (typeof v === 'string' && (this.activeRec ?? this.hostRec)) { const h = (this.activeRec ?? this.hostRec)!; const q = h.points[h.pointIndex(v)]; return [...q.at] as Pt; }
    const a = v as unknown[]; if (!Array.isArray(a) || a.length !== 2) throw new Error('a point is [x, y]'); return [this.num(a[0]), this.num(a[1])]; }
  /** the sketch drawing commands: kept in the sketch record, nothing is solved */
  private sketchCommand(command: string, args: any): unknown {
    const sk = command === 'sketch.inspect' ? this.sketchRef(args.sketch) : this.activeRec ?? this.hostRec ?? (() => { throw new Error(`${command}: no sketch is open`); })();
    const opt = { connect: args.connect !== false, construction: !!args.construction };
    const info = () => ({ id: sk.id, name: sk.name, curves: sk.curves.length });
    switch (command) {
      case 'sketch.line': { const ids = sk.line((args.points as unknown[]).map((p) => this.pt2(p)), { ...opt, closed: !!args.closed, ids: args.ids }); return { curves: ids, constraints: [], sketch: info() }; }
      case 'sketch.arc.three_point': { const id = sk.arc3(this.pt2(args.start), this.pt2(args.end), this.pt2(args.through), { ...opt, id: args.id }); return { curves: [id], constraints: [], sketch: info() }; }
      case 'sketch.spline.fit_point': { const pts = ((args.points as unknown[]) ?? []).map((p) => this.pt2(p)); const id = sk.spline(pts, { closed: !!args.closed, id: args.id, construction: opt.construction }); return { curves: [id], constraints: [], sketch: info() }; }
      case 'sketch.circle.center': { const r = args.radius !== undefined ? this.num(args.radius) : this.num(args.diameter) / 2; const id = sk.circle(this.pt2(args.center), r, { ...opt, id: args.id }); return { curves: [id], constraints: [], sketch: info() }; }
      case 'sketch.point': { const id = sk.point(this.pt2(args.point), args.id); return { curves: [], points: [id], constraints: [], sketch: info() }; }
      case 'sketch.inspect': return sk.inspect();
      case 'sketch.project': return this.sketchProject(sk, args);
      case 'sketch.replace': {
        const from = this.sketchRef(args.from);
        sk.replaceWith(from);
        return { curves: sk.curves.map((c) => c.id), sketch: info() };
      }
      case 'sketch.constraint.fix': {
        const ents: string[] = args.entities ?? [];
        for (const e of ents) { const pi = sk.points.findIndex((q) => q.id === e); if (pi >= 0) sk.points[pi].fixed = args.fixed !== false; else sk.curveIndex(e); }
        sk.constraints.push({ id: `k${sk.constraints.length + 1}`, name: 'fix', ...args });
        return { constraints: [`k${sk.constraints.length}`], sketch: info() };
      }
      default: { sk.constraints.push({ id: `k${sk.constraints.length + 1}`, name: command.replace('sketch.', ''), ...args }); return { constraints: [`k${sk.constraints.length}`], sketch: info() }; }
    }
  }
  /** whether the body made by an extrusion already has a round bore where the hole is: a circle of its sketch with the hole's centre and diameter, the hole along the sketch normal */
  private boreExists(body: string, h: Hole): boolean {
    const x = this.order.find((o): o is Extrude => 'kind' in o && o.kind === 'extrude' && o.op === 'new' && (o.body ?? o.name) === body);
    if (!x) return false;
    const sk = x.sketch, a = sk.xdir, b = sk.ydir, n = unitVec([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]), d = unitVec(h.dir);
    if (Math.abs(d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) < 1 - 1e-9) return false;
    const rel = h.pos.map((v, i) => v - sk.origin[i]);
    return sk.curves.some((c) => c.type === 'circle' && !c.construction && Math.abs(c.r * 2 - h.d) < 1e-6 && (() => { const q = sk.points[c.c].at; return [0, 1, 2].every((i) => { const w = rel[i] - n[i] * (rel[0] * n[0] + rel[1] * n[1] + rel[2] * n[2]); return Math.abs(w - (q[0] * a[i] + q[1] * b[i])) < 1e-6; }); })());
  }
  // ---- construction planes, projection and the straight sweep (the sketch-driven rails) ----
  /** named construction planes made by construct.plane.*: origin and x, y axes in the plugin's frame (sketch.create can name one) */
  private planes = new Map<string, { origin: number[]; x: number[]; y: number[] }>();
  private sub = (a: number[], b: number[]): number[] => a.map((v, i) => v - b[i]);
  private dotv = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  private crossv = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  /** a point of a sketch in the world */
  private world(sk: SketchRec, p: Pt): number[] { return [0, 1, 2].map((i) => sk.origin[i] + p[0] * sk.xdir[i] + p[1] * sk.ydir[i]); }
  /** the ends of a straight line `{ sketch, curve }` of a sketch of this run, in the world */
  private lineWorld(ref: any): { sk: SketchRec; a: number[]; b: number[]; id: string } {
    const sk = this.sketchRef(ref?.sketch), c = sk.curves[sk.curveIndex(String(ref?.curve))];
    if (c.type !== 'line') throw new Unsupported(`a path must be a straight line (${c.id} is an ${c.type})`);
    return { sk, a: this.world(sk, sk.points[c.a].at), b: this.world(sk, sk.points[c.b].at), id: c.id };
  }
  /** `construct.plane.along_path`: the plane square to a straight path at `t` (0 start, 1 end); x is the horizontal Z cross the direction (+X when the path is vertical), as SolidCraft picks for a plane given by its normal */
  private planeAlongPath(args: any): unknown {
    const L = this.lineWorld(args.path), d = this.sub(L.b, L.a), len = vecLen(d);
    if (!(len > 1e-9)) throw new Error('construct.plane.along_path: the path has no length');
    const n = d.map((v) => v / len), t = this.num(args.t ?? 0);
    const o = L.a.map((v, i) => v + d[i] * t);
    const cand = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : this.crossv([0, 0, 1], n), x = unitVec(cand.map((c, i) => c - n[i] * this.dotv(cand, n)));
    const y = this.crossv(n, x);
    return this.addPlane(String(args.name), o, x, y);
  }
  /** `construct.plane.axis_point`: the plane through a straight path and a point of a sketch: x along the path, y across towards the point, so the normal looks out of that side */
  private planeAxisPoint(args: any): unknown {
    const L = this.lineWorld(args.axis), d = this.sub(L.b, L.a), x = unitVec(d);
    const ps = this.sketchRef(args.point?.sketch), pi = ps.pointIndex(String(args.point?.point)), q = this.world(ps, ps.points[pi].at);
    const rel = this.sub(q, L.a), perp = rel.map((v, i) => v - x[i] * this.dotv(rel, x));
    if (!(vecLen(perp) > 1e-9)) throw new Error('construct.plane.axis_point: the point is on the axis');
    return this.addPlane(String(args.name), L.a, x, unitVec(perp));
  }
  private addPlane(name: string, origin: number[], x: number[], y: number[]): unknown {
    if (this.planes.has(name)) throw new Error(`a plane named "${name}" already exists`);
    this.planes.set(name, { origin, x, y });
    return { feature: this.newFeature(name, 'plane'), name, plane: name };
  }
  /** `sketch.project` of a straight path line into the open sketch: its ends drop onto the sketch plane. The projection stays a construction line (no profile). */
  private sketchProject(sk: SketchRec, args: any): unknown {
    const refs = (args.refs ?? []) as any[], made: string[] = [];
    for (const r of refs) {
      const L = this.lineWorld(r);
      const uv = (w: number[]): Pt => { const rel = this.sub(w, sk.origin); return [this.dotv(rel, sk.xdir), this.dotv(rel, sk.ydir)]; };
      const a = uv(L.a), b = uv(L.b);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) throw new Error('sketch.project: the line is square to the sketch plane');
      made.push(...sk.line([a, b], { construction: args.construction !== false, connect: false }));
    }
    return { created: { curves: made, points: [] }, constraints: [], sketch: { id: sk.id, name: sk.name, curves: sk.curves.length } };
  }
  /** `solid.sweep` along ONE straight line with the profile in the plane square to it at the start (what a rail is): the same solid as an extrusion of the profile along the path, which is how it is recorded. A curved or multi-segment path is not swept here. */
  private sweep(args: any): unknown {
    const sk = this.sketchRef(args.sketch), path = (args.path ?? []) as string[];
    if (path.length !== 1) throw new Unsupported('solid.sweep: only a path of one straight line is run here (not a chain of curves)');
    for (const k of ['rails', 'twist', 'scale', 'orientation']) if (args[k] !== undefined) throw new Unsupported(`solid.sweep: ${k} is not supported yet`);
    const L = this.lineWorld({ sketch: args.path_sketch, curve: path[0] }), d = this.sub(L.b, L.a), len = vecLen(d), n = this.crossv(sk.xdir, sk.ydir);
    if (Math.abs(this.dotv(n, d) / len) < 1 - 1e-6) throw new Unsupported('solid.sweep: the profile plane must be square to the straight path (only that is run here)');
    const forward = this.dotv(n, d) > 0;
    const op = (['cut', 'join', 'intersect'] as const).find((o) => o === args.operation) ?? 'new';
    const only = sk.select(args.profiles);
    const x: Extrude = { kind: 'extrude', name: String(args.name ?? args.body_name ?? `Sweep ${sk.name}`), sketch: sk, ...(only ? { only } : {}), distance: len, dir: forward ? 'positive' : 'negative', op, body: args.body_name, targets: op === 'new' ? [] : ((args.targets as string[] | undefined)?.length ? args.targets : this.allBodies(op)) };
    for (const t of x.targets) if (!this.exists(t)) throw new Error(`no body named "${t}"`);
    this.order.push(x);
    const r = op === 'new' ? this.featureReply(x.name, [x.body ?? x.name], [], 'sweep') : this.featureReply(x.name, [], x.targets, 'sweep');
    x.fid = r.feature as number;
    this.feats[x.fid - 1].def = { sketch: sk.id, profiles: args.profiles ?? 'all', path_sketch: args.path_sketch, path, operation: op, targets: x.targets };
    return r;
  }
  /** `solid.hole` at the points of a sketch (a tap): one hole per point, along the sketch normal (`flip`: with it, else against it) */
  private holesAtSketchPoints(args: any): unknown {
    const sk = this.sketchRef(args.sketch), n = unitVec(this.crossv(sk.xdir, sk.ydir)), dir = args.flip ? n : n.map((v) => -v);
    const ids = (args.points ?? []) as string[];
    if (!ids.length) throw new Error('solid.hole: `points` names the sketch points to drill');
    ids.forEach((id, i) => {
      const w = this.world(sk, sk.points[sk.pointIndex(id)].at);
      this.runSync('solid.hole', { name: ids.length > 1 ? `${args.name} ${i + 1}` : args.name, position: w, direction: dir, diameter: args.diameter, depth: args.depth, targets: args.targets, thread: args.thread, modeled: args.modeled });
    });
    return { feature: this.newFeature(String(args.name), 'hole'), name: String(args.name) };
  }
  /** a tapped hole without a diameter: the tap drill of its thread (the thread form itself is not cut: the bore is) */
  private tapDrill(thread: unknown): number {
    const d: Record<string, number> = { M2: 1.6, 'M2.5': 2.05, M3: 2.5, M4: 3.3, M5: 4.2, M6: 5, M8: 6.8, M10: 8.5, M12: 10.2 };
    const k = String(thread ?? '').split(/[x\s]/i)[0].trim().toUpperCase();
    if (!(k in d)) throw new Error(`solid.hole: give a diameter, or a thread this host knows the tap drill of (got ${JSON.stringify(thread)})`);
    return d[k];
  }
  /** placements of components made by occurrence.copy (the first placement of a component is the component itself, id = the component's) */
  private occs = new Map<number, { component: string; index: number; parent: number }>();
  /** occurrence.move with a matrix: the placement's rows are the world axes of the part's x, y and normal, then its point (a 3 x 4 matrix). The first placement moves the part's own bodies; a copy is a new set of bodies. */
  private placeOccurrence(args: any): unknown {
    const m = args.to_matrix as number[][];
    if (!Array.isArray(m) || m.length < 3 || m.some((r) => !Array.isArray(r) || r.length !== 4)) throw new Error('occurrence.move: to_matrix is 3 rows of 4 numbers');
    const R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[i][j])), t = [m[0][3], m[1][3], m[2][3]];
    const id = Number(args.occurrence), copy = this.occs.get(id);
    const comp = copy ? copy.component : this.occName(args.occurrence).replace(/:\d+$/, ''), c = this.components.get(comp);
    if (!c) return { moved: args.occurrence, stub: true };
    const names = [...new Set(this.order.slice(c.from, c.to).flatMap((o) => this.made(o)))];
    const tr = R[0][0] + R[1][1] + R[2][2], ang = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI;
    let axis = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]];
    if (ang > 179.9) { const d = [0, 1, 2].map((i) => Math.sqrt(Math.max(0, (R[i][i] + 1) / 2))); const k = d.indexOf(Math.max(...d)); axis = d.map((v, i) => (i === k ? v : (R[i][k] + R[k][i]) / (4 * d[k]))); }
    const rotate = ang > 1e-6 && vecLen(axis) > 1e-12 ? { origin: [0, 0, 0], axis: unitVec(axis), angle: ang } : undefined;
    const translate = t.some((v) => Math.abs(v) > 1e-12) ? t : undefined;
    if (!rotate && !translate && !copy) return { moved: args.occurrence };
    const mv: Move = { kind: 'move', name: `Place ${comp}:${copy?.index ?? 1}`, late: true, bodies: names, ...(translate ? { translate } : {}), ...(rotate ? { rotate } : {}) };
    if (copy) { mv.copies = names.map((b) => ({ from: b, to: `${b} (${comp}:${copy.index})` })); mv.bodies = []; }
    this.order.push(mv);
    return { moved: args.occurrence, reverted: false };
  }
  /** design properties a plugin set (document.metadata.set) */
  private docMeta = new Map<string, unknown>();
  /** names of construction axes: they carry no geometry here but a history folder may list them */
  private axes = new Set<string>();
  /** what this run stored on the components it made: kept with the run's record so a later run can read it */
  componentMetadata(): Record<string, Record<string, unknown>> { return Object.fromEntries([...this.components.keys()].filter((n) => this.metadata.has(n)).map((n) => [n, this.metadata.get(n)!])); }
  /** hinges and slides a plugin asked for: kept for a later assembly, nothing moves yet */
  joints: Array<Record<string, unknown>> = [];
  constructor(private readonly scratch: Scratch, readonly opts: { readEntry?: boolean; /** the sketch the user has open: sketch.inspect answers with it and the sketch commands draw into it */ openSketch?: { name: string; curves: ReadonlyArray<SketchCurveIO>; picked?: { curves: number[]; points: Array<[number, number]> } }; doc?: DocContext; /** the up axis of the document the result goes into (a measure builds in that frame) */ up?: 'y' | 'z' } = {}) {
    const o = opts.openSketch;
    if (o) {
      const r = new SketchRec(0, o.name, [0, 0, 0], [1, 0, 0], [0, 1, 0]);
      for (const c of o.curves) {
        const k = { connect: true, construction: !!c.construction };
        if (c.type === 'line') r.line([c.a, c.b], { ...k, closed: false }); else if (c.type === 'arc') r.arc3(c.a, c.b, c.through, k); else r.circle(c.c, c.r, k);
      }
      this.hostRec = r; this.hostBase = r.curves.length;
    }
  }
  /** the sketch the user has open (when the run was given one) and how many curves it had before the run */
  private hostRec: SketchRec | null = null;
  private hostBase = 0;
  /** the curves the run drew into the open sketch, in its 2D frame */
  hostAdds(): SketchCurveIO[] {
    const r = this.hostRec;
    if (!r) return [];
    return r.curves.slice(this.hostBase).flatMap((c): SketchCurveIO[] => {
      const k = c.construction ? { construction: true } : {};
      if (c.type === 'line') return [{ type: 'line', a: [...r.points[c.a].at] as [number, number], b: [...r.points[c.b].at] as [number, number], ...k }];
      if (c.type === 'arc') return [{ type: 'arc', a: [...r.points[c.a].at] as [number, number], b: [...r.points[c.b].at] as [number, number], through: [...c.through] as [number, number], ...k }];
      if (c.type === 'circle') return [{ type: 'circle', c: [...r.points[c.c].at] as [number, number], r: c.r, ...k }];
      return [];
    });
  }

  // the document's frame -> the plugin's Z-up frame (the inverse of pt() below): Y-up (x, y, z) -> (x, -z, y)
  private fromDoc(p: number[]): number[] { return (this.opts.up ?? this.opts.doc?.up) === 'y' ? [p[0], 0 - p[2], p[1]] : p; }
  private docBody(name: string): DocBody | undefined { return this.opts.doc?.bodies.find((b) => b.name === name); }
  /** a body of this run or of the open document */
  private exists(name: string): boolean {
    return this.order.some((o) => ('cut' in o && !o.cut && !o.join && !o.inter && (o.body ?? o.name) === name) || ('kind' in o && ((o.kind === 'round' || o.kind === 'extrude' || o.kind === 'sweep' || o.kind === 'sphere') && o.op === 'new') && (o.body ?? o.name) === name)) || !!this.docBody(name);
  }
  /** a box in the document's frame -> the plugin's frame (every corner turns, so the min and max are taken again) */
  private boxFromDoc(b: { min: number[]; max: number[] }): { min: number[]; max: number[] } {
    const c = [0, 1, 2].map((i) => [b.min[i], b.max[i]]), pts: number[][] = [];
    for (const x of c[0]) for (const y of c[1]) for (const z of c[2]) pts.push(this.fromDoc([x, y, z]));
    return { min: [0, 1, 2].map((i) => Math.min(...pts.map((q) => q[i]))), max: [0, 1, 2].map((i) => Math.max(...pts.map((q) => q[i]))) };
  }
  private bboxOf(name: string): { min: number[]; max: number[] } | null {
    const b = this.docBody(name)?.bbox; if (!b) return null;
    const t = this.shifted.get(name) ?? [0, 0, 0], r = this.boxFromDoc(b);
    return { min: r.min.map((v, i) => v + t[i]), max: r.max.map((v, i) => v + t[i]) };
  }

  /** this run's parameters, and the document's (a plugin links its sizes to another cabinet's: `B_height = A_height`) */
  private vars(): Record<string, number> { return { ...Object.fromEntries((this.opts.doc?.parameters ?? []).map((p) => [p.name, p.value])), ...Object.fromEntries([...this.params].map(([k, p]) => [k, p.value])) }; }
  private num(v: unknown): number { return evalExpr(v as string | number, this.vars()); }

  /** The `commands.run` entry point: JSON in, JSON out, throws a plain Error (the host turns it into command-failed). */
  async run(command: string, args: any): Promise<unknown> {
    const v = this.runSync(command, args);
    if (v !== undefined) return v;
    this.calls.push(command);
    if (command === 'component.properties') return this.componentProperties(args);
    return command === 'document.inspect' ? this.inspect() : this.measure(args);
  }

  /** Edits only record, so they can answer synchronously: the host then never has to replay the guest for them. Reads (they build) return undefined. */
  runSync(command: string, args: any): unknown {
    if (command === 'material.list') { this.calls.push(command); return { materials: [...this.materials].map(([name, m]) => ({ name, density_g_cm3: m.density })) }; }
    if (command === 'selection.get') { this.calls.push(command); return this.selection(args); }
    if (command === 'model.mesh') { this.calls.push(command); return this.modelMesh(args); }
    if (command === 'model.faces') { this.calls.push(command); return this.modelFaces(args); }
    if (command === 'model.edges') { this.calls.push(command); return this.modelEdges(args); }
    if (command === 'model.threads') { this.calls.push(command); return { threads: this.opts.doc?.threads ?? [] }; }
    if (BUILT_READS.has(command)) return undefined;
    this.calls.push(command);
    if (this.opts.readEntry && !READS.has(command)) throw new Error(`a read entry may not call ${command}`);
    switch (command) {
      case 'parameters.add': {
        const name = String(args.name);
        if (this.params.has(name) || this.opts.doc?.parameters?.some((p) => p.name === name)) throw new Error(`parameter ${name} already exists`);
        const value = this.num(args.expression);
        this.params.set(name, { name, expression: String(args.expression), value, ...(args.comment ? { comment: String(args.comment) } : {}) });
        return { name, value, expression: String(args.expression) };
      }
      case 'solid.box': {
        const cut = args.operation === 'cut', join = args.operation === 'join', inter = args.operation === 'intersect';
        const box: Box = { name: String(args.name ?? args.body_name), body: args.body_name, cut, join, inter, targets: args.targets ?? [], corner: (args.corner as unknown[]).map((c) => this.num(c)), size: [args.length, args.width, args.height].map((c) => this.num(c)) };
        if ((cut || join || inter) && !box.targets.length) throw new Error(`a ${args.operation} needs targets`);
        if (cut || join || inter) for (const t of box.targets) if (!this.exists(t)) throw new Error(`no body named "${t}"`);
        box.corner = this.shiftBack(box.corner);
        this.boxes.push(box); this.order.push(box);
        return { feature: box.name, body: box.body ?? null };
      }
      case 'solid.extrude': {
        const sk = this.sketchRef(args.sketch);
        const op = (['cut', 'join', 'intersect'] as const).find((o) => o === args.operation) ?? 'new';
        const dirArg = String(args.direction ?? 'positive');
        if (!['positive', 'negative', 'symmetric'].includes(dirArg)) throw new Error(`solid.extrude: direction is positive, negative or symmetric (got ${dirArg})`);
        for (const k of ['face', 'faces', 'through_all', 'extent', 'taper', 'distance2', 'start_offset', 'to', 'from', 'thin', 'to_offset']) if (args[k] !== undefined && args[k] !== null && args[k] !== false) throw new Unsupported(`solid.extrude: ${k} is not supported yet`);
        if (args.distance === undefined) throw new Error('solid.extrude: `distance` is required');
        const only = sk.select(args.profiles);
        const x: Extrude = { kind: 'extrude', name: String(args.name ?? args.body_name ?? `Extrude ${sk.name}`), sketch: sk, ...(only ? { only } : {}), distance: this.num(args.distance), dir: dirArg as Extrude['dir'], op, body: args.body_name, targets: op === 'new' ? [] : ((args.targets ?? args.participants) as string[] | undefined)?.length ? (args.targets ?? args.participants) : this.allBodies(op) };
        if (!(x.distance > 0)) throw new Error('solid.extrude needs a positive distance');
        if (op !== 'new' && !x.targets.length) throw new Error(`a ${op} needs targets`);
        for (const t of x.targets) if (!this.exists(t)) throw new Error(`no body named "${t}"`);
        this.order.push(x);
        const r = op === 'new' ? this.featureReply(x.name, [x.body ?? x.name]) : this.featureReply(x.name, [], x.targets);
        x.fid = r.feature as number;
        this.feats[x.fid - 1].def = { sketch: sk.id, profiles: args.profiles ?? 'all', extent: { distance: String(x.distance), direction: x.dir }, operation: op, targets: x.targets };
        return r;
      }
      case 'solid.sphere': {
        const op = (['cut', 'join', 'intersect'] as const).find((o) => o === args.operation) ?? 'new';
        const r = args.radius !== undefined ? this.num(args.radius) : args.diameter !== undefined ? this.num(args.diameter) / 2 : NaN;
        if (!(r > 0)) throw new Error('solid.sphere needs a positive radius or diameter');
        const targets: string[] = op === 'new' ? [] : ((args.targets as string[] | undefined)?.length ? (args.targets as string[]) : this.allBodies(op));
        if (op !== 'new' && !targets.length) throw new Error(`a ${op} needs a body to work on`);
        for (const t of targets) if (!this.exists(t)) throw new Error(`no body named "${t}"`);
        const sp: Sphere = { kind: 'sphere', name: String(args.name ?? args.body_name ?? 'Sphere'), center: this.shiftBack(((args.center as unknown[] | undefined) ?? [0, 0, 0]).map((c) => this.num(c))), r, op, body: args.body_name, targets };
        this.order.push(sp);
        const rep = op === 'new' ? this.featureReply(sp.name, [sp.body ?? sp.name], [], 'sphere') : this.featureReply(sp.name, [], targets, 'sphere');
        return rep;
      }
      case 'construct.plane.along_path': return this.planeAlongPath(args);
      case 'construct.plane.axis_point': return this.planeAxisPoint(args);
      case 'solid.sweep': return this.sweep(args);
      case 'solid.hole': {
        if (args.sketch !== undefined) return this.holesAtSketchPoints(args);
        const targets: string[] = args.targets ?? [];
        if (!targets.length) throw new Error('a hole needs targets');
        for (const t of targets) if (!this.exists(t)) throw new Error(`no body named "${t}"`);
        const h: Hole = { hole: true, name: String(args.name), pos: (args.position as unknown[]).map((c) => this.num(c)), dir: (args.direction as number[]).map(Number), d: args.diameter !== undefined ? this.num(args.diameter) : this.tapDrill(args.thread), depth: this.num(args.depth), targets };
        if (!(h.d > 0) || !(h.depth > 0)) throw new Error('a hole needs a positive diameter and depth');
        if (args.diameter === undefined && h.targets.every((t) => this.boreExists(t, h))) h.noop = true;
        this.holes.push(h); this.order.push(h);
        return { feature: h.name };
      }
      case 'solid.pattern.rectangular': {
        // a pattern repeats features made earlier in this run: holes, or cuts made by a cylinder or a box
        type Seed = Hole | Round | Box;
        const seeds = (args.features as string[]).map((f): Seed | undefined => this.holes.find((h) => h.name === f) ?? this.order.find((o): o is Round | Box => o.name === f && (('kind' in o && o.kind === 'round' && o.op === 'cut') || (!('kind' in o) && !('hole' in o) && o.cut))));
        if (seeds.some((h) => !h)) throw new Error('a pattern can only repeat a hole or a cut made earlier in this run');
        const n1 = Math.round(this.num(args.count1)), n2 = Math.round(this.num(args.count2 ?? 1));
        const s1 = this.num(args.spacing1), s2 = args.spacing2 === undefined ? 0 : this.num(args.spacing2);
        const d1 = (args.dir1 as number[]) ?? [0, 0, 1], d2 = (args.dir2 as number[]) ?? [0, 1, 0];
        let made = 0;
        for (const h of seeds as Seed[]) for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
          if (!i && !j) continue;
          const shift = (v: number[]) => v.map((x, k) => x + d1[k] * s1 * i + d2[k] * s2 * j);
          const name = `${h.name} ${i + 1}.${j + 1}`;
          if ('hole' in h) { const c: Hole = { ...h, name, pos: shift(h.pos) }; this.holes.push(c); this.order.push(c); }
          else if ('kind' in h) this.order.push({ ...h, name, base: shift(h.base) });
          else { const c: Box = { ...h, name, corner: shift(h.corner) }; this.boxes.push(c); this.order.push(c); }
          made++;
        }
        this.patterns.add(String(args.name));
        return { feature: String(args.name), copies: made };
      }
      case 'solid.cylinder': case 'solid.cone': {
        const cone = command === 'solid.cone';
        const op = (['cut', 'join', 'intersect'] as const).find((o) => o === args.operation) ?? 'new';
        const axis = (typeof args.axis === 'string' ? (({ X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1], '-X': [-1, 0, 0], '-Y': [0, -1, 0], '-Z': [0, 0, -1] } as Record<string, number[]>)[String(args.axis).trim().toUpperCase()] ?? [NaN]) : ((args.axis as unknown[] | undefined) ?? [0, 0, 1])).map((c) => Number(c));   // SolidCraft: base defaults to the origin, axis to Z
        if (axis.length !== 3 || axis.some((v) => !Number.isFinite(v)) || !(vecLen(axis) > 1e-12)) throw new Error(`${command}: axis must be a non-zero 3D vector (got [${axis}])`);
        const r: Round = { kind: 'round', name: String(args.name ?? args.body_name ?? (cone ? 'Cone' : 'Cylinder')), base: ((args.base as unknown[] | undefined) ?? [0, 0, 0]).map((c) => this.num(c)), axis, d: args.radius !== undefined ? 2 * this.num(args.radius) : this.num(args.diameter), height: this.num(args.height), op, body: args.body_name, targets: args.targets?.length ? args.targets : op === 'new' ? [] : this.allBodies(op), ...(cone ? { top: this.num(args.top_diameter ?? 0) } : {}) };
        if (!(r.d > 0) || !(r.height > 0) || (cone && !(r.top! >= 0))) throw new Error(`${command} needs a positive diameter and height`);
        if (op !== 'new' && !r.targets.length) throw new Error(`a ${op} needs targets`);
        for (const t of r.targets) if (!this.exists(t)) throw new Error(`no body named "${t}"`);
        r.base = this.shiftBack(r.base);
        this.order.push(r);
        return { feature: r.name, body: op === 'new' ? (r.body ?? r.name) : r.targets[0] ?? null };
      }
      case 'solid.combine': {
        const target = String(args.target), tools = (args.tools as string[]) ?? [];
        const op = (['cut', 'join', 'intersect'] as const).find((o) => o === args.operation);
        if (!op) throw new Error(`solid.combine: operation is "cut", "join" or "intersect" (got ${JSON.stringify(args.operation)})`);
        if (!tools.length) throw new Error('solid.combine needs tools');
        for (const t of [target, ...tools]) if (!this.exists(t)) throw new Error(`no body named "${t}"`);
        const c: Combine = { kind: 'combine', name: String(args.name ?? `Combine ${target}`), target, tools, op, keep: !!args.keep_tools };
        this.order.push(c);
        return { feature: c.name, body: target };
      }
      case 'solid.move': {
        const bodies = (args.bodies as string[]) ?? [];
        if (!bodies.length) throw new Error('solid.move needs bodies');
        for (const b of bodies) if (!this.exists(b)) throw new Error(`no body named "${b}"`);
        const m: Move = { kind: 'move', name: String(args.name ?? `Move ${bodies[0]}`), bodies, ...(args.translate ? { translate: (args.translate as unknown[]).map((c) => this.num(c)) } : {}) };
        if (args.axis) m.rotate = { origin: ((args.origin as unknown[]) ?? [0, 0, 0]).map((c) => this.num(c)), axis: (args.axis as number[]).map(Number), angle: this.num(args.angle) };
        if (!m.translate && !m.rotate) throw new Error('solid.move needs translate or axis and angle');
        if (m.translate && !m.rotate) for (const b of bodies) { const t = this.shifted.get(b) ?? [0, 0, 0]; this.shifted.set(b, t.map((v, i) => v + m.translate![i])); }
        this.order.push(m);
        return { moved: bodies };
      }
      case 'model.body_features': {
        // each body with the solid features that built it (a sketch is read with sketch.inspect); a feature is one that made or changed the body
        const bodies = [...new Set(this.order.flatMap((o) => this.made(o)))].map((b) => ({ body: b, features: this.order.filter((o) => 'fid' in o && o.fid !== undefined && (this.made(o).includes(b) || ('targets' in o && o.targets.includes(b)))).flatMap((o) => [...('sketch' in o && o.sketch instanceof SketchRec ? [{ id: o.sketch.id }] : []), { id: (o as { fid: number }).fid }]).filter((f, i, a) => a.findIndex((g) => g.id === f.id) === i) }));
        return { bodies };
      }
      case 'parameters.list': {
        const all = [...(this.opts.doc?.parameters ?? []).filter((d) => !this.params.has(d.name)), ...this.params.values()];
        const rows = all.map((p) => ({ name: p.name, expression: p.expression, unit: 'mm', value: p.value, source: 'user', comment: p.comment ?? '', favorite: false, uses: [], used_by: [], error: null }));
        return { parameters: rows, count: rows.length, cycles: [] };
      }
      case 'parameters.users': {
        const name = String(args.name);
        if (!this.params.has(name) && !this.opts.doc?.parameters?.some((p) => p.name === name)) throw new Error(`no parameter \`${name}\``);
        return { name, users: [], drives: [] };
      }
      case 'timeline.inspect': {
        if (args.group !== undefined) { const g = this.groups[Number(args.group) - 1]; if (!g) throw new Error(`no folder ${String(args.group)}`); return { group: Number(args.group), name: g.name, parent: null, features: g.features, joints: [] }; }
        const f = this.featureOf(args.feature);
        return { id: f.id, name: f.name, type: f.type, type_name: f.type, suppressed: false, rolled_back: false, definition: { ...(f.def ?? {}), ...(f.component !== 'Root' ? { component: this.compId(f.component) } : {}) }, omitted: f.type === 'sketch' ? [{ field: 'sketch', what: 'the sketch geometry (sketch.inspect; edit it with the sketch commands)' }] : [], inputs: [], error: null, warning: null, boolean_diagnostics: null };
      }
      case 'appearance.list': {
        const look = (m: string | undefined) => { const l = lookOf(m ?? 'Steel', m ? this.materials.get(m) : undefined); return { name: m ?? 'Steel', color: l.colour, opacity: l.opacity ?? 1, ...(l.metalness !== undefined ? { pbr: { metallic: l.metalness, roughness: l.roughness ?? 0.5, dielectric_ior: 1.5 } } : {}) }; };
        const bodies: Record<string, unknown> = {};
        for (const [b, m] of this.assigned) bodies[b] = look(m);
        const out: Record<string, unknown> = { in_design: [], bodies, faces: [], components: [] };
        if (args.body !== undefined) {
          const n = String(args.body);
          if (!this.exists(n)) throw new Error(`no body \`${n}\``);
          const a = look(this.assigned.get(n));
          out.body = { name: n, appearance: a, color: a.color, faces: [] };
        }
        return out;
      }
      case 'document.metadata.set': {
        const entries = args.values && typeof args.values === 'object' ? Object.entries(args.values as Record<string, unknown>) : args.key !== undefined ? [[String(args.key), args.value] as [string, unknown]] : null;
        if (!entries) throw new Error('document.metadata.set: give `key` and `value`, or `values`: {key: value, ...}');
        const changed: string[] = [];
        for (const [k, v] of entries) { if (v === null) { if (this.docMeta.delete(k)) changed.push(k); } else if (JSON.stringify(this.docMeta.get(k)) !== JSON.stringify(v)) { this.docMeta.set(k, v); changed.push(k); } }
        return { metadata: Object.fromEntries(this.docMeta), changed };
      }
      case 'browser.visibility': {
        if (typeof args.visible !== 'boolean') throw new Error('browser.visibility: `visible` must be true or false');
        const n = (Array.isArray(args.items) ? args.items.length : 0) + (Array.isArray(args.paths) ? args.paths.length : 0) + (Array.isArray(args.tree_folders) ? args.tree_folders.length : 0) || (args.folder !== undefined ? 1 : 0);
        for (const it of (Array.isArray(args.items) ? args.items : [])) { const f = typeof it === 'number' ? this.sketches.find((k) => k.id === it) : undefined; if (f) f.hidden = !args.visible; }
        return { visible: args.visible, changed: n, visibility: {} };
      }
      case 'material.create': {
        const appObj = args.appearance && typeof args.appearance === 'object' && !Array.isArray(args.appearance) ? (args.appearance as Record<string, unknown>) : undefined;
        const look = typeof args.appearance === 'string' ? args.appearance : (typeof appObj?.preset === 'string' ? appObj.preset : (typeof appObj?.name === 'string' ? appObj.name : undefined));
        const colour = parseColor(args.color ?? args.colour ?? appObj?.color ?? appObj?.colour ?? (typeof args.appearance === 'string' ? args.appearance : undefined));
        const metalness = clampUnit(args.metalness ?? args.metallic ?? appObj?.metalness ?? appObj?.metallic);
        const roughness = clampUnit(args.roughness ?? appObj?.roughness);
        const opacity = clampOpacity(args.opacity ?? appObj?.opacity);
        const finish = parseFinish(args.finish ?? appObj?.finish);
        const clearcoat = clampUnit(args.clearcoat ?? appObj?.clearcoat);
        this.materials.set(String(args.name), {
          ...(args.density_g_cm3 !== undefined ? { density: Number(args.density_g_cm3) } : {}),
          ...(look !== undefined ? { look } : {}),
          ...(colour !== undefined ? { colour } : {}),
          ...(metalness !== undefined ? { metalness } : {}),
          ...(roughness !== undefined ? { roughness } : {}),
          ...(opacity !== undefined ? { opacity } : {}),
          ...(finish !== undefined ? { finish } : {}),
          ...(clearcoat !== undefined ? { clearcoat } : {}),
        });
        return { name: args.name };
      }
      case 'material.assign': {
        if (!this.materials.has(String(args.material))) throw new Error(`no material named "${args.material}"`);
        for (const b of (args.bodies as string[])) this.assigned.set(b, String(args.material));
        return { assigned: (args.bodies as string[]).length };
      }
      case 'solid.chamfer': {
        const body = String(args.body);
        if (!this.exists(body)) throw new Error(`no body named "${body}"`);
        const near = ((args.edges as unknown[]) ?? []).map((e) => (e as unknown[]).map((c) => this.num(c)));
        if (!near.length) throw new Error('solid.chamfer needs edges');
        const distance = this.num(args.distance);
        if (!(distance > 0)) throw new Error('solid.chamfer needs a positive distance');
        this.order.push({ kind: 'chamfer', name: String(args.name ?? `Chamfer ${body}`), body, distance, near });
        return { feature: args.name ?? null, body };
      }
      case 'construct.axis.two_planes': { this.axes.add(String(args.name)); return { axis: args.name }; }
      case 'joint.create': {
        this.joints.push({ ...args });
        return { joint: args.name };
      }
      case 'joint.edit': {
        const key = String(args.joint ?? args.name ?? '');
        const idx = this.joints.findIndex((j) => String(j.name ?? j.joint ?? '') === key);
        if (idx >= 0) this.joints[idx] = { ...this.joints[idx], ...args };
        return { joints: this.joints };
      }
      case 'joint.list': return { joints: this.joints };
      case 'component.metadata.set': { const n = this.compName(args.component); this.metadata.set(n, { ...(this.metadata.get(n) ?? {}), ...((args.values as Record<string, unknown>) ?? {}) }); return { component: n }; }
      case 'component.metadata': { const n = this.compName(args.component), m = this.metadata.get(n) ?? this.opts.doc?.components?.[n] ?? {}; return { component: n, metadata: m, values: m }; }
      case 'component.list': {
        // the open document has no components here: a cabinet is the bodies sharing a prefix before "Side L" / "Side R"
        const fromDoc = new Set((this.opts.doc?.bodies ?? []).map((b) => /^(.+) Side [LR]$/.exec(b.name)?.[1]).filter((n): n is string => !!n));
        const names = [...new Set([...fromDoc, ...Object.keys(this.opts.doc?.components ?? {}), ...this.components.keys()])];
        const IDENTITY = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
        const node = (id: number, name: string, parent: number | null) => { const c = this.components.get(name), mine = this.feats.filter((f) => f.component === name && id !== 0), of = (t: (k: string) => boolean) => mine.filter((f) => t(f.type)).map((f) => f.name); return ({ id, name, parent, bodies: c ? [...new Set(this.order.slice(c.from, c.to).flatMap((o) => this.made(o)))] : [] as string[], features: of((k) => k !== 'sketch' && k !== 'plane'), sketches: of((k) => k === 'sketch'), construction: of((k) => k === 'plane'),
          occurrences: id === 0 ? [] : [{ id, component: id, parent: 0, name: `${name}:1`, transform: IDENTITY, grounded: false }], children: [] as unknown[] }); };
        return { active: this.compId(this.activeName), active_path: [], components: [node(0, 'Root', null), ...names.filter((n) => n !== 'Root').map((n) => node(this.compId(n), n, 0))], pending_moves: [] };
      }
      case 'component.delete': return { deleted: args.component ?? args.occurrence ?? null };
      case 'sketch.create': {
        const pl = this.sketchPlane(args);
        const sname = String(args.name ?? `Sketch${this.sketches.length + 1}`);
        this.sketch = { name: sname, origin: pl.origin, xdir: pl.x, ydir: pl.y, texts: [] };
        return this.openSketch(this.sketch);
      }
      case 'solid.pattern.circular': return this.circularPattern(args);
      case 'sketch.text': {
        if (!this.sketch) throw new Error('sketch.text: no sketch is open');
        this.sketch.texts.push({ text: String(args.text), height: this.num(args.height ?? 5) });
        return { text: args.text };
      }
      case 'sketch.project': case 'sketch.replace': case 'sketch.line': case 'sketch.arc.three_point': case 'sketch.spline.fit_point': case 'sketch.circle.center': case 'sketch.point': case 'sketch.inspect': case 'sketch.dimension': case 'sketch.constraint.coincident': case 'sketch.constraint.fix':
        return this.sketchCommand(command, args);
      case 'sketch.finish': {
        const sk = this.sketch; this.sketch = null;
        if (!sk) return { stub: true };
        if (this.activeRec && this.activeRec.curves.length + this.activeRec.points.length > 0 && !sk.texts.length) { const r = this.activeRec; this.activeRec = null; return { sketch: r.name, id: r.id, curves: r.curves.length, profiles: r.profiles().length }; }
        this.activeRec = null;
        const board = sk.name.replace(/ label$/, '');
        if (!this.exists(board)) throw new Error(`no body named "${board}"`);
        sk.texts.forEach((t, i) => this.order.push({ kind: 'label', name: i ? `${sk.name} ${i + 1}` : sk.name, board, origin: sk.origin, xdir: sk.xdir, ydir: sk.ydir, text: t.text, height: t.height }));
        return { sketch: sk.name };
      }
      case 'parameters.change': {
        const name = String(args.name), cur = this.params.get(name);
        if (!cur) throw new Error(`no parameter named "${name}"`);
        const value = this.num(args.expression);
        this.params.set(name, { ...cur, expression: String(args.expression), value });
        return { name, value };
      }
      case 'timeline.group': {
        const features: string[] = ((args.features ?? []) as unknown[]).map((f) => (typeof f === 'number' ? this.featureOf(f).name : String(f)));
        for (const f of features) if (!this.feats.some((x) => x.name === f) && !this.patterns.has(f) && !this.axes.has(f) && !this.order.some((b) => b.name === f || ('hole' in b && b.name.startsWith(`${f} `)))) throw new Error(`no feature named "${f}"`);
        this.groups.push({ name: String(args.name), features });
        return { group: args.name, count: features.length };
      }
      case 'component.create': { const n = String(args.name); if (args.activate === false) { this.components.set(n, { from: this.order.length, to: this.order.length }); this.compId(n); return { component: this.compId(n), name: n, parent: 0, occurrence: this.compId(n), grounded: false, stub: true }; } this.components.set(n, { from: this.order.length, to: Infinity }); this.openComponent = n; this.activeName = n; return { component: this.compId(n), name: n, parent: 0, occurrence: this.compId(n), grounded: false, stub: true }; }
      case 'component.activate': { this.activeName = this.compName(args.component); if (this.openComponent) { const c = this.components.get(this.openComponent); if (c && c.to === Infinity) c.to = this.order.length; this.openComponent = null; } return { active: this.compId(this.activeName), stub: true }; }
      case 'joint.as_built': {
        this.joints.push({ ...args, as_built: true });
        return { stub: true, name: args.name ?? args.joint, joint: args.name ?? args.joint };
      }
      case 'joint.limits': {
        const key = String(args.joint ?? args.name ?? '');
        const idx = this.joints.findIndex((j) => String(j.name ?? j.joint ?? '') === key);
        const patch: Record<string, unknown> = {
          ...(args.min !== undefined ? { min: args.min } : {}),
          ...(args.max !== undefined ? { max: args.max } : {}),
          ...(args.rest !== undefined ? { rest: args.rest } : {}),
          ...(args.limits && typeof args.limits === 'object' ? { limits: args.limits } : {}),
        };
        if (idx >= 0) this.joints[idx] = { ...this.joints[idx], ...patch };
        else if (key) this.joints.push({ name: key, ...patch });
        return { stub: true, name: args.name ?? args.joint, joint: args.joint ?? args.name };
      }
      case 'occurrence.move': {
        if (args.to_matrix !== undefined) return this.placeOccurrence(args);
        // a plugin placing a generated component: turn it (about its own origin, which is the document's origin here), then translate it, in world space
        const c = this.components.get(this.occName(args.occurrence).replace(/:\d+$/, ''));
        const extra = Object.keys(args).filter((k) => !['occurrence', 'space', 'translate', 'angle', 'axis'].includes(k));
        if (extra.length) throw new Error(`occurrence.move: ${extra.join(', ')} not supported (only a turn and a translation)`);
        const tr = ((args.translate as unknown[]) ?? [0, 0, 0]).map((v) => this.num(v));
        const angle = args.angle === undefined ? 0 : this.num(args.angle);
        if (!c && tr.some((v) => v !== 0) && !angle) { const n = String(args.occurrence).replace(/:\d+$/, ''); const m = this.movedBy.get(n) ?? [0, 0, 0]; this.movedBy.set(n, m.map((x, i) => x + tr[i])); return { moved: args.occurrence, reverted: false }; }
        if (!c || (tr.every((v) => v === 0) && !angle)) return { moved: args.occurrence, stub: !c };
        const names = this.order.slice(c.from, c.to).flatMap((f) => ('hole' in f ? [] : 'kind' in f ? (((f.kind === 'round' || f.kind === 'extrude' || f.kind === 'sweep' || f.kind === 'sphere') && f.op === 'new') ? [f.body ?? f.name] : []) : (!f.cut && !f.join && !f.inter ? [f.body ?? f.name] : [])));
        if (!names.length) return { moved: args.occurrence, bodies: 0 };
        if (angle) this.runSync('solid.move', { name: `Turn ${args.occurrence}`, bodies: names, origin: [0, 0, 0], axis: args.axis ?? [0, 0, 1], angle });
        return tr.some((v) => v !== 0) ? this.runSync('solid.move', { name: `Place ${args.occurrence}`, bodies: names, translate: tr }) : { moved: names };
      }
      case 'occurrence.copy': {
        const comp = this.compName(args.component ?? this.occs.get(Number(args.occurrence))?.component), c = this.components.get(comp);
        if (!c) throw new Error(`occurrence.copy: no component \`${String(args.component)}\``);
        const index = 1 + [...this.occs.values()].filter((o) => o.component === comp).length + 0;
        const id = 10000 + this.occs.size + 1;
        this.occs.set(id, { component: comp, index: index + 1, parent: Number(args.parent ?? 0) });
        return { occurrence: id, component: this.compId(comp), parent: Number(args.parent ?? 0), name: `${comp}:${index + 1}` };
      }
      case 'occurrence.reparent': {
        const id = Number(this.occName(args.occurrence) && args.occurrence), o = this.occs.get(id);
        if (o) o.parent = Number(args.parent);
        return { occurrence: args.occurrence, parent: args.parent };
      }
      case 'occurrence.ground': return { grounded: args.grounded, stub: true };
      default: throw new Unsupported(`unsupported command: ${command}. CivilKit CAD does not run this SolidCraft command yet`);
    }
  }


  /** The plane of `sketch.create`, as SolidCraft reads `plane` (and the `offset`, `flip` and `frame` beside it), in the plugin's frame (Z up, mm), orthonormal, normal = x cross y.
   *  Named origin planes use SolidCraft's axes: XY/Top (x +X, y +Y, normal +Z), XZ/Front (x +X, y -Z, normal +Y), YZ/Right (x +Y, y +Z, normal +X). Also an explicit
   *  {origin?, x_dir, y_dir} or {origin?, normal} (SolidCraft picks x as the horizontal Z cross n, or +X for a horizontal plane). A construction plane name or a face is not available here. */
  private sketchPlane(args: any): { origin: number[]; x: number[]; y: number[] } {
    const cmd = 'sketch.create', pv = args.plane ?? 'XY';
    const vec = (v: unknown, what: string): number[] => { if (!Array.isArray(v) || v.length !== 3) throw new Error(`${cmd}: ${what} must be three numbers [x, y, z]`); return v.map((c) => this.num(c)); };
    const unit = (v: number[]): number[] | null => { const l = vecLen(v); return l > 1e-12 && Number.isFinite(l) ? v.map((c) => c / l) : null; };
    const cross = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    /** Plane::new: x normalised, normal = x cross y, y = normal cross x */
    const make = (origin: number[], x: number[], y: number[]): { origin: number[]; x: number[]; y: number[] } => {
      const ux = unit(x), n = ux && unit(cross(ux, y)), uy = n && ux && unit(cross(n, ux));
      if (!ux || !n || !uy) throw new Error(`${cmd}: degenerate plane`);
      return { origin, x: ux, y: uy };
    };
    const fromNormal = (origin: number[], nv: number[]): { origin: number[]; x: number[]; y: number[] } => {
      const n = unit(nv); if (!n) throw new Error(`${cmd}: degenerate plane`);
      const cand = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : cross([0, 0, 1], n);
      const x = unit(cand.map((c, i) => c - n[i] * dot(cand, n))); if (!x) throw new Error(`${cmd}: degenerate plane`);
      return make(origin, x, cross(n, x));
    };
    const NAMED: Record<string, [number[], number[]]> = { XY: [[1, 0, 0], [0, 1, 0]], TOP: [[1, 0, 0], [0, 1, 0]], XZ: [[1, 0, 0], [0, 0, -1]], FRONT: [[1, 0, 0], [0, 0, -1]], YZ: [[0, 1, 0], [0, 0, 1]], RIGHT: [[0, 1, 0], [0, 0, 1]] };
    let pl: { origin: number[]; x: number[]; y: number[] };
    if (typeof pv === 'string' && NAMED[pv.trim().toUpperCase()]) { const [x, y] = NAMED[pv.trim().toUpperCase()]; pl = { origin: [0, 0, 0], x, y }; }
    else if (this.planes.has(String(pv))) { const q = this.planes.get(String(pv))!; pl = { origin: q.origin, x: q.x, y: q.y }; }
    else if (typeof pv === 'string' || typeof pv === 'number') throw new Unsupported(`${cmd}: the plane "${pv}" is a construction plane, which this app does not run yet (XY, XZ, YZ and explicit planes are)`);
    else if (pv && typeof pv === 'object' && !Array.isArray(pv)) {
      if ('face' in pv) throw new Unsupported(`${cmd}: a sketch on a face is not supported from a plugin yet`);
      const origin = pv.origin === undefined || pv.origin === null ? [0, 0, 0] : vec(pv.origin, 'plane origin');
      if (pv.x_dir !== undefined && pv.y_dir !== undefined) pl = make(origin, vec(pv.x_dir, 'x_dir'), vec(pv.y_dir, 'y_dir'));
      else if (pv.normal !== undefined) pl = fromNormal(origin, vec(pv.normal, 'normal'));
      else throw new Error(`${cmd}: a plane object needs x_dir and y_dir, or normal`);
    } else throw new Error(`${cmd}: plane must be XY, XZ, YZ, a construction plane name or id, or an object`);
    // offset moves the plane along its (unflipped) normal; flip then turns it half a turn about its own x (true: about y when its y points up, so it stays up) or y axis
    if (args.offset !== undefined && args.offset !== null) { const d = this.num(args.offset), n = cross(pl.x, pl.y); pl = { ...pl, origin: pl.origin.map((c, i) => c + n[i] * d) }; }
    if (args.flip !== undefined && args.flip !== null && args.flip !== false) {
      const f = args.flip, aboutY = f === true ? pl.y[2] > 1e-9 : String(f).toLowerCase() === 'y';
      if (f !== true && !/^[xy]$/i.test(String(f))) throw new Error(`${cmd}: flip must be true, false, "x" or "y"`);
      pl = aboutY ? { ...pl, x: pl.x.map((c) => -c) } : { ...pl, y: pl.y.map((c) => -c) };
    }
    return pl;
  }


  /** SolidCraft's default scope for a join, cut or intersect with no `targets`: every body of the component (this run's, then the open document's) */
  private allBodies(op?: string): string[] {
    const made = this.order.flatMap((o) => ('cut' in o && !o.cut && !o.join && !o.inter ? [o.body ?? o.name] : 'kind' in o && (o.kind === 'round' || o.kind === 'extrude') && o.op === 'new' ? [o.body ?? o.name] : []));
    // a join or intersect with no targets works on what this run made: it must not merge the document's own bodies into the new part (they are the fallback only when the run made none)
    if ((op === 'join' || op === 'intersect') && made.length) return [...new Set(made)];
    return [...new Set([...made, ...(this.opts.doc?.bodies ?? []).map((b) => b.name)])];
  }

  /** `solid.pattern.circular` of extrusions made earlier in this run, about the axis X, Y or Z through the origin (or {origin, dir}): `count` copies including the original, over `angle` (default 360, a partial arc includes both ends). Each copy turns the seed's sketch plane. */
  private circularPattern(args: any): unknown {
    const names = (args.features as string[] | undefined) ?? [];
    if (!names.length || args.bodies || args.components) throw new Unsupported('solid.pattern.circular: only features made earlier in this run can be repeated yet');
    const seeds = names.map((f) => this.order.find((o): o is Extrude => 'kind' in o && o.kind === 'extrude' && o.name === f));
    if (seeds.some((q) => !q)) throw new Unsupported('solid.pattern.circular: it can only repeat an extrusion made earlier in this run');
    const A = args.axis;
    let o3 = [0, 0, 0], d3: number[];
    if (typeof A === 'string' && /^[xyz]$/i.test(A.trim())) d3 = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[A.trim().toLowerCase() as 'x']!;
    else if (A && typeof A === 'object' && !Array.isArray(A) && Array.isArray(A.dir)) { d3 = A.dir.map((c: unknown) => this.num(c)); if (Array.isArray(A.origin)) o3 = A.origin.map((c: unknown) => this.num(c)); }
    else throw new Unsupported('solid.pattern.circular: the axis is X, Y, Z or {origin, dir}');
    const n = Math.round(this.num(args.count));
    if (!(n >= 1)) throw new Error('solid.pattern.circular needs a count of at least 1');
    const total = args.angle === undefined ? 360 : this.num(args.angle);
    const step = Math.abs(total) >= 360 - 1e-9 ? total / n : n > 1 ? total / (n - 1) : 0;
    const k = unitVec(d3);
    const turn = (v: number[], deg: number, about: number[]): number[] => {   // Rodrigues, about a point
      const t = deg * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t), r = v.map((x, i) => x - about[i]);
      const kxr = [k[1] * r[2] - k[2] * r[1], k[2] * r[0] - k[0] * r[2], k[0] * r[1] - k[1] * r[0]], kr = k[0] * r[0] + k[1] * r[1] + k[2] * r[2];
      return r.map((x, i) => x * c + kxr[i] * sn + k[i] * kr * (1 - c) + about[i]);
    };
    let made = 0;
    for (const seed of seeds as Extrude[]) for (let i = 1; i < n; i++) {
      const deg = step * i, sk = seed.sketch;
      const copy = sk.clone(`${sk.name} ${i + 1}`, this.newFeature(`${sk.name} ${i + 1}`, 'sketch'), turn(sk.origin, deg, o3), turn(sk.xdir, deg, [0, 0, 0]), turn(sk.ydir, deg, [0, 0, 0]));
      this.order.push({ ...seed, name: `${seed.name} ${i + 1}`, sketch: copy, ...(seed.body ? { body: `${seed.body} ${i + 1}` } : {}) });
      made++;
    }
    this.patterns.add(String(args.name ?? `Pattern ${names[0]}`));
    return { feature: args.name ?? null, copies: made };
  }

  /** The recorded list as our script text (the same API run_script takes). */
  /** document frame for the current script() call: plugins are written Z-up; for a Y-up document (the app's default) every point turns (x, y, z) -> (x, z, -y), so the cabinet stands upright and Z of Position means up in the plugin's terms */
  private frame: { up: 'y' | 'z'; offset: number[] } = { up: 'z', offset: [0, 0, 0] };
  private pt(p: number[]): number[] { const q = this.frame.up === 'y' ? [p[0], p[2], -p[1]] : p; return q.map((v, i) => v + this.frame.offset[i]); }
  private dirOf(d: number[]): number[] { return this.frame.up === 'y' ? [d[0], d[2], -d[1]] : d; }

  /** Normalized joint/motion metadata declared by this plugin run, transformed into document coordinates. */
  jointHints(o: { up?: 'y' | 'z'; offset?: number[] } = {}): PluginJointHint[] {
    if (!this.joints.length) return [];
    const prev = this.frame;
    this.frame = { up: o.up ?? 'z', offset: o.offset ?? [0, 0, 0] };
    const createdBodies = this.order.flatMap((f) => ('hole' in f ? [] : 'kind' in f ? (((f.kind === 'round' || f.kind === 'extrude' || f.kind === 'sweep' || f.kind === 'sphere') && f.op === 'new') ? [f.body ?? f.name] : []) : (!f.cut && !f.join && !f.inter ? [f.body ?? f.name] : [])));
    const bodiesOfComponent = (occ: string): string[] => {
      const compName = occ.replace(/:\d+$/, '');
      const c = this.components.get(compName);
      if (c) return this.order.slice(c.from, c.to).flatMap((f) => ('hole' in f ? [] : 'kind' in f ? (((f.kind === 'round' || f.kind === 'extrude' || f.kind === 'sweep' || f.kind === 'sphere') && f.op === 'new') ? [f.body ?? f.name] : []) : (!f.cut && !f.join && !f.inter ? [f.body ?? f.name] : [])));
      return createdBodies.filter((b) => b === compName || b.startsWith(`${compName} `));
    };
    const out: PluginJointHint[] = [];
    for (let i = 0; i < this.joints.length; i++) {
      const j = this.joints[i];
      const name = String(j.name ?? j.joint ?? `Joint ${i + 1}`);
      const rawKind = String(j.type ?? j.kind ?? j.motion_type ?? 'rigid').toLowerCase();
      const kind: PluginJointHint['kind'] = rawKind === 'revolute' || rawKind === 'hinge' || rawKind === 'rotary' ? 'revolute'
        : rawKind === 'slider' || rawKind === 'prismatic' || rawKind === 'linear' || rawKind === 'drawer' ? 'prismatic'
        : 'rigid';
      const comp = typeof j.component === 'string' ? j.component : typeof j.occurrence === 'string' ? j.occurrence : typeof j.occurrence1 === 'string' ? j.occurrence1 : undefined;
      const explicitBodies = Array.isArray(j.bodies) ? (j.bodies as unknown[]).map(String).filter(Boolean)
        : typeof j.body === 'string' && j.body ? [j.body] : [];
      const bodies = explicitBodies.length ? explicitBodies : (comp ? bodiesOfComponent(comp) : []);
      const rawOrigin = Array.isArray(j.origin) && j.origin.length >= 3 ? (j.origin as unknown[]).slice(0, 3).map((v) => this.num(v)) : [0, 0, 0];
      const rawAxis = Array.isArray(j.axis) && j.axis.length >= 3 ? (j.axis as unknown[]).slice(0, 3).map(Number) : (kind === 'prismatic' ? [0, -1, 0] : [0, 0, 1]);
      const origin = this.pt(rawOrigin).map(roundNum) as [number, number, number];
      const axis = unitVec(this.dirOf(rawAxis)).map(roundNum) as [number, number, number];
      const lim = j.limits && typeof j.limits === 'object' ? (j.limits as Record<string, unknown>) : undefined;
      const minRaw = j.min ?? lim?.min;
      const maxRaw = j.max ?? lim?.max;
      const min = minRaw !== undefined ? this.num(minRaw) : 0;
      const max = maxRaw !== undefined ? this.num(maxRaw) : (kind === 'revolute' ? 110 : kind === 'prismatic' ? 300 : 0);
      const rest = j.rest !== undefined ? this.num(j.rest) : undefined;
      out.push({ name, kind, bodies, origin, axis, min, max, ...(rest !== undefined ? { rest } : {}), ...(comp ? { component: comp.replace(/:\d+$/, '') } : {}) });
    }
    this.frame = prev;
    return out;
  }

  script(o: { part?: string; up?: 'y' | 'z'; offset?: number[]; /** the app's own colour or PBR look for a board material name (its material library), or undefined to use the plugin's look */ look?: (material: string) => string | Partial<MaterialLook> | undefined } = {}): string {
    this.frame = { up: o.up ?? 'z', offset: o.offset ?? [0, 0, 0] };
    const L: string[] = [];
    const names = new Set(this.params.keys());
    const defs = [...this.params.values()].map((p) => `${JSON.stringify(p.name)}: ${JSON.stringify(kernelExpr(p.expression, names) ?? String(p.value))}`);
    if (defs.length) L.push(`variables({ ${defs.join(', ')} });`);
    L.push(`const p = part(${JSON.stringify(o.part ?? 'Plugin')});`, ...(this.frame.up === 'z' ? [`p.upAxis('z');   // SolidCraft is Z-up: keep its numbers, the app opens the part Z-up (document field upAxis, a view hint)`] : []));
    L.push('const H = {};');
    const groupOf = new Map<string, string>();
    for (const g of this.groups) for (const f of g.features) { groupOf.set(f, g.name); for (const o of this.order) if ('hole' in o && o.name.startsWith(`${f} `)) groupOf.set(o.name, g.name); }
    const emit = (b: Box | Hole | Round | Combine | Move | Chamfer | Label | Extrude | Sweep | Sphere): string => {
      if ('hole' in b) return this.emitHole(b);
      if ('kind' in b) return b.kind === 'sphere' ? this.emitSphere(b) : b.kind === 'extrude' ? this.emitExtrude(b) : b.kind === 'sweep' ? this.emitSweep(b) : b.kind === 'round' ? this.emitRound(b) : b.kind === 'combine' ? this.emitCombine(b) : b.kind === 'chamfer' ? this.emitChamfer(b) : b.kind === 'label' ? this.emitLabel(b) : this.emitMove(b);
      const a = this.pt(b.corner), c = this.pt(b.corner.map((v, i) => v + b.size[i]));
      const [x, y, z] = [0, 1, 2].map((i) => Math.min(a[i], c[i])), [l, w, h] = [0, 1, 2].map((i) => Math.abs(c[i] - a[i]));
      const sk = `p.sketch(at('front', ${z}), (s) => s.rect(${l}, ${w}, [${x + l / 2}, ${y + w / 2}]))`;
      const nm = JSON.stringify(b.name);
      // a join: the box is made as its own body, then united with the target (the part's own extrude would unite with whatever it touches)
      if (b.join || b.inter) { const tmp = JSON.stringify(`${b.name} (${b.join ? 'join' : 'intersect'})`); return `${sk}.extrude(${h}, { name: ${nm}, newBody: ${tmp} });\n  ${this.joinTail(b.join ? 'join' : 'intersect', b.targets, tmp)}`; }
      // SolidCraft's `targets` is "subtract this volume from each of these bodies". Our `from: [a, b]` MERGES the targets into one body
      // (kernel finding, see the report), so a cut is one `from: [single]` cut per target.
      return b.cut
        ? b.targets.map((t) => `${sk}.cut(${h}, { name: ${JSON.stringify(`${b.name} @ ${t}`)}, from: [${JSON.stringify(t)}], direction: 'away' });`).join('\n  ')
        : `${sk}.extrude(${h}, { name: ${nm}, newBody: ${JSON.stringify(b.body ?? b.name)} }); H[${JSON.stringify(b.body ?? b.name)}] = p.handle();`;
    };
    // consecutive items of one history folder go inside one p.group(...)
    const late = this.order.filter((o): o is Move => 'kind' in o && o.kind === 'move' && !!o.late);
    for (let i = 0; i < this.order.length;) {
      if ('kind' in this.order[i] && (this.order[i] as Move).late) { i++; continue; }
      const g = groupOf.get(this.order[i].name);
      let j = i; while (j < this.order.length && groupOf.get(this.order[j].name) === g && !('kind' in this.order[j] && (this.order[j] as Move).late)) j++;
      const body = this.order.slice(i, j).map(emit).join('\n  ');
      L.push(g ? `p.group(${JSON.stringify(g)}, () => {\n  ${body}\n});` : body);
      i = j;
    }
    for (const m of [...late.filter((x) => x.copies), ...late.filter((x) => !x.copies)]) L.push(this.emitMove(m));
    // materials become each body's appearance (colour, finish, metallic, roughness, opacity, clearcoat)
    const fmtAppearance = (target: string, look: MaterialLook, comment = ''): string => {
      const fields = [`feature: ${target}`, `colour: ${JSON.stringify(look.colour)}`];
      if (look.finish) fields.push(`finish: ${JSON.stringify(look.finish)}`);
      if (look.metalness !== undefined) fields.push(`metallic: ${roundNum(look.metalness)}`);
      if (look.roughness !== undefined) fields.push(`roughness: ${roundNum(look.roughness)}`);
      if (look.opacity !== undefined && look.opacity < 1) fields.push(`opacity: ${roundNum(look.opacity)}`);
      if (look.clearcoat !== undefined && look.clearcoat > 0) fields.push(`clearcoat: ${roundNum(look.clearcoat)}`);
      return `p.appearance({ ${fields.join(', ')} });${comment}`;
    };
    for (const [body, mat] of this.assigned) {
      const def = this.materials.get(mat);
      const preset = lookOf(mat, def);
      const lib = o.look?.(mat);
      const libLook: Partial<MaterialLook> = typeof lib === 'string' ? { colour: lib } : (lib ?? {});
      const look: MaterialLook = {
        ...preset,
        ...libLook,
        ...(def?.colour ? { colour: def.colour } : {}),
        ...(def?.finish ? { finish: def.finish } : {}),
        ...(def?.metalness !== undefined ? { metalness: def.metalness } : {}),
        ...(def?.roughness !== undefined ? { roughness: def.roughness } : {}),
        ...(def?.opacity !== undefined ? { opacity: def.opacity } : {}),
        ...(def?.clearcoat !== undefined ? { clearcoat: def.clearcoat } : {}),
      };
      const madeHere = this.order.some((it) => ('cut' in it && !it.cut && !it.join && !it.inter && (it.body ?? it.name) === body) || ('kind' in it && ((it.kind === 'round' || it.kind === 'extrude' || it.kind === 'sweep') && it.op === 'new') && (it.body ?? it.name) === body));
      if (madeHere) L.push(fmtAppearance(`H[${JSON.stringify(body)}]`, look));
      else if (this.docBody(body)?.feature) L.push(fmtAppearance(JSON.stringify(this.docBody(body)!.feature), look, '   // a body of the open document'));
    }
    return L.join('\n');
  }

  /** The frame of an axis-aligned round solid: the sketch plane perpendicular to the axis (document frame) and the u, v of a point on it. */
  private roundFrame(base: number[], axis: number[]): { plane: string; off: number; uv: number[]; sign: number } {
    const [x, y, z] = this.pt(base), dir3 = this.dirOf(axis), a = dir3.findIndex((v) => Math.abs(v) > 1e-12), sign = Math.sign(dir3[a]);
    return { plane: ['right', 'top', 'front'][a], off: [x, y, z][a], uv: [[-z, y], [x, -z], [x, y]][a], sign };
  }
  /** A cylinder is a circle extruded along the axis; a cone is a loft between two circles. Supports both axis-aligned and arbitrary 3D axis vectors. */
  private emitRound(r: Round): string {
    const dir3 = this.dirOf(r.axis);
    const axisAligned = dir3.filter((v) => Math.abs(v) > 1e-12).length === 1;
    const nm = JSON.stringify(r.name);
    const tmp = r.op === 'join' || r.op === 'intersect' ? `${r.name} (${r.op})` : r.body ?? r.name;
    if (axisAligned) {
      const f = this.roundFrame(r.base, r.axis);
      const cutOf = (t: string): string => r.top === undefined
        ? `p.sketch(at(${JSON.stringify(f.plane)}, ${f.off}), (s) => s.circle(${r.d / 2}, [${f.uv[0]}, ${f.uv[1]}])).cut(${r.height}, { name: ${JSON.stringify(`${r.name} @ ${t}`)}, from: [${JSON.stringify(t)}], direction: '${f.sign > 0 ? 'away' : 'into'}' });`
        : `p.loft(${this.sections(r, f)}, { op: 'cut', name: ${JSON.stringify(`${r.name} @ ${t}`)}, from: [${JSON.stringify(t)}] });`;
      if (r.op === 'cut') return r.targets.map(cutOf).join('\n  ');
      const make = r.top === undefined
        ? `p.sketch(at(${JSON.stringify(f.plane)}, ${f.off}), (s) => s.circle(${r.d / 2}, [${f.uv[0]}, ${f.uv[1]}])).extrude(${r.height}, { name: ${nm}, newBody: ${JSON.stringify(tmp)}${f.sign < 0 ? ', flip: true' : ''} });`
        : `p.loft(${this.sections(r, f)}, { name: ${nm}, newBody: ${JSON.stringify(tmp)}, ends: { first: 'cap', last: ${r.top === 0 ? "'point'" : "'cap'"} } });`;
      return r.op === 'join' || r.op === 'intersect' ? `${make}\n  ${this.joinTail(r.op, r.targets, JSON.stringify(tmp))}` : `${make} H[${JSON.stringify(tmp)}] = p.handle();`;
    }
    // Arbitrary 3D axis vector: build an explicit plane frame (origin, unit normal, orthogonal xdir)
    const o = this.pt(r.base).map(roundNum);
    const n = unitVec(dir3).map(roundNum) as [number, number, number];
    const u = orthoX(n).map(roundNum) as [number, number, number];
    const basePlane = `at({ origin: [${o}], normal: [${n}], xdir: [${u}] })`;
    const arbSections = (): string => {
      const o2 = [o[0] + n[0] * r.height, o[1] + n[1] * r.height, o[2] + n[2] * r.height].map(roundNum);
      const topPlane = `at({ origin: [${o2}], normal: [${n}], xdir: [${u}] })`;
      const topD = r.top === 0 ? r.d * 1e-3 : r.top!;
      return `[{ on: ${basePlane}, draw: (s) => s.circle(${r.d / 2}, [0, 0]) }, { on: ${topPlane}, draw: (s) => s.circle(${topD / 2}, [0, 0]) }]`;
    };
    const cutOf = (t: string): string => r.top === undefined
      ? `p.sketch(${basePlane}, (s) => s.circle(${r.d / 2}, [0, 0])).cut(${r.height}, { name: ${JSON.stringify(`${r.name} @ ${t}`)}, from: [${JSON.stringify(t)}], direction: 'away' });`
      : `p.loft(${arbSections()}, { op: 'cut', name: ${JSON.stringify(`${r.name} @ ${t}`)}, from: [${JSON.stringify(t)}] });`;
    if (r.op === 'cut') return r.targets.map(cutOf).join('\n  ');
    const make = r.top === undefined
      ? `p.sketch(${basePlane}, (s) => s.circle(${r.d / 2}, [0, 0])).extrude(${r.height}, { name: ${nm}, newBody: ${JSON.stringify(tmp)} });`
      : `p.loft(${arbSections()}, { name: ${nm}, newBody: ${JSON.stringify(tmp)}, ends: { first: 'cap', last: ${r.top === 0 ? "'point'" : "'cap'"} } });`;
    return r.op === 'join' || r.op === 'intersect' ? `${make}\n  ${this.joinTail(r.op, r.targets, JSON.stringify(tmp))}` : `${make} H[${JSON.stringify(tmp)}] = p.handle();`;
  }
  private sections(r: Round, f: { plane: string; off: number; uv: number[]; sign: number }): string {
    const sec = (off: number, d: number): string => `{ on: at(${JSON.stringify(f.plane)}, ${off}), draw: (s) => s.circle(${d / 2}, [${f.uv[0]}, ${f.uv[1]}]) }`;
    return `[${sec(f.off, r.d)}, ${sec(f.off + f.sign * r.height, r.top === 0 ? r.d * 1e-3 : r.top!)}]`;
  }
  /** the plane of a recorded sketch in the script's frame */
  private planeOf(sk: SketchRec): string {
    const x = sk.xdir, y = sk.ydir, n = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    return `at({ origin: [${this.pt(sk.origin).map(roundNum)}], normal: [${unitVec(this.dirOf(n)).map(roundNum)}], xdir: [${unitVec(this.dirOf(x)).map(roundNum)}] })`;
  }
  /** an extrusion: the sketch's profiles pushed along the plane's normal (positive), against it (negative) or both ways (symmetric); a cut is one cut per target */
  private emitExtrude(x: Extrude): string {
    const sk = `p.sketch(${this.planeOf(x.sketch)}, (s) => { ${x.sketch.draw(x.only)} })`, nm = JSON.stringify(x.name);
    const tmp = x.op === 'join' || x.op === 'intersect' ? `${x.name} (${x.op})` : x.body ?? x.name;
    if (x.op === 'cut') return x.targets.map((t) => `${sk}.cut(${x.distance}, { name: ${JSON.stringify(`${x.name} @ ${t}`)}, from: [${JSON.stringify(t)}], ${x.dir === 'symmetric' ? 'mid: true' : `direction: '${x.dir === 'positive' ? 'away' : 'into'}'`} });`).join('\n  ');
    const flags = x.dir === 'negative' ? ', flip: true' : x.dir === 'symmetric' ? ', mid: true' : '';
    const make = `${sk}.extrude(${x.distance}, { name: ${nm}, newBody: ${JSON.stringify(tmp)}${flags} });`;
    return x.op === 'new' ? `${make} H[${JSON.stringify(tmp)}] = p.handle();` : `${make}\n  ${this.joinTail(x.op, x.targets, JSON.stringify(tmp))}`;
  }
  /** a ball: its own body, united with, cut from or intersected with the target (a cut is one per target) */
  private emitSphere(b: Sphere): string {
    const c = this.pt(b.center), tmp = b.op === 'new' ? (b.body ?? b.name) : `${b.name} (${b.op})`;
    const make = `p.sphere(${b.r}, { centre: [${c}], newBody: ${JSON.stringify(tmp)}, name: ${JSON.stringify(b.name)} });`;
    if (b.op === 'new') return `${make} H[${JSON.stringify(tmp)}] = p.handle();`;
    if (b.op === 'cut') return `${make}\n  ` + b.targets.map((t, i) => `p.combine('cut', ${JSON.stringify(t)}, [${JSON.stringify(tmp)}]${i < b.targets.length - 1 ? ', { keepTools: true }' : ''});`).join('\n  ');
    return `${make}\n  ${this.joinTail(b.op, b.targets, JSON.stringify(tmp))}`;
  }
  /** the combine that finishes a join or intersect whose tool body is `tmp` (already JSON-quoted). Several targets: a join merges them all into the first target's body; an intersect trims each target to the tool, one by one */
  private joinTail(op: 'join' | 'intersect' | string, targets: string[], tmp: string): string {
    const q = (t: string) => JSON.stringify(t);
    if (op === 'join') return `p.combine('union', ${q(targets[0])}, [${[tmp, ...targets.slice(1).map(q)].join(', ')}]);`;
    return targets.map((t, i) => `p.combine('intersect', ${q(t)}, [${tmp}]${i < targets.length - 1 ? ', { keepTools: true }' : ''});`).join('\n  ');
  }
  private emitSweep(_w: Sweep): string { throw new Error('solid.sweep is not built yet'); }
  private emitCombine(c: Combine): string { return `p.combine('${c.op === 'join' ? 'union' : c.op}', ${JSON.stringify(c.target)}, ${JSON.stringify(c.tools)}${c.keep ? ', { keepTools: true }' : ''});`; }
  private emitLabel(l: Label): string {
    const [x, y] = [l.xdir, l.ydir], n = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    return `p.workplane({ origin: [${this.pt(l.origin)}], normal: [${this.dirOf(n)}], xdir: [${this.dirOf(x)}] }, 0, { name: ${JSON.stringify(`${l.name} plane`)} });\n  p.sketch(at(p.handle()), (s) => s.text(${JSON.stringify(l.text)}, [0, 0], { height: ${l.height}, anchor: ['center', 'middle'] })).cut(0.3, { name: ${JSON.stringify(l.name)}, from: [${JSON.stringify(l.board)}], direction: 'into' });`;
  }
  private emitChamfer(c: Chamfer): string {
    return c.near.map((n, i) => `p.chamfer(edges({ near: [${this.pt(n)}], within: 1 }), { name: ${JSON.stringify(c.near.length > 1 ? `${c.name} ${i + 1}` : c.name)}, distance: ${c.distance} });`).join('\n  ');
  }
  private emitMove(m: Move): string {
    const o: string[] = [];
    if (m.rotate) o.push(`rotate: { axis: [${this.dirOf(m.rotate.axis)}], origin: [${this.pt(m.rotate.origin)}], angle: ${m.rotate.angle} }`);
    if (m.translate) o.push(`translate: [${this.dirOf(m.translate)}]`);
    if (m.copies) return m.copies.map((c) => `p.moveBody(${JSON.stringify(c.from)}, { ${o.join(', ')}, copy: true, body: ${JSON.stringify(c.to)} });`).join('\n');
    return m.bodies.length ? `p.moveBody(${JSON.stringify(m.bodies)}, { ${o.join(', ')} });` : '';
  }

  /** `selection.get`: the picked bodies, faces and edges of the open document (what the plugin edits). `detail` adds a face's plane normal, in the plugin's frame. */
  private selection(args: { detail?: boolean }): unknown {
    const items = (this.opts.doc?.selection ?? []).map((i) => {
      const o: Record<string, unknown> = { type: i.type, ...(i.name !== undefined ? { name: i.name } : {}), ...(i.body !== undefined ? { body: i.body } : {}) };
      if (args?.detail && i.normal) o.surface = { normal: this.dirFromDoc(i.normal) };
      return o;
    });
    // what is picked in the open sketch, as SolidCraft words it: sketch_curve (the curve's id in sketch.inspect) and point (its id there), each with the sketch's id
    const h = this.hostRec, pk = this.opts.openSketch?.picked;
    if (h && pk) {
      for (const i of pk.curves) { const c = h.curves[i]; if (c) items.push({ type: 'sketch_curve', id: c.id, sketch: h.id }); }
      for (const q of pk.points) { const p = h.points.find((x) => Math.hypot(x.at[0] - q[0], x.at[1] - q[1]) <= 1e-7); if (p) items.push({ type: 'point', id: p.id, sketch: h.id, position: [...p.at] }); }
    }
    return { items };
  }
  /** `model.mesh`: the triangles of bodies of the open document, in the plugin's frame (Z up), millimetres. `bodies` (names) or `body` (one name) picks them, all of them when
   *  neither is given. Per body: `positions` (the welded vertices, each `[x, y, z]`: the form the Woodwork cut list reads), `indices` (flat, three per triangle) and `triangle_face` (per triangle,
   *  the index of its face in the body's face list, the same `index` a face selection carries). A request with `body` (one name) is answered with that body's fields at the top level next to
   *  `units` (what Woodwork's `{ body, tolerance }` call reads); `bodies` or no selector gives `{ units, bodies: [...] }`. `tolerance` is accepted and ignored: the mesh is the display tessellation. An unknown name is an error. Bodies this run has made or changed are not in the open document yet, so they are refused. */
  private modelMesh(args: { bodies?: string[]; body?: string } | undefined): unknown {
    const doc = this.opts.doc, src = doc?.meshes;
    const want = args?.bodies ?? (args?.body !== undefined ? [args.body] : undefined);
    if (want !== undefined && (!Array.isArray(want) || want.some((n) => typeof n !== 'string'))) throw new Error('model.mesh: bodies must be a list of body names');
    const names = want ?? (doc?.bodies ?? []).map((b) => b.name);
    for (const n of names) if (!this.docBody(n)) throw new Error(`model.mesh: no body named "${n}" in the open document`);
    if (this.order.length && names.length) throw new Error('model.mesh reads the open document; this run has already changed the model, so ask for the mesh before editing');
    const m = src?.mesh;
    const toPlugin = (x: number, y: number, z: number): number[] => (this.opts.up ?? doc?.up) === 'y' ? [x, 0 - z, y] : [x, y, z];
    const triOf = new Map<string, number[]>();   // face name -> its triangles
    if (m) for (let t = 0; t < m.triFace.length; t++) { const f = m.faceIds[m.triFace[t]]; let a = triOf.get(f); if (!a) triOf.set(f, a = []); a.push(t); }
    let total = 0;
    const bodies = names.map((name) => {
      const faces = src?.faces[name] ?? [];
      const verts = new Map<string, number>(), positions: number[][] = [], indices: number[] = [], triangleFace: number[] = [];
      faces.forEach((f, fi) => {
        for (const t of triOf.get(f) ?? []) {
          if (++total > MESH_MAX_TRIANGLES) throw new Error(`model.mesh: more than ${MESH_MAX_TRIANGLES} triangles asked for in one call; ask for fewer bodies at a time`);
          for (let v = 0; v < 3; v++) {
            const o = t * 9 + v * 3, p = toPlugin(m!.positions[o], m!.positions[o + 1], m!.positions[o + 2]).map((c) => Math.round(c * 1e4) / 1e4 + 0);
            const key = `${p[0]},${p[1]},${p[2]}`;
            let id = verts.get(key);
            if (id === undefined) { id = positions.length; verts.set(key, id); positions.push(p); }
            indices.push(id);
          }
          triangleFace.push(fi);
        }
      });
      return { name, vertex_count: positions.length, triangle_count: indices.length / 3, positions, indices, triangle_face: triangleFace };
    });
    return args?.body !== undefined && args.bodies === undefined ? { units: 'mm', ...bodies[0] } : { units: 'mm', bodies };
  }
  /** The body a `model.faces` / `model.edges` call names, checked the way `model.mesh` checks: it must be in the open document and this run must not have changed the model yet. */
  private readBody(cmd: string, args: { body?: string } | undefined): string {
    const name = args?.body;
    if (typeof name !== 'string') throw new Error(`${cmd}: body must be a body name`);
    if (!this.docBody(name)) throw new Error(`${cmd}: no body named "${name}" in the open document`);
    if (this.order.length) throw new Error(`${cmd} reads the open document; this run has already changed the model, so ask before editing`);
    return name;
  }
  private toPluginFrame(p: number[]): number[] { return (this.opts.up ?? this.opts.doc?.up) === 'y' ? [p[0], 0 - p[2], p[1]] : [p[0], p[1], p[2]]; }
  /** `model.faces`: one entry per face of a body, in the body's own order (`index` is the one a face selection carries): its selection `name` (what face.delete, solid.shell and the like take in place of a point),
   *  `exact` (a plane or cylinder recognised from the tessellation), `area` (mm2), `centroid` (not always on the face), `plane_normal` (planes), `point` (lies on the face: picks it) and `cylinder` { origin, axis, radius }
   *  for a cylindrical face. Answered as `{ units, body, faces }`. */
  private modelFaces(args: { body?: string } | undefined): unknown {
    const body = this.readBody('model.faces', args), src = this.opts.doc?.meshes, m = src?.mesh;
    const names = src?.faces[body] ?? [];
    const triOf = new Map<string, number[]>();
    if (m) for (let t = 0; t < m.triFace.length; t++) { const f = m.faceIds[m.triFace[t]]; let a = triOf.get(f); if (!a) triOf.set(f, a = []); a.push(t); }
    const faces = names.map((name, index) => {
      const tris = triOf.get(name) ?? [], flat: number[] = [];
      for (const t of tris) for (let v = 0; v < 3; v++) { const o = t * 9 + v * 3; flat.push(...this.toPluginFrame([m!.positions[o], m!.positions[o + 1], m!.positions[o + 2]])); }
      const f = faceInfo(flat, tris.length);
      return f ? { index, name, exact: f.exact, area: f.area, centroid: f.centroid, ...(f.plane_normal ? { plane_normal: f.plane_normal } : {}), point: f.point, ...(f.cylinder ? { cylinder: f.cylinder } : {}) } : { index, name, exact: false };
    });
    return { units: 'mm', body, faces };
  }
  /** `model.edges`: one entry per edge of a body, in the body's own order: `index`, `name`, `point` (on the edge: the middle of it), `length`, `curve` ("line", "circle" or "curve") and, for a circle,
   *  `centre`, `axis` and `radius`. Answered as `{ units, body, edges }`. */
  private modelEdges(args: { body?: string } | undefined): unknown {
    const body = this.readBody('model.edges', args);
    const edges = (this.opts.doc?.edges?.[body] ?? []).map((e, index) => {
      const i = edgeInfo(e.pts.map((p) => this.toPluginFrame(p)));
      return i ? { index, name: e.name, ...i } : { index, name: e.name };
    });
    return { units: 'mm', body, edges };
  }
  private dirFromDoc(d: number[]): number[] { return (this.opts.up ?? this.opts.doc?.up) === 'y' ? [d[0], 0 - d[2], d[1]] : d; }

  /** A hole is a circle sketched on the plane the drill enters from, cut `depth` along the drill direction, one cut per target body. Supports arbitrary 3D drill directions. */
  private emitHole(h: Hole): string {
    if (h.noop) return '';
    const dir3 = this.dirOf(h.dir);
    if (dir3.filter((v) => Math.abs(v) > 1e-12).length === 1) {
      const [x, y, z] = this.pt(h.pos), axis = dir3.findIndex((v) => Math.abs(v) > 1e-12), sign = Math.sign(dir3[axis]);
      // frames from docs/scripting.md: front (x,y | +Z), top (x,-z | +Y), right (-z,y | +X); a cut goes against the normal unless direction is 'away'
      const plane = ['right', 'top', 'front'][axis];
      const off = [x, y, z][axis];
      const uv = [[-z, y], [x, -z], [x, y]][axis];
      const dir = sign > 0 ? 'away' : 'into';
      return h.targets.map((t) => `p.sketch(at(${JSON.stringify(plane)}, ${off}), (s) => s.circle(${h.d / 2}, [${uv[0]}, ${uv[1]}])).cut(${h.depth}, { name: ${JSON.stringify(`${h.name} @ ${t}`)}, from: [${JSON.stringify(t)}], direction: '${dir}' });`).join('\n  ');
    }
    const o = this.pt(h.pos).map(roundNum);
    const n = unitVec(dir3).map(roundNum) as [number, number, number];
    const u = orthoX(n).map(roundNum) as [number, number, number];
    const plane = `at({ origin: [${o}], normal: [${n}], xdir: [${u}] })`;
    return h.targets.map((t) => `p.sketch(${plane}, (s) => s.circle(${h.d / 2}, [0, 0])).cut(${h.depth}, { name: ${JSON.stringify(`${h.name} @ ${t}`)}, from: [${JSON.stringify(t)}], direction: 'away' });`).join('\n  ');
  }

  /** The only write to the open document: the recorded list as one script run (one undo step). */
  async commit(open: Target): Promise<{ created: number }> { return open.commit(this.script()); }

  private async inspect(): Promise<unknown> {
    // `parameters` is the keyed form; `params` is the list the Woodwork plugin reads ({ name, expression, value, comment }): it finds a cabinet's sizes and a free name there
    const mine = [...this.params.values()];
    const all = [...(this.opts.doc?.parameters ?? []).filter((d) => !this.params.has(d.name)), ...mine];
    const entry = (p: { expression?: string; value: number; comment?: string }) => ({ expression: p.expression, value: p.value, ...(p.comment ? { comment: p.comment } : {}) });
    return { units: 'mm', parameters: Object.fromEntries(all.map((p) => [p.name, entry(p)])), params: all.map((p) => ({ name: p.name, ...entry(p) })), name: 'Part', metadata: Object.fromEntries(this.docMeta), path: null, dirty: false, revision: 0, active_sketch: null, marker: this.groups.length, undo: 0, redo: 0, bodies: false,
      // the rows SolidCraft's own document.inspect gives for its timeline (a plugin reads them as records)
      timeline: [...this.feats.map((f) => ({ id: f.id, name: f.name, type: f.type, suppressed: false, rolled_back: false, error: null, warning: null, ms: 0 })), ...(this.feats.length ? [] : this.groups).map((g, i) => ({ id: this.feats.length + i + 1, name: g.name, type: 'group', suppressed: false, rolled_back: false, error: null, warning: null, ms: 0 }))], selection: (this.opts.doc?.selection ?? []).map((i) => ({ type: i.type, name: i.name ?? i.body, ...(i.body ? { body: i.body } : {}) })) };
  }

  /** `component.properties`: the bodies the component made (all the run's bodies for the root), measured on the scratch kernel, with a mass from the body's material density (steel, 7.85 g/cm3, when it has none) */
  private async componentProperties(args: { component?: unknown }): Promise<unknown> {
    const name = args.component === undefined ? this.activeName : this.compName(args.component), c = this.components.get(name);
    const items = c ? this.order.slice(c.from, c.to) : this.order;
    const mine = new Set(items.flatMap((o) => this.made(o)));
    const rows = ((await this.measure({})) as { bodies: Array<{ name: string; volume_mm3: number | null; bbox: { min: number[]; max: number[] }; material: string | null }> }).bodies.filter((b) => mine.has(b.name));
    let volume = 0, mass = 0;
    const bodies = rows.map((b) => {
      const density = (b.material ? this.materials.get(b.material)?.density : undefined) ?? 7.85, v = b.volume_mm3 ?? 0, m = (v / 1000) * density;
      volume += v; mass += m;
      return { name: b.name, material: b.material ?? 'Steel', closed: b.volume_mm3 !== null, density_g_cm3: density, mass_g: m, volume_mm3: b.volume_mm3, bbox: b.bbox };
    });
    const lo = [0, 1, 2].map((i) => Math.min(...bodies.map((b) => b.bbox.min?.[i] ?? 0))), hi = [0, 1, 2].map((i) => Math.max(...bodies.map((b) => b.bbox.max?.[i] ?? 0)));
    return { component: this.compId(name), name, coordinate_frame: 'world', descendants: args && (args as { descendants?: boolean }).descendants !== false, placement_count: 1, body_count: bodies.length, bodies,
      total: { open_bodies_skipped: 0, volume_mm3: volume, mass_g: mass, bbox: bodies.length ? { min: lo, max: hi } : null } };
  }

  private async measure(args?: { bodies?: string[]; names_only?: boolean }): Promise<unknown> {
    if (args?.names_only) return { bodies: [...new Set([...(this.opts.doc?.bodies ?? []).map((b) => b.name), ...this.order.flatMap((o) => ('cut' in o && !o.cut && !o.join && !o.inter ? [o.body ?? o.name] : 'kind' in o && ((o.kind === 'round' || o.kind === 'extrude' || o.kind === 'sweep' || o.kind === 'sphere') && o.op === 'new') ? [o.body ?? o.name] : []))])].map((name) => ({ name })) };
    // with nothing recorded yet, the open document's own bodies answer from the document. Once this run has recorded something, a build is needed: `scratch.build`
    // is given the recorded script and (in the app) runs it on top of the open document, so the rows hold the document's bodies as the run has changed them.
    const want = args?.bodies as string[] | undefined;
    const fromDoc = (n: string) => { const b = this.docBody(n)!, bb = this.bboxOf(n); return { name: n, volume_mm3: b.volume ?? null, bbox: bb ?? { min: undefined, max: undefined }, material: this.assigned.get(n) ?? null }; };
    if (!this.order.length) return { bodies: (want ?? (this.opts.doc?.bodies ?? []).map((b) => b.name)).filter((n) => this.docBody(n)).map(fromDoc) };
    const t = performance.now();
    const rows = (await this.scratch.build(this.script({ up: this.opts.up ?? this.opts.doc?.up ?? 'z' }))).filter((b) => !want || want.includes(b.name));
    this.buildMs += performance.now() - t; this.builds++;
    const out: Array<Record<string, unknown>> = rows.map((b) => ({ name: b.name, volume_mm3: b.volume, bbox: b.bbox ? this.boxFromDoc(b.bbox) : (this.bboxOf(b.name) ?? { min: undefined, max: undefined }), material: this.assigned.get(b.name) ?? null }));
    for (const n of want ?? []) if (!out.some((o) => o.name === n) && this.docBody(n)) out.push(fromDoc(n));
    return { bodies: out };
  }
}
