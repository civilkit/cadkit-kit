// SVG geometry -> sketch points and entities. Pure: the caller adds the result to the open draft (mergeIntoDraft, shared with the
// DXF import) and sends it through the usual apply path, so the kernel solves and previews it like any other edit.
//
//  - read: path (M L H V C S Q T A Z, absolute and relative), rect (also rounded), circle, ellipse, line, polyline, polygon;
//    nested g / a / svg, internal <use>, the transform attribute (matrix translate scale rotate skewX skewY);
//  - size: width / height with units (mm cm in pt pc px) and the viewBox give the scale; without a physical size one user unit is
//    one CSS pixel (96 dpi) and the result says so (`units: 'px'`); the SVG Y axis points down, the sketch v axis up, so Y is flipped
//    about the bottom of the viewport and the drawing stands upright with its lower left corner at the origin;
//  - lines stay lines, circular arcs stay arcs (also under a uniform scale or a mirror), circles stay circles, ellipses stay ellipses
//    (also under a rotation or a non-uniform scale); Beziers become spline entities that follow the curve exactly (a cubic is a clamped
//    cubic B-spline with its four points, a quadratic one with three), elliptical arcs become a chain of such cubics, and a Bezier whose
//    control points are on its chord is a line;
//  - end points that agree within 1e-6 mm share one sketch point, so closed subpaths close and extrude. No constraints are written;
//  - never read: fills, strokes, gradients, text, images, scripts, clip paths, masks, filters. Nothing is executed or fetched; a file
//    that declares entities is refused (entity expansion), and size, element count, nesting, entity count and range are capped.
import type { DraftEntity, DraftPoint } from '@kit/sketch';

export const MAX_SVG_ENTITIES = 20000;
/** Coordinates beyond this (mm, from the sketch origin) are refused. */
export const MAX_SVG_COORD = 1e6;
/** Longest file read, in characters. */
export const MAX_SVG_BYTES = 10 * 1024 * 1024;
const MAX_ELEMENTS = 200_000;
const MAX_DEPTH = 64;
const MAX_VISITS = 100_000;
const MERGE_TOL = 1e-6;
const MM_PER_PX = 25.4 / 96;

export type SvgImportError =
  | { code: 'tooMany'; count: number; max: number }
  | { code: 'tooLarge'; bytes: number; max: number }
  | { code: 'nothing'; unsupported: Record<string, number> }
  | { code: 'range'; max: number }
  | { code: 'unsafe' | 'notSvg'; message: string };

export interface SvgImportOk {
  ok: true;
  points: DraftPoint[];
  entities: DraftEntity[];
  /** Millimetres per user unit that was applied at the root. */
  scale: number;
  /** 'physical' when width / height named mm, cm, in, pt or pc (with a viewBox); 'px' when the size was assumed from CSS pixels at 96 dpi. */
  units: 'physical' | 'px';
  /** Elements and features that were not read, by name (text, image, script, ...). */
  unsupported: Record<string, number>;
  /** Shapes dropped because they have no size. */
  degenerate: number;
  /** Shapes dropped because an identical one was already imported. */
  duplicate: number;
  /** Elements that use a clip path, mask or filter: their whole shape was imported, unclipped. */
  clipped: number;
}
export type SvgImportResult = SvgImportOk | { ok: false; error: SvgImportError };

export interface SvgImportOptions {
  /** Millimetres per user unit, replacing what the file's size and viewBox say. */
  mmPerUnit?: number;
}

class Stop extends Error { constructor(public readonly error: SvgImportError) { super(error.code); } }

// ---- XML -------------------------------------------------------------------------------------------------------------------

interface XNode { raw: string; name: string; attrs: Record<string, string>; children: XNode[]; foreign: boolean }

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s: string): string => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, g: string) => {
  if (g[0] === '#') {
    const cp = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
    return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
  }
  return ENTITIES[g] ?? m;
}));

