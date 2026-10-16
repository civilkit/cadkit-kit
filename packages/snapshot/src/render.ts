// renderSnapshot: single views and the multi-panel sheets (orthos, first / third angle drawings, A|B, section).
import { azElOf, dirFromAzEl, resolveView, stdDirection } from './camera.js';
import { encodePng } from './png.js';
import { Raster, type RGB } from './raster.js';
import { fmtMm, prepare, renderPanel, type PanelOpts, type PanelResult } from './render3d.js';
import { renderSectionPanel } from './section2d.js';
import type { Frame, SheetName, SnapshotInput, SnapshotMeta, SnapshotOpts, SnapshotResult, StyleName, V3, ViewSpec } from './types.js';

function parseColor(c: SnapshotOpts['background'], dflt: RGB): RGB {
  if (!c) return dflt;
  if (Array.isArray(c)) return [c[0], c[1], c[2]];
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) throw new Error(`snapshot: bad background colour '${c}' (use #rrggbb)`);
  let h = m[1];
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const GAP = 10;
const HEADER = 30;

export async function renderSnapshot(input: SnapshotInput, opts: SnapshotOpts = {}): Promise<SnapshotResult> {
  const t0 = Date.now();
  const up = opts.up ?? 'y';
  const sheet: SheetName = opts.sheet ?? 'single';
  const style: StyleName = opts.style ?? 'shaded';
  const ss = Math.max(1, Math.min(3, Math.round(opts.supersample ?? 2)));
  const size = typeof opts.size === 'number' ? { width: opts.size, height: opts.size } : opts.size ?? { width: 768, height: 768 };
  const persp = opts.projection === 'persp';
  const prep = prepare(input);
  const bg = parseColor(opts.background, style === 'hidden-line' ? [255, 255, 255] : [234, 238, 244]);
  const base = (over: Partial<PanelOpts> & { view?: ViewSpec }): PanelOpts => {
    const v = resolveView(over.view ?? opts.view, up);
    return {
      w: size.width, h: size.height, ss, dir: v.dir, upv: v.upv, persp, style, bg,
      frame: opts.frame, markers: opts.markers, annotate: opts.annotate,
      highlight: opts.highlight ? new Set(opts.highlight) : undefined,
      section: input.section, looks: opts.appearance !== false, ...over,
    };
  };
  let out: Raster;
  let main: PanelResult;
  let viewName = resolveView(opts.view, up).name;
  const panels: NonNullable<SnapshotMeta['panels']> = [];
  const place = (r: Raster, big: Raster, x: number, y: number, label: string) => {
    big.blit(r, x, y);
    big.strokeRect(x, y, x + r.width, y + r.height, [170, 176, 188], 1);
    panels.push({ label, x, y, width: r.width, height: r.height });
  };

  if (sheet === 'single') {
    main = renderPanel(prep, base({}));
    out = main.raster;
  } else if (sheet === 'ab') {
    const v = resolveView(opts.view ?? 'iso', up);
    let { az, el } = azElOf(v.dir, up);
    const axisAligned = Math.abs(Math.sin((az * Math.PI) / 180)) < 0.05;
    let viewA: ViewSpec = opts.view ?? 'iso', viewB: ViewSpec;
    if (opts.ab?.bView) viewB = opts.ab.bView;
    else if (axisAligned) { viewA = { azimuth: az + 35, elevation: Math.abs(el) > 80 ? 20 : el }; viewB = { azimuth: az - 35, elevation: Math.abs(el) > 80 ? 20 : el }; }
    else viewB = { azimuth: -az, elevation: el };
    const [la, lb] = opts.ab?.labels ?? ['A', 'B'];
    const inB = opts.ab?.b ?? input;
    const frame = opts.frame ?? { center: prep.center, radius: Math.max(prep.radius, prepare(inB).radius) };
    const pa = renderPanel(prep, base({ view: viewA, frame, label: la }));
    const pb = renderPanel(prepare(inB), base({ view: viewB, frame, label: lb, section: inB.section }));
    out = new Raster(size.width * 2 + GAP, size.height, [255, 255, 255]);
    place(pa.raster, out, 0, 0, la); place(pb.raster, out, size.width + GAP, 0, lb);
    main = pa; viewName = `${la}|${lb}`;
  } else if (sheet === 'orthos') {
    const pw = Math.round(size.width * 0.7), ph = Math.round(size.height * 0.7);
    const frame: Frame | undefined = opts.frame;
    const list: Array<[string, ViewSpec]> = [['FRONT', 'front'], ['RIGHT', 'right'], ['TOP', 'top'], ['ISO', 'iso']];
    out = new Raster(pw * 2 + GAP, ph * 2 + GAP, [255, 255, 255]);
    list.forEach(([label, view], i) => {
      const pr = renderPanel(prep, base({ view, w: pw, h: ph, label, frame }));
      if (i === 0) main = pr;
      place(pr.raster, out, (i % 2) * (pw + GAP), Math.floor(i / 2) * (ph + GAP), label);
    });
    main = main!;
    viewName = 'orthos';
  } else if (sheet === 'drawing-first-angle' || sheet === 'drawing-third-angle') {
    const pw = Math.round(size.width * 0.7), ph = Math.round(size.height * 0.7);
    const bb = prep.bbox;
    const ext = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2], 1e-9);
    const scale = 0.62 * Math.min(pw, ph) / ext;
    const frame: Frame = { center: prep.center, radius: prep.radius };
    const first = sheet === 'drawing-first-angle';
    const dp = (view: ViewSpec, label: string) => renderPanel(prep, base({ view, w: pw, h: ph, label, style: opts.style ?? 'hidden-line', bg: parseColor(opts.background, [255, 255, 255]), frame, scale, dims: true, markers: undefined, annotate: undefined, section: undefined }));
    const extra = input.section
      ? { raster: renderSectionPanel(input.section, { w: pw, h: ph, bg: [255, 255, 255], label: 'SECTION' }).raster, label: 'SECTION' }
      : (() => { const pr = renderPanel(prep, base({ view: 'iso', w: pw, h: ph, label: 'ISO', style: 'shaded', frame, scale: scale * 0.8, section: undefined })); return { raster: pr.raster, label: 'ISO' }; })();
    const front = dp('front', 'FRONT'), top = dp('top', 'TOP'), right = dp('right', 'RIGHT');
    const TB = 78;
    out = new Raster(pw * 2 + GAP, ph * 2 + GAP + TB, [255, 255, 255]);
    // third angle: top above front, right to the right of front. first angle: right to the left of front, top below it.
    const cells = first
      ? [[extra.raster, extra.label], [front.raster, 'FRONT'], [right.raster, 'RIGHT'], [top.raster, 'TOP']] as const
      : [[top.raster, 'TOP'], [extra.raster, extra.label], [front.raster, 'FRONT'], [right.raster, 'RIGHT']] as const;
    // first angle grid: row0 [RIGHT | FRONT], row1 [extra | TOP]
    const grid = first
      ? [[right.raster, 'RIGHT'], [front.raster, 'FRONT'], [extra.raster, extra.label], [top.raster, 'TOP']] as const
      : cells;
    grid.forEach(([r, label], i) => place(r, out, (i % 2) * (pw + GAP), Math.floor(i / 2) * (ph + GAP), label));
    const ty = ph * 2 + GAP;
    out.fillRect(0, ty, out.width, out.height, [255, 255, 255]);
    out.strokeRect(0, ty, out.width, out.height, [60, 66, 78], 2);
    const dx = bb.max[0] - bb.min[0], dy = bb.max[1] - bb.min[1], dz = bb.max[2] - bb.min[2];
    const ink: RGB = [20, 24, 32];
    out.text(10, ty + 8, `PART: ${opts.title ?? input.name ?? 'UNNAMED'}`, ink, 2);
    out.text(10, ty + 28, `BBOX ${fmtMm(dx)} X ${fmtMm(dy)} X ${fmtMm(dz)} MM`, ink, 2);
    out.text(10, ty + 46, input.volume !== undefined ? `VOLUME ${fmtMm(input.volume)} MM3` : 'VOLUME N/A', ink, 2);
    const tx = Math.round(out.width * 0.58);
    out.text(tx, ty + 8, first ? 'FIRST ANGLE PROJECTION' : 'THIRD ANGLE PROJECTION', ink, 2);
    out.text(tx, ty + 28, `SCALE ${fmtMm(scale)} PX/MM  HIDDEN LINES DASHED`, ink, 1);
    out.text(tx, ty + 46, `UP ${up.toUpperCase()}  UNITS MM`, ink, 1);
    main = front; viewName = sheet;
  } else if (sheet === 'section') {
    if (!input.section) throw new Error("snapshot: sheet 'section' needs input.section (the kernel section reply)");
    const pw = size.width, ph = size.height;
    const sp = renderSectionPanel(input.section, { w: pw, h: ph, bg: [255, 255, 255], label: 'SECTION' });
    const iso = renderPanel(prep, base({ w: pw, h: ph, label: opts.view ? undefined : 'ISO' }));
    out = new Raster(pw * 2 + GAP, ph, [255, 255, 255]);
    place(sp.raster, out, 0, 0, 'SECTION'); place(iso.raster, out, pw + GAP, 0, 'MODEL');
    main = iso; viewName = 'section';
  } else {
    throw new Error(`snapshot: unknown sheet '${sheet as string}'`);
  }
  const png = await encodePng({ width: out.width, height: out.height, rgba: out.data });
  const meta: SnapshotMeta = {
    view: viewName, up, projection: persp ? 'persp' : 'ortho', style, sheet,
    frame: main.frame, scale: main.camera.scale, triangles: prep.nTri,
    bbox: prep.bbox, ms: Date.now() - t0, ...(panels.length ? { panels } : {}),
  };
  return { png, width: out.width, height: out.height, rgba: out.data, meta };
}

export { dirFromAzEl, stdDirection };
export type { V3 };
