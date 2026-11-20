// Spike: a transactional command interpreter for the SolidCraft `commands.run` surface, five commands.
// Edits (parameters.add, solid.box, timeline.group) only RECORD; the open document is never touched. Reads (document.inspect,
// inspect.measure) build the recorded list as a script on a scratch AgentSession and answer from that. commit() is the one write.
// component.create / component.activate / occurrence.ground are NOT in the brief's list but the woodwork `cabinet` entry calls them
// unconditionally; here they are inert stubs so the run can complete, except that a component remembers its features and
// occurrence.move (a translation) moves the bodies it made: that is how the plugin's Place (right, left, above) takes effect. Everything else is refused.
import { evalExpr, kernelExpr } from '../../solidcraft/src/expr';

/** What the interpreter needs from the kernel side: build a script on a scratch state and list its bodies; commit a script to the open document. */
export interface BodyRow { name: string; volume: number | null; bbox: { min: number[]; max: number[] } | null }
export interface Scratch { build(script: string): Promise<BodyRow[]> }
export interface Target { commit(script: string): Promise<{ created: number }> }

export const SUPPORTED = new Set(['parameters.add', 'solid.box', 'solid.cylinder', 'solid.cone', 'solid.combine', 'solid.move', 'selection.get', 'solid.hole', 'solid.pattern.rectangular', 'timeline.group', 'document.inspect', 'inspect.measure', 'material.list', 'material.create', 'material.assign', 'model.mesh']);
export const STUBBED = new Set(['component.create', 'component.activate', 'component.list', 'component.metadata', 'component.metadata.set', 'component.delete', 'occurrence.ground', 'occurrence.move', 'joint.as_built', 'joint.limits', 'joint.create', 'joint.edit', 'joint.list', 'construct.axis.two_planes', 'solid.chamfer', 'sketch.create', 'sketch.text', 'sketch.finish', 'parameters.change']);
/** SolidCraft classifies these as reads; everything else is an edit (a `read` entry may only call reads). */
export const READS = new Set(['document.inspect', 'inspect.measure', 'model.mesh', 'material.list', 'selection.get']);

/** What the open document offers a plugin that edits it (all in the DOCUMENT's frame: the interpreter turns it into the plugin's Z-up frame): its bodies with their boxes and what is selected. */
export interface DocSel { type: 'body' | 'face' | 'edge'; /** body items */ name?: string; /** face and edge items: the body they belong to */ body?: string; /** a face's place in its body's list */ index?: number; /** planar faces: the outward normal */ normal?: number[] }
export interface DocBody { name: string; bbox: { min: number[]; max: number[] } | null; volume?: number | null; /** the feature that made the body: a colour for it is written against that feature */ feature?: string }
/** The display mesh of the open document and which faces (by name, in the body's own order) belong to each body: what `model.mesh` answers from. Triangles are three vertices each (9 floats), millimetres, document frame. */
export interface DocMeshSource { mesh: { positions: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] }; faces: Record<string, string[]> }
/** `model.mesh` answers at most this many triangles in one call (the reply is JSON through the command channel); ask for fewer bodies at a time. */
export const MESH_MAX_TRIANGLES = 200000;
export interface DocContext { /** the bodies' triangles, for `model.mesh` */ meshes?: DocMeshSource; up?: 'y' | 'z'; bodies: DocBody[]; selection: DocSel[]; /** what generators stored for the components they made, by component name (kept with the run that made each folder) */ components?: Record<string, Record<string, unknown>>; /** the document's variables */ parameters?: ReadonlyArray<{ name: string; expression: string; value: number; comment?: string }> }

