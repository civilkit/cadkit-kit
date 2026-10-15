// The recorder: a fluent API whose calls are REMEMBERED (with the script line) and later compiled to EditOps by the runner.
// Selectors (face(), edges()) are resolved at compile time against the body as it is just before that step.
import { resolveEdges, resolveFace, SelectorError, type EdgeSel, type FaceSel, type Geometry } from './selectors';

export type EditOp = { op: 'add'; feature: Record<string, unknown>; index?: number };
export type Plane = 'front' | 'top' | 'right';

/** A parameter written as an expression over the part's variables, e.g. expr('w/2'). */
export class Expr { constructor(public text: string, public value: number) {} valueOf(): number { return this.value; } }
export type Num = number | Expr;
const num = (n: Num): number => (n instanceof Expr ? n.value : n);
const ref = (n: Num): number | string => (n instanceof Expr ? `=${n.text}` : n);

export interface Ctx {
  geo: Geometry;
  nextId(): string;
  /** id of the sketch recorded last / the feature added last */
  lastSketch: string | null;
  lastFeature: string | null;
}
export interface Step { line: number; label: string; run(ctx: Ctx): EditOp[]; sk?: SketchBuilder }
export interface Recorded { name: string; variables: Array<{ name: string; expr: string }>; steps: Step[] }

/** The 1-based script line of the caller, from the stack of the evaluated function (see run.ts: sourceURL + header offset). */
let lineOffset = 2;
export const setLineOffset = (n: number): void => { lineOffset = n; };
export function callerLine(): number {
  const m = /kit-script:(\d+):\d+/.exec(new Error().stack ?? '');
  return m ? Math.max(1, Number(m[1]) - lineOffset) : 0;
}

export const face = (sel: string): FaceSel => ({ kind: 'face', sel, line: callerLine() });
export const edges = (sel: string): EdgeSel => ({ kind: 'edges', sel, line: callerLine() });
export const through = (): { through: true } => ({ through: true });
export type EndSpec = Num | { through: true };

// ---- sketch ----
type Pt = [number, number];
export class SketchBuilder {
  points: Array<Record<string, unknown>> = [{ id: 'O', x: 0, y: 0, fixed: true }];
  entities: Array<Record<string, unknown>> = [];
  private np = 0;
  private ne = 0;
  axisId: string | null = null;
  private pt(x: number, y: number): string { const id = `p${++this.np}`; this.points.push({ id, x: +x.toFixed(6), y: +y.toFixed(6) }); return id; }
  private ent(e: Record<string, unknown>): void { this.entities.push({ id: `e${++this.ne}`, ...e }); }
  /** Closed polygon through the points. */
  polygon(pts: Pt[]): this {
    const ids = pts.map(([x, y]) => this.pt(x, y));
    ids.forEach((id, i) => this.ent({ type: 'line', p1: id, p2: ids[(i + 1) % ids.length] }));
    return this;
  }
  /** Open chain of lines through the points. */
  polyline(pts: Pt[]): this {
    const ids = pts.map(([x, y]) => this.pt(x, y));
    for (let i = 0; i + 1 < ids.length; i++) this.ent({ type: 'line', p1: ids[i], p2: ids[i + 1] });
    return this;
  }
  line(a: Pt, b: Pt): this { return this.polyline([a, b]); }
  /** Width x height rectangle centred on `at` (default the origin). */
  rect(w: Num, h: Num, at: Pt = [0, 0]): this {
    const hw = num(w) / 2, hh = num(h) / 2;
    return this.polygon([[at[0] - hw, at[1] - hh], [at[0] + hw, at[1] - hh], [at[0] + hw, at[1] + hh], [at[0] - hw, at[1] + hh]]);
  }
  /** Circle by RADIUS. */
  circle(r: Num, at: Pt = [0, 0]): this { this.ent({ type: 'circle', c: this.pt(at[0], at[1]), r: num(r) }); return this; }
  /** Counter-clockwise arc about `centre` from `start` to `end` (the end point is projected on the radius). */
  arc(centre: Pt, start: Pt, end: Pt): this {
    const c = this.pt(...centre), a = this.pt(...start), b = this.pt(...end);
    this.ent({ type: 'arc', c, p1: a, p2: b });
    return this;
  }
  /** A point (hole centres). */
  point(at: Pt): this { this.ent({ type: 'point', p: this.pt(at[0], at[1]) }); return this; }
  /** Construction line along the sketch's Y axis (the default revolve axis). */
  axis(): this {
    const a = this.pt(0, 0), b = this.pt(0, 10);
    this.ent({ type: 'line', p1: a, p2: b, construction: true });
    this.axisId = this.entities[this.entities.length - 1].id as string;
    return this;
  }
}