/** A small, non-validating XML reader: elements and attributes only. DOCTYPE entity declarations are refused, nothing else is expanded. */
function parseXml(text: string): XNode {
  if (text.length > MAX_SVG_BYTES) throw new Stop({ code: 'tooLarge', bytes: text.length, max: MAX_SVG_BYTES });
  if (text.indexOf('\0') >= 0) throw new Stop({ code: 'notSvg', message: 'binary data' });
  if (/<!ENTITY/i.test(text)) throw new Stop({ code: 'unsafe', message: 'entity declarations are not read' });
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  const stack: XNode[] = [];
  let root: XNode | null = null;
  let elements = 0;
  const bad = (m: string): never => { throw new Stop({ code: 'notSvg', message: m }); };
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); if (e < 0) bad('unterminated comment'); i = e + 3; continue; }
    if (text.startsWith('<![CDATA[', i)) { const e = text.indexOf(']]>', i + 9); if (e < 0) bad('unterminated CDATA'); i = e + 3; continue; }
    if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i + 2); if (e < 0) bad('unterminated declaration'); i = e + 2; continue; }
    if (text.startsWith('<!', i)) {
      // DOCTYPE and friends: skip to the closing '>' outside quotes and an internal [ ... ] subset
      let j = i + 2, depth = 0, q = '';
      for (; j < n; j++) {
        const ch = text[j];
        if (q) { if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '[') depth++; else if (ch === ']') depth--; else if (ch === '>' && depth <= 0) break;
      }
      if (j >= n) bad('unterminated declaration');
      i = j + 1;
      continue;
    }
    if (text[i + 1] === '/') {
      const e = text.indexOf('>', i);
      if (e < 0) bad('unterminated tag');
      const name = text.slice(i + 2, e).trim();
      const top = stack.pop();
      if (!top || top.raw !== name) bad(`unexpected </${name.slice(0, 40)}>`);
      i = e + 1;
      if (!stack.length) break;      // the root is closed; whatever follows is ignored
      continue;
    }
    // start tag
    let j = i + 1;
    while (j < n && !/[\s/>]/.test(text[j])) j++;
    const rawName = text.slice(i + 1, j);
    if (!rawName) bad('empty tag name');
    const attrs: Record<string, string> = {};
    let selfClose = false;
    for (;;) {
      while (j < n && /\s/.test(text[j])) j++;
      if (j >= n) bad('unterminated tag');
      if (text[j] === '>') { j++; break; }
      if (text[j] === '/' && text[j + 1] === '>') { selfClose = true; j += 2; break; }
      let k = j;
      while (k < n && !/[\s=/>]/.test(text[k])) k++;
      const an = text.slice(j, k);
      if (!an) bad('bad attribute');
      while (k < n && /\s/.test(text[k])) k++;
      if (text[k] !== '=') bad(`attribute ${an.slice(0, 30)} has no value`);
      k++;
      while (k < n && /\s/.test(text[k])) k++;
      const q = text[k];
      if (q !== '"' && q !== "'") bad(`attribute ${an.slice(0, 30)} is not quoted`);
      const e = text.indexOf(q, k + 1);
      if (e < 0) bad('unterminated attribute');
      if (!(an in attrs)) attrs[an] = decode(text.slice(k + 1, e));
      j = e + 1;
    }
    if (++elements > MAX_ELEMENTS) throw new Stop({ code: 'tooMany', count: elements, max: MAX_ELEMENTS });
    const colon = rawName.indexOf(':');
    const foreign = colon >= 0 && rawName.slice(0, colon) !== 'svg';
    const node: XNode = { raw: rawName, name: (colon >= 0 && !foreign ? rawName.slice(colon + 1) : rawName).toLowerCase(), attrs: {}, children: [], foreign };
    // attributes: drop foreign-namespace ones (inkscape:, sodipodi:), keep the rest; xlink:href is href
    for (const [k, v] of Object.entries(attrs)) {
      const c = k.indexOf(':');
      if (c < 0) node.attrs[k] = v; else if (k === 'xlink:href') node.attrs.href ??= v;
    }
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (!root) root = node;
    i = j;
    if (!selfClose) {
      if (stack.length >= MAX_DEPTH) bad('nested too deeply');
      stack.push(node);
    } else if (!stack.length) break;
  }
  if (stack.length) bad('unclosed element');
  if (!root) bad('no element');
  return root!;
}

// ---- lengths and transforms --------------------------------------------------------------------------------------------------

const PX_PER: Record<string, number> = { px: 1, '': 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16, em: 16, ex: 8 };
const LEN = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|mm|cm|in|pt|pc|em|ex|%)?\s*$/;

/** A length attribute in user units (CSS px). Percentages and unreadable values give `fallback`. */
function userLen(s: string | undefined, fallback = 0): number {
  if (s === undefined) return fallback;
  const m = LEN.exec(s);
  if (!m || m[2] === '%') return fallback;
  const v = Number(m[1]) * PX_PER[m[2] ?? ''];
  return Number.isFinite(v) ? v : fallback;
}
/** width / height of the root: millimetres and whether a physical unit was named; null when absent or relative. */
function sizeMm(s: string | undefined): { mm: number; physical: boolean } | null {
  if (s === undefined) return null;
  const m = LEN.exec(s);
  if (!m || m[2] === '%' || m[2] === 'em' || m[2] === 'ex') return null;
  const v = Number(m[1]) * PX_PER[m[2] ?? ''] * MM_PER_PX;
  return Number.isFinite(v) && v > 0 ? { mm: v, physical: m[2] === 'mm' || m[2] === 'cm' || m[2] === 'in' || m[2] === 'pt' || m[2] === 'pc' } : null;
}

