// The Frame tool's drawing: a prepopulated `DrawingDoc` with isometric, front and top views of the frame, a numbered balloon on each
// piece (the number is its row # in the cut list), the cut list and the bill of materials as table blocks and the title block. It is
// ordinary, editable drawing content: the Drawings workspace opens it and its own export (PDF, SVG, DXF, print, tables as CSV) applies.
import { t } from '../i18n';
import { fetchViews, type DrawingQuery } from '../drawing/layout';
import { SCALES, STD_FRAMES, emptyDrawing, parseScale, sheetSize, viewExtent, type DBalloon, type DrawingDoc, type DTable, type DView, type V2, type ViewData } from '../drawing/model';
import { toPdf } from '../drawing/output';
import { placer, renderSheet, toSvg, viewBox, type Prim } from '../drawing/render';
import { bom, cutList, profileById, profileMaterialLabel, type FrameReport } from './frameLib';

const kg = (v: number): string => (Math.round(v * 1000) / 1000).toString();

/** The tables and the piece numbering of a sheet, as text: no geometry. */
export interface SheetModel {
  head: string[];
  /** cut list rows: #, profile, length, angles, qty, mass each */
  cut: string[][];
  bomHead: string[];
  bom: string[][];
  /** member body name -> its cut-list row number (1-based) */
  rowOf: Map<string, number>;
  pieces: number;
  massKg: number;
  materials: string[];
}

export function sheetModel(frames: FrameReport[]): SheetModel {
  const cl = cutList(frames);
  const rowOf = new Map<string, number>();
  cl.forEach((l, i) => l.members.forEach((b) => rowOf.set(b, i + 1)));
  const mats = new Set<string>();
  for (const fr of frames) for (const m of fr.members) { const mat = profileMaterialLabel(profileById(m.profile)); if (mat) mats.add(mat); }
  return {
    head: ['#', t('frame.cutlist.profile'), t('frame.cutlist.length'), t('frame.cutlist.angles'), t('frame.cutlist.qty'), t('frame.cutlist.mass')],
    cut: cl.map((l, i) => [String(i + 1), l.label, String(l.length), `${l.angles[0]} / ${l.angles[1]}`, String(l.qty), kg(l.massKg / l.qty)]),
    bomHead: ['#', t('frame.cutlist.part'), t('frame.cutlist.qty'), t('frame.cutlist.type'), t('frame.cutlist.standard'), t('frame.cutlist.grade'), t('frame.cutlist.massTotal'), t('frame.cutlist.detail')],
    bom: bom(frames).map((b, i) => [String(i + 1), b.label, `${b.qty} ${b.unit}`, t('frame.group.' + b.group), b.standard ?? '', b.grade ?? '', b.massKg !== undefined ? kg(b.massKg) : '', b.detail]),
    rowOf, pieces: cl.reduce((s, l) => s + l.qty, 0), massKg: cl.reduce((s, l) => s + l.massKg, 0), materials: [...mats],
  };
}

/** Face-name prefix of a member body (`F2 M3` owns faces `F2.M3.*`). */
export const facePrefix = (body: string): string => body.replace(/ /g, '.') + '.';

const polyLen = (p: number[]): number => { let s = 0; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s; };
const polyMid = (p: number[]): V2 => {
  let half = polyLen(p) / 2;
  for (let i = 2; i < p.length; i += 2) {
    const d = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    if (half <= d && d > 0) { const k = half / d; return [p[i - 2] + (p[i] - p[i - 2]) * k, p[i - 1] + (p[i + 1] - p[i - 1]) * k]; }
    half -= d;
  }
  return [p[0], p[1]];
};

/** Where a member's balloon points in a view: the middle of its longest visible edge; null when none of it shows. */
export function memberAnchor(g: ViewData, body: string): V2 | null {
  const pre = facePrefix(body);
  let best: { len: number; p: number[] } | null = null;
  for (const l of g.lines) {
    if (!l.v || l.e === undefined || l.k === 'h') continue;
    const e = g.edges[l.e];
    if (!e || !e.faces.some((f) => f.startsWith(pre))) continue;
    const len = polyLen(l.p);
    if (!best || len > best.len) best = { len, p: l.p };
  }
  return best ? polyMid(best.p) : null;
}

