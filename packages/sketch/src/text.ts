/**
 * Lettering in the sketch editor (docs/text.md in the kernel repo, docs/text.md in the kit).
 *
 * A text entity `{type:'text', string, font, height, p, anchor, angle, spacing, mirror, arc}` is fixed geometry whose anchor is a
 * normal sketch point `p`, so the point can be dragged, locked and dimensioned like any other. The outlines come from the kernel
 * (`textOutline`, asynchronous); this module keeps a cache of them keyed by the entity's fields and resolved position, builds the
 * request from a draft, and edits a text entity immutably (the panel and the tool both use it). No DOM, no kernel calls: the
 * caller injects the fetch.
 */
import type { DraftEntity, SketchDraft } from './types';
import { nextId } from './tools/builders';
import type { Pt } from './tools/types';
import { sampleSpline } from './tools/splineOffset';

/** A built-in font ('gauge', 'engrave') or the name of a font loaded into the kernel (a curated id, or a slug of a user's font). */
export type TextFont = string;
export type TextHAnchor = 'left' | 'center' | 'right';
export type TextVAnchor = 'baseline' | 'middle' | 'top';

export const TEXT_DEFAULTS = { string: 'TEXT', font: 'gauge' as TextFont, height: 5 };
/** The built-in fonts. */
export const TEXT_FONTS: TextFont[] = ['gauge', 'engrave'];
export const TEXT_H: TextHAnchor[] = ['left', 'center', 'right'];
export const TEXT_V: TextVAnchor[] = ['top', 'middle', 'baseline'];
/** Below this cap height (mm) the kernel warns `textTooSmall`. */
export const TEXT_MIN_HEIGHT = 0.8;

export interface TextOutlineData {
  regions: Array<{ outer: number[][]; holes: number[][][] }>;
  bbox: number[];
  area: number;
  warnings: Array<{ code?: string; detail?: string; [k: string]: unknown }>;
}
/** A failed request is cached too (the message is shown in the panel), so a bad entity is not asked again every redraw. */
export type TextOutlineEntry = TextOutlineData | { error: string };
export const isOutlineError = (e: TextOutlineEntry | undefined): e is { error: string } => !!e && 'error' in e;

export const isText = (e: { [k: string]: unknown } | undefined | null): boolean => e?.type === 'text';

interface PointsLike { points: Array<{ id: string; x: number; y: number }>; entities?: Array<{ [k: string]: unknown }> }

/** The curve kinds a text can follow: a line, arc, circle, ellipse or spline of the sketch (construction ones too). */
export const isPathCurve = (e: { [k: string]: unknown } | undefined | null): boolean => !!e && ['line', 'arc', 'circle', 'ellipse', 'spline', 'cvspline'].includes(String(e.type));

/** A polyline along a sketch curve in the direction the kernel travels it (a line p1 to p2, an arc counter-clockwise p1 to p2, a circle from angle 0); null when it is not a curve or its points are missing. */
export function pathPolyline(sketch: PointsLike, id: string): Pt[] | null {
  const e = sketch.entities?.find((x) => x.id === id);
  if (!e || !isPathCurve(e)) return null;
  const pt = (k: unknown) => { const q = typeof k === 'string' ? sketch.points.find((p) => p.id === k) : undefined; return q ? { x: q.x, y: q.y } : null; };
  const N = 120;
  switch (e.type) {
    case 'line': { const a = pt(e.p1), b = pt(e.p2); return a && b ? [a, b] : null; }
    case 'circle': { const c = pt(e.c), r = Math.abs(Number(e.r)); return c && r > 0 ? Array.from({ length: N + 1 }, (_, i) => { const t = (2 * Math.PI * i) / N; return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }; }) : null; }
    case 'arc': {
      const c = pt(e.c), a = pt(e.p1), b = pt(e.p2);
      if (!c || !a || !b) return null;
      const a0 = Math.atan2(a.y - c.y, a.x - c.x);
      let sw = Math.atan2(b.y - c.y, b.x - c.x) - a0;
      while (sw <= 1e-12) sw += 2 * Math.PI;
      while (sw > 2 * Math.PI + 1e-12) sw -= 2 * Math.PI;
      const r = Math.hypot(a.x - c.x, a.y - c.y);
      return r > 0 ? Array.from({ length: N + 1 }, (_, i) => { const t = a0 + (sw * i) / N; return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }; }) : null;
    }
    case 'ellipse': {
      const c = pt(e.c), p = pt(e.p), r = Number(e.r);
      if (!c || !p) return null;
      const ux = p.x - c.x, uy = p.y - c.y, lu = Math.hypot(ux, uy);
      if (lu <= 0) return null;
      const vx = (-uy / lu) * r, vy = (ux / lu) * r;
      return Array.from({ length: N + 1 }, (_, i) => { const t = (2 * Math.PI * i) / N; return { x: c.x + ux * Math.cos(t) + vx * Math.sin(t), y: c.y + uy * Math.cos(t) + vy * Math.sin(t) }; });
    }
    default: {
      const ps = (Array.isArray(e.pts) ? e.pts : []).map(pt).filter((q): q is Pt => !!q);
      if (ps.length < 2) return null;
      const closed = e.closed === true;
      const s = sampleSpline(ps, closed);
      return closed ? [...s, s[0]] : s;
    }
  }
}