// ---- the part ----
export interface ExtrudeOpts { mid?: boolean; flip?: boolean; draft?: number; thin?: Num }
export class PartBuilder {
  steps: Step[] = [];
  variables: Array<{ name: string; expr: string }> = [];
  constructor(public name: string) {}
  private add(label: string, run: Step['run']): this { this.steps.push({ line: callerLine(), label, run }); return this; }
  /** The feature a step adds is reported to the context once the runner has applied it; steps record their own ids through ctx.nextId. */
  private line = (): number => this.steps[this.steps.length - 1]?.line ?? 0;

  sketch(plane: Plane | FaceSel, build: (s: SketchBuilder) => void, name?: string): this {
    const s = new SketchBuilder();
    build(s);
    const line = callerLine();
    this.steps.push({ line, label: 'sketch', run: (ctx) => {
      const id = ctx.nextId();
      const pl = typeof plane === 'string' ? { kind: 'std', id: plane } : { kind: 'face', id: resolveFace(plane.sel, ctx.geo, plane.line).id };
      ctx.lastSketch = id;
      ctx.lastFeature = id;
      return [{ op: 'add', feature: { type: 'sketch', id, ...(name ? { name } : {}), plane: pl, points: s.points, entities: s.entities, constraints: [] } }];
    } });
    this.steps[this.steps.length - 1].sk = s;
    return this;
  }

  private solid(label: string, op: 'add' | 'cut', end: EndSpec, o: ExtrudeOpts): this {
    return this.add(label, (ctx) => {
      if (!ctx.lastSketch) throw new SelectorError(`${label}() needs a sketch before it`, this.line());
      const id = ctx.nextId();
      const through = typeof end === 'object' && 'through' in end;
      const f: Record<string, unknown> = { type: 'extrude', id, op, sketch: ctx.lastSketch };
      if (through) f.end = 'through'; else { f.end = o.mid ? 'mid' : 'blind'; f.depth = ref(end as Num); }
      if (o.flip) f.flip = true;
      if (o.draft) f.draft = o.draft;
      if (o.thin !== undefined) f.thin = { thickness: ref(o.thin), side: 'mid', ends: 'flat', cornerStyle: 'mitre' };
      ctx.lastFeature = id;
      ctx.lastSketch = null;
      return [{ op: 'add', feature: f }];
    });
  }
  extrude(depth: Num, o: ExtrudeOpts = {}): this { return this.solid('extrude', 'add', depth, o); }
  /** Cut the last sketch through the body: a depth, or through(). */
  cut(end: EndSpec, o: ExtrudeOpts = {}): this { return this.solid('cut', 'cut', end, o); }
  /** Revolve the last sketch about its Y axis (a construction line is added when the sketch has none). */
  revolve(angle: Num = 360, o: { op?: 'add' | 'cut'; thin?: Num } = {}): this {
    const sk = [...this.steps].reverse().find((x) => x.sk)?.sk;
    if (sk && !sk.axisId) sk.axis();
    return this.add('revolve', (ctx) => {
      if (!ctx.lastSketch) throw new SelectorError('revolve() needs a sketch before it', this.line());
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'revolve', id, op: o.op ?? 'add', sketch: ctx.lastSketch, axis: sk?.axisId, angle: ref(angle) };
      if (o.thin !== undefined) f.thin = { thickness: ref(o.thin), side: 'mid' };
      ctx.lastFeature = id;
      return [{ op: 'add', feature: f }];
    });
  }
  /** Thin-wall the last extrude / revolve: edit applied to the feature recorded just before. */
  thin(thickness: Num): this {
    const prev = this.steps.pop();
    if (!prev) throw new SelectorError('thin() needs an extrude or revolve before it', callerLine());
    const line = callerLine();
    this.steps.push({ line: prev.line, label: prev.label, run: (ctx) => {
      const ops = prev.run(ctx);
      const f = ops[0]?.feature;
      if (!f || (f.type !== 'extrude' && f.type !== 'revolve')) throw new SelectorError('thin() applies to an extrude or revolve', line);
      f.thin = { thickness: ref(thickness), side: 'mid', ...(f.type === 'extrude' ? { ends: 'flat', cornerStyle: 'mitre' } : {}) };
      return ops;
    } });
    return this;
  }
  /** A hole on a planar face at [x, y] (sketch-plane coordinates): diameter, optional blind depth (through otherwise). */
  hole(on: FaceSel, at: Pt, o: { diameter: Num; depth?: Num; flip?: boolean }): this {
    return this.add('hole', (ctx) => {
      const sid = ctx.nextId(), id = ctx.nextId();
      const fc = resolveFace(on.sel, ctx.geo, on.line);
      ctx.lastFeature = id;
      const hole: Record<string, unknown> = { type: 'hole', id, sketch: sid, kind: 'simple', diameter: ref(o.diameter), end: o.depth === undefined ? 'through' : 'blind', flip: o.flip ?? false };
      if (o.depth !== undefined) hole.depth = ref(o.depth);
      return [
        { op: 'add', feature: { type: 'sketch', id: sid, plane: { kind: 'face', id: fc.id }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: at[0], y: at[1] }], entities: [{ id: 'e1', type: 'point', p: 'p1' }], constraints: [] } },
        { op: 'add', feature: hole },
      ];
    });
  }
  fillet(on: EdgeSel, radius: Num): this {
    return this.add('fillet', (ctx) => { const id = ctx.nextId(); ctx.lastFeature = id; return [{ op: 'add', feature: { type: 'fillet', id, radius: ref(radius), edges: resolveEdges(on.sel, ctx.geo, on.line) } }]; });
  }
  chamfer(on: EdgeSel, distance: Num): this {
    return this.add('chamfer', (ctx) => { const id = ctx.nextId(); ctx.lastFeature = id; return [{ op: 'add', feature: { type: 'chamfer', id, chamferType: 'equal', distance: ref(distance), edges: resolveEdges(on.sel, ctx.geo, on.line) } }]; });
  }
  /** Hollow the body, opening the selected face. */
  shell(open: FaceSel, thickness: Num): this {
    return this.add('shell', (ctx) => { const id = ctx.nextId(); ctx.lastFeature = id; return [{ op: 'add', feature: { type: 'shell', id, faces: [resolveFace(open.sel, ctx.geo, open.line).id], thickness: ref(thickness) } }]; });
  }
  /** Repeat the last feature `count` times along a world axis. */
  linearPattern(o: { count: number; spacing: Num; axis?: 'x' | 'y' | 'z' }): this {
    return this.add('linearPattern', (ctx) => {
      if (!ctx.lastFeature) throw new SelectorError('linearPattern() needs a feature before it', this.line());
      const id = ctx.nextId();
      const seed = ctx.lastFeature;
      ctx.lastFeature = id;
      return [{ op: 'add', feature: { type: 'lpattern', id, seeds: [seed], dir: { kind: 'axis', axis: o.axis ?? 'x' }, count: o.count, spacing: ref(o.spacing), reverse: false } }];
    });
  }
  /** Repeat the last feature `count` times about a world axis over `angle` degrees. */
  circularPattern(o: { count: number; axis?: 'x' | 'y' | 'z'; angle?: number }): this {
    return this.add('circularPattern', (ctx) => {
      if (!ctx.lastFeature) throw new SelectorError('circularPattern() needs a feature before it', this.line());
      const id = ctx.nextId();
      const seed = ctx.lastFeature;
      ctx.lastFeature = id;
      return [{ op: 'add', feature: { type: 'cpattern', id, seeds: [seed], axis: { kind: 'axis', axis: o.axis ?? 'z' }, count: o.count, angle: o.angle ?? 360, equal: (o.angle ?? 360) === 360 } }];
    });
  }
}