/** [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f. */
type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const NUMS = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

/** The transform attribute; null when it is malformed. */
function parseTransform(s: string | undefined): Mat | null {
  if (s === undefined || !s.trim()) return IDENT;
  let m: Mat = IDENT;
  const re = /\s*,?\s*([a-zA-Z]+)\s*\(([^)]*)\)/y;
  let pos = 0;
  const t = s.trim();
  while (pos < t.length) {
    re.lastIndex = pos;
    const g = re.exec(t);
    if (!g) return null;
    pos = re.lastIndex;
    const a = (g[2].match(NUMS) ?? []).map(Number);
    if (a.some((x) => !Number.isFinite(x))) return null;
    const rad = (d: number) => (d * Math.PI) / 180;
    let k: Mat;
    switch (g[1]) {
      case 'matrix': if (a.length !== 6) return null; k = a as Mat; break;
      case 'translate': if (a.length < 1 || a.length > 2) return null; k = [1, 0, 0, 1, a[0], a[1] ?? 0]; break;
      case 'scale': if (a.length < 1 || a.length > 2) return null; k = [a[0], 0, 0, a[1] ?? a[0], 0, 0]; break;
      case 'rotate': {
        if (a.length !== 1 && a.length !== 3) return null;
        const c = Math.cos(rad(a[0])), sn = Math.sin(rad(a[0]));
        const r: Mat = [c, sn, -sn, c, 0, 0];
        k = a.length === 3 ? mul(mul([1, 0, 0, 1, a[1], a[2]], r), [1, 0, 0, 1, -a[1], -a[2]]) : r;
        break;
      }
      case 'skewX': if (a.length !== 1) return null; k = [1, 0, Math.tan(rad(a[0])), 1, 0, 0]; break;
      case 'skewY': if (a.length !== 1) return null; k = [1, Math.tan(rad(a[0])), 0, 1, 0, 0]; break;
      default: return null;
    }
    m = mul(m, k);
  }
  return m.every(Number.isFinite) ? m : null;
}

// ---- path data -------------------------------------------------------------------------------------------------------------

type V = { x: number; y: number };
type Seg =
  | { k: 'L'; to: V }
  | { k: 'C'; c1: V; c2: V; to: V }
  | { k: 'Q'; c1: V; to: V }
  | { k: 'A'; rx: number; ry: number; phi: number; large: boolean; sweep: boolean; to: V };