/** The `textOutline` request for a text entity of a sketch: the anchor point and the arc centre point are resolved to coordinates. Null when the anchor is missing. */
export function textSpec(sketch: PointsLike, e: { [k: string]: unknown }): Record<string, unknown> | null {
  const pt = (id: unknown) => (typeof id === 'string' ? sketch.points.find((p) => p.id === id) : undefined);
  const spec: Record<string, unknown> = {};
  for (const k of ['string', 'font', 'height', 'anchor', 'angle', 'spacing', 'mirror', 'polyline']) if (e[k] !== undefined) spec[k] = e[k];
  const p = pt(e.p);
  if (p) spec.at = [p.x, p.y];
  else if (Array.isArray(e.at)) spec.at = e.at;
  else return null;
  if (e.arc && typeof e.arc === 'object') {
    const arc = { ...(e.arc as Record<string, unknown>) };
    const c = pt(arc.c);
    if (c) arc.centre = [c.x, c.y];
    delete arc.c;
    spec.arc = arc;
  }
  if (typeof e.path === 'string') {
    // the letters follow another entity of the sketch: the preview sends its polyline (the kernel resolves the id itself when it regenerates)
    const poly = pathPolyline(sketch, e.path);
    if (poly) {
      spec.path = poly.map((q) => [q.x, q.y]);
      if (e.pathOffset !== undefined) spec.pathOffset = e.pathOffset;
      if (e.pathFlip === true) spec.pathFlip = true;
    }
  }
  return spec;
}
export const textKey = (spec: Record<string, unknown>): string => JSON.stringify(spec);

const cache = new Map<string, TextOutlineEntry>();
const inflight = new Map<string, Promise<void>>();
const MAX_CACHE = 400;
export const textCacheGet = (key: string): TextOutlineEntry | undefined => cache.get(key);
export const textCacheClear = (): void => { cache.clear(); inflight.clear(); };
export function textCachePut(key: string, v: TextOutlineEntry): void {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, v);
}

/** The cached outline of a text entity, or undefined while it has not arrived. */
export function textOutlineOf(sketch: PointsLike, e: { [k: string]: unknown }): TextOutlineEntry | undefined {
  const spec = textSpec(sketch, e);
  return spec ? cache.get(textKey(spec)) : undefined;
}

/** Ask for the outlines of every text entity that is not cached yet; `onChange` runs once when something new arrived. */
export function ensureTextOutlines(
  sketch: PointsLike & { entities: Array<{ [k: string]: unknown; type?: unknown }> },
  fetchOutline: (spec: Record<string, unknown>) => Promise<TextOutlineData>,
  onChange: () => void,
): Promise<void> {
  const todo: Array<[string, Record<string, unknown>]> = [];
  for (const e of sketch.entities) {
    if (!isText(e) || e.construction === true) continue;
    const spec = textSpec(sketch, e);
    if (!spec) continue;
    const key = textKey(spec);
    if (!cache.has(key) && !inflight.has(key)) todo.push([key, spec]);
  }
  if (!todo.length) return Promise.resolve();
  return Promise.all(todo.map(([key, spec]) => {
    const run = fetchOutline(spec).then((d) => { textCachePut(key, d); }, (err: unknown) => { textCachePut(key, { error: String((err as Error)?.message ?? err) }); }).finally(() => { inflight.delete(key); });
    inflight.set(key, run);
    return run;
  })).then(() => { onChange(); });
}

/** Outline loops of a text entity as polylines in sketch coordinates (outer boundaries and holes). */
export function textLoops(d: TextOutlineEntry | undefined): number[][][] {
  if (!d || isOutlineError(d)) return [];
  return d.regions.flatMap((r) => [r.outer, ...r.holes]);
}

/** Ink box [x0, y0, x1, y1] of the cached outline in sketch coordinates, or null. */
export function textInkBox(d: TextOutlineEntry | undefined): number[] | null {
  if (!d || isOutlineError(d) || !d.bbox || d.bbox.length < 4) return null;
  return d.bbox;
}