// ---- script-level state: the runner collects what the script built ----
export interface ScriptState { parts: PartBuilder[]; vars: Record<string, number>; varDefs: Array<{ name: string; expr: string }> }
export function makeApi(state: ScriptState) {
  const evalExpr = (text: string): number => {
    const names = Object.keys(state.vars);
    if (!/^[\w\s.+\-*/%()^,]*$/.test(text.replace(/Math\.\w+/g, ''))) throw new SelectorError(`expression "${text}" has characters that are not allowed`, callerLine());
    const v = new Function(...names, 'Math', `return (${text.replace(/\^/g, '**')});`)(...names.map((n) => state.vars[n]), Math);
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new SelectorError(`expression "${text}" is not a number`, callerLine());
    return v;
  };
  return {
    part: (name = 'Script part'): PartBuilder => {
      const p = new PartBuilder(name);
      state.parts.push(p);
      return p;
    },
    /** variables({w: 60, t: 'w/10'}): named values; strings are expressions over earlier ones. Returns the numbers; use expr('w*2') to keep a parameter linked to a variable. */
    variables: (defs: Record<string, number | string>): Record<string, number> => {
      for (const [name, v] of Object.entries(defs)) {
        const text = String(v).replace(/^=/, '');
        state.vars[name] = typeof v === 'number' ? v : evalExpr(text);
        state.varDefs.push({ name, expr: text });
      }
      return { ...state.vars };
    },
    expr: (text: string): Expr => new Expr(text, evalExpr(text)),
    face, edges, through,
  };
}
export type ScriptApi = ReturnType<typeof makeApi>;
