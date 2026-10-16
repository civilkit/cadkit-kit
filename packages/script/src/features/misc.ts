// Surfaces, threads, assemblies and the raw-feature escape hatch. Mixed into PartBuilder by features/index.ts.
import type { Ctx, EditOp, Num, OffsetPlane, PartBuilder, Plane } from '../recorder';
import type { EdgeSel, FaceSel } from '../selectors';
import { FEATURE_TYPES } from '@ck/part-model';
import { H, memOf, planeRef, sketchOps, type SketchSpec } from './h';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Replace script handles inside a raw feature: face() -> persistent face name, edges() -> edge refs, '$last' / '$sketch' -> ids of the previous steps. */
function resolveHandles(v: unknown, ctx: Ctx, pre: EditOp[], key: string, line: number): unknown {
  if (typeof v === 'string') {
    if (v === '$last' || v === '$sketch') {
      const id = v === '$last' ? ctx.lastFeature : ctx.lastSketch;
      if (!id) throw new H.SelectorError(`feature(): ${v} has no earlier ${v === '$last' ? 'feature' : 'sketch'}`, line);
      return id;
    }
    return v;
  }
  if (Array.isArray(v)) return v.flatMap((x) => (isObj(x) && x.kind === 'edges' && 'sel' in x ? (resolveHandles(x, ctx, pre, key, line) as unknown[]) : [resolveHandles(x, ctx, pre, key, line)]));
  if (!isObj(v)) return v;
  if (v.kind === 'face' && typeof v.sel === 'string') {
    const id = H.resolveFace(v.sel, ctx.geo, (v as unknown as FaceSel).line).id;
    return key === 'plane' || key === 'neutral' || key === 'axis' ? { kind: 'face', id } : id;
  }
  if (v.kind === 'edges' && 'sel' in v) return H.resolveEdges((v as unknown as EdgeSel).sel, ctx.geo, (v as unknown as EdgeSel).line);
  if (v.kind === 'offset' && typeof v.plane === 'string' && 'offset' in v) return planeRef(ctx, v as unknown as OffsetPlane, pre);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveHandles(x, ctx, pre, k, line)]));
}

const SURFACE_END = 'surfaces are sheets, not solids: thicken() them or knit() a closed set into a solid';