interface Sub { start: V; segs: Seg[]; closed: boolean }

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** Parse path data into absolute subpaths. Like a renderer, everything before the first error is kept; `error` says one was found. */
function parsePath(d: string): { subs: Sub[]; error: boolean } {
  const subs: Sub[] = [];
  let cur: V = { x: 0, y: 0 }, start: V = { x: 0, y: 0 };
  let sub: Sub | null = null;
  let lastCtl: V | null = null, lastKind = '';
  let pos = 0, cmd = '';
  const n = d.length;
  const numRe = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const skip = () => { while (pos < n && (d[pos] === ' ' || d[pos] === ',' || d[pos] === '\t' || d[pos] === '\n' || d[pos] === '\r' || d[pos] === '\f')) pos++; };
  const num = (): number | null => { skip(); numRe.lastIndex = pos; const m = numRe.exec(d); if (!m) return null; pos = numRe.lastIndex; const v = Number(m[0]); return Number.isFinite(v) ? v : null; };
  const flag = (): boolean | null => { skip(); const c = d[pos]; if (c !== '0' && c !== '1') return null; pos++; return c === '1'; };
  const begin = (p: V) => { sub = { start: { ...p }, segs: [], closed: false }; subs.push(sub); };
  for (;;) {
    skip();
    if (pos >= n) break;
    const ch = d[pos];
    if (/[A-Za-z]/.test(ch)) { cmd = ch; pos++; } else if (!cmd || cmd === 'z' || cmd === 'Z') return { subs, error: true };
    const lc = cmd.toLowerCase();
    if (!(lc in ARGS)) return { subs, error: true };
    if (!subs.length && lc !== 'm') return { subs, error: true };
    const rel = cmd === lc;
    if (lc === 'z') {
      if (sub) { (sub as Sub).closed = true; cur = { ...(sub as Sub).start }; start = cur; }
      lastCtl = null; lastKind = 'z';
      sub = null;
      continue;
    }
    const a: Array<number | boolean> = [];
    for (let i = 0; i < ARGS[lc]; i++) {
      const v = lc === 'a' && (i === 3 || i === 4) ? flag() : num();
      if (v === null) return { subs, error: true };
      a.push(v);
    }
    const ox = rel ? cur.x : 0, oy = rel ? cur.y : 0;
    const at = (i: number): V => ({ x: (a[i] as number) + ox, y: (a[i + 1] as number) + oy });
    if (!sub && lc !== 'm') begin(cur);       // a command after Z starts a new subpath at the old start
    switch (lc) {
      case 'm': { const p = at(0); begin(p); cur = p; start = p; cmd = rel ? 'l' : 'L'; lastCtl = null; lastKind = 'm'; break; }
      case 'l': { const p = at(0); sub!.segs.push({ k: 'L', to: p }); cur = p; lastCtl = null; lastKind = 'l'; break; }
      case 'h': { const p = { x: (a[0] as number) + ox, y: cur.y }; sub!.segs.push({ k: 'L', to: p }); cur = p; lastCtl = null; lastKind = 'l'; break; }
      case 'v': { const p = { x: cur.x, y: (a[0] as number) + oy }; sub!.segs.push({ k: 'L', to: p }); cur = p; lastCtl = null; lastKind = 'l'; break; }
      case 'c': { const c1 = at(0), c2 = at(2), p = at(4); sub!.segs.push({ k: 'C', c1, c2, to: p }); cur = p; lastCtl = c2; lastKind = 'c'; break; }
      case 's': {
        const c1: V = lastKind === 'c' && lastCtl ? { x: 2 * cur.x - lastCtl.x, y: 2 * cur.y - lastCtl.y } : { ...cur };
        const c2 = at(0), p = at(2);
        sub!.segs.push({ k: 'C', c1, c2, to: p }); cur = p; lastCtl = c2; lastKind = 'c'; break;
      }
      case 'q': { const c1 = at(0), p = at(2); sub!.segs.push({ k: 'Q', c1, to: p }); cur = p; lastCtl = c1; lastKind = 'q'; break; }
      case 't': {
        const c1: V = lastKind === 'q' && lastCtl ? { x: 2 * cur.x - lastCtl.x, y: 2 * cur.y - lastCtl.y } : { ...cur };
        const p = at(0);
        sub!.segs.push({ k: 'Q', c1, to: p }); cur = p; lastCtl = c1; lastKind = 'q'; break;
      }
      case 'a': {
        const p = at(5);
        sub!.segs.push({ k: 'A', rx: Math.abs(a[0] as number), ry: Math.abs(a[1] as number), phi: ((a[2] as number) * Math.PI) / 180, large: a[3] as boolean, sweep: a[4] as boolean, to: p });
        cur = p; lastCtl = null; lastKind = 'a'; break;
      }
    }
  }
  return { subs, error: false };
}

/** Elliptical arc, endpoint form -> centre form (SVG implementation notes F.6.5). Null when it is a line or has no extent. */
function arcCentre(p0: V, s: Extract<Seg, { k: 'A' }>): { c: V; rx: number; ry: number; phi: number; t1: number; dt: number } | null {
  let { rx, ry } = s;
  const { phi, to: p1 } = s;
  if (!(rx > 0) || !(ry > 0)) return null;
  if (Math.abs(p0.x - p1.x) < 1e-12 && Math.abs(p0.y - p1.y) < 1e-12) return null;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { const f = Math.sqrt(lam); rx *= f; ry *= f; }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = (s.large === s.sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx;
  const c = { x: cp * cxp - sp * cyp + (p0.x + p1.x) / 2, y: sp * cxp + cp * cyp + (p0.y + p1.y) / 2 };
  const ux = (x1 - cxp) / rx, uy = (y1 - cyp) / ry, vx = (-x1 - cxp) / rx, vy = (-y1 - cyp) / ry;
  const t1 = Math.atan2(uy, ux);
  let dt = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!s.sweep && dt > 0) dt -= 2 * Math.PI;
  if (s.sweep && dt < 0) dt += 2 * Math.PI;
  return Number.isFinite(dt) && Math.abs(dt) > 1e-12 ? { c, rx, ry, phi, t1, dt } : null;
}

// ---- import ----------------------------------------------------------------------------------------------------------------

