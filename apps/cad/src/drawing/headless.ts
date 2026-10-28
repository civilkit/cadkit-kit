// The drawing layer without the UI: views, automatic dimensions, hole callouts, an optional section, tidy-ups, and SVG / PDF / DXF output
// for a kernel Session. The MCP `drawing` tool and scripts call this; the Drawings workspace builds the same documents interactively
// from the same modules (kernel, layout, geom, render, output).
import type { Session } from '@ck/session';
import { densityOf, massText, massView } from '../inspect/mass';
import { autoDims, type HoleInfo } from './geom';
import { drawingQuery, holeInfos } from './kernel';
import { addSection, standardViews } from './layout';
import { SCALES, SHEET_NAMES, SHEET_SIZES, STD_NAMES, emptyDrawing, sheetSize, viewCentre, type DDim, type DrawingDoc, type TitleBlock, type V2, type ViewData } from './model';
import { toDxf, toPdf } from './output';
import { renderSheet, toSvg, type Prim } from './render';

export interface HeadlessDrawingOptions {
  /** standard views: front (always first), top, right, left, bottom, back, iso. Default front, top, right, iso. */
  views?: string[];
  /** A4 | A3 | A2 | A1 | A0 | ANSI A..E. Default A3. */
  sheet?: string;
  orientation?: 'landscape' | 'portrait';
  /** e.g. '2:1', '1:1', '1:5'. Default: the largest standard scale at which the views fit. */
  scale?: string;
  /** 'third' (default) or 'first' angle projection */
  projection?: 'third' | 'first';
  /** draw hidden lines (default false: they bury hole callouts on busy assemblies) */
  hidden?: boolean;
  /** add the automatic dimensions: overall width / height, diameters, hole callouts (default true) */
  dimensions?: boolean;
  /** add a section view of the first view: true (vertical cut through its centre) or { dir, at } (at = position in the front view's own coordinates) */
  section?: boolean | { dir?: 'v' | 'h'; at?: number };
  /** tidy the automatic dimensions (default true): hole callout leaders point away from the middle of the view, and plain diameters of small circles (at or below `minDiameter`) are dropped */
  tidy?: boolean;
  /** with tidy: plain diameter dimensions of circles up to this diameter in mm are left out (default 10). Hole callouts are always kept. */
  minDiameter?: number;
  title?: Partial<TitleBlock>;
}

export interface HeadlessDrawing {
  doc: DrawingDoc;
  data: Record<string, ViewData | undefined>;
  prims: Prim[];
  size: V2;
  svg: string;
  pdf(): Uint8Array;
  dxf(): string;
  /** what was drawn, for the tool result */
  summary: { sheet: string; scale: string; views: string[]; dimensions: number; callouts: string[]; section: boolean };
  warnings: string[];
}

/** Callout leaders away from the view's middle, no tiny diameters. */
export function tidyDims(dims: DDim[], g: ViewData, minDiameter = 10): DDim[] {
  const [cx, cy] = viewCentre(g);
  return dims
    .filter((d) => d.kind !== 'diameter' || (d.r ?? 0) * 2 > minDiameter)
    .map((d) => (d.kind === 'callout' ? { ...d, angle: Math.atan2(d.a[1] - cy, d.a[0] - cx), offset: 12 } : d));
}

export async function drawHeadless(session: Session, o: HeadlessDrawingOptions = {}): Promise<HeadlessDrawing> {
  const warnings: string[] = [];
  const part = session.document as unknown as { name?: string; material?: string; features: Array<Record<string, unknown>> };
  const sheet = o.sheet ?? 'A3';
  if (!SHEET_SIZES[sheet]) throw new Error(`drawing: unknown sheet size ${JSON.stringify(sheet)}; use ${SHEET_NAMES.join(', ')}`);
  if (o.scale !== undefined && !/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(o.scale)) throw new Error(`drawing: scale must look like "2:1" or "1:5" (standard scales: ${SCALES.join(', ')})`);
  const names = o.views?.length ? o.views : ['front', 'top', 'right', 'iso'];
  for (const n of names) if (!STD_NAMES.includes(n)) throw new Error(`drawing: unknown view ${JSON.stringify(n)}; use ${STD_NAMES.join(', ')}`);
  if (names[0] !== 'front') throw new Error("drawing: the first view must be 'front' (the other views are projected from it)");

  const q = drawingQuery(session);
  let doc = emptyDrawing(part.name ?? '', part.material ?? '');
  doc = { ...doc, sheet: { ...doc.sheet, size: sheet, orientation: o.orientation ?? doc.sheet.orientation, projection: o.projection ?? doc.sheet.projection }, title: { ...doc.title, ...o.title } };
  if (!doc.title.mass) {
    try {
      const dens = densityOf(part.material);
      const raw = dens !== null ? await session.massProps() : null;
      if (raw && dens !== null) doc = { ...doc, title: { ...doc.title, mass: massText(massView(raw as never, dens).mass) } };
    } catch { /* the title block leaves the mass empty */ }
  }
  const r = await standardViews(doc, q, names, 0, o.scale);
  doc = r.doc;
  const data: Record<string, ViewData | undefined> = r.data;
  if (!doc.views.length || !data[doc.views[0].id]) throw new Error('drawing: the kernel returned no view geometry (does the document have a solid?)');

  const holes: HoleInfo[] = holeInfos(part.features as never);
  const flat = o.hidden === true;
  let dimCount = 0;
  if (o.dimensions !== false) {
    const dims = doc.views.filter((v) => (v.kind === 'std' || v.kind === 'proj') && v.label !== 'Isometric').flatMap((v) => {
      const g = data[v.id]!;
      const d = autoDims(g, v, holes);
      return o.tidy === false ? d : tidyDims(d, g, o.minDiameter);
    });
    doc = { ...doc, dims };
    dimCount = dims.length;
  }
  let sectioned = false;
  if (o.section) {
    const front = doc.views[0];
    const spec = typeof o.section === 'object' ? o.section : {};
    const dir = spec.dir ?? 'v';
    const c = viewCentre(data[front.id]!);
    const sec = await addSection(doc, q, data, front.id, dir, spec.at ?? (dir === 'v' ? c[0] : c[1]));
    if (sec) { doc = sec.doc; Object.assign(data, sec.data); sectioned = true; } else warnings.push('the section view could not be made (the cut missed the body or the kernel returned nothing)');
  }
  doc = { ...doc, views: doc.views.map((v) => ({ ...v, hidden: v.kind === 'section' ? false : flat, tangent: false })) };
  if (holes.length === 0 && o.dimensions !== false) warnings.push('the part has no hole features, so there are no hole callouts: use holes.points / holes.polar / hole() instead of a sketch circle plus a cut if you want "M5 x 12 DEPTH" notes');
  const text = new Map(holes.map((h) => [h.feature, h.text]));
  const prims = renderSheet({ doc, data, callout: (f) => text.get(f) ?? null });
  const size = sheetSize(doc.sheet);
  const callouts = doc.dims.filter((d) => d.kind === 'callout').map((d) => (d.feature ? text.get(d.feature) ?? '' : '')).filter(Boolean);
  return {
    doc, data, prims, size, svg: toSvg(prims, size), pdf: () => toPdf(prims, size), dxf: () => toDxf(prims, size), warnings,
    summary: { sheet: `${doc.sheet.size} ${doc.sheet.orientation}`, scale: doc.sheet.scale, views: doc.views.map((v) => v.label), dimensions: dimCount, callouts, section: sectioned },
  };
}