/** Distance from `at` to the text's ink: 0 inside a letter region's bounding box of the whole string, else the distance to the box. Infinity when no outline is cached. */
export function textDistance(sketch: PointsLike, e: { [k: string]: unknown }, at: Pt): number {
  const o = textOutlineOf(sketch, e);
  const b = textInkBox(o);
  if (!b) {
    const p = sketch.points.find((q) => q.id === e.p);
    return p ? Math.hypot(at.x - p.x, at.y - p.y) : Infinity;
  }
  const dx = Math.max(b[0] - at.x, 0, at.x - b[2]), dy = Math.max(b[1] - at.y, 0, at.y - b[3]);
  return Math.hypot(dx, dy);
}

export interface TextPatch {
  string?: string; font?: TextFont; /** pins the font file (prefix of its SHA-256); null / absent with a new `font` clears it */ fontHash?: string | null; height?: number; anchor?: [TextHAnchor, TextVAnchor]; angle?: number; spacing?: number; mirror?: boolean;
  /** true: lay along an arc with the given parameters (missing ones keep the old value or the default); false: straight */
  /** false: not along a curve; else the sketch curve (entity id) the letters follow, the slide along it and the direction */
  path?: false | { id?: string; offset?: number; flip?: boolean };
  arc?: false | { radius?: number; angleCentre?: number; side?: 'outside' | 'inside'; centre?: Pt; /** an existing sketch point as the centre */ centreId?: string };
}

const ARC_DEFAULT = { radius: 30, angleCentre: 90, side: 'outside' as const };

/** Edit the fields of a text entity; the anchor point and every other entity stay. Returns the same draft when nothing changes. */
export function patchText(draft: SketchDraft, id: string, patch: TextPatch): SketchDraft {
  const i = draft.entities.findIndex((e) => e.id === id && isText(e));
  if (i < 0) return draft;
  const old = draft.entities[i];
  const e: DraftEntity = { ...old };
  let points = draft.points;
  const set = <K extends keyof TextPatch>(k: K, v: unknown, dflt?: unknown) => { if (v === dflt) delete e[k as string]; else e[k as string] = v; };
  if (patch.string !== undefined) e.string = patch.string;
  if (patch.font !== undefined) { e.font = patch.font; if (patch.fontHash === undefined) delete e.fontHash; }
  if (patch.fontHash) e.fontHash = patch.fontHash; else if (patch.fontHash === null) delete e.fontHash;
  if (patch.height !== undefined && Number.isFinite(patch.height)) e.height = patch.height;
  if (patch.anchor !== undefined) set('anchor', patch.anchor, undefined);
  if (patch.angle !== undefined && Number.isFinite(patch.angle)) set('angle', patch.angle, 0);
  if (patch.spacing !== undefined && Number.isFinite(patch.spacing)) set('spacing', patch.spacing, 1);
  if (patch.mirror !== undefined) set('mirror', patch.mirror, false);
  if (patch.path === false) { delete e.path; delete e.pathOffset; delete e.pathFlip; }
  else if (patch.path) {
    if (patch.path.id !== undefined) e.path = patch.path.id;
    else if (e.path === undefined) e.path = '';   // switched on, the curve still to be picked
    delete e.arc;   // an arc and a path exclude each other
    if (patch.path.offset !== undefined && Number.isFinite(patch.path.offset)) { if (patch.path.offset === 0) delete e.pathOffset; else e.pathOffset = patch.path.offset; }
    if (patch.path.flip !== undefined) { if (patch.path.flip) e.pathFlip = true; else delete e.pathFlip; }
  }
  if (patch.arc === false) delete e.arc;
  else if (patch.arc) {
    delete e.path; delete e.pathOffset; delete e.pathFlip;   // an arc and a path exclude each other
    const prev = (old.arc as Record<string, unknown> | undefined) ?? {};
    const arc: Record<string, unknown> = { radius: prev.radius ?? ARC_DEFAULT.radius, angleCentre: prev.angleCentre ?? ARC_DEFAULT.angleCentre, side: prev.side ?? ARC_DEFAULT.side };
    if (prev.c !== undefined) arc.c = prev.c;
    if (prev.centre !== undefined) arc.centre = prev.centre;
    if (patch.arc.radius !== undefined && Number.isFinite(patch.arc.radius)) arc.radius = patch.arc.radius;
    if (patch.arc.angleCentre !== undefined && Number.isFinite(patch.arc.angleCentre)) arc.angleCentre = patch.arc.angleCentre;
    if (patch.arc.side) arc.side = patch.arc.side;
    if (patch.arc.centreId) { delete arc.centre; arc.c = patch.arc.centreId; }
    else if (patch.arc.centre) {
      // a fresh centre is a plain coordinate pair; an old point reference is dropped
      delete arc.c; arc.centre = [patch.arc.centre.x, patch.arc.centre.y];
    } else if (arc.c === undefined && arc.centre === undefined) {
      const p = draft.points.find((q) => q.id === old.p);
      arc.centre = p ? [p.x, p.y] : [0, 0];
    }
    e.arc = arc;
  }
  const entities = draft.entities.slice();
  entities[i] = e;
  return { ...draft, points, entities };
}