interface Box { name: string; body?: string; corner: number[]; size: number[]; cut: boolean; join?: boolean; inter?: boolean; targets: string[]; group?: string }
/** A cylinder, or a cone when `top` is set (diameters at the base and at the top), on an axis along one of x, y, z. */
interface Round { kind: 'round'; name: string; base: number[]; axis: number[]; d: number; top?: number; height: number; op: 'new' | 'join' | 'cut' | 'intersect'; body?: string; targets: string[] }
interface Combine { kind: 'combine'; name: string; target: string; tools: string[]; op: 'cut' | 'join' | 'intersect'; keep: boolean }
/** `solid.chamfer`: an equal-distance bevel on the edges that pass through the given points of a body */
interface Chamfer { kind: 'chamfer'; name: string; body: string; distance: number; near: number[][] }
/** `sketch.create` + `sketch.text`: a board's name, engraved 0.3 mm deep on the plane the plugin gives (a label the cut list names) */
interface Label { kind: 'label'; name: string; board: string; origin: number[]; xdir: number[]; ydir: number[]; text: string; height: number }
interface Move { kind: 'move'; name: string; bodies: string[]; translate?: number[]; rotate?: { origin: number[]; axis: number[]; angle: number } }
interface Hole { name: string; pos: number[]; dir: number[]; d: number; depth: number; targets: string[]; hole: true }
export interface Param { name: string; expression: string; value: number; comment?: string }

