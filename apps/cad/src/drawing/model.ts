// The drawing document: sheet, title block, views, dimensions, notes, balloons. Pure data and arithmetic; it is stored
// as the part document's `drawing` field (the kernel never reads it). Lengths on the sheet are millimetres; model
// coordinates stay in model units and are only scaled when drawn, so the sheet follows the part when it changes.

export type V3 = [number, number, number];
export type V2 = [number, number];

export const SHEET_SIZES: Record<string, V2> = {
  A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189],
  'ANSI A': [215.9, 279.4], 'ANSI B': [279.4, 431.8], 'ANSI C': [431.8, 558.8], 'ANSI D': [558.8, 863.6], 'ANSI E': [863.6, 1117.6],
};
export const SHEET_NAMES = Object.keys(SHEET_SIZES);
export const SCALES = ['10:1', '5:1', '4:1', '2:1', '1:1', '1:2', '1:4', '1:5', '1:10', '1:20', '1:50', '1:100'];

export interface Sheet { size: string; orientation: 'landscape' | 'portrait'; units: 'mm' | 'in'; scale: string; projection: 'third' | 'first'; margin: number }
export interface TitleBlock { title: string; partNo: string; material: string; author: string; date: string; revision: string; mass: string; company: string }

export type ViewKind = 'std' | 'proj' | 'section' | 'detail' | 'aux';
export interface DView {
  id: string; kind: ViewKind; label: string;
  /** frame axes in model space; the view looks against x cross y */
  x: V3; y: V3;
  /** centre of the view on the sheet, mm */
  pos: V2;
  /** own scale ("1:1", "2:1" ...), null = the sheet's */
  scale: string | null;
  hidden: boolean; tangent: boolean; centerlines: boolean; showLabel: boolean;
  parent?: string;
  /** proj / section: side of the parent the view sits on (alignment axis) */
  side?: 'right' | 'left' | 'up' | 'down';
  /** section: cut line on the parent, `v` vertical (at parent u = at) or `h` horizontal (at parent v = at); letter on the labels */
  cut?: { dir: 'v' | 'h'; at: number; letter: string };
  /** detail: centre and radius of the circle on the parent, in parent view coordinates */
  circle?: { c: V2; r: number; letter: string };
  /** aux: angle (rad, parent view coordinates) of the picked edge the view looks square at */
  auxAngle?: number;
}
export type DimKind = 'linear' | 'radial' | 'diameter' | 'angular' | 'callout';
export interface DDim {
  id: string; view: string; kind: DimKind;
  /** linear: end points in view coordinates; radial / diameter / callout: a = centre, r = radius; angular: a = vertex, b and c the two ray points */
  a: V2; b?: V2; c?: V2; r?: number;
  orient?: 'aligned' | 'h' | 'v';
  /** where the dimension line / leader goes: mm on the sheet, from the measured geometry */
  offset: number;
  /** angle (rad) of the leader or of the text anchor for radial / diameter / callout */
  angle?: number;
  text?: string;
  /** persistent reference: faces (and a model point) of the edge(s) it was made on, so a regenerated view finds them again */
  refs?: Array<{ faces: string[]; at: V3; /** a centre line: the second silhouette edge it lies between (faces / at are the first's) */ axis?: { faces: string[]; at: V3 }; /** a centre mark: faces / at are the circle edge it marks */ mark?: boolean }>;
  /** callout: the hole or thread feature it speaks for */
  feature?: string;
  /** overall width / height of the view: follows the view's bounds instead of an edge */
  overall?: 'w' | 'h';
}
/** `text`, a surface finish symbol (text = the roughness, e.g. `Ra 1.6`) or a feature control frame (cells split by `|`, e.g. `POS|0.1|A`) */
export interface DNote { id: string; view?: string; text: string; pos: V2; leader?: V2; style?: 'text' | 'finish' | 'fcf' }
export interface DBalloon { id: string; view: string; at: V2; pos: V2; n: number }
/** A table block on the sheet (a cut list, a parts list ...): `x`,`y` the top-left corner in mm, `cols` the column widths, an optional bold title above it. */
export interface DTable { id: string; title?: string; x: number; y: number; cols: number[]; head: string[]; rows: string[][]; rowH?: number; textSize?: number }
export interface DrawingDoc {
  v: 1; sheet: Sheet; title: TitleBlock; views: DView[]; dims: DDim[]; notes: DNote[]; balloons: DBalloon[];
  bom: { show: boolean; pos: V2 | null };
  tables?: DTable[];
}

export const DEFAULT_SHEET: Sheet = { size: 'A3', orientation: 'landscape', units: 'mm', scale: '1:1', projection: 'third', margin: 10 };

export function emptyDrawing(name = '', material = ''): DrawingDoc {
  return {
    v: 1, sheet: { ...DEFAULT_SHEET },
    title: { title: name, partNo: '', material, author: '', date: new Date().toISOString().slice(0, 10), revision: 'A', mass: '', company: '' },
    views: [], dims: [], notes: [], balloons: [], bom: { show: true, pos: null },
  };
}