const TABLE_W = 142;
const COLS_CUT = [8, 38, 24, 32, 10, 30];
const COLS_BOM = [7, 32, 13, 17, 19, 11, 13, 30];
const ROW_H = 5.5;
const tableHeight = (rows: number): number => 6 + ROW_H * (rows + 1);

export interface FrameDrawingOptions { name?: string; date?: string }
export interface FrameDrawing { doc: DrawingDoc; data: Record<string, ViewData>; model: SheetModel }

/** Spread balloons: push apart any two closer than `gap` mm, keep each inside the box. */
function spread(pos: V2[], box: { x0: number; y0: number; x1: number; y1: number }, gap = 10): void {
  for (let it = 0; it < 40; it++) {
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      const dx = pos[j][0] - pos[i][0], dy = pos[j][1] - pos[i][1], d = Math.hypot(dx, dy);
      if (d >= gap) continue;
      const ux = d < 1e-6 ? 1 : dx / d, uy = d < 1e-6 ? 0 : dy / d, push = (gap - d) / 2;
      pos[i] = [pos[i][0] - ux * push, pos[i][1] - uy * push];
      pos[j] = [pos[j][0] + ux * push, pos[j][1] + uy * push];
    }
    for (const p of pos) { p[0] = Math.min(box.x1, Math.max(box.x0, p[0])); p[1] = Math.min(box.y1, Math.max(box.y0, p[1])); }
  }
}

