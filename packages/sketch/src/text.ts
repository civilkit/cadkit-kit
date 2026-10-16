/**
 * Lettering in the sketch editor (docs/text.md in the kernel repo, docs/text.md in the kit).
 *
 * A text entity `{type:'text', string, font, height, p, anchor, angle, spacing, mirror, arc}` is fixed geometry whose anchor is a
 * normal sketch point `p`, so the point can be dragged, locked and dimensioned like any other. The outlines come from the kernel
 * (`textOutline`, asynchronous); this module keeps a cache of them keyed by the entity's fields and resolved position, builds the
 * request from a draft, and edits a text entity immutably (the panel and the tool both use it). No DOM, no kernel calls: the
 * caller injects the fetch.
 */
import type { DraftEntity, SketchDraft } from './index';
import { nextId } from './tools/builders';
import type { Pt } from './tools/types';

export type TextFont = 'gauge' | 'engrave';
export type TextHAnchor = 'left' | 'center' | 'right';
export type TextVAnchor = 'baseline' | 'middle' | 'top';

export const TEXT_DEFAULTS = { string: 'TEXT', font: 'gauge' as TextFont, height: 5 };
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

interface PointsLike { points: Array<{ id: string; x: number; y: number }> }

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
  string?: string; font?: TextFont; height?: number; anchor?: [TextHAnchor, TextVAnchor]; angle?: number; spacing?: number; mirror?: boolean;
  /** true: lay along an arc with the given parameters (missing ones keep the old value or the default); false: straight */
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
  if (patch.font !== undefined) e.font = patch.font;
  if (patch.height !== undefined && Number.isFinite(patch.height)) e.height = patch.height;
  if (patch.anchor !== undefined) set('anchor', patch.anchor, undefined);
  if (patch.angle !== undefined && Number.isFinite(patch.angle)) set('angle', patch.angle, 0);
  if (patch.spacing !== undefined && Number.isFinite(patch.spacing)) set('spacing', patch.spacing, 1);
  if (patch.mirror !== undefined) set('mirror', patch.mirror, false);
  if (patch.arc === false) delete e.arc;
  else if (patch.arc) {
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
  string: string; font: TextFont; height: number; anchor: [TextHAnchor, TextVAnchor]; angle: number; spacing: number; mirror: boolean;
  arc: null | { radius: number; angleCentre: number; side: 'outside' | 'inside'; centre: Pt };
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
    string: String(e.string ?? ''), font: e.font === 'engrave' ? 'engrave' : 'gauge', height: Number(e.height ?? TEXT_DEFAULTS.height),
    anchor: [a[0] ?? 'left', a[1] ?? 'baseline'], angle: Number(e.angle ?? 0), spacing: Number(e.spacing ?? 1), mirror: e.mirror === true,
    arc: arc ? { radius: Number(arc.radius ?? ARC_DEFAULT.radius), angleCentre: Number(arc.angleCentre ?? 90), side: arc.side === 'inside' ? 'inside' : 'outside', centre: cp ? { x: cp.x, y: cp.y } : { x: Number(arc.centre?.[0] ?? 0), y: Number(arc.centre?.[1] ?? 0) } } : null,
    x: p?.x ?? 0, y: p?.y ?? 0,
  };
}

/** i18n keys and params of the warnings / error of an entity's cached outline (the panel and the status bar show them). */
export function textNotes(d: TextOutlineEntry | undefined): Array<{ key: string; params?: Record<string, string> }> {
  if (!d) return [];
  if (isOutlineError(d)) {
    const m = /\btext(Empty|NothingToDraw|BadFont|BadHeight|BadArc|BadValue)\b/.exec(d.error);
    return [{ key: 'app.sketch.text.err.' + (m ? m[1] : 'Other'), params: { detail: d.error } }];
  }
  return d.warnings.flatMap((w) => {
    const code = String(w.code ?? '');
    if (!/^text(TooSmall|MissingGlyph|Truncated|SpacingAdjusted|Overlap)$/.test(code)) return [];
    return [{ key: 'app.sketch.text.warn.' + code.slice(4), params: { detail: String(w.detail ?? '') } }];
  });
}