/** Sheet size in mm for the orientation. */
export function sheetSize(s: Sheet): V2 {
  const [a, b] = SHEET_SIZES[s.size] ?? SHEET_SIZES.A3;
  return s.orientation === 'landscape' ? [b, a] : [a, b];
}
export function parseScale(s: string | null | undefined, fallback = 1): number {
  const m = /^\s*([\d.]+)\s*[:/]\s*([\d.]+)\s*$/.exec(s ?? '');
  if (!m) return fallback;
  const r = Number(m[1]) / Number(m[2]);
  return r > 0 && Number.isFinite(r) ? r : fallback;
}
export const scaleText = (r: number): string => (r >= 1 ? `${+r.toFixed(3)}:1` : `1:${+(1 / r).toFixed(3)}`);
export const viewScale = (d: DrawingDoc, v: DView): number => parseScale(v.scale, parseScale(d.sheet.scale));

// ---- vectors / frames ------------------------------------------------------------------------------------------------------
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1] + 0, a[2] * b[0] - a[0] * b[2] + 0, a[0] * b[1] - a[1] * b[0] + 0];
export const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const neg3 = (a: V3): V3 => [0 - a[0], 0 - a[1], 0 - a[2]];
export const unit3 = (a: V3): V3 => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
export const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

/** The seven standard views, same frames as the kernel's names. */
export const STD_FRAMES: Record<string, { x: V3; y: V3; label: string }> = {
  front: { x: [1, 0, 0], y: [0, 1, 0], label: 'Front' },
  back: { x: [-1, 0, 0], y: [0, 1, 0], label: 'Back' },
  right: { x: [0, 0, -1], y: [0, 1, 0], label: 'Right' },
  left: { x: [0, 0, 1], y: [0, 1, 0], label: 'Left' },
  top: { x: [1, 0, 0], y: [0, 0, -1], label: 'Top' },
  bottom: { x: [1, 0, 0], y: [0, 0, 1], label: 'Bottom' },
  iso: { x: [0.7071067811865476, 0, -0.7071067811865476], y: [-0.40824829046386296, 0.816496580927726, -0.40824829046386296], label: 'Isometric' },
};
export const STD_NAMES = Object.keys(STD_FRAMES);

/** Frame of a view projected from `parent` towards `side` (third angle: the view of the side you look from sits on that side). */
export function projectedFrame(px: V3, py: V3, side: 'right' | 'left' | 'up' | 'down'): { x: V3; y: V3 } {
  const pz = cross(px, py);
  if (side === 'right') return { x: neg3(pz), y: py };
  if (side === 'left') return { x: pz, y: py };
  if (side === 'up') return { x: px, y: neg3(pz) };
  return { x: px, y: pz };
}
/** The side a projected view sits on for the sheet's projection: first angle puts it opposite. */
export const sideFor = (projection: 'third' | 'first', dir: 'right' | 'left' | 'up' | 'down'): 'right' | 'left' | 'up' | 'down' =>
  projection === 'third' ? dir : ({ right: 'left', left: 'right', up: 'down', down: 'up' } as const)[dir];

/** Frame of an auxiliary view: looks square at an edge of the parent view that makes `angle` with the parent's x axis. */
export function auxFrame(px: V3, py: V3, angle: number): { x: V3; y: V3 } {
  const along = add3(mul3(px, Math.cos(angle)), mul3(py, Math.sin(angle)));   // direction of the edge in space
  // x along the edge, y = minus the parent's normal: the view normal is the in-plane direction square to the edge
  return { x: along, y: neg3(cross(px, py)) };
}

/** Section frame and a point on the cut plane for a cut line on a parent view. The kept half is the one away from the viewer. */
export function sectionFrame(px: V3, py: V3, cut: { dir: 'v' | 'h'; at: number }): { x: V3; y: V3; point: V3 } {
  const f = projectedFrame(px, py, cut.dir === 'v' ? 'right' : 'up');
  const z = cross(f.x, f.y);
  const origin = cut.dir === 'v' ? mul3(px, cut.at) : mul3(py, cut.at);
  return { ...f, point: mul3(z, dot3(z, origin)) };
}

export function newId(prefix: string, used: Iterable<string>): string {
  const u = new Set(used);
  for (let i = 1; ; i++) if (!u.has(prefix + i)) return prefix + i;
}
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function nextLetter(d: DrawingDoc): string {
  const used = new Set<string>();
  for (const v of d.views) { if (v.cut) used.add(v.cut.letter); if (v.circle) used.add(v.circle.letter); }
  return [...LETTERS].find((l) => !used.has(l)) ?? 'Z';
}

// ---- view geometry from the kernel reply -----------------------------------------------------------------------------------
export interface KLine { k: 'e' | 'o' | 't' | 'h'; v: boolean; p: number[]; e?: number }
export interface KEdge { faces: string[]; at: number[]; line?: number[][]; mid: number[]; ends: number[][]; outline?: boolean }
export interface ViewData { min: V2; max: V2; lines: KLine[]; edges: KEdge[] }