const GROUPS = new Set(['g', 'a', 'switch']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
/** Not drawn, or not geometry: ignored without a word. */
const QUIET = new Set(['defs', 'clippath', 'mask', 'pattern', 'marker', 'symbol', 'lineargradient', 'radialgradient', 'filter', 'style', 'title', 'desc', 'metadata', 'namedview', 'font', 'font-face', 'glyph', 'view', 'cursor', 'color-profile', 'set', 'animate', 'animatetransform', 'animatemotion', 'animatecolor', 'stop', 'tspan']);

export function svgToSketch(input: string, opts: SvgImportOptions = {}): SvgImportResult {
  try { return run(input, opts); } catch (e) {
    if (e instanceof Stop) return { ok: false, error: e.error };
    throw e;
  }
}

function run(input: string, opts: SvgImportOptions): SvgImportOk {
  const root = parseXml(input);
  if (root.name !== 'svg' || root.foreign) throw new Stop({ code: 'notSvg', message: 'the root element is not <svg>' });

  const points: DraftPoint[] = [];
  const entities: DraftEntity[] = [];
  const grid = new Map<string, number>();
  const seen = new Set<string>();
  const unsupported: Record<string, number> = {};
  let overflow = false, degenerate = 0, duplicate = 0, clipped = 0, visits = 0;
  const cell = (v: number) => Math.round(v / MERGE_TOL);
  const skipped = (what: string) => { unsupported[what] = (unsupported[what] ?? 0) + 1; };

  const pointAt = (x0: number, y0: number): string => {
    const x = Math.round(x0 * 1e9) / 1e9, y = Math.round(y0 * 1e9) / 1e9;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX_SVG_COORD || Math.abs(y) > MAX_SVG_COORD) { overflow = true; return 'p0'; }
    const cx = cell(x), cy = cell(y);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const i = grid.get(`${cx + dx},${cy + dy}`);
      if (i !== undefined && Math.abs(points[i].x - x) <= MERGE_TOL && Math.abs(points[i].y - y) <= MERGE_TOL) return points[i].id;
    }
    const id = `p${points.length + 1}`;
    points.push({ id, x, y });
    grid.set(`${cx},${cy}`, points.length - 1);
    return id;
  };
  const add = (e: Record<string, unknown>) => {
    if (overflow) throw new Stop({ code: 'range', max: MAX_SVG_COORD });
    const key = e.type === 'line' ? [e.type, ...[e.p1 as string, e.p2 as string].sort()].join('|') : e.type === 'circle' ? `${e.type}|${e.c}|${(e.r as number).toFixed(6)}`
      : [e.type, e.c ?? '', e.p1 ?? '', e.p2 ?? '', e.p ?? '', e.r === undefined ? '' : (e.r as number).toFixed(6), ...((e.pts as string[] | undefined) ?? [])].join('|');
    if (seen.has(key)) { duplicate++; return; }
    seen.add(key);
    entities.push({ id: `e${entities.length + 1}`, ...e });
    if (entities.length > MAX_SVG_ENTITIES) throw new Stop({ code: 'tooMany', count: entities.length, max: MAX_SVG_ENTITIES });
  };
  const pt = (v: V) => pointAt(v.x, v.y);
  const line = (a: V, b: V) => {
    const p1 = pt(a), p2 = pt(b);
    if (p1 === p2) { degenerate++; return; }
    add({ type: 'line', p1, p2 });
  };
  /** A Bezier of 3 or 4 points (mm): a line when the points are on the chord, two halves when it closes on itself, else a spline entity. */
  const bezier = (p: V[]) => {
    const a = p[0], b = p.at(-1)!;
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (chord <= MERGE_TOL) {
      if (p.every((q) => Math.hypot(q.x - a.x, q.y - a.y) <= MERGE_TOL)) { degenerate++; return; }
      // closes on itself: split at t = 1/2 (de Casteljau) so the end points differ
      const lerp = (u: V, v: V): V => ({ x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 });
      if (p.length === 3) { const l = lerp(p[0], p[1]), r = lerp(p[1], p[2]), m = lerp(l, r); bezier([p[0], l, m]); bezier([m, r, p[2]]); return; }
      const ab = lerp(p[0], p[1]), bc = lerp(p[1], p[2]), cd = lerp(p[2], p[3]), abc = lerp(ab, bc), bcd = lerp(bc, cd), m = lerp(abc, bcd);
      bezier([p[0], ab, abc, m]); bezier([m, bcd, cd, p[3]]);
      return;
    }
    const ux = (b.x - a.x) / chord, uy = (b.y - a.y) / chord;
    const onChord = p.slice(1, -1).every((q) => {
      const t = (q.x - a.x) * ux + (q.y - a.y) * uy;
      return Math.abs(-(q.x - a.x) * uy + (q.y - a.y) * ux) <= 1e-9 * Math.max(1, chord) && t >= -1e-9 && t <= chord + 1e-9;
    });
    if (onChord) { line(a, b); return; }
    const ids = p.map((q) => pointAt(q.x, q.y));
    add({ type: 'cvspline', pts: ids, degree: p.length - 1 });
  };

  /** One ellipse (or circle) given its centre and two conjugate half-diameters u, v (mm). */
  const ellipseFrom = (c: V, u: V, v: V) => {
    const uu = u.x * u.x + u.y * u.y, vv = v.x * v.x + v.y * v.y, uv = u.x * v.x + u.y * v.y;
    const t0 = 0.5 * Math.atan2(2 * uv, uu - vv);
    const ma = { x: u.x * Math.cos(t0) + v.x * Math.sin(t0), y: u.y * Math.cos(t0) + v.y * Math.sin(t0) };
    const mi = { x: -u.x * Math.sin(t0) + v.x * Math.cos(t0), y: -u.y * Math.sin(t0) + v.y * Math.cos(t0) };
    let a = Math.hypot(ma.x, ma.y), b = Math.hypot(mi.x, mi.y), major = ma;
    if (b > a) { [a, b] = [b, a]; major = mi; }
    if (!(b > MERGE_TOL)) { degenerate++; return; }
    if (a - b <= 1e-9 * a) { add({ type: 'circle', c: pointAt(c.x, c.y), r: a }); return; }
    add({ type: 'ellipse', c: pointAt(c.x, c.y), p: pointAt(c.x + major.x, c.y + major.y), r: b });
  };

  /** Emit one subpath through the matrix `m`. */
  const emitSub = (sub: Sub, m: Mat) => {
    const P = (v: V): V => ({ x: m[0] * v.x + m[2] * v.y + m[4], y: m[1] * v.x + m[3] * v.y + m[5] });
    let cur = sub.start;
    for (const s of sub.segs) {
      switch (s.k) {
        case 'L': line(P(cur), P(s.to)); break;
        case 'Q': bezier([P(cur), P(s.c1), P(s.to)]); break;
        case 'C': bezier([P(cur), P(s.c1), P(s.c2), P(s.to)]); break;
        case 'A': {
          const g = arcCentre(cur, s);
          if (!g) { if (s.rx > 0 && s.ry > 0) { degenerate++; } else line(P(cur), P(s.to)); break; }
          const cp = Math.cos(g.phi), sp = Math.sin(g.phi);
          const lin = (x: number, y: number): V => ({ x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y });
          const u = lin(cp * g.rx, sp * g.rx), v = lin(-sp * g.ry, cp * g.ry);
          const lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y);
          const cross = u.x * v.y - u.y * v.x;
          if (Math.abs(lu - lv) <= 1e-9 * Math.max(lu, lv) && Math.abs(u.x * v.x + u.y * v.y) <= 1e-9 * lu * lv) {
            // still a circle after the transform: a sketch arc, counter-clockwise from p1 to p2
            const ccw = (g.dt > 0) === (cross > 0);
            const a = pt(P(cur)), b = pt(P(s.to));
            if (a === b) { degenerate++; break; }
            add({ type: 'arc', c: pt(P(g.c)), p1: ccw ? a : b, p2: ccw ? b : a });
          } else {
            // an ellipse arc: cubic pieces of at most a quarter turn
            const pieces = Math.max(1, Math.ceil(Math.abs(g.dt) / (Math.PI / 2) - 1e-9));
            const step = g.dt / pieces;
            const at = (t: number): V => ({ x: g.c.x + cp * g.rx * Math.cos(t) - sp * g.ry * Math.sin(t), y: g.c.y + sp * g.rx * Math.cos(t) + cp * g.ry * Math.sin(t) });
            const dv = (t: number): V => ({ x: -cp * g.rx * Math.sin(t) - sp * g.ry * Math.cos(t), y: -sp * g.rx * Math.sin(t) + cp * g.ry * Math.cos(t) });
            for (let i = 0; i < pieces; i++) {
              const ta = g.t1 + step * i, tb = g.t1 + step * (i + 1);
              const k = (4 / 3) * Math.tan((tb - ta) / 4);
              const da = dv(ta), db = dv(tb);
              const p0 = i === 0 ? cur : at(ta), p3 = i === pieces - 1 ? s.to : at(tb);
              bezier([P(p0), P({ x: p0.x + k * da.x, y: p0.y + k * da.y }), P({ x: p3.x - k * db.x, y: p3.y - k * db.y }), P(p3)]);
            }
          }
          break;
        }
      }
      cur = s.to;
    }
    if (sub.closed && Math.hypot(cur.x - sub.start.x, cur.y - sub.start.y) > 1e-12) line(P(cur), P(sub.start));
  };

  const emitCircleLike = (cx: number, cy: number, rx: number, ry: number, m: Mat) => {
    if (!(rx > 0) || !(ry > 0)) { degenerate++; return; }
    const c = { x: m[0] * cx + m[2] * cy + m[4], y: m[1] * cx + m[3] * cy + m[5] };
    ellipseFrom(c, { x: m[0] * rx, y: m[1] * rx }, { x: m[2] * ry, y: m[3] * ry });
  };

  const shape = (el: XNode, m: Mat) => {
    const a = el.attrs;
    switch (el.name) {
      case 'path': {
        const r = parsePath(a.d ?? '');
        if (r.error) skipped('path data error');
        for (const sub of r.subs) if (sub.segs.length) emitSub(sub, m); else if (sub.closed || r.subs.length === 1) degenerate++;
        break;
      }
      case 'line': { const P = (x: number, y: number): V => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }); line(P(userLen(a.x1), userLen(a.y1)), P(userLen(a.x2), userLen(a.y2))); break; }
      case 'polyline': case 'polygon': {
        const n = (a.points?.match(NUMS) ?? []).map(Number);
        const pts: V[] = [];
        for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
        if (pts.length < 2 || pts.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))) { degenerate++; break; }
        emitSub({ start: pts[0], segs: pts.slice(1).map((to) => ({ k: 'L', to }) as Seg), closed: el.name === 'polygon' }, m);
        break;
      }
      case 'circle': { const r = userLen(a.r); emitCircleLike(userLen(a.cx), userLen(a.cy), r, r, m); break; }
      case 'ellipse': {
        let rx = userLen(a.rx, NaN), ry = userLen(a.ry, NaN);
        if (Number.isNaN(rx)) rx = ry; if (Number.isNaN(ry)) ry = rx;
        emitCircleLike(userLen(a.cx), userLen(a.cy), rx, ry, m);
        break;
      }
      case 'rect': {
        const x = userLen(a.x), y = userLen(a.y), w = userLen(a.width), h = userLen(a.height);
        if (!(w > 0) || !(h > 0)) { degenerate++; break; }
        let rx = userLen(a.rx, NaN), ry = userLen(a.ry, NaN);
        if (Number.isNaN(rx) && Number.isNaN(ry)) rx = ry = 0; else if (Number.isNaN(rx)) rx = ry; else if (Number.isNaN(ry)) ry = rx;
        rx = Math.min(Math.max(rx, 0), w / 2); ry = Math.min(Math.max(ry, 0), h / 2);
        const L = (px: number, py: number): Seg => ({ k: 'L', to: { x: px, y: py } });
        const A = (px: number, py: number): Seg => ({ k: 'A', rx, ry, phi: 0, large: false, sweep: true, to: { x: px, y: py } });
        const segs: Seg[] = rx > 0 && ry > 0
          ? [L(x + w - rx, y), A(x + w, y + ry), L(x + w, y + h - ry), A(x + w - rx, y + h), L(x + rx, y + h), A(x, y + h - ry), L(x, y + ry), A(x + rx, y)]
          : [L(x + w, y), L(x + w, y + h), L(x, y + h)];
        emitSub({ start: rx > 0 && ry > 0 ? { x: x + rx, y } : { x, y }, segs, closed: true }, m);
        break;
      }
    }
  };

  const hidden = (el: XNode): boolean => {
    if (el.attrs.display === 'none') return true;
    const st = el.attrs.style;
    return st !== undefined && /(^|;)\s*display\s*:\s*none\b/i.test(st);
  };
  const usesClip = (el: XNode): boolean => ['clip-path', 'mask', 'filter'].some((k) => el.attrs[k] !== undefined && el.attrs[k].trim() !== 'none')
    || (el.attrs.style !== undefined && /(^|;)\s*(clip-path|mask|filter)\s*:\s*(?!none)/i.test(el.attrs.style));

  const byId = new Map<string, XNode>();
  const index = (el: XNode) => { if (el.attrs.id !== undefined && !byId.has(el.attrs.id)) byId.set(el.attrs.id, el); for (const c of el.children) index(c); };
  index(root);

  /** viewBox -> viewport transform (preserveAspectRatio included). */
  const viewBoxMat = (vb: number[], w: number, h: number, par: string | undefined): Mat => {
    const [vx, vy, vw, vh] = vb;
    const p = (par ?? 'xMidYMid meet').trim().split(/\s+/);
    const align = p[0] === 'defer' ? p[1] ?? 'xMidYMid' : p[0];
    const slice = p.includes('slice');
    let sx = w / vw, sy = h / vh;
    if (align === 'none') return [sx, 0, 0, sy, -vx * sx, -vy * sy];
    const s = slice ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = sy = s;
    const fx = /xMin/.test(align) ? 0 : /xMax/.test(align) ? 1 : 0.5, fy = /YMin/.test(align) ? 0 : /YMax/.test(align) ? 1 : 0.5;
    return [s, 0, 0, s, (w - vw * s) * fx - vx * s, (h - vh * s) * fy - vy * s];
  };
  const parseVb = (s: string | undefined): number[] | null => {
    if (!s) return null;
    const v = (s.match(NUMS) ?? []).map(Number);
    return v.length === 4 && v.every(Number.isFinite) && v[2] > 0 && v[3] > 0 ? v : null;
  };

  // ---- root frame: user units -> sketch millimetres, Y up
  const vb = parseVb(root.attrs.viewBox);
  const wS = sizeMm(root.attrs.width), hS = sizeMm(root.attrs.height);
  let rootM: Mat, scale: number, physical = false, H: number;
  if (opts.mmPerUnit !== undefined && opts.mmPerUnit > 0 && Number.isFinite(opts.mmPerUnit)) {
    scale = opts.mmPerUnit;
    rootM = vb ? [scale, 0, 0, scale, -vb[0] * scale, -vb[1] * scale] : [scale, 0, 0, scale, 0, 0];
    H = (vb ? vb[3] : userLen(root.attrs.height)) * scale;
    physical = true;
  } else if (vb) {
    let w = wS?.mm, h = hS?.mm;
    if (w === undefined && h === undefined) { w = vb[2] * MM_PER_PX; h = vb[3] * MM_PER_PX; }
    else if (w === undefined) w = (h! * vb[2]) / vb[3];
    else if (h === undefined) h = (w * vb[3]) / vb[2];
    rootM = viewBoxMat(vb, w!, h!, root.attrs.preserveAspectRatio);
    scale = rootM[0];
    H = h!;
    physical = (wS?.physical ?? false) || (hS?.physical ?? false);
  } else {
    scale = MM_PER_PX;
    rootM = [scale, 0, 0, scale, 0, 0];
    H = hS ? hS.mm : 0;
  }
  const flip: Mat = [1, 0, 0, -1, 0, H];
  const base = mul(flip, rootM);

  const walk = (el: XNode, ctm: Mat, depth: number): void => {
    if (++visits > MAX_VISITS) throw new Stop({ code: 'tooMany', count: visits, max: MAX_VISITS });
    if (depth > 24) { skipped('nesting'); return; }
    if (el.foreign) return;
    const name = el.name;
    if (QUIET.has(name)) return;
    if (hidden(el)) return;
    const tr = parseTransform(el.attrs.transform);
    if (!tr) { skipped('transform'); return; }
    let m = mul(ctm, tr);
    if (SHAPES.has(name)) { if (usesClip(el)) clipped++; shape(el, m); return; }
    if (GROUPS.has(name) || name === 'svg') {
      if (usesClip(el)) clipped++;
      if (name === 'svg' && el !== root) {
        // a nested viewport: x / y place it, a viewBox with a size fits it
        const w = userLen(el.attrs.width, NaN), h = userLen(el.attrs.height, NaN), nvb = parseVb(el.attrs.viewBox);
        m = mul(m, [1, 0, 0, 1, userLen(el.attrs.x), userLen(el.attrs.y)]);
        if (nvb && w > 0 && h > 0) m = mul(m, viewBoxMat(nvb, w, h, el.attrs.preserveAspectRatio));
        else if (nvb) m = mul(m, [1, 0, 0, 1, -nvb[0], -nvb[1]]);
      }
      for (const c of el.children) walk(c, m, depth + 1);
      return;
    }
    if (name === 'use') {
      const href = el.attrs.href;
      if (!href || href[0] !== '#') { skipped('use (external)'); return; }
      const target = byId.get(href.slice(1));
      if (!target) { skipped('use (missing target)'); return; }
      m = mul(m, [1, 0, 0, 1, userLen(el.attrs.x), userLen(el.attrs.y)]);
      if (target.name === 'symbol' || target.name === 'svg') {
        const nvb = parseVb(target.attrs.viewBox);
        const w = userLen(el.attrs.width, userLen(target.attrs.width, NaN)), h = userLen(el.attrs.height, userLen(target.attrs.height, NaN));
        if (nvb && w > 0 && h > 0) m = mul(m, viewBoxMat(nvb, w, h, target.attrs.preserveAspectRatio));
        if (hidden(target)) return;
        for (const c of target.children) walk(c, m, depth + 1);
      } else walk(target, m, depth + 1);
      return;
    }
    skipped(name);      // text, image, foreignObject, script, ...
  };
  // the root is walked like any group, its own transform attribute included (CSS allows it on <svg>)
  walk(root, base, 0);
  if (overflow) throw new Stop({ code: 'range', max: MAX_SVG_COORD });
  if (!entities.length) throw new Stop({ code: 'nothing', unsupported });
  return { ok: true, points, entities, scale, units: physical ? 'physical' : 'px', unsupported, degenerate, duplicate, clipped };
}
