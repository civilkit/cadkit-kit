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

export const SUPPORTED = new Set(['parameters.add', 'solid.box', 'solid.hole', 'solid.pattern.rectangular', 'timeline.group', 'document.inspect', 'inspect.measure', 'material.list', 'material.create', 'material.assign']);
export const STUBBED = new Set(['component.create', 'component.activate', 'occurrence.ground', 'occurrence.move', 'joint.as_built', 'joint.limits']);
/** SolidCraft classifies these as reads; everything else is an edit (a `read` entry may only call reads). */
export const READS = new Set(['document.inspect', 'inspect.measure', 'model.mesh', 'material.list']);

interface Box { name: string; body?: string; corner: number[]; size: number[]; cut: boolean; targets: string[]; group?: string }
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
  order: Array<Box | Hole> = [];
  /** names of pattern features: groupable, but they only repeat holes that are already emitted */
  patterns = new Set<string>();
  materials = new Map<string, { density?: number; look?: string }>();
  assigned = new Map<string, string>();
  groups: Array<{ name: string; features: string[] }> = [];
  calls: string[] = [];
  buildMs = 0; builds = 0;
  constructor(private readonly scratch: Scratch, readonly opts: { readEntry?: boolean } = {}) {}

  private vars(): Record<string, number> { return Object.fromEntries([...this.params].map(([k, p]) => [k, p.value])); }
  private num(v: unknown): number { return evalExpr(v as string | number, this.vars()); }

  /** The `commands.run` entry point: JSON in, JSON out, throws a plain Error (the host turns it into command-failed). */
  async run(command: string, args: any): Promise<unknown> {
    const v = this.runSync(command, args);
    if (v !== undefined) return v;
    this.calls.push(command);
    return command === 'document.inspect' ? this.inspect() : this.measure();
  }

  /** Edits only record, so they can answer synchronously: the host then never has to replay the guest for them. Reads (they build) return undefined. */
  runSync(command: string, args: any): unknown {
    if (command === 'material.list') { this.calls.push(command); return { materials: [...this.materials].map(([name, m]) => ({ name, density_g_cm3: m.density })) }; }
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
        const cut = args.operation === 'cut';
        const box: Box = { name: String(args.name ?? args.body_name), body: args.body_name, cut, targets: args.targets ?? [], corner: (args.corner as unknown[]).map((c) => this.num(c)), size: [args.length, args.width, args.height].map((c) => this.num(c)) };
        if (cut && !box.targets.length) throw new Error('a cut needs targets');
        if (cut) for (const t of box.targets) if (!this.boxes.some((b) => !b.cut && b.body === t)) throw new Error(`no body named "${t}"`);
        this.boxes.push(box); this.order.push(box);
        return { feature: box.name, body: box.body ?? null };
      }
      case 'solid.hole': {
        const targets: string[] = args.targets ?? [];
        if (!targets.length) throw new Error('a hole needs targets');
        for (const t of targets) if (!this.boxes.some((b) => !b.cut && b.body === t)) throw new Error(`no body named "${t}"`);
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
    const emit = (b: Box | Hole): string => {
      if ('hole' in b) return this.emitHole(b);
      const a = this.pt(b.corner), c = this.pt(b.corner.map((v, i) => v + b.size[i]));
      const [x, y, z] = [0, 1, 2].map((i) => Math.min(a[i], c[i])), [l, w, h] = [0, 1, 2].map((i) => Math.abs(c[i] - a[i]));
      const sk = `p.sketch(at('front', ${z}), (s) => s.rect(${l}, ${w}, [${x + l / 2}, ${y + w / 2}]))`;
      const nm = JSON.stringify(b.name);
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
      if (this.order.some((o) => !('hole' in o) && !o.cut && (o.body ?? o.name) === body)) L.push(`p.appearance({ feature: H[${JSON.stringify(body)}], colour: ${JSON.stringify(look.colour)}, finish: 'matte' });`);
    }
    return L.join('\n');
  }

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
    return { units: 'mm', parameters: Object.fromEntries([...this.params].map(([k, p]) => [k, { expression: p.expression, value: p.value }])), bodies: false, timeline: this.groups.map((g) => g.name), selection: [] };
  }

  private async measure(): Promise<unknown> {
    if (!this.boxes.length) return { bodies: [] };
    const t = performance.now();
    const rows = await this.scratch.build(this.script());
    this.buildMs += performance.now() - t; this.builds++;
    return { bodies: rows.map((b) => ({ name: b.name, volume_mm3: b.volume, bbox: { min: b.bbox?.min, max: b.bbox?.max }, material: this.assigned.get(b.name) ?? null })) };
  }
}