export const viewCentre = (g: ViewData): V2 => [(g.min[0] + g.max[0]) / 2, (g.min[1] + g.max[1]) / 2];

/** View coordinates (u,v) to sheet millimetres for a view. */
export function toSheet(v: DView, g: ViewData, s: number, u: number, w: number): V2 {
  const c = viewCentre(g);
  return [v.pos[0] + (u - c[0]) * s, v.pos[1] - (w - c[1]) * s];
}
export function fromSheet(v: DView, g: ViewData, s: number, x: number, y: number): V2 {
  const c = viewCentre(g);
  return [c[0] + (x - v.pos[0]) / s, c[1] - (y - v.pos[1]) / s];
}
/** Sheet-size of a view's extent in mm. */
export const viewExtent = (g: ViewData, s: number): V2 => [(g.max[0] - g.min[0]) * s, (g.max[1] - g.min[1]) * s];

/** The largest standard scale at which a set of extents fits the free area of the sheet. */
export function bestScale(sheet: Sheet, extents: V2[], layout: 'cross' | 'row' = 'cross'): string {
  const [w, h] = sheetSize(sheet);
  const free: V2 = [w - 2 * sheet.margin - 20, h - 2 * sheet.margin - 60];
  const gap = 25;
  const need: V2 = layout === 'cross'
    ? [(extents[0]?.[0] ?? 0) + (extents[1]?.[0] ?? 0) + gap, (extents[0]?.[1] ?? 0) + (extents[2]?.[1] ?? 0) + gap]
    : [extents.reduce((s, e) => s + e[0], 0) + gap * extents.length, Math.max(...extents.map((e) => e[1]), 0)];
  for (const sc of SCALES) {
    const r = parseScale(sc);
    if (need[0] * r <= free[0] && need[1] * r <= free[1]) return sc;
  }
  return SCALES[SCALES.length - 1];
}

// ---- dimension text -------------------------------------------------------------------------------------------------------
export function fmtLength(x: number, units: 'mm' | 'in'): string {
  if (units === 'in') return (x / 25.4).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0');
  const s = Math.abs(x) < 100 ? x.toFixed(2) : x.toFixed(1);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
export const fmtAngle = (rad: number): string => `${+(rad * 180 / Math.PI).toFixed(1)}°`;

/** Dimension text: the override with `<>` standing for the measured value, or the measured value with its symbol. */
export function dimText(measured: string, override?: string): string {
  if (!override || !override.trim()) return measured;
  return override.includes('<>') ? override.split('<>').join(measured) : override;
}

/** Drop what points at removed views and fix stray values after a load. */
export function sanitizeDrawing(raw: unknown, fallbackName = '', material = ''): DrawingDoc {
  const base = emptyDrawing(fallbackName, material);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<DrawingDoc>;
  const d: DrawingDoc = {
    ...base, ...r, v: 1,
    sheet: { ...base.sheet, ...(r.sheet ?? {}) }, title: { ...base.title, ...(r.title ?? {}) },
    views: Array.isArray(r.views) ? r.views.filter((v) => v && Array.isArray(v.x) && Array.isArray(v.y) && Array.isArray(v.pos)) : [],
    dims: Array.isArray(r.dims) ? r.dims : [], notes: Array.isArray(r.notes) ? r.notes : [], balloons: Array.isArray(r.balloons) ? r.balloons : [],
    tables: Array.isArray(r.tables) ? r.tables.filter((x) => x && Array.isArray(x.cols) && Array.isArray(x.head) && Array.isArray(x.rows)) : [],
    bom: { ...base.bom, ...(r.bom ?? {}) },
  };
  if (!SHEET_SIZES[d.sheet.size]) d.sheet.size = 'A3';
  const ids = new Set(d.views.map((v) => v.id));
  d.views = d.views.filter((v) => !v.parent || ids.has(v.parent));
  const ids2 = new Set(d.views.map((v) => v.id));
  d.dims = d.dims.filter((x) => ids2.has(x.view));
  d.balloons = d.balloons.filter((x) => ids2.has(x.view));
  return d;
}

/** Views that hang off `id` (projected, section, aux), transitively. */
export function descendants(d: DrawingDoc, id: string): DView[] {
  const out: DView[] = [];
  const walk = (p: string) => { for (const v of d.views) if (v.parent === p && !out.includes(v)) { out.push(v); walk(v.id); } };
  walk(id);
  return out;
}
export function removeView(d: DrawingDoc, id: string): DrawingDoc {
  const gone = new Set([id, ...descendants(d, id).map((v) => v.id)]);
  return { ...d, views: d.views.filter((v) => !gone.has(v.id)), dims: d.dims.filter((x) => !gone.has(x.view)), balloons: d.balloons.filter((x) => !gone.has(x.view)), notes: d.notes.filter((n) => !n.view || !gone.has(n.view)) };
}
