// The Drawings workspace: a sheet shown as SVG in the viewport area, with the view / annotation tools, the sheet and title block
// panel, and PDF / SVG / DXF / print output. The sheet is data (`DrawingDoc`) kept in the part document; the views are projected
// again by the kernel whenever the part changes.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { t } from '../i18n';
import {
  SCALES, SHEET_NAMES, STD_FRAMES, STD_NAMES, emptyDrawing, fmtLength, newId, removeView, sanitizeDrawing, sheetSize, viewScale, fromSheet,
  type DDim, type DrawingDoc, type DView, type V2, type ViewData,
} from './model';
import { autoBalloons, autoDims, dimFromPicks, edgeShape, pickEdge, type HoleInfo } from './geom';
import { addAux, addDetail, addProjected, addSection, fetchViews, moveView, nudgeClear, sideOfPoint, standardViews, type DrawingQuery } from './layout';
import { dataOf, dimMeasure, placer, refreshDims, renderSheet, toSvg, viewBox, type BomRow, type Prim } from './render';
import { hitAnnotation } from './hit';
import { holeInfos } from './kernel';
import { massText } from '../inspect/mass';
import { printSvg, toDxf, toPdf } from './output';
import { componentOfName, insertIds } from '../assembly/model';
import { projectedFrame } from './model';

export interface DrawingHost {
  partName: string; material: string;
  /** the `drawing` field of the part document */
  stored: unknown;
  features: Array<Record<string, unknown>>;
  /** changes whenever the part changes: views are projected again */
  revision: string;
  query: DrawingQuery | null;
  hasBody: boolean;
  /** pitch of thread sizes, `standard|size` -> mm */
  pitches(): Promise<Record<string, number>>;
  /** mass of the part in grams, when the material is known */
  mass(): Promise<number | null>;
  /** bill of materials rows for an assembly ([] for a part) */
  bom(): Promise<BomRow[]>;
  onChange(d: DrawingDoc): void;
  save(name: string, data: string | Uint8Array, mime: string): Promise<void>;
  notify(text: string, level?: 'info' | 'warn' | 'error'): void;
  close(): void;
}

type Tool = 'select' | 'dim' | 'proj' | 'section' | 'detail' | 'aux' | 'note' | 'balloon';
type Sel = { kind: 'view' | 'dim' | 'note' | 'balloon' | 'title' | 'bom' | 'label'; id: string } | null;
const PX = 3.7795;      // css pixels per mm at zoom 1

const stem = (s: string): string => (s || 'drawing').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'drawing';
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const frameSig = (d: DrawingDoc): string => JSON.stringify(d.views.map((v) => [v.id, v.kind, v.x, v.y, v.parent, v.cut, v.side]));