/** The colour a board material shows: the plugin's own `color`, else a wood tone chosen from the library name it asked for (we have no texture library for these). */
export function lookOf(name: string, look?: string): { colour: string } {
  if (look && /^#[0-9a-f]{6}$/i.test(look)) return { colour: look };
  const n = `${name} ${look ?? ''}`.toLowerCase();
  if (n.includes('birch')) return { colour: '#e3c995' };
  if (n.includes('oak')) return { colour: '#b78a56' };
  if (n.includes('walnut')) return { colour: '#6b4a32' };
  if (n.includes('melamine') || n.includes('white')) return { colour: '#f1f1ec' };
  return { colour: '#c9a87a' };
}

export class Unsupported extends Error {}

export class Interpreter {
  params = new Map<string, Param>();
  boxes: Box[] = [];
  holes: Hole[] = [];
  /** boxes and holes in call order: a hole needs its target body to exist first */
  order: Array<Box | Hole | Round | Combine | Move | Chamfer | Label> = [];
  /** names of pattern features: groupable, but they only repeat holes that are already emitted */
  patterns = new Set<string>();
  materials = new Map<string, { density?: number; look?: string }>();
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
  /** how far a plugin moved a component of the open document (Joinery puts a cabinet on the origin to drill it): nothing really moves here, so what it cuts there is shifted back */
  private movedBy = new Map<string, number[]>();
  private shiftBack(v: number[]): number[] { const m = this.movedBy.get(this.activeName); return m ? v.map((x, i) => x - m[i]) : v; }
  /** the label sketch a plugin is drawing (sketch.create .. sketch.finish) */
  private sketch: { name: string; origin: number[]; xdir: number[]; ydir: number[]; texts: Array<{ text: string; height: number }> } | null = null;
  /** component metadata a plugin stored (it finds its own cabinets again by it) */
  private metadata = new Map<string, Record<string, unknown>>();
  /** names of construction axes: they carry no geometry here but a history folder may list them */
  private axes = new Set<string>();
  /** what this run stored on the components it made: kept with the run's record so a later run can read it */
  componentMetadata(): Record<string, Record<string, unknown>> { return Object.fromEntries([...this.components.keys()].filter((n) => this.metadata.has(n)).map((n) => [n, this.metadata.get(n)!])); }
  /** hinges and slides a plugin asked for: kept for a later assembly, nothing moves yet */
  joints: Array<Record<string, unknown>> = [];
  constructor(private readonly scratch: Scratch, readonly opts: { readEntry?: boolean; doc?: DocContext; /** the up axis of the document the result goes into (a measure builds in that frame) */ up?: 'y' | 'z' } = {}) {}

  // the document's frame -> the plugin's Z-up frame (the inverse of pt() below): Y-up (x, y, z) -> (x, -z, y)
  private fromDoc(p: number[]): number[] { return (this.opts.up ?? this.opts.doc?.up) === 'y' ? [p[0], 0 - p[2], p[1]] : p; }
  private docBody(name: string): DocBody | undefined { return this.opts.doc?.bodies.find((b) => b.name === name); }
  /** a body of this run or of the open document */
  private exists(name: string): boolean {
    return this.order.some((o) => ('cut' in o && !o.cut && !o.join && !o.inter && (o.body ?? o.name) === name) || ('kind' in o && o.kind === 'round' && o.op === 'new' && (o.body ?? o.name) === name)) || !!this.docBody(name);
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
    return command === 'document.inspect' ? this.inspect() : this.measure(args);
  }

  /** Edits only record, so they can answer synchronously: the host then never has to replay the guest for them. Reads (they build) return undefined. */
  runSync(command: string, args: any): unknown {
    if (command === 'material.list') { this.calls.push(command); return { materials: [...this.materials].map(([name, m]) => ({ name, density_g_cm3: m.density })) }; }
    if (command === 'selection.get') { this.calls.push(command); return this.selection(args); }
    if (command === 'model.mesh') { this.calls.push(command); return this.modelMesh(args); }
    if (READS.has(command) && SUPPORTED.has(command)) return undefined;
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
        if ((join || inter) && box.targets.length > 1) throw new Error(`a ${args.operation} takes one target body`);
        if (cut || join || inter) for (const t of box.targets) if (!this.exists(t)) throw new Error(`no body named "${t}"`);
        box.corner = this.shiftBack(box.corner);
        this.boxes.push(box); this.order.push(box);
        return { feature: box.name, body: box.body ?? null };
      }
      case 'solid.hole': {
        const targets: string[] = args.targets ?? [];
        if (!targets.length) throw new Error('a hole needs targets');
        for (const t of targets) if (!this.exists(t)) throw new Error(`no body named "${t}"`);
        const h: Hole = { hole: true, name: String(args.name), pos: (args.position as unknown[]).map((c) => this.num(c)), dir: (args.direction as number[]).map(Number), d: this.num(args.diameter), depth: this.num(args.depth), targets };
        if (!(h.d > 0) || !(h.depth > 0)) throw new Error('a hole needs a positive diameter and depth');
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
        const axis = (args.axis as unknown[]).map((c) => Number(c));
        if (axis.filter((v) => v !== 0).length !== 1) throw new Error(`${command}: only an axis along x, y or z is supported (got [${axis}])`);
        const r: Round = { kind: 'round', name: String(args.name ?? args.body_name ?? (cone ? 'Cone' : 'Cylinder')), base: (args.base as unknown[]).map((c) => this.num(c)), axis, d: this.num(args.diameter), height: this.num(args.height), op, body: args.body_name, targets: args.targets ?? [], ...(cone ? { top: this.num(args.top_diameter ?? 0) } : {}) };
        if (!(r.d > 0) || !(r.height > 0) || (cone && !(r.top! >= 0))) throw new Error(`${command} needs a positive diameter and height`);
        if (op !== 'new' && !r.targets.length) throw new Error(`a ${op} needs targets`);
        if (op !== 'new' && op !== 'cut' && r.targets.length > 1) throw new Error(`a ${op} takes one target body`);
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
      case 'material.create': { this.materials.set(String(args.name), { density: args.density_g_cm3, look: args.appearance ?? args.color }); return { name: args.name }; }
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
      case 'joint.create': { this.joints.push({ ...args }); return { joint: args.name }; }
      case 'joint.edit': case 'joint.list': return { joints: this.joints };
      case 'component.metadata.set': { const n = String(args.component); this.metadata.set(n, { ...(this.metadata.get(n) ?? {}), ...((args.values as Record<string, unknown>) ?? {}) }); return { component: n }; }
      case 'component.metadata': { const n = String(args.component), m = this.metadata.get(n) ?? this.opts.doc?.components?.[n] ?? {}; return { component: n, metadata: m, values: m }; }
      case 'component.list': {
        // the open document has no components here: a cabinet is the bodies sharing a prefix before "Side L" / "Side R"
        const fromDoc = new Set((this.opts.doc?.bodies ?? []).map((b) => /^(.+) Side [LR]$/.exec(b.name)?.[1]).filter((n): n is string => !!n));
        const names = [...new Set([...fromDoc, ...Object.keys(this.opts.doc?.components ?? {}), ...this.components.keys()])];
        return { active: this.activeName, components: names.map((name) => ({ name, occurrence: `${name}:1`, id: name })) };
      }
      case 'component.delete': return { deleted: args.component ?? args.occurrence ?? null };
      case 'sketch.create': {
        const pl = args.plane ?? {};
        if (!pl.origin || !pl.x_dir || !pl.y_dir) throw new Error('sketch.create: only a plane with an origin and x and y directions is supported');
        this.sketch = { name: String(args.name), origin: (pl.origin as unknown[]).map((v) => this.num(v)), xdir: (pl.x_dir as unknown[]).map(Number), ydir: (pl.y_dir as unknown[]).map(Number), texts: [] };
        return { sketch: args.name };
      }
      case 'sketch.text': {
        if (!this.sketch) throw new Error('sketch.text: no sketch is open');
        this.sketch.texts.push({ text: String(args.text), height: this.num(args.height ?? 5) });
        return { text: args.text };
      }
      case 'sketch.finish': {
        const sk = this.sketch; this.sketch = null;
        if (!sk) return { stub: true };
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
        const features: string[] = args.features ?? [];
        for (const f of features) if (!this.patterns.has(f) && !this.axes.has(f) && !this.order.some((b) => b.name === f || ('hole' in b && b.name.startsWith(`${f} `)))) throw new Error(`no feature named "${f}"`);
        this.groups.push({ name: String(args.name), features });
        return { group: args.name, count: features.length };
      }
      case 'component.create': { const n = String(args.name); this.components.set(n, { from: this.order.length, to: Infinity }); this.openComponent = n; this.activeName = n; return { occurrence: `${n}:1`, parent: 'Root', stub: true }; }
      case 'component.activate': { this.activeName = String(args.component ?? 'Root'); if (this.openComponent) { const c = this.components.get(this.openComponent); if (c && c.to === Infinity) c.to = this.order.length; this.openComponent = null; } return { active: args.component, stub: true }; }
      case 'joint.as_built': case 'joint.limits': return { stub: true, name: args.name ?? args.joint };
      case 'occurrence.move': {
        // a plugin placing a generated component: turn it (about its own origin, which is the document's origin here), then translate it, in world space
        const c = this.components.get(String(args.occurrence).replace(/:\d+$/, ''));
        const extra = Object.keys(args).filter((k) => !['occurrence', 'space', 'translate', 'angle', 'axis'].includes(k));
        if (extra.length) throw new Error(`occurrence.move: ${extra.join(', ')} not supported (only a turn and a translation)`);
        const tr = ((args.translate as unknown[]) ?? [0, 0, 0]).map((v) => this.num(v));
        const angle = args.angle === undefined ? 0 : this.num(args.angle);
        if (!c && tr.some((v) => v !== 0) && !angle) { const n = String(args.occurrence).replace(/:\d+$/, ''); const m = this.movedBy.get(n) ?? [0, 0, 0]; this.movedBy.set(n, m.map((x, i) => x + tr[i])); return { moved: args.occurrence, reverted: false }; }
        if (!c || (tr.every((v) => v === 0) && !angle)) return { moved: args.occurrence, stub: !c };
        const names = this.order.slice(c.from, c.to).flatMap((f) => ('hole' in f ? [] : 'kind' in f ? (f.kind === 'round' && f.op === 'new' ? [f.body ?? f.name] : []) : (!f.cut && !f.join && !f.inter ? [f.body ?? f.name] : [])));
        if (!names.length) return { moved: args.occurrence, bodies: 0 };
        if (angle) this.runSync('solid.move', { name: `Turn ${args.occurrence}`, bodies: names, origin: [0, 0, 0], axis: args.axis ?? [0, 0, 1], angle });
        return tr.some((v) => v !== 0) ? this.runSync('solid.move', { name: `Place ${args.occurrence}`, bodies: names, translate: tr }) : { moved: names };
      }
      case 'occurrence.ground': return { grounded: args.grounded, stub: true };
      default: throw new Unsupported(`unsupported command: ${command}. CivilKit CAD does not run this SolidCraft command yet`);
    }
  }

  /** The recorded list as our script text (the same API run_script takes). */
  /** document frame for the current script() call: plugins are written Z-up; for a Y-up document (the app's default) every point turns (x, y, z) -> (x, z, -y), so the cabinet stands upright and Z of Position means up in the plugin's terms */
  private frame: { up: 'y' | 'z'; offset: number[] } = { up: 'z', offset: [0, 0, 0] };
  private pt(p: number[]): number[] { const q = this.frame.up === 'y' ? [p[0], p[2], -p[1]] : p; return q.map((v, i) => v + this.frame.offset[i]); }
  private dirOf(d: number[]): number[] { return this.frame.up === 'y' ? [d[0], d[2], -d[1]] : d; }

  script(o: { part?: string; up?: 'y' | 'z'; offset?: number[]; /** the app's own colour for a board material name (its material library), or undefined to use the plugin's colour */ look?: (material: string) => string | undefined } = {}): string {
    this.frame = { up: o.up ?? 'z', offset: o.offset ?? [0, 0, 0] };
    const L: string[] = [];
    const names = new Set(this.params.keys());
    const defs = [...this.params.values()].map((p) => `${JSON.stringify(p.name)}: ${JSON.stringify(kernelExpr(p.expression, names) ?? String(p.value))}`);
    if (defs.length) L.push(`variables({ ${defs.join(', ')} });`);
    L.push(`const p = part(${JSON.stringify(o.part ?? 'Plugin')});`, ...(this.frame.up === 'z' ? [`p.upAxis('z');   // SolidCraft is Z-up: keep its numbers, the app opens the part Z-up (document field upAxis, a view hint)`] : []));
    L.push('const H = {};');
    const groupOf = new Map<string, string>();
    for (const g of this.groups) for (const f of g.features) { groupOf.set(f, g.name); for (const o of this.order) if ('hole' in o && o.name.startsWith(`${f} `)) groupOf.set(o.name, g.name); }
    const emit = (b: Box | Hole | Round | Combine | Move | Chamfer | Label): string => {
      if ('hole' in b) return this.emitHole(b);
      if ('kind' in b) return b.kind === 'round' ? this.emitRound(b) : b.kind === 'combine' ? this.emitCombine(b) : b.kind === 'chamfer' ? this.emitChamfer(b) : b.kind === 'label' ? this.emitLabel(b) : this.emitMove(b);
      const a = this.pt(b.corner), c = this.pt(b.corner.map((v, i) => v + b.size[i]));
      const [x, y, z] = [0, 1, 2].map((i) => Math.min(a[i], c[i])), [l, w, h] = [0, 1, 2].map((i) => Math.abs(c[i] - a[i]));
      const sk = `p.sketch(at('front', ${z}), (s) => s.rect(${l}, ${w}, [${x + l / 2}, ${y + w / 2}]))`;
      const nm = JSON.stringify(b.name);
      // a join: the box is made as its own body, then united with the target (the part's own extrude would unite with whatever it touches)
      if (b.join || b.inter) { const tmp = JSON.stringify(`${b.name} (${b.join ? 'join' : 'intersect'})`); return `${sk}.extrude(${h}, { name: ${nm}, newBody: ${tmp} });\n  p.combine('${b.join ? 'union' : 'intersect'}', ${JSON.stringify(b.targets[0])}, [${tmp}]);`; }
      // SolidCraft's `targets` is "subtract this volume from each of these bodies". Our `from: [a, b]` MERGES the targets into one body
      // (kernel finding, see the report), so a cut is one `from: [single]` cut per target.
      return b.cut
        ? b.targets.map((t) => `${sk}.cut(${h}, { name: ${JSON.stringify(`${b.name} @ ${t}`)}, from: [${JSON.stringify(t)}], direction: 'away' });`).join('\n  ')
        : `${sk}.extrude(${h}, { name: ${nm}, newBody: ${JSON.stringify(b.body ?? b.name)} }); H[${JSON.stringify(b.body ?? b.name)}] = p.handle();`;
    };
    // consecutive items of one history folder go inside one p.group(...)
    for (let i = 0; i < this.order.length;) {
      const g = groupOf.get(this.order[i].name);
      let j = i; while (j < this.order.length && groupOf.get(this.order[j].name) === g) j++;
      const body = this.order.slice(i, j).map(emit).join('\n  ');
      L.push(g ? `p.group(${JSON.stringify(g)}, () => {\n  ${body}\n});` : body);
      i = j;
    }
    // board materials become each body's colour (view state; the part's own material stays the default for bodies without one)
    for (const [body, mat] of this.assigned) {
      const look = { colour: o.look?.(mat) ?? lookOf(mat, this.materials.get(mat)?.look).colour };
      if (this.order.some((o) => 'cut' in o && !o.cut && !o.join && !o.inter && (o.body ?? o.name) === body)) L.push(`p.appearance({ feature: H[${JSON.stringify(body)}], colour: ${JSON.stringify(look.colour)}, finish: 'matte' });`);
      else if (this.docBody(body)?.feature) L.push(`p.appearance({ feature: ${JSON.stringify(this.docBody(body)!.feature)}, colour: ${JSON.stringify(look.colour)}, finish: 'matte' });   // a body of the open document`);
    }
    return L.join('\n');
  }

  /** The frame of a round solid: the sketch plane perpendicular to the axis (document frame) and the u, v of a point on it. Same planes as a hole. */
  private roundFrame(base: number[], axis: number[]): { plane: string; off: number; uv: number[]; sign: number } {
    const [x, y, z] = this.pt(base), dir3 = this.dirOf(axis), a = dir3.findIndex((v) => v !== 0), sign = Math.sign(dir3[a]);
    return { plane: ['right', 'top', 'front'][a], off: [x, y, z][a], uv: [[-z, y], [x, -z], [x, y]][a], sign };
  }
  /** A cylinder is a circle extruded along the axis; a cone is a loft between two circles. `new` makes a body, `join` unites it with the target, `cut` removes it from each target. */
  private emitRound(r: Round): string {
    const f = this.roundFrame(r.base, r.axis), nm = JSON.stringify(r.name);
    const tmp = r.op === 'join' || r.op === 'intersect' ? `${r.name} (${r.op})` : r.body ?? r.name;
    const cutOf = (t: string): string => r.top === undefined
      ? `p.sketch(at(${JSON.stringify(f.plane)}, ${f.off}), (s) => s.circle(${r.d / 2}, [${f.uv[0]}, ${f.uv[1]}])).cut(${r.height}, { name: ${JSON.stringify(`${r.name} @ ${t}`)}, from: [${JSON.stringify(t)}], direction: '${f.sign > 0 ? 'away' : 'into'}' });`
      : `p.loft(${this.sections(r, f)}, { op: 'cut', name: ${JSON.stringify(`${r.name} @ ${t}`)}, from: [${JSON.stringify(t)}] });`;
    if (r.op === 'cut') return r.targets.map(cutOf).join('\n  ');
    const make = r.top === undefined
      ? `p.sketch(at(${JSON.stringify(f.plane)}, ${f.off}), (s) => s.circle(${r.d / 2}, [${f.uv[0]}, ${f.uv[1]}])).extrude(${r.height}, { name: ${nm}, newBody: ${JSON.stringify(tmp)}${f.sign < 0 ? ', flip: true' : ''} });`
      : `p.loft(${this.sections(r, f)}, { name: ${nm}, newBody: ${JSON.stringify(tmp)}, ends: { first: 'cap', last: ${r.top === 0 ? "'point'" : "'cap'"} } });`;
    return r.op === 'join' || r.op === 'intersect' ? `${make}\n  p.combine('${r.op === 'join' ? 'union' : 'intersect'}', ${JSON.stringify(r.targets[0])}, [${JSON.stringify(tmp)}]);` : `${make} H[${JSON.stringify(tmp)}] = p.handle();`;
  }
  private sections(r: Round, f: { plane: string; off: number; uv: number[]; sign: number }): string {
    const sec = (off: number, d: number): string => `{ on: at(${JSON.stringify(f.plane)}, ${off}), draw: (s) => s.circle(${d / 2}, [${f.uv[0]}, ${f.uv[1]}]) }`;
    return `[${sec(f.off, r.d)}, ${sec(f.off + f.sign * r.height, r.top === 0 ? r.d * 1e-3 : r.top!)}]`;
  }
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
    return `p.moveBody(${JSON.stringify(m.bodies)}, { ${o.join(', ')} });`;
  }

  /** `selection.get`: the picked bodies, faces and edges of the open document (what the plugin edits). `detail` adds a face's plane normal, in the plugin's frame. */
  private selection(args: { detail?: boolean }): unknown {
    const items = (this.opts.doc?.selection ?? []).map((i) => {
      const o: Record<string, unknown> = { type: i.type, ...(i.name !== undefined ? { name: i.name } : {}), ...(i.body !== undefined ? { body: i.body } : {}) };
      if (args?.detail && i.normal) o.surface = { normal: this.dirFromDoc(i.normal) };
      return o;
    });
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
  private dirFromDoc(d: number[]): number[] { return (this.opts.up ?? this.opts.doc?.up) === 'y' ? [d[0], 0 - d[2], d[1]] : d; }

  /** A hole is a circle sketched on the plane the drill enters from, cut `depth` along the drill direction, one cut per target body. */
  private emitHole(h: Hole): string {
    const [x, y, z] = this.pt(h.pos), dir3 = this.dirOf(h.dir), axis = dir3.findIndex((v) => v !== 0), sign = Math.sign(dir3[axis]);
    // frames from docs/scripting.md: front (x,y | +Z), top (x,-z | +Y), right (-z,y | +X); a cut goes against the normal unless direction is 'away'
    const plane = ['right', 'top', 'front'][axis];
    const off = [x, y, z][axis];
    const uv = [[-z, y], [x, -z], [x, y]][axis];
    const dir = sign > 0 ? 'away' : 'into';
    return h.targets.map((t) => `p.sketch(at(${JSON.stringify(plane)}, ${off}), (s) => s.circle(${h.d / 2}, [${uv[0]}, ${uv[1]}])).cut(${h.depth}, { name: ${JSON.stringify(`${h.name} @ ${t}`)}, from: [${JSON.stringify(t)}], direction: '${dir}' });`).join('\n  ');
  }

  /** The only write to the open document: the recorded list as one script run (one undo step). */
  async commit(open: Target): Promise<{ created: number }> { return open.commit(this.script()); }

  private async inspect(): Promise<unknown> {
    // `parameters` is the keyed form; `params` is the list the Woodwork plugin reads ({ name, expression, value, comment }): it finds a cabinet's sizes and a free name there
    const mine = [...this.params.values()];
    const all = [...(this.opts.doc?.parameters ?? []).filter((d) => !this.params.has(d.name)), ...mine];
    const entry = (p: { expression?: string; value: number; comment?: string }) => ({ expression: p.expression, value: p.value, ...(p.comment ? { comment: p.comment } : {}) });
    return { units: 'mm', parameters: Object.fromEntries(all.map((p) => [p.name, entry(p)])), params: all.map((p) => ({ name: p.name, ...entry(p) })), bodies: false, timeline: this.groups.map((g) => g.name), selection: (this.opts.doc?.selection ?? []).map((i) => ({ type: i.type, name: i.name ?? i.body, ...(i.body ? { body: i.body } : {}) })) };
  }

  private async measure(args?: { bodies?: string[]; names_only?: boolean }): Promise<unknown> {
    if (args?.names_only) return { bodies: [...new Set([...(this.opts.doc?.bodies ?? []).map((b) => b.name), ...this.order.flatMap((o) => ('cut' in o && !o.cut && !o.join && !o.inter ? [o.body ?? o.name] : 'kind' in o && o.kind === 'round' && o.op === 'new' ? [o.body ?? o.name] : []))])].map((name) => ({ name })) };
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
