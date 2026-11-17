// Spike: a transactional command interpreter for the SolidCraft `commands.run` surface, five commands.
// Edits (parameters.add, solid.box, timeline.group) only RECORD; the open document is never touched. Reads (document.inspect,
// inspect.measure) build the recorded list as a script on a scratch AgentSession and answer from that. commit() is the one write.
// component.create / component.activate / occurrence.ground are NOT in the brief's list but the woodwork `cabinet` entry calls them
// unconditionally; here they are inert stubs so the run can complete (wave 2 would give them meaning). Everything else is refused.
import { evalExpr, kernelExpr } from '../../solidcraft/src/expr';

/** What the interpreter needs from the kernel side: build a script on a scratch state and list its bodies; commit a script to the open document. */
export interface BodyRow { name: string; volume: number | null; bbox: { min: number[]; max: number[] } | null }
export interface Scratch { build(script: string): Promise<BodyRow[]> }
export interface Target { commit(script: string): Promise<{ created: number }> }

export const SUPPORTED = new Set(['parameters.add', 'solid.box', 'solid.cylinder', 'solid.cone', 'solid.combine', 'solid.move', 'selection.get', 'solid.hole', 'solid.pattern.rectangular', 'timeline.group', 'document.inspect', 'inspect.measure', 'material.list', 'material.create', 'material.assign']);
export const STUBBED = new Set(['component.create', 'component.activate', 'occurrence.ground', 'occurrence.move', 'joint.as_built', 'joint.limits']);
/** SolidCraft classifies these as reads; everything else is an edit (a `read` entry may only call reads). */
export const READS = new Set(['document.inspect', 'inspect.measure', 'model.mesh', 'material.list', 'selection.get']);

/** What the open document offers a plugin that edits it (all in the DOCUMENT's frame: the interpreter turns it into the plugin's Z-up frame): its bodies with their boxes and what is selected. */
export interface DocSel { type: 'body' | 'face' | 'edge'; /** body items */ name?: string; /** face and edge items: the body they belong to */ body?: string; /** planar faces: the outward normal */ normal?: number[] }
export interface DocBody { name: string; bbox: { min: number[]; max: number[] } | null; volume?: number | null }
export interface DocContext { up?: 'y' | 'z'; bodies: DocBody[]; selection: DocSel[] }

interface Box { name: string; body?: string; corner: number[]; size: number[]; cut: boolean; join?: boolean; inter?: boolean; targets: string[]; group?: string }
/** A cylinder, or a cone when `top` is set (diameters at the base and at the top), on an axis along one of x, y, z. */
interface Round { kind: 'round'; name: string; base: number[]; axis: number[]; d: number; top?: number; height: number; op: 'new' | 'join' | 'cut' | 'intersect'; body?: string; targets: string[] }
interface Combine { kind: 'combine'; name: string; target: string; tools: string[]; op: 'cut' | 'join' | 'intersect'; keep: boolean }
interface Move { kind: 'move'; name: string; bodies: string[]; translate?: number[]; rotate?: { origin: number[]; axis: number[]; angle: number } }
interface Hole { name: string; pos: number[]; dir: number[]; d: number; depth: number; targets: string[]; hole: true }
export interface Param { name: string; expression: string; value: number }

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
  order: Array<Box | Hole | Round | Combine | Move> = [];
  /** names of pattern features: groupable, but they only repeat holes that are already emitted */
  patterns = new Set<string>();
  materials = new Map<string, { density?: number; look?: string }>();
  assigned = new Map<string, string>();
  groups: Array<{ name: string; features: string[] }> = [];
  calls: string[] = [];
  buildMs = 0; builds = 0;
  /** boxes of document bodies this run moved (translations only): a later measure sees them where the plugin put them */
  private shifted = new Map<string, number[]>();
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

  private vars(): Record<string, number> { return Object.fromEntries([...this.params].map(([k, p]) => [k, p.value])); }
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
    if (READS.has(command) && SUPPORTED.has(command)) return undefined;
    this.calls.push(command);
    if (this.opts.readEntry && !READS.has(command)) throw new Error(`a read entry may not call ${command}`);
    switch (command) {
      case 'parameters.add': {
        const name = String(args.name);
        if (this.params.has(name)) throw new Error(`parameter ${name} already exists`);
        const value = this.num(args.expression);
        this.params.set(name, { name, expression: String(args.expression), value });
        return { name, value, expression: String(args.expression) };
      }
      case 'solid.box': {
        const cut = args.operation === 'cut', join = args.operation === 'join', inter = args.operation === 'intersect';
        const box: Box = { name: String(args.name ?? args.body_name), body: args.body_name, cut, join, inter, targets: args.targets ?? [], corner: (args.corner as unknown[]).map((c) => this.num(c)), size: [args.length, args.width, args.height].map((c) => this.num(c)) };
        if ((cut || join || inter) && !box.targets.length) throw new Error(`a ${args.operation} needs targets`);
        if ((join || inter) && box.targets.length > 1) throw new Error(`a ${args.operation} takes one target body`);
        if (cut || join || inter) for (const t of box.targets) if (!this.exists(t)) throw new Error(`no body named "${t}"`);
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
        const seeds = (args.features as string[]).map((f) => this.holes.find((h) => h.name === f));
        if (seeds.some((h) => !h)) throw new Error('a pattern can only repeat a hole made earlier in this run');
        const n1 = Math.round(this.num(args.count1)), n2 = Math.round(this.num(args.count2 ?? 1));
        const s1 = this.num(args.spacing1), s2 = args.spacing2 === undefined ? 0 : this.num(args.spacing2);
        const d1 = (args.dir1 as number[]) ?? [0, 0, 1], d2 = (args.dir2 as number[]) ?? [0, 1, 0];
        let made = 0;
        for (const h of seeds as Hole[]) for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
          if (!i && !j) continue;
          const c: Hole = { ...h, name: `${h.name} ${i + 1}.${j + 1}`, pos: h.pos.map((v, k) => v + d1[k] * s1 * i + d2[k] * s2 * j) };
          this.holes.push(c); this.order.push(c); made++;
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
      case 'timeline.group': {
        const features: string[] = args.features ?? [];
        for (const f of features) if (!this.patterns.has(f) && !this.order.some((b) => b.name === f || ('hole' in b && b.name.startsWith(`${f} `)))) throw new Error(`no feature named "${f}"`);
        this.groups.push({ name: String(args.name), features });
        return { group: args.name, count: features.length };
      }
      case 'component.create': return { occurrence: `${args.name}:1`, parent: 'Root', stub: true };
      case 'component.activate': return { active: args.component, stub: true };
      case 'joint.as_built': case 'joint.limits': return { stub: true, name: args.name ?? args.joint };
      case 'occurrence.move': return { moved: args.occurrence, stub: true };
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
    const emit = (b: Box | Hole | Round | Combine | Move): string => {
      if ('hole' in b) return this.emitHole(b);
      if ('kind' in b) return b.kind === 'round' ? this.emitRound(b) : b.kind === 'combine' ? this.emitCombine(b) : this.emitMove(b);
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
    return { units: 'mm', parameters: Object.fromEntries([...this.params].map(([k, p]) => [k, { expression: p.expression, value: p.value }])), bodies: false, timeline: this.groups.map((g) => g.name), selection: (this.opts.doc?.selection ?? []).map((i) => i.name ?? i.body) };
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