export function DrawingWorkspace(p: { host: DrawingHost }): JSX.Element {
  const { host } = p;
  const [doc, setDoc] = useState<DrawingDoc>(() => sanitizeDrawing(host.stored, host.partName, host.material));
  const docRef = useRef(doc); docRef.current = doc;
  const [data, setData] = useState<Record<string, ViewData | undefined>>({});
  const dataRef = useRef(data); dataRef.current = data;
  const [sel, setSel] = useState<Sel>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [busy, setBusy] = useState(false);
  const [lost, setLost] = useState(0);
  const [pitches, setPitches] = useState<Record<string, number>>({});
  const [bom, setBom] = useState<BomRow[]>([]);
  const [pend, setPend] = useState<{ view: string; picks: number[]; radial: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ kind: string; pts: number[]; r?: number; c?: V2 } | null>(null);
  const [cam, setCam] = useState<{ x: number; y: number; k: number }>({ x: 20, y: 20, k: 1 });
  const camRef = useRef(cam); camRef.current = cam;
  const stage = useRef<HTMLDivElement>(null);
  const sheetEl = useRef<HTMLDivElement>(null);
  const drag = useRef<null | { kind: 'pan'; x: number; y: number; cx: number; cy: number } | { kind: 'item'; sel: NonNullable<Sel>; start: V2; moved: boolean; base: DrawingDoc } | { kind: 'detail'; view: string; c: V2 } | { kind: 'projParent'; view: string }>(null);
  const projParent = useRef<string | null>(null);
  const pitchesRef = useRef<Record<string, number>>({});

  const commit = (next: DrawingDoc) => { docRef.current = next; setDoc(next); host.onChange(next); };
  const update = (fn: (d: DrawingDoc) => DrawingDoc) => commit(fn(docRef.current));

  // ---- keep the title block's part-derived fields and the views in step with the part -------------------------------------
  const sig = frameSig(doc);
  useEffect(() => {
    let dead = false;
    (async () => {
      if (!host.query || !host.hasBody || !docRef.current.views.length) { setData({}); return; }
      setBusy(true);
      try {
        const d = await fetchViews(docRef.current, host.query);
        if (dead) return;
        setData(d);
        const r = refreshDims(docRef.current, d);
        setLost(r.lost.length);
        if (!same(r.dims, docRef.current.dims)) update((x) => ({ ...x, dims: r.dims }));
      } finally { if (!dead) setBusy(false); }
    })();
    return () => { dead = true; };
  }, [sig, host.revision, host.hasBody]);
  useEffect(() => {
    let dead = false;
    (async () => {
      const pitches = await host.pitches();
      pitchesRef.current = pitches;
      if (!dead) setPitches(pitches);
      const rows = await host.bom();
      if (!dead) setBom(rows);
      const m = await host.mass();
      if (!dead && m !== null) {
        const text = massText(m);
        if (docRef.current.title.mass !== text && (docRef.current.title.mass === '' || /^[\d.]+ (g|kg)$/.test(docRef.current.title.mass))) update((x) => ({ ...x, title: { ...x.title, mass: text } }));
      }
    })();
    return () => { dead = true; };
  }, [host.revision]);
  // the part's name / material fill the title block while the user has not typed their own
  useEffect(() => {
    const d = docRef.current;
    const patch: Partial<DrawingDoc['title']> = {};
    if (!d.title.title) patch.title = host.partName;
    if (!d.title.material) patch.material = host.material;
    if (Object.keys(patch).length) update((x) => ({ ...x, title: { ...x.title, ...patch } }));
  }, [host.partName, host.material]);

  // ---- rendering ----------------------------------------------------------------------------------------------------------
  const size = sheetSize(doc.sheet);
  const holes: HoleInfo[] = useMemo(() => holeInfos(host.features as never, (std, size) => pitches[`${std}|${size}`] ?? null), [host.revision, pitches]);
  const calloutOf = useMemo(() => (f: string) => holes.find((h) => h.feature === f)?.text ?? null, [holes]);
  const prims: Prim[] = useMemo(() => renderSheet({ doc, data, callout: calloutOf, bom }), [doc, data, calloutOf, bom]);
  const svg = useMemo(() => toSvg(prims, size, { interactive: true, selected: sel?.id ?? null }), [prims, sel?.id, doc.sheet.size, doc.sheet.orientation]);

  const fit = () => {
    const el = stage.current; if (!el || !el.clientWidth) return;
    const k = Math.min((el.clientWidth - 40) / (size[0] * PX), (el.clientHeight - 40) / (size[1] * PX));
    setCam({ k, x: (el.clientWidth - size[0] * PX * k) / 2, y: (el.clientHeight - size[1] * PX * k) / 2 });
  };
  useEffect(() => { fit(); }, [doc.sheet.size, doc.sheet.orientation]);
  const userCam = useRef(false);
  useEffect(() => {
    const el = stage.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (!userCam.current) fit(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc.sheet.size, doc.sheet.orientation]);

  const mm = (e: { clientX: number; clientY: number }): V2 => {
    const r = sheetEl.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * size[0], ((e.clientY - r.top) / r.height) * size[1]];
  };
  const viewAt = (pt: V2): DView | null => {
    const d = docRef.current;
    let best: { v: DView; area: number } | null = null;
    for (const v of d.views) {
      const g = dataOf({ doc: d, data: dataRef.current }, v);
      if (!g) continue;
      const b = viewBox(d, v, g);
      const m = 3;
      if (pt[0] >= b.x0 - m && pt[0] <= b.x1 + m && pt[1] >= b.y0 - m && pt[1] <= b.y1 + m) {
        const area = (b.x1 - b.x0) * (b.y1 - b.y0);
        if (!best || area < best.area) best = { v, area };
      }
    }
    return best?.v ?? null;
  };
  const toView = (v: DView, pt: V2): V2 => {
    const g = dataOf({ doc: docRef.current, data: dataRef.current }, v)!;
    if (v.kind === 'detail' && v.circle) { const s = viewScale(docRef.current, v); return [v.circle.c[0] + (pt[0] - v.pos[0]) / s, v.circle.c[1] - (pt[1] - v.pos[1]) / s]; }
    return fromSheet(v, g, viewScale(docRef.current, v), pt[0], pt[1]);
  };

  // ---- actions ------------------------------------------------------------------------------------------------------------
  const note = (key: string, level: 'info' | 'warn' | 'error' = 'info', params?: Record<string, string | number>) => host.notify(t(key, params), level);
  const needQuery = (): DrawingQuery | null => { if (!host.query || !host.hasBody) { note('drawing.msg.nothing', 'warn'); return null; } return host.query; };

  const holesNow = (): HoleInfo[] => holeInfos(host.features as never, (std, size) => pitchesRef.current[`${std}|${size}`] ?? null);
  const doStandard = async () => {
    const q = needQuery(); if (!q) return;
    setBusy(true);
    try {
      const r = await standardViews(docRef.current, q, undefined, bom.length ? bom.length * 6 + 12 : 0);
      setData(r.data); dataRef.current = r.data;
      let next = r.doc;
      const dims: DDim[] = next.views.filter((v) => v.kind !== 'std' || v.label === 'Front').flatMap((v) => (r.data[v.id] ? autoDims(r.data[v.id]!, v, holesNow()) : []));
      next = { ...next, dims };
      commit(next);
      setSel(null);
    } finally { setBusy(false); }
  };
  const addStdView = async (name: string) => {
    const q = needQuery(); if (!q) return;
    const fr = STD_FRAMES[name];
    const d = docRef.current;
    const v: DView = { id: newId('V', d.views.map((x) => x.id)), kind: 'std', label: fr.label, x: fr.x, y: fr.y, pos: [size[0] / 2, size[1] / 2 - 20], scale: null, hidden: true, tangent: false, centerlines: true, showLabel: true };
    const d2 = { ...d, views: [...d.views, v] };
    const nd = await fetchViews(d2, q, [v.id]);
    if (!nd[v.id]) return;
    const all = { ...dataRef.current, ...nd };
    v.pos = nudgeClear(d2, all, v, [1, 0.3]);
    setData(all); dataRef.current = all;
    commit(d2); setSel({ kind: 'view', id: v.id });
  };
  const doAutoDim = () => {
    const d = docRef.current;
    const targets = sel?.kind === 'view' ? d.views.filter((v) => v.id === sel.id) : d.views.filter((v) => v.kind !== 'detail' && v.label !== 'Isometric');
    if (!targets.length) { note('drawing.msg.noViews', 'warn'); return; }
    const ids = new Set(targets.map((v) => v.id));
    const fresh = targets.flatMap((v) => (dataRef.current[v.id] ? autoDims(dataRef.current[v.id]!, v, holesNow()) : []));
    commit({ ...d, dims: [...d.dims.filter((x) => !ids.has(x.view)), ...fresh] });
  };
  const doAutoBalloons = () => {
    const d = docRef.current;
    const v = (sel?.kind === 'view' ? d.views.find((x) => x.id === sel.id) : undefined) ?? d.views.find((x) => x.label === 'Front') ?? d.views[0];
    const g = v && dataRef.current[v.id];
    if (!v || !g) { note('drawing.msg.noViews', 'warn'); return; }
    const ins = insertIds({ features: host.features as never });
    const found = autoBalloons(g, v, bom.map((b) => ({ no: b.no, components: b.components ?? [] })), (f) => componentOfName(f, ins));
    const P = placer(d, v, g);
    const balloons = found.map((f, i) => { const a = P(f.at[0], f.at[1]); return { id: `B${i + 1}`, view: v.id, at: f.at, pos: [a[0] + f.dir[0] * 20, a[1] - f.dir[1] * 20] as V2, n: f.no }; });
    commit({ ...d, balloons: [...d.balloons.filter((x) => x.view !== v.id), ...balloons] });
  };
  const deleteSel = () => {
    if (!sel) return;
    update((d) => {
      if (sel.kind === 'view') return removeView(d, sel.id);
      if (sel.kind === 'dim') return { ...d, dims: d.dims.filter((x) => x.id !== sel.id) };
      if (sel.kind === 'note') return { ...d, notes: d.notes.filter((x) => x.id !== sel.id) };
      if (sel.kind === 'balloon') return { ...d, balloons: d.balloons.filter((x) => x.id !== sel.id) };
      if (sel.kind === 'bom') return { ...d, bom: { ...d.bom, show: false } };
      return d;
    });
    setSel(null);
  };
  const files = {
    pdf: async () => { await host.save(`${stem(doc.title.title || host.partName)}.pdf`, toPdf(prims, size), 'application/pdf'); },
    svg: async () => { await host.save(`${stem(doc.title.title || host.partName)}.svg`, toSvg(prims, size), 'image/svg+xml'); },
    dxf: async () => { await host.save(`${stem(doc.title.title || host.partName)}.dxf`, toDxf(prims, size), 'image/vnd.dxf'); },
    print: async () => { printSvg(toSvg(prims, size), size); },
  };
  const out = (k: keyof typeof files) => async () => { if (!doc.views.length) { note('drawing.msg.noViews', 'warn'); return; } try { await files[k](); } catch (e) { host.notify((e as Error).message, 'error'); } };

  // ---- pointer ------------------------------------------------------------------------------------------------------------
  const tol = () => 5 / (PX * camRef.current.k);
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const el = stage.current!.getBoundingClientRect();
    const c = camRef.current;
    const f = Math.exp(-e.deltaY * 0.0015);
    const k = Math.min(20, Math.max(0.1, c.k * f));
    const mx = e.clientX - el.left, my = e.clientY - el.top;
    userCam.current = true;
    setCam({ k, x: mx - ((mx - c.x) / c.k) * k, y: my - ((my - c.y) / c.k) * k });
  };
  useEffect(() => { const el = stage.current; if (!el) return; el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel); }, []);

  const onDown = async (e: PointerEvent) => {
    if (e.button === 1 || e.button === 2) { drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, cx: camRef.current.x, cy: camRef.current.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); return; }
    const pt = mm(e);
    const d = docRef.current;
    const hit = hitAnnotation(prims, pt, tol());
    const v = viewAt(pt);
    if (tool === 'select') {
      const target: Sel = hit ? { kind: hit.kind, id: hit.id } : v ? { kind: 'view', id: v.id } : null;
      setSel(target);
      if (target) { drag.current = { kind: 'item', sel: target, start: pt, moved: false, base: d }; }
      else drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, cx: camRef.current.x, cy: camRef.current.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'dim') {
      if (!v) { if (pend) finishDim(); return; }
      const g = dataOf({ doc: d, data: dataRef.current }, v)!;
      const hitE = pickEdge(g, v, toView(v, pt), tol() / viewScale(d, v));
      if (!hitE) { if (pend) finishDim(); else note('drawing.msg.noEdge', 'warn'); return; }
      if (!edgeShape(g, hitE.e)) { note('drawing.msg.cantDim', 'warn'); return; }
      const cur = pend && pend.view === v.id ? pend : { view: v.id, picks: [] as number[], radial: e.shiftKey };
      const picks = [...cur.picks, hitE.e];
      if (picks.length >= 2) { setPend(null); addDim(v, picks, cur.radial); } else setPend({ ...cur, picks });
      return;
    }
    if (!v && tool !== 'note' && !(tool === 'proj' && projParent.current)) return;
    if (tool === 'note') {
      const id = newId('N', d.notes.map((x) => x.id));
      const lead = e.shiftKey && v ? pt : undefined;
      commit({ ...d, notes: [...d.notes, { id, text: 'NOTE', pos: lead ? [pt[0] + 20, pt[1] - 14] : pt, ...(lead ? { leader: lead, view: v!.id } : {}) }] });
      setSel({ kind: 'note', id }); setTool('select');
    } else if (tool === 'balloon' && v) {
      const id = newId('B', d.balloons.map((x) => x.id));
      const n = Math.max(0, ...d.balloons.map((x) => x.n)) + 1;
      commit({ ...d, balloons: [...d.balloons, { id, view: v.id, at: toView(v, pt), pos: [pt[0] + 16, pt[1] - 16], n }] });
      setSel({ kind: 'balloon', id });
    } else if (tool === 'section' && v) {
      const q = needQuery(); if (!q) return;
      const horiz = e.shiftKey;
      const vp = toView(v, pt);
      setBusy(true);
      try {
        const r = await addSection(d, q, dataRef.current, v.id, horiz ? 'h' : 'v', horiz ? vp[1] : vp[0]);
        if (!r) { note('drawing.msg.sectionMisses', 'warn'); return; }
        const all = { ...dataRef.current, ...r.data };
        setData(all); dataRef.current = all;
        commit(r.doc); setSel({ kind: 'view', id: r.view.id }); setGhost(null); setTool('select');
      } finally { setBusy(false); }
    } else if (tool === 'detail' && v) {
      drag.current = { kind: 'detail', view: v.id, c: toView(v, pt) };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } else if (tool === 'proj') {
      if (!projParent.current) { if (!v) return; projParent.current = v.id; setSel({ kind: 'view', id: v.id }); return; }
      const par = d.views.find((x) => x.id === projParent.current)!;
      const g = dataRef.current[par.id]!;
      const side = sideOfPoint(viewBox(d, par, g), pt);
      const q = needQuery(); if (!q) return;
      projParent.current = null;
      const r = await addProjected(d, q, par.id, side, pt);
      if (!r) return;
      const all = { ...dataRef.current, ...r.data };
      setData(all); dataRef.current = all;
      commit(moveView(r.doc, all, r.view.id, pt)); setSel({ kind: 'view', id: r.view.id }); setGhost(null); setTool('select');
    } else if (tool === 'aux' && v) {
      const g = dataOf({ doc: d, data: dataRef.current }, v)!;
      const hitE = pickEdge(g, v, toView(v, pt), tol() / viewScale(d, v));
      const sh = hitE && edgeShape(g, hitE.e);
      if (!sh || sh.kind !== 'line') { note('drawing.msg.noEdge', 'warn'); return; }
      const q = needQuery(); if (!q) return;
      const r = await addAux(d, q, dataRef.current, v.id, Math.atan2(sh.b[1] - sh.a[1], sh.b[0] - sh.a[0]));
      if (!r) return;
      const all = { ...dataRef.current, ...r.data };
      setData(all); dataRef.current = all;
      commit(r.doc); setSel({ kind: 'view', id: r.view.id }); setTool('select');
    }
  };

  const addDim = (v: DView, picks: number[], radial: boolean) => {
    const g = dataOf({ doc: docRef.current, data: dataRef.current }, v)!;
    const nd = dimFromPicks(g, v.id, picks, { radial });
    if (!nd) { note('drawing.msg.cantDim', 'warn'); return; }
    // a circle that belongs to a hole or thread feature gets the callout text
    const e0 = g.edges[picks[0]];
    const hole = picks.length === 1 && nd.r !== undefined && e0 ? holesNow().find((h) => h.faces.some((f) => e0.faces.some((x) => x === f || x.startsWith(f + '.') || x.startsWith(f + '~')))) : undefined;
    const dim = hole && !radial ? { ...nd, kind: 'callout' as const, feature: hole.feature } : nd;
    update((d) => ({ ...d, dims: [...d.dims, dim] }));
    setSel({ kind: 'dim', id: dim.id });
  };
  const finishDim = () => {
    const d = docRef.current;
    if (pend && pend.picks.length) { const v = d.views.find((x) => x.id === pend.view); if (v) addDim(v, pend.picks, pend.radial); }
    setPend(null);
  };

  const onMove = (e: PointerEvent) => {
    const dr = drag.current;
    if (dr?.kind === 'pan') { setCam({ ...camRef.current, x: dr.cx + e.clientX - dr.x, y: dr.cy + e.clientY - dr.y }); return; }
    const pt = mm(e);
    const d = docRef.current;
    if (dr?.kind === 'item') {
      if (!dr.moved && Math.hypot(pt[0] - dr.start[0], pt[1] - dr.start[1]) < 1) return;
      dr.moved = true;
      const dx = pt[0] - dr.start[0], dy = pt[1] - dr.start[1];
      const b = dr.base, s = dr.sel;
      if (s.kind === 'view') {
        const v = b.views.find((x) => x.id === s.id)!;
        const next = moveView(b, dataRef.current, s.id, [v.pos[0] + dx, v.pos[1] + dy]);
        docRef.current = next; setDoc(next);
      } else if (s.kind === 'note') { const next = { ...b, notes: b.notes.map((n) => (n.id === s.id ? { ...n, pos: [n.pos[0] + dx, n.pos[1] + dy] as V2 } : n)) }; docRef.current = next; setDoc(next); }
      else if (s.kind === 'balloon') { const next = { ...b, balloons: b.balloons.map((n) => (n.id === s.id ? { ...n, pos: [n.pos[0] + dx, n.pos[1] + dy] as V2 } : n)) }; docRef.current = next; setDoc(next); }
      else if (s.kind === 'dim') { const next = { ...b, dims: b.dims.map((x) => (x.id === s.id ? dragDim(x, b, dataRef.current, pt) : x)) }; docRef.current = next; setDoc(next); }
      return;
    }
    if (dr?.kind === 'detail') {
      const v = d.views.find((x) => x.id === dr.view)!;
      const q = toView(v, pt);
      setGhost({ kind: 'circle', pts: [], c: dr.c, r: Math.hypot(q[0] - dr.c[0], q[1] - dr.c[1]) });
      return;
    }
    if (tool === 'section') {
      const v = viewAt(pt);
      if (!v) { setGhost(null); return; }
      const g = dataOf({ doc: d, data: dataRef.current }, v)!;
      const a = e.shiftKey ? [viewBox(d, v, g).x0 - 6, pt[1], viewBox(d, v, g).x1 + 6, pt[1]] : [pt[0], viewBox(d, v, g).y0 - 6, pt[0], viewBox(d, v, g).y1 + 6];
      setGhost({ kind: 'line', pts: a });
    } else if (tool === 'proj' && projParent.current) {
      const par = d.views.find((x) => x.id === projParent.current)!;
      const g = dataRef.current[par.id]!;
      const b = viewBox(d, par, g);
      const side = sideOfPoint(b, pt);
      const pts = side === 'right' ? [b.x1 + 2, (b.y0 + b.y1) / 2, b.x1 + 18, (b.y0 + b.y1) / 2] : side === 'left' ? [b.x0 - 2, (b.y0 + b.y1) / 2, b.x0 - 18, (b.y0 + b.y1) / 2] : side === 'up' ? [(b.x0 + b.x1) / 2, b.y0 - 2, (b.x0 + b.x1) / 2, b.y0 - 18] : [(b.x0 + b.x1) / 2, b.y1 + 2, (b.x0 + b.x1) / 2, b.y1 + 18];
      setGhost({ kind: 'line', pts });
    } else if (ghost) setGhost(null);
  };
  const onUp = async (e: PointerEvent) => {
    const dr = drag.current; drag.current = null;
    if (!dr) return;
    if (dr.kind === 'item') { if (dr.moved) host.onChange(docRef.current); return; }
    if (dr.kind === 'detail') {
      const pt = mm(e);
      const v = docRef.current.views.find((x) => x.id === dr.view)!;
      const q = toView(v, pt);
      let r = Math.hypot(q[0] - dr.c[0], q[1] - dr.c[1]);
      const g = dataOf({ doc: docRef.current, data: dataRef.current }, v)!;
      if (r < 0.5) r = Math.min(g.max[0] - g.min[0], g.max[1] - g.min[1]) * 0.15;
      const res = addDetail(docRef.current, v.id, dr.c, r, undefined, dataRef.current);
      setGhost(null);
      if (res) { commit(res.doc); setSel({ kind: 'view', id: res.view.id }); setTool('select'); }
    }
  };
  const onDbl = () => { if (sel) { const el = document.querySelector<HTMLInputElement>('.dwg-props [data-focus]'); el?.focus(); el?.select?.(); } };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null;
      if (tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)) return;
      if (e.key === 'Escape') { setPend(null); projParent.current = null; setGhost(null); if (tool !== 'select') setTool('select'); else setSel(null); }
      else if (e.key === 'Enter' && pend) finishDim();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSel(); }
      else if (e.key === 'd' || e.key === 'D') setTool('dim');
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  // ---- panels -------------------------------------------------------------------------------------------------------------
  const selView = sel?.kind === 'view' ? doc.views.find((v) => v.id === sel.id) : undefined;
  const selDim = sel?.kind === 'dim' ? doc.dims.find((v) => v.id === sel.id) : undefined;
  const selNote = sel?.kind === 'note' ? doc.notes.find((v) => v.id === sel.id) : undefined;
  const selBal = sel?.kind === 'balloon' ? doc.balloons.find((v) => v.id === sel.id) : undefined;
  const setView = (id: string, patch: Partial<DView>) => update((d) => ({ ...d, views: d.views.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
  const tb = (id: Tool, label: string, tip: string, onPick?: () => void) => (
    <button class={'dwg-btn' + (tool === id ? ' on' : '')} aria-pressed={tool === id} title={tip} onClick={() => { projParent.current = null; setPend(null); setGhost(null); setTool(id); onPick?.(); }}>{label}</button>
  );
  const hint = tool === 'dim' ? t('drawing.status.hint.pickDim') : tool === 'proj' ? t('drawing.status.hint.projected') : tool === 'section' ? t('drawing.status.hint.section') : tool === 'detail' ? t('drawing.status.hint.detail') : tool === 'aux' ? t('drawing.status.hint.aux') : tool === 'note' ? t('drawing.status.hint.note') : tool === 'balloon' ? t('drawing.status.hint.balloon') : '';
  const [addName, setAddName] = useState('left');

  return (
    <div id="dwg" role="region" aria-label={t('drawing.title')}>
      <div class="dwg-bar" role="toolbar">
        <button class="dwg-btn" onClick={host.close}>{'← ' + t('drawing.back')}</button>
        {tb('select', t('drawing.select'), t('drawing.select'))}
        <span class="dwg-sep" />
        <button class="dwg-btn" title={t('drawing.standard.tip')} onClick={doStandard} disabled={!host.hasBody}>{t('drawing.standard')}</button>
        <select class="dwg-sel" aria-label={t('drawing.addView')} value={addName} onChange={(e) => setAddName((e.target as HTMLSelectElement).value)}>{STD_NAMES.map((n) => <option value={n} key={n}>{STD_FRAMES[n].label}</option>)}</select>
        <button class="dwg-btn" onClick={() => addStdView(addName)} disabled={!host.hasBody}>{t('drawing.addView')}</button>
        {tb('proj', t('drawing.projected'), t('drawing.projected.tip'))}
        {tb('section', t('drawing.section'), t('drawing.section.tip'))}
        {tb('detail', t('drawing.detail'), t('drawing.detail.tip'))}
        {tb('aux', t('drawing.aux'), t('drawing.aux.tip'))}
        <span class="dwg-sep" />
        {tb('dim', t('drawing.dimension'), t('drawing.dimension.tip'))}
        <button class="dwg-btn" title={t('drawing.autoDim.tip')} onClick={doAutoDim}>{t('drawing.autoDim')}</button>
        {tb('note', t('drawing.note'), t('drawing.note.tip'))}
        {tb('balloon', t('drawing.balloon'), t('drawing.balloon.tip'))}
        {bom.length ? <button class="dwg-btn" title={t('drawing.autoBalloons.tip')} onClick={doAutoBalloons}>{t('drawing.autoBalloons')}</button> : null}
        <span class="dwg-sep" />
        <button class="dwg-btn" onClick={out('pdf')}>{t('drawing.exportPdf')}</button>
        <button class="dwg-btn" onClick={out('svg')}>{t('drawing.exportSvg')}</button>
        <button class="dwg-btn" onClick={out('dxf')}>{t('drawing.exportDxf')}</button>
        <button class="dwg-btn" onClick={out('print')}>{t('drawing.print')}</button>
        <span class="dwg-sep" />
        <button class="dwg-btn" onClick={() => { userCam.current = false; fit(); }}>{t('drawing.fit')}</button>
        <button class="dwg-btn" disabled={!sel} onClick={deleteSel}>{t('drawing.delete')}</button>
      </div>
      <div class="dwg-stage" ref={stage} onPointerDown={onDown as never} onPointerMove={onMove as never} onPointerUp={onUp as never} onDblClick={onDbl} onContextMenu={(e) => e.preventDefault()} data-tool={tool}>
        <div class="dwg-sheet" ref={sheetEl} style={{ width: size[0] * PX + 'px', height: size[1] * PX + 'px', transform: `translate(${cam.x}px,${cam.y}px) scale(${cam.k})` }} dangerouslySetInnerHTML={{ __html: svg }} />
        <svg class="dwg-over" style={{ width: size[0] * PX + 'px', height: size[1] * PX + 'px', transform: `translate(${cam.x}px,${cam.y}px) scale(${cam.k})` }} viewBox={`0 0 ${size[0]} ${size[1]}`}>
          {ghost && ghost.kind === 'line' ? <polyline points={ghost.pts.join(' ')} fill="none" stroke="#0b74dc" stroke-width="0.5" stroke-dasharray="3 1.5" /> : null}
          {ghost && ghost.kind === 'circle' && ghost.c ? (() => { const v = doc.views.find((x) => x.id === (drag.current as { view?: string } | null)?.view); const g = v && dataOf({ doc, data }, v); if (!v || !g) return null; const P = placer(doc, v, g)(ghost.c![0], ghost.c![1]); return <circle cx={P[0]} cy={P[1]} r={(ghost.r ?? 0) * viewScale(doc, v)} fill="#0b74dc22" stroke="#0b74dc" stroke-width="0.4" />; })() : null}
          {pend ? pend.picks.map((e, i) => { const v = doc.views.find((x) => x.id === pend.view); const g = v && dataOf({ doc, data }, v); if (!v || !g) return null; const P = placer(doc, v, g); const pts = g.lines.filter((l) => l.e === e).flatMap((l) => { const o: number[] = []; for (let j = 0; j < l.p.length; j += 2) { const q = P(l.p[j], l.p[j + 1]); o.push(q[0], q[1]); } return [o.join(' ')]; }); return <g key={i}>{pts.map((s, j) => <polyline key={j} points={s} fill="none" stroke="#0b74dc" stroke-width="0.9" />)}</g>; }) : null}
        </svg>
        {!doc.views.length && !busy ? <div class="dwg-empty">{host.hasBody ? t('drawing.empty') : t('drawing.noPart')}</div> : null}
        <div class="dwg-status">{busy ? t('drawing.status.loading') : lost ? t('drawing.status.lost', { count: lost }) : hint}</div>
      </div>
      <div class="dwg-props">
        <h4>{t('drawing.sheet')}</h4>
        <label>{t('drawing.sheet.size')}<select value={doc.sheet.size} onChange={(e) => update((d) => ({ ...d, sheet: { ...d.sheet, size: (e.target as HTMLSelectElement).value } }))}>{SHEET_NAMES.map((n) => <option key={n}>{n}</option>)}</select></label>
        <label>{t('drawing.sheet.orientation')}<select value={doc.sheet.orientation} onChange={(e) => update((d) => ({ ...d, sheet: { ...d.sheet, orientation: (e.target as HTMLSelectElement).value as 'landscape' | 'portrait' } }))}><option value="landscape">{t('drawing.sheet.landscape')}</option><option value="portrait">{t('drawing.sheet.portrait')}</option></select></label>
        <label>{t('drawing.sheet.scale')}<select value={doc.sheet.scale} onChange={(e) => update((d) => ({ ...d, sheet: { ...d.sheet, scale: (e.target as HTMLSelectElement).value } }))}>{(SCALES.includes(doc.sheet.scale) ? SCALES : [doc.sheet.scale, ...SCALES]).map((n) => <option key={n}>{n}</option>)}</select></label>
        <label>{t('drawing.sheet.units')}<select value={doc.sheet.units} onChange={(e) => update((d) => ({ ...d, sheet: { ...d.sheet, units: (e.target as HTMLSelectElement).value as 'mm' | 'in' } }))}><option>mm</option><option>in</option></select></label>
        <label>{t('drawing.sheet.projection')}<select value={doc.sheet.projection} onChange={(e) => update((d) => ({ ...d, sheet: { ...d.sheet, projection: (e.target as HTMLSelectElement).value as 'third' | 'first' } }))}><option value="third">{t('drawing.sheet.third')}</option><option value="first">{t('drawing.sheet.first')}</option></select></label>
        <h4>{t('drawing.titleBlock')}</h4>
        {(['title', 'partNo', 'material', 'author', 'date', 'revision', 'mass', 'company'] as const).map((k) => (
          <label key={k}>{t('drawing.field.' + k)}<input data-field={k} type="text" value={doc.title[k]} onInput={(e) => update((d) => ({ ...d, title: { ...d.title, [k]: (e.target as HTMLInputElement).value } }))} /></label>
        ))}
        {sel?.kind === 'title' ? <div class="dwg-hint">{t('drawing.titleBlock')}</div> : null}
        {selView ? (
          <>
            <h4>{t('drawing.kind.' + selView.kind)}: {selView.label}</h4>
            <label>{t('drawing.view.label')}<input data-focus type="text" value={selView.label} onInput={(e) => setView(selView.id, { label: (e.target as HTMLInputElement).value })} /></label>
            <label>{t('drawing.view.scale')}<select value={selView.scale ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; update((d) => moveAfterScale(d, selView.id, v || null)); }}><option value="">{t('drawing.view.sheetScale')} ({doc.sheet.scale})</option>{SCALES.map((n) => <option key={n}>{n}</option>)}</select></label>
            <label class="chk"><input type="checkbox" checked={selView.hidden} onChange={(e) => setView(selView.id, { hidden: (e.target as HTMLInputElement).checked })} />{t('drawing.view.hidden')}</label>
            <label class="chk"><input type="checkbox" checked={selView.tangent} onChange={(e) => setView(selView.id, { tangent: (e.target as HTMLInputElement).checked })} />{t('drawing.view.tangent')}</label>
            <label class="chk"><input type="checkbox" checked={selView.centerlines} onChange={(e) => setView(selView.id, { centerlines: (e.target as HTMLInputElement).checked })} />{t('drawing.view.centerlines')}</label>
            <label class="chk"><input type="checkbox" checked={selView.showLabel} onChange={(e) => setView(selView.id, { showLabel: (e.target as HTMLInputElement).checked })} />{t('drawing.view.label')}</label>
            {selView.parent && selView.side ? <button class="dwg-btn" onClick={() => update((d) => moveView(d, dataRef.current, selView.id, selView.pos))}>{t('drawing.view.align')}</button> : null}
          </>
        ) : null}
        {selDim ? (
          <>
            <h4>{t('drawing.dim')}</h4>
            <label>{t('drawing.dim.text')}<input data-focus type="text" value={selDim.text ?? ''} placeholder={dimMeasure(selDim, doc, { doc, data, callout: calloutOf })} onInput={(e) => update((d) => ({ ...d, dims: d.dims.map((x) => (x.id === selDim.id ? { ...x, text: (e.target as HTMLInputElement).value || undefined } : x)) }))} /></label>
            {selDim.r !== undefined && selDim.kind !== 'callout' ? <button class="dwg-btn" onClick={() => update((d) => ({ ...d, dims: d.dims.map((x) => (x.id === selDim.id ? { ...x, kind: x.kind === 'radial' ? 'diameter' : 'radial' } : x)) }))}>{selDim.kind === 'radial' ? t('drawing.dim.diameter') : t('drawing.dim.radial')}</button> : null}
          </>
        ) : null}
        {selNote ? (
          <>
            <h4>{t('drawing.note')}</h4>
            <label>{t('drawing.note.text')}<textarea data-focus rows={3} value={selNote.text} onInput={(e) => update((d) => ({ ...d, notes: d.notes.map((x) => (x.id === selNote.id ? { ...x, text: (e.target as HTMLTextAreaElement).value } : x)) }))} /></label>
          </>
        ) : null}
        {selBal ? (
          <>
            <h4>{t('drawing.balloon')}</h4>
            <label>{t('drawing.balloon.number')}<input data-focus type="number" min={1} value={selBal.n} onInput={(e) => update((d) => ({ ...d, balloons: d.balloons.map((x) => (x.id === selBal.id ? { ...x, n: Math.max(1, Math.round(Number((e.target as HTMLInputElement).value) || 1)) } : x)) }))} /></label>
          </>
        ) : null}
        {bom.length ? (
          <>
            <h4>{t('drawing.bom')}</h4>
            <label class="chk"><input type="checkbox" checked={doc.bom.show} onChange={(e) => update((d) => ({ ...d, bom: { ...d.bom, show: (e.target as HTMLInputElement).checked } }))} />{t('drawing.bom.show')}</label>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Change a view's scale; its centre stays where it is and aligned dependants follow. */
function moveAfterScale(d: DrawingDoc, id: string, scale: string | null): DrawingDoc {
  return { ...d, views: d.views.map((v) => (v.id === id ? { ...v, scale } : v)) };
}

/** Drag a dimension: its offset follows the pointer (along the normal of the dimension line; for round ones, the leader angle and length). */
function dragDim(x: DDim, d: DrawingDoc, data: Record<string, ViewData | undefined>, pt: V2): DDim {
  const v = d.views.find((q) => q.id === x.view);
  const g = v && dataOf({ doc: d, data }, v);
  if (!v || !g) return x;
  const P = placer(d, v, g);
  const s = viewScale(d, v);
  if (x.r !== undefined) {
    const C = P(x.a[0], x.a[1]);
    const ang = Math.atan2(-(pt[1] - C[1]), pt[0] - C[0]);
    return { ...x, angle: ang, offset: Math.max(6, Math.hypot(pt[0] - C[0], pt[1] - C[1]) - x.r * s) };
  }
  if (x.kind === 'linear' && x.b) {
    const A = P(x.a[0], x.a[1]), B = P(x.b[0], x.b[1]);
    if (x.orient === 'h') return { ...x, offset: pt[1] - (pt[1] >= Math.max(A[1], B[1]) ? Math.max(A[1], B[1]) : Math.min(A[1], B[1])) };
    if (x.orient === 'v') return { ...x, offset: pt[0] - (pt[0] >= Math.max(A[0], B[0]) ? Math.max(A[0], B[0]) : Math.min(A[0], B[0])) };
    const t: V2 = [B[0] - A[0], B[1] - A[1]]; const L = Math.hypot(...t) || 1;
    const n: V2 = [-t[1] / L, t[0] / L];
    return { ...x, offset: (pt[0] - A[0]) * n[0] + (pt[1] - A[1]) * n[1] };
  }
  if (x.kind === 'angular') { const V = P(x.a[0], x.a[1]); return { ...x, offset: Math.max(4, Math.hypot(pt[0] - V[0], pt[1] - V[1]) - 6) }; }
  return x;
}
void fmtLength; void emptyDrawing; void projectedFrame;