export const miscFeatures = {
  /**
   * Append any kernel feature as raw JSON (escape hatch for features without a helper).
   *
   * Validates json.type against the kernel's feature list, assigns the id and adds the feature after the previous step. face(sel) inside the JSON becomes the persistent face name (or a { kind: 'face', id } reference under plane / neutral / axis), edges(sel) becomes the edge references (spliced into arrays), at(plane, offset) becomes a reference plane feature, and the strings '$last' and '$sketch' stand for the id of the previous feature / sketch. Use it for types like draft, helix, lip, dome or moveFace; prefer the typed helpers when one exists. Field names are the kernel's (docs/spec-agent-interface.md).
   * @domain features
   * @param json the feature object, e.g. { type: 'shell', faces: [face('>Z')], thickness: 2 }
   * @example
   * part('Cup').sketch('front', (s) => s.rect(40, 40)).extrude(20)
   *   .feature({ type: 'shell', faces: [face('>Z')], thickness: 2 });
   * @see part.sketchFeature, face, edges
   */
  feature(this: PartBuilder, json: Record<string, unknown>): PartBuilder {
    const line = H.callerLine();
    if (!isObj(json) || typeof json.type !== 'string') throw new H.SelectorError('feature() needs an object with a type, e.g. { type: "shell", faces: [face(">Z")], thickness: 2 }', line);
    if (!(FEATURE_TYPES as readonly string[]).includes(json.type)) throw new H.SelectorError(`feature(): unknown type "${json.type}". Known: ${FEATURE_TYPES.join(', ')}`, line);
    if (json.type === 'sketch') throw new H.SelectorError('feature(): use sketchFeature() for a raw sketch', line);
    this.steps.push({ line, label: String(json.type), run: (ctx) => {
      const pre: EditOp[] = [];
      const f = resolveHandles(json, ctx, pre, '', line) as Record<string, unknown>;
      const id = typeof f.id === 'string' ? f.id : ctx.nextId();
      ctx.lastFeature = id;
      if (f.type === 'sketch3d') ctx.lastSketch = id;
      return [...pre, { op: 'add', feature: { ...f, id } }];
    } });
    return this;
  },

  /**
   * Append a raw sketch (points, entities, constraints) on a plane.
   *
   * For sketches the builder cannot draw: pass the kernel's sketch JSON { points, entities, constraints? } and the plane ('front' | 'top' | 'right', at(plane, offset) or face(sel)). The next extrude, cut, revolve or rib consumes it. Point ids and entity ids are yours; remember the origin point O exists only if you declare it.
   * @domain sketch
   * @param on 'front' | 'top' | 'right', at(plane, offset) or face(sel)
   * @param json { points: [{ id, x, y }], entities: [{ id, type, ... }], constraints?: [] }
   * @example
   * part('Tri').sketchFeature('front', { points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 0 }, { id: 'c', x: 0, y: 20 }],
   *   entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'b', p2: 'c' }, { id: 'e3', type: 'line', p1: 'c', p2: 'a' }] }).extrude(5);
   * @see part.feature, part.sketch
   */
  sketchFeature(this: PartBuilder, on: Plane | OffsetPlane | FaceSel, json: { points: Array<Record<string, unknown>>; entities: Array<Record<string, unknown>>; constraints?: Array<Record<string, unknown>> }): PartBuilder {
    const line = H.callerLine();
    if (!isObj(json) || !Array.isArray(json.points) || !Array.isArray(json.entities)) throw new H.SelectorError('sketchFeature() needs { points: [...], entities: [...] }', line);
    this.steps.push({ line, label: 'sketch', run: (ctx) => {
      const pre: EditOp[] = [];
      const plane = planeRef(ctx, on, pre);
      const id = ctx.nextId();
      ctx.lastSketch = id; ctx.lastFeature = id;
      return [...pre, { op: 'add', feature: { type: 'sketch', id, plane, points: json.points, entities: json.entities, constraints: json.constraints ?? [] } }];
    } });
    return this;
  },

  /**
   * Add a cosmetic or modeled screw thread to a bore or cylinder.
   *
   * Threads the wall of the bore drilled last (default 'hole'), or a cylinder named by a persistent face name ('F2.S.c1') or 'last:c1' (the c1 face of the last feature, e.g. an extruded circle shaft). Give the designation as size ('M6', 'M12x1.5', '1/4-20') or diameter (+ pitch). Cosmetic by default: no geometry change, the thread is reported in the regen threads list. modeled: true cuts the real helical groove (slow, falls back to cosmetic with a warning). The bore should be the tap drill of the size: the tapped kind of hole() sets that for you.
   * @domain features
   * @param on "hole" for the last hole drilled; a face name string; or 'last:<tag>'
   * @param o.size designation, e.g. 'M6' or 'M12x1.5'
   * @param o.diameter major diameter in mm (alternative to size)
   * @param o.pitch pitch in mm with diameter (fine pitch)
   * @param o.length thread length in mm, default the whole face
   * @param o.standard 'metric' (default), 'metric-fine', 'UNC', ... (inferred from the size when omitted)
   * @param o.hand 'right' (default) | 'left'
   * @param o.modeled cut the helical groove
   * @example
   * part('Tapped block').sketch('front', (s) => s.rect(30, 30)).extrude(20)
   *   .hole(face('>Z'), [0, 0], { diameter: 5, depth: 12 })
   *   .thread('hole', { size: 'M6', length: 10 });
   * @see part.hole, part.holes.points
   */
  thread(this: PartBuilder, on: string, o: { size?: string; diameter?: number; pitch?: number; length?: Num; standard?: string; hand?: 'right' | 'left'; modeled?: boolean }): PartBuilder {
    const line = H.callerLine();
    const size = o.size ?? (o.diameter !== undefined ? (o.pitch !== undefined ? `M${+o.diameter.toFixed(4)}x${+o.pitch.toFixed(4)}` : `M${+o.diameter.toFixed(4)}`) : undefined);
    if (!size) throw new H.SelectorError('thread() needs size ("M6") or diameter', line);
    this.steps.push({ line, label: 'thread', run: (ctx) => {
      const mem = memOf(ctx);
      const faces: string[] = [];
      if (on === undefined || on === 'hole') {
        const h = mem.holes.at(-1);
        if (!h) throw new H.SelectorError('thread(): there is no hole before it; drill one first or pass a face name', line);
        for (let k = 0; k < h.n; k++) faces.push(`${h.id}.S.h1${h.n > 1 ? `~${k + 1}` : ''}`);
      } else if (on.startsWith('last:')) {
        if (!ctx.lastFeature) throw new H.SelectorError('thread(): no feature before it', line);
        faces.push(`${ctx.lastFeature}.S.${on.slice(5)}`);
      } else faces.push(on);
      return faces.map((face) => threadOp(ctx, face, size, o));
    } });
    return this;
  },

  /**
   * Surface: extrude the last sketch into a sheet (no end caps, not a solid).
   *
   * Like extrude but the result is a surface body (open sheet). Use thicken() to give it a wall, or knit() a closed set of sheets into a solid. A closed profile gives a tube sheet open at both ends; an open sketch gives a ribbon.
   * @domain surfaces
   * @param depth length in mm
   * @param o.flip reverse direction
   * @example
   * part('Ribbon').sketch('front', (s) => s.polyline([[0, 0], [20, 10], [40, 0]])).surfaceExtrude(30).thicken(2);
   * @see part.thicken, part.knit, part.surfaceLoft
   */
  surfaceExtrude(this: PartBuilder, depth: Num, o: { flip?: boolean } = {}): PartBuilder {
    const line = H.callerLine();
    this.steps.push({ line, label: 'surfaceExtrude', run: (ctx) => {
      if (!ctx.lastSketch) throw new H.SelectorError('surfaceExtrude() needs a sketch before it', line);
      const id = ctx.nextId();
      memOf(ctx).surfaces.push(id);
      const f: Record<string, unknown> = { type: 'surfaceExtrude', id, sketch: ctx.lastSketch, end: 'blind', depth: H.ref(depth) };
      if (o.flip) f.flip = true;
      ctx.lastFeature = id; ctx.lastSketch = null;
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Surface: a flat sheet filling the last closed sketch.
   *
   * Makes a planar surface body from a closed profile. Use it to cap surface tubes before knit(solid: true).
   * @domain surfaces
   * @example
   * part('Lid sheet').sketch('front', (s) => s.rect(30, 20)).surfacePlanar();
   * @see part.knit, part.surfaceExtrude
   */
  surfacePlanar(this: PartBuilder): PartBuilder {
    const line = H.callerLine();
    this.steps.push({ line, label: 'surfacePlanar', run: (ctx) => {
      if (!ctx.lastSketch) throw new H.SelectorError('surfacePlanar() needs a closed sketch before it', line);
      const id = ctx.nextId();
      memOf(ctx).surfaces.push(id);
      const sketch = ctx.lastSketch;
      ctx.lastFeature = id; ctx.lastSketch = null;
      return [{ op: 'add', feature: { type: 'surfacePlanar', id, sketch } }];
    } });
    return this;
  },

  /**
   * Surface: loft a sheet through section sketches (open or closed curves).
   *
   * Like loft() but the result is a surface body, so open curves (arcs, splines) work as sections. All sections should be the same kind (all open or all closed). The sheet is a surface body: thicken() works on planar and cylindrical sheets (a thicken of a doubly curved lofted sheet answers offsetUnsupported).
   * @domain surfaces
   * @param sections list of { on, draw } section sketches, at least two
   * @example
   * part('Panel').surfaceLoft([
   *   { on: 'front', draw: (s) => s.arc3([-20, 0], [0, 6], [20, 0]) },
   *   { on: at('front', 30), draw: (s) => s.arc3([-20, 0], [0, 12], [20, 0]) },
   * ]);
   * @see part.loft, part.thicken
   */
  surfaceLoft(this: PartBuilder, sections: SketchSpec[]): PartBuilder {
    const line = H.callerLine();
    if (!Array.isArray(sections) || sections.length < 2 || sections.some((s) => !s?.on || !s.draw)) throw new H.SelectorError('surfaceLoft() needs at least two sections { on, draw }', line);
    this.steps.push({ line, label: 'surfaceLoft', run: (ctx) => {
      const ops: EditOp[] = [];
      const ids = sections.map((s) => sketchOps(ctx, s, ops));
      const id = ctx.nextId();
      memOf(ctx).surfaces.push(id);
      ops.push({ op: 'add', feature: { type: 'loft', id, op: 'add', sketches: ids, surface: true } });
      ctx.lastFeature = id; ctx.lastSketch = null;
      return ops;
    } });
    return this;
  },

  /**
   * Surface: give the last surface a wall thickness and make it a solid.
   *
   * Thickens the most recent surface feature (surfaceExtrude, surfacePlanar, surfaceLoft or knit) into a solid wall of this thickness. It fails on a surface that folds or has a pole (thickenFailed).
   * @domain surfaces
   * @param thickness wall thickness in mm
   * @param o.op 'add' (default) or 'cut'
   * @example
   * part('Wall').sketch('front', (s) => s.arc3([-20, 0], [0, 10], [20, 0])).surfaceExtrude(30).thicken(2);
   * @see part.surfaceExtrude, part.knit
   */
  thicken(this: PartBuilder, thickness: Num, o: { op?: 'add' | 'cut' } = {}): PartBuilder {
    const line = H.callerLine();
    this.steps.push({ line, label: 'thicken', run: (ctx) => {
      const target = memOf(ctx).surfaces.at(-1);
      if (!target) throw new H.SelectorError(`thicken() needs a surface before it; ${SURFACE_END}`, line);
      const id = ctx.nextId();
      ctx.lastFeature = id;
      return [{ op: 'add', feature: { type: 'thicken', id, surface: target, thickness: H.ref(thickness), ...(o.op ? { op: o.op } : {}) } }];
    } });
    return this;
  },

  /**
   * Surface: sew all surfaces so far into one body (a solid when they close).
   *
   * Knits every surface feature made earlier in the script. With solid: true a closed set becomes a solid body (knitNotClosed when there are gaps); with solid: false (default) the result stays a sheet.
   * @domain surfaces
   * @param o.solid make a solid from a closed shell
   * @example
   * part('Box from sheets')
   *   .sketch('front', (s) => s.rect(20, 20)).surfaceExtrude(10)
   *   .sketch('front', (s) => s.rect(20, 20)).surfacePlanar()
   *   .sketch(at('front', 10), (s) => s.rect(20, 20)).surfacePlanar()
   *   .knit({ solid: true });
   * @see part.surfaceExtrude, part.surfacePlanar, part.thicken
   */
  knit(this: PartBuilder, o: { solid?: boolean } = {}): PartBuilder {
    const line = H.callerLine();
    this.steps.push({ line, label: 'knit', run: (ctx) => {
      const mem = memOf(ctx);
      if (!mem.surfaces.length) throw new H.SelectorError(`knit() needs surfaces before it; ${SURFACE_END}`, line);
      const id = ctx.nextId();
      const surfaces = [...new Set(mem.surfaces)];
      if (o.solid !== true) mem.surfaces.push(id);
      ctx.lastFeature = id;
      return [{ op: 'add', feature: { type: 'knit', id, surfaces, solid: o.solid === true } }];
    } });
    return this;
  },

  /**
   * Assembly: insert another part (its document) as a component, optionally moved.
   *
   * Adds an insertPart feature that carries the whole part document (the .document of a runScript result, or a saved part). The component is its own body in the model, so a later mate() can position it. at moves it by [x, y, z] mm; fixed keeps mates from moving it. A part document is needed, not code: run the other script first. Assemblies live inside one part document; there is no separate assembly document in the script API.
   * @domain assembly
   * @param doc the inserted part's document object
   * @param o.at [x, y, z] placement in mm, default [0, 0, 0]
   * @param o.fixed true to anchor the component
   * @param o.name label for the component
   * @example
   * const pin = { format: 'ck-part', version: 1, name: 'Pin', features: [], seq: 1, rollback: null };
   * part('Asm').insertPart(pin, { at: [10, 0, 0] });
   * @see part.mate
   */
  insertPart(this: PartBuilder, doc: Record<string, unknown>, o: { at?: [number, number, number]; fixed?: boolean; name?: string } = {}): PartBuilder {
    const line = H.callerLine();
    if (!isObj(doc) || !Array.isArray(doc.features)) throw new H.SelectorError('insertPart() needs a part document ({ features: [...] })', line);
    this.steps.push({ line, label: 'insertPart', run: (ctx) => {
      const id = ctx.nextId();
      ctx.lastFeature = id;
      memOf(ctx).inserts.push(id);
      const [dx, dy, dz] = o.at ?? [0, 0, 0];
      return [{ op: 'add', feature: { type: 'insertPart', id, ...(o.name ? { name: o.name } : {}), part: structuredClone(doc), source: o.name ?? String(doc.name ?? 'part'), fixed: o.fixed === true, dx, dy, dz } }];
    } });
    return this;
  },

  /**
   * Assembly: constrain two faces of different components.
   *
   * Adds a mate of the given kind between faces a and b: coincident, parallel, perpendicular, concentric (round faces), distance (needs distance), angle (needs angle), tangent, lock. A face is { part: n, face: 'F2.C1' }: the face named F2.C1 inside the n-th insertPart() call (1-based), or a persistent name string with the @component suffix, or face(sel) of the current body. flip reverses the alignment. The component that is not fixed moves, so insert the stationary one with fixed: true.
   * @domain assembly
   * @param o.kind mate kind, e.g. 'coincident'
   * @param o.a first face: { part, face } | persistent name | face(sel)
   * @param o.b second face: { part, face } | persistent name | face(sel)
   * @param o.distance distance in mm for kind 'distance'
   * @param o.angle degrees for kind 'angle'
   * @param o.flip reverse the alignment
   * @example
   * const doc = { format: 'ck-part', version: 1, name: 'Plate', features: [], seq: 1, rollback: null };
   * part('Stack').insertPart(doc, { fixed: true }).insertPart(doc, { at: [0, 0, 30] })
   *   .mate({ kind: 'coincident', a: { part: 1, face: 'F2.C1' }, b: { part: 2, face: 'F2.C0' } });
   * @see part.insertPart, face
   */
  mate(this: PartBuilder, o: { kind: string; a: FaceSel | string | { part: number; face: string }; b: FaceSel | string | { part: number; face: string }; distance?: Num; angle?: Num; flip?: boolean }): PartBuilder {
    const line = H.callerLine();
    if (!o?.kind || !o.a || !o.b) throw new H.SelectorError('mate() needs { kind, a, b }', line);
    this.steps.push({ line, label: 'mate', run: (ctx) => {
      const face = (f: FaceSel | string | { part: number; face: string }): string => {
        if (typeof f === 'string') return f;
        if ('part' in f) {
          const ins = memOf(ctx).inserts[f.part - 1];
          if (!ins) throw new H.SelectorError(`mate(): there is no inserted part number ${f.part} (insertPart calls so far: ${memOf(ctx).inserts.length})`, line);
          return `${f.face}@${ins}.1`;
        }
        return H.resolveFaceSel(f, ctx.geo, ctx.warn).id;
      };
      const id = ctx.nextId();
      ctx.lastFeature = id;
      const m: Record<string, unknown> = { type: 'mate', id, kind: o.kind, a: face(o.a), b: face(o.b) };
      if (o.distance !== undefined) m.distance = H.ref(o.distance);
      if (o.angle !== undefined) m.angle = H.ref(o.angle);
      if (o.flip) m.flip = true;
      return [{ op: 'add', feature: m }];
    } });
    return this;
  },
};

/** The thread feature for one face (used by thread() and by hole(..., { thread })). */
export function threadOp(ctx: Ctx, face: string, size: string, o: { standard?: string; length?: Num; hand?: 'right' | 'left'; modeled?: boolean; class?: string }): EditOp {
  const standard = o.standard ?? (/^M[\d.]+x[\d.]+$/.test(size) ? 'metric-fine' : /^M[\d.]+$/.test(size) ? 'metric' : /^#|\/|^\d/.test(size) ? 'UNC' : 'metric');
  const f: Record<string, unknown> = { type: 'thread', id: ctx.nextId(), face, standard, size, length: o.length === undefined ? 'full' : H.ref(o.length), hand: o.hand ?? 'right', modeled: o.modeled === true };
  if (o.class) f.class = o.class;
  ctx.lastFeature = f.id as string;
  return { op: 'add', feature: f };
}