/** Build the drawing. `query` is the kernel's drawing query (Controller.drawingQuery()); without it (or without a solid) the sheet has the tables only. */
export async function frameDrawing(frames: FrameReport[], query: DrawingQuery | null, o: FrameDrawingOptions = {}): Promise<FrameDrawing> {
  const model = sheetModel(frames);
  const need = tableHeight(model.cut.length) + tableHeight(model.bom.length) + 8;
  const sizeName = ['A3', 'A2', 'A1', 'A0'].find((n) => {
    const [, h] = sheetSize({ size: n, orientation: 'landscape' } as never);
    return h - 20 - 60 >= need;
  }) ?? 'A0';
  let doc = emptyDrawing(o.name ?? '', model.materials.join(', '));
  doc = {
    ...doc, sheet: { ...doc.sheet, size: sizeName, orientation: 'landscape', units: 'mm' },
    title: { ...doc.title, title: o.name ?? '', date: o.date ?? doc.title.date, material: model.materials.join(', '), mass: model.massKg ? `${kg(model.massKg)} kg` : '' },
    bom: { show: false, pos: null },
  };
  const [sw, sh] = sheetSize(doc.sheet);
  const m = doc.sheet.margin;
  const mk = (id: string, name: keyof typeof STD_FRAMES): DView => ({ id, kind: 'std', label: STD_FRAMES[name].label, x: STD_FRAMES[name].x, y: STD_FRAMES[name].y, pos: [0, 0], scale: null, hidden: false, tangent: false, centerlines: false, showLabel: true });
  const iso = mk('V1', 'iso'), front = mk('V2', 'front'), top = mk('V3', 'top');
  doc = { ...doc, views: [iso, front, top] };
  let data: Record<string, ViewData> = {};
  if (query && model.cut.length) { try { data = await fetchViews(doc, query); } catch { data = {}; } }

  // regions: views at the left, tables stacked at the right, title block (drawn by the sheet) at the bottom right
  const tx = sw - m - TABLE_W - 3;
  const area = { x0: m + 6, y0: m + 6, x1: tx - 8, y1: sh - m - 50 };
  const cells: Record<string, { x0: number; y0: number; x1: number; y1: number }> = {
    V1: { x0: area.x0, y0: area.y0, x1: area.x1, y1: area.y0 + (area.y1 - area.y0) * 0.58 },
    V2: { x0: area.x0, y0: area.y0 + (area.y1 - area.y0) * 0.58, x1: (area.x0 + area.x1) / 2, y1: area.y1 },
    V3: { x0: (area.x0 + area.x1) / 2, y0: area.y0 + (area.y1 - area.y0) * 0.58, x1: area.x1, y1: area.y1 },
  };
  const BAL = 22;   // room for balloons and the view label around a view
  const views = doc.views.map((v) => {
    const g = data[v.id], c = cells[v.id];
    if (!g) return v;
    const e = viewExtent(g, 1);
    const iw = c.x1 - c.x0 - 2 * BAL, ih = c.y1 - c.y0 - 2 * BAL - 4;
    const sc = SCALES.find((s) => e[0] * parseScale(s) <= iw && e[1] * parseScale(s) <= ih) ?? SCALES[SCALES.length - 1];
    return { ...v, scale: sc, pos: [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2 - 2] as V2 };
  });
  doc = { ...doc, views, sheet: { ...doc.sheet, scale: views.find((v) => v.id === 'V2')?.scale ?? doc.sheet.scale } };

  // balloons: one per piece, numbered by its cut-list row
  const balloons: DBalloon[] = [];
  const bodies = [...model.rowOf.keys()];
  for (const v of doc.views) {
    const g = data[v.id];
    if (!g) continue;
    const P = placer(doc, v, g);
    const c = P((g.min[0] + g.max[0]) / 2, (g.min[1] + g.max[1]) / 2);
    const items: Array<{ body: string; at: V2; pos: V2 }> = [];
    for (const body of bodies) {
      const at = memberAnchor(g, body);
      if (!at) continue;
      const s = P(at[0], at[1]);
      const dx = s[0] - c[0], dy = s[1] - c[1], L = Math.hypot(dx, dy) || 1;
      items.push({ body, at, pos: [s[0] + (dx / L) * 12, s[1] + (dy / L) * 12] });
    }
    const box = cells[v.id];
    const vb = viewBox(doc, v, g), cx = (vb.x0 + vb.x1) / 2;
    // keep clear of the view's label under it
    for (const it of items) if (Math.abs(it.pos[0] - cx) < 26 && it.pos[1] > vb.y1 && it.pos[1] < vb.y1 + 14) it.pos = [it.pos[0], vb.y1 + 19];
    const pos = items.map((it) => it.pos);
    spread(pos, { x0: box.x0 + 5, y0: box.y0 + 5, x1: box.x1 - 5, y1: box.y1 - 4 });
    items.forEach((it, i) => balloons.push({ id: `B${balloons.length + 1}`, view: v.id, at: it.at, pos: pos[i], n: model.rowOf.get(it.body)! }));
  }
  doc = { ...doc, balloons };

  const tables: DTable[] = [
    { id: TABLE_CUT, title: t('frame.cutlist.title'), x: tx, y: m + 6, cols: COLS_CUT, head: model.head, rows: model.cut, rowH: ROW_H },
    { id: TABLE_BOM, title: t('frame.cutlist.bom'), x: tx, y: m + 6 + tableHeight(model.cut.length) + 8, cols: COLS_BOM, head: model.bomHead, rows: model.bom, rowH: ROW_H },
  ];
  doc = { ...doc, tables };
  return { doc, data, model };
}

/** Table blocks of a frame drawing (replaced by id when the cut list is refreshed). */
export const TABLE_CUT = 'frame-cutlist', TABLE_BOM = 'frame-bom';

/** The cut list and BOM tables of the frames, placed under any already on a drawing; those with the frame ids are replaced. */
export function refreshTables(existing: DrawingDoc, fresh: DrawingDoc): DrawingDoc {
  const keep = (existing.tables ?? []).filter((x) => x.id !== TABLE_CUT && x.id !== TABLE_BOM);
  return { ...existing, tables: [...keep, ...(fresh.tables ?? [])] };
}

/** Headless: the drawing's sheet as PDF bytes (the Drawings workspace exports the same primitives). */
export function drawingPdf(doc: DrawingDoc, data: Record<string, ViewData>): { pdf: Uint8Array; prims: Prim[]; svg: string } {
  const prims = renderSheet({ doc, data });
  const size = sheetSize(doc.sheet);
  return { pdf: toPdf(prims, size), prims, svg: toSvg(prims, size) };
}