/** Add a text entity anchored at `at` (an existing sketch point id reuses that point). Returns the new draft and the entity id. */
export function addText(draft: SketchDraft, at: Pt, opts: { string?: string; font?: TextFont; height?: number; pointId?: string; anchor?: [TextHAnchor, TextVAnchor] } = {}): { draft: SketchDraft; id: string } {
  let d = draft;
  let p = opts.pointId;
  if (!p) { p = nextId(d, 'p'); d = { ...d, points: [...d.points, { id: p, x: at.x, y: at.y }] }; }
  const id = nextId(d, 'e');
  const e: DraftEntity = { id, type: 'text', string: opts.string ?? TEXT_DEFAULTS.string, font: opts.font ?? TEXT_DEFAULTS.font, height: opts.height ?? TEXT_DEFAULTS.height, p, anchor: opts.anchor ?? ['left', 'baseline'] };
  return { draft: { ...d, entities: [...d.entities, e] }, id };
}

/** What the panel shows for a text entity: every field with its default filled in. */
export interface TextFields {
  string: string; font: TextFont; fontHash?: string; height: number; anchor: [TextHAnchor, TextVAnchor]; angle: number; spacing: number; mirror: boolean;
  arc: null | { radius: number; angleCentre: number; side: 'outside' | 'inside'; centre: Pt };
  /** the curve the letters follow, null when they do not; `id` may be empty while it is being picked */
  path?: null | { id: string; offset: number; flip: boolean };
  x: number; y: number;
}
export function textFields(draft: SketchDraft, id: string): TextFields | null {
  const e = draft.entities.find((x) => x.id === id && isText(x));
  if (!e) return null;
  const p = draft.points.find((q) => q.id === e.p);
  const a = (e.anchor as [TextHAnchor?, TextVAnchor?] | undefined) ?? [];
  const arc = e.arc as { radius?: number; angleCentre?: number; side?: 'outside' | 'inside'; c?: string; centre?: number[] } | undefined;
  const cp = arc?.c ? draft.points.find((q) => q.id === arc.c) : undefined;
  return {
    string: String(e.string ?? ''), font: typeof e.font === 'string' && e.font ? e.font : 'gauge', ...(typeof e.fontHash === 'string' ? { fontHash: e.fontHash } : {}), height: Number(e.height ?? TEXT_DEFAULTS.height),
    anchor: [a[0] ?? 'left', a[1] ?? 'baseline'], angle: Number(e.angle ?? 0), spacing: Number(e.spacing ?? 1), mirror: e.mirror === true,
    arc: arc ? { radius: Number(arc.radius ?? ARC_DEFAULT.radius), angleCentre: Number(arc.angleCentre ?? 90), side: arc.side === 'inside' ? 'inside' : 'outside', centre: cp ? { x: cp.x, y: cp.y } : { x: Number(arc.centre?.[0] ?? 0), y: Number(arc.centre?.[1] ?? 0) } } : null,
    path: typeof e.path === 'string' ? { id: e.path, offset: Number(e.pathOffset ?? 0), flip: e.pathFlip === true } : null,
    x: p?.x ?? 0, y: p?.y ?? 0,
  };
}

/** i18n keys and params of the warnings / error of an entity's cached outline (the panel and the status bar show them). */
export function textNotes(d: TextOutlineEntry | undefined): Array<{ key: string; params?: Record<string, string> }> {
  if (!d) return [];
  if (isOutlineError(d)) {
    const m = /\btext(Empty|NothingToDraw|BadFont|BadHeight|BadArc|BadPath|BadValue|FontNotLoaded|FontMismatch)\b/.exec(d.error);
    return [{ key: 'app.sketch.text.err.' + (m ? m[1] : 'Other'), params: { detail: d.error } }];
  }
  return d.warnings.flatMap((w) => {
    const code = String(w.code ?? '');
    if (!/^text(TooSmall|MissingGlyph|Truncated|SpacingAdjusted|Overlap|OverlappingContours)$/.test(code)) return [];
    return [{ key: 'app.sketch.text.warn.' + code.slice(4), params: { detail: String(w.detail ?? '') } }];
  });
}
