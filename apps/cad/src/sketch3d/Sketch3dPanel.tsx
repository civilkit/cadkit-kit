// The 3D Sketch panel and tool: pick a drawing mode, click in the view to place points (on the ground or a work plane lifted by a
// height, snapping to model corners, edge ends and middles and other sketch points), or type X / Y / Z. Strokes become line, arc,
// spline and control-vertex-spline entities; points are diamonds that drag in the work plane and have X / Y / Z fields. Create adds one
// `sketch3d` feature (Update replaces it when the panel reopened one); Enter finishes, Escape drops the chain under way, then cancels.
// The geometry rules are in model.ts; the viewport is reached through `Sketch3dHost` so the panel is tested without WebGL.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon, numberAttrs } from '@kit/ui';
import type { HandleDragSink, HandleSpec } from '@kit/viewport';
import { t } from '../i18n';
import {
  MODES, dropOrphans, entityPolyline, finishStroke, fitDraftToSurface, isSplinePath, movePoint, posOf, removePoint, sketch3dFeature, snapRay, strokeReady, withPoint, withStroke, workPlanes,
  type Draft3, type Mode, type P3, type Snap, type SnapCandidate, type Stroke, type WorkPlane,
} from './model';

/** What the panel needs from the viewport and the document. */
export interface Sketch3dHost {
  rayAt(x: number, y: number): { o: P3; d: P3 } | null;
  worldPerPixel(p: P3): number;
  setPlacement(hook: { move(x: number, y: number): void; tap(x: number, y: number): void; leave?(): void } | null): void;
  setHandles(specs: HandleSpec[] | null, sink: HandleDragSink | null): void;
  dragging(): boolean;
  upAxis(): 'y' | 'z';
  /** model corners, edge ends and middles, and the points of other sketches */
  candidates(): SnapCandidate[];
  /** datum planes of the document */
  planes(): Array<{ id: string; frame: { o: number[]; z: number[] } }>;
  /** the document's reference meshes (an imported STL): a ray's hit on the surface, and a point moved onto the surface (nearest, or along `dir` either way); null/absent without a mesh */
  mesh?(): { hit(ray: { o: P3; d: P3 }): { pos: P3; normal: P3 } | null; project(p: P3, dir?: P3): P3 | null } | null;
}

export interface Sketch3dResult {
  draft: Draft3;
  /** the feature the panel builds (for the caller to put an id on) */
  feature: Record<string, unknown>;
  /** also add a plane normal to the path's start */
  normalPlane: boolean;
}

export interface Sketch3dPanelProps {
  host: Sketch3dHost;
  initial: Draft3;
  /** the feature id the sketch will have (new) or has (edit) */
  featureId: string;
  /** the feature being edited: its other keys are kept */
  base?: Record<string, unknown>;
  edit?: boolean;
  /** a datum plane to start on (the plane selected in the tree) */
  startPlane?: string | null;
  onApply(r: Sketch3dResult): void;
  onCancel(): void;
  hint?: string | null;
}

const MODE_LABEL = (m: Mode): string => {
  switch (m) {
    case 'line': return t('sk3d.mode.line');
    case 'arc': return t('sk3d.mode.arc');
    case 'spline': return t('sk3d.mode.spline');
    case 'cvspline': return t('sk3d.mode.cvspline');
    default: return t('sk3d.mode.point');
  }
};
const MODE_HINT = (m: Mode): string => {
  switch (m) {
    case 'line': return t('sk3d.hint.line');
    case 'arc': return t('sk3d.hint.arc');
    case 'spline': return t('sk3d.hint.spline');
    case 'cvspline': return t('sk3d.hint.cvspline');
    default: return t('sk3d.hint.point');
  }
};
const PLANE_LABEL = (id: string): string => {
  switch (id) {
    case 'ground': return t('sk3d.plane.ground');
    case 'front': return t('sk3d.plane.front');
    case 'top': return t('sk3d.plane.top');
    case 'right': return t('sk3d.plane.right');
    default: return t('sk3d.plane.datum', { id: id.replace(/^plane:/, '') });
  }
};

const MODE_ICON: Record<Mode, string> = { line: 'line', arc: 'arc-three-point', spline: 'spline', cvspline: 'cvspline', point: 'point' };
/** The guide's tutorial page (the docs are served beside the app). */
const GUIDE_URL = '/docs/cad/sketching/intro-3d-sketching.html';
const SNAP_PX = 12;
/** Pick radius of a point diamond in pixels: at least 12 (the diamond is drawn about 5 px), larger for a finger. */
export const HIT_PX = 14;
export const HIT_PX_TOUCH = 22;
const hitPx = (): number => {
  try { return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? HIT_PX_TOUCH : HIT_PX; } catch { return HIT_PX; }
};
/** The same snap result again (position, kind, id): the cursor state keeps its object so nothing redraws on a pointer move that changed nothing. */
export function sameSnap(a: Snap | null, b: Snap | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id && a.pos[0] === b.pos[0] && a.pos[1] === b.pos[1] && a.pos[2] === b.pos[2];
}
const fmt = (v: number): string => String(Math.round(v * 1000) / 1000);
/** shown in the narrow Points table: two decimals (the full value is the field's tooltip and is kept until the field is edited) */
const fmt2 = (v: number): string => String(Math.round(v * 100) / 100);
const AXES: Array<['x' | 'y' | 'z', string]> = [['x', 'X'], ['y', 'Y'], ['z', 'Z']];

interface Snapshot { draft: Draft3; stroke: Stroke | null }

/** The handles for a draft: wire of the curves, a rubber band for the stroke under way, the snap cross, the work plane's square and a draggable diamond per point. Exported for tests. */
export function handleSpecs(o: { hitPx?: number; draft: Draft3; stroke: Stroke | null; cursor: Snap | null; selected: string | null; plane: WorkPlane; offset: number; wpp(p: P3): number; moved?: { id: string; pos: P3 } }): HandleSpec[] {
  const draft = o.moved ? movePoint(o.draft, o.moved.id, o.moved.pos) : o.draft;
  const shown = withStroke(draft, o.stroke);
  const segs: P3[] = [];
  const pushLine = (pl: P3[], into: P3[]): void => { for (let i = 1; i < pl.length; i++) into.push(pl[i - 1], pl[i]); };
  for (const e of shown.entities) if (e.construction !== true) pushLine(entityPolyline(shown, e), segs);
  const specs: HandleSpec[] = [];
  const centre: P3 = [o.plane.o[0] + o.plane.n[0] * o.offset, o.plane.o[1] + o.plane.n[1] * o.offset, o.plane.o[2] + o.plane.n[2] * o.offset];
  // the work plane: a square and its two axes, large enough for the draft
  let reach = 50;
  for (const p of draft.points) reach = Math.max(reach, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
  const u = o.plane.u, v: P3 = [o.plane.n[1] * u[2] - o.plane.n[2] * u[1], o.plane.n[2] * u[0] - o.plane.n[0] * u[2], o.plane.n[0] * u[1] - o.plane.n[1] * u[0]];
  const S = reach * 1.2;
  const corner = (a: number, b: number): P3 => [centre[0] + u[0] * a * S + v[0] * b * S, centre[1] + u[1] * a * S + v[1] * b * S, centre[2] + u[2] * a * S + v[2] * b * S];
  const sq: P3[] = [corner(-1, -1), corner(1, -1), corner(1, -1), corner(1, 1), corner(1, 1), corner(-1, 1), corner(-1, 1), corner(-1, -1), corner(-1, 0), corner(1, 0), corner(0, -1), corner(0, 1)];
  specs.push({ id: 'sk3d:plane', kind: 'wire', origin: centre, axis: o.plane.n, lines: sq, color: '#7b8aa6' });
  if (segs.length) specs.push({ id: 'sk3d:wire', kind: 'wire', origin: [0, 0, 0], axis: [0, 0, 1], lines: segs, color: '#ff8a1f' });
  if (o.stroke && o.cursor && !o.moved) {
    // the stroke as it would be with the cursor as its next point
    const tmp = withPoint(draft, o.cursor.pos);
    const ids = o.cursor.kind === 'draft' && o.cursor.id ? [...o.stroke.ids, o.cursor.id] : [...o.stroke.ids, tmp.id];
    const withCursor = withStroke(tmp.draft, { ...o.stroke, ids });
    const rub: P3[] = [];
    const known = new Set(shown.entities.map((e) => e.id));
    const before = o.stroke.ids.length;
    for (const e of withCursor.entities) if (!known.has(e.id) || e.type === 'spline' || e.type === 'cvspline') pushLine(entityPolyline(withCursor, e), rub);
    if (!rub.length && before) {
      const last = shown.points.find((p) => p.id === o.stroke!.ids[before - 1]);
      if (last) rub.push(posOf(last), o.cursor.pos);
    }
    if (rub.length) specs.push({ id: 'sk3d:rubber', kind: 'wire', origin: [0, 0, 0], axis: [0, 0, 1], lines: rub, color: '#9ec5ff' });
  }
  if (o.cursor && !o.moved) {
    const k = 7 * o.wpp(o.cursor.pos), c = o.cursor.pos;
    const cross: P3[] = [[c[0] - k, c[1], c[2]], [c[0] + k, c[1], c[2]], [c[0], c[1] - k, c[2]], [c[0], c[1] + k, c[2]], [c[0], c[1], c[2] - k], [c[0], c[1], c[2] + k]];
    specs.push({ id: 'sk3d:snap', kind: 'wire', origin: c, axis: [0, 0, 1], lines: cross, color: o.cursor.kind === 'plane' ? '#ffd23f' : '#2fe0a0' });
  }
  for (const p of draft.points) {
    specs.push({
      id: 'p:' + p.id, kind: 'cube', look: 'diamond', drag: 'plane', origin: posOf(p), axis: o.plane.n, u: o.plane.u, sizePx: 4.5, hitPx: o.hitPx ?? HIT_PX,
      color: p.id === o.selected ? '#ff4d4d' : '#ffb000', label: p.id, ...(o.moved?.id === p.id ? { follow: true } : {}),
    });
  }
  return specs;
}

export function Sketch3dPanel(p: Sketch3dPanelProps): JSX.Element {
  const { host } = p;
  const pr = useRef(p);
  pr.current = p;
  const [draft, setDraftState] = useState<Draft3>(p.initial);
  const [stroke, setStrokeState] = useState<Stroke | null>(null);
  const [mode, setMode] = useState<Mode>('spline');
  const [degree, setDegree] = useState(3);
  const planes = useMemo(() => workPlanes(host.upAxis(), host.planes()), [host]);
  const [planeId, setPlaneId] = useState<string>(p.startPlane && planes.some((w) => w.id === 'plane:' + p.startPlane) ? 'plane:' + p.startPlane : 'ground');
  const [offset, setOffset] = useState(0);
  const [snapOn, setSnapOn] = useState(true);
  const mesh = host.mesh?.() ?? null;
  const [onMesh, setOnMesh] = useState(true);
  const [fitAlong, setFitAlong] = useState<'nearest' | 'normal'>('nearest');
  const [fitNote, setFitNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState<{ x: string; y: string; z: string }>({ x: '0', y: '0', z: '0' });
  const [withPlane, setWithPlane] = useState(!p.edit);
  const [cursor, setCursor] = useState<Snap | null>(null);

  // the current values for the handlers the viewport calls later
  const live = useRef({ draft, stroke, mode, degree, planeId, offset, snapOn, selected, withPlane, onMesh });
  live.current = { draft, stroke, mode, degree, planeId, offset, snapOn, selected, withPlane, onMesh };
  const history = useRef<Snapshot[]>([]);
  const plane = (): WorkPlane => planes.find((w) => w.id === live.current.planeId) ?? planes[0];

  const setState = (d: Draft3, s: Stroke | null, keepHistory = false): void => {
    if (!keepHistory) history.current.push({ draft: live.current.draft, stroke: live.current.stroke });
    if (history.current.length > 200) history.current.shift();
    live.current = { ...live.current, draft: d, stroke: s };
    setDraftState(d);
    setStrokeState(s);
  };
  const undo = (): void => {
    const prev = history.current.pop();
    if (!prev) return;
    live.current = { ...live.current, draft: prev.draft, stroke: prev.stroke };
    setDraftState(prev.draft);
    setStrokeState(prev.stroke);
  };

  /** End the chain under way: its entity is made when it has the points for one. */
  const endStroke = (): void => {
    const { draft: d, stroke: s } = live.current;
    if (!s) return;
    setState(strokeReady(s) ? finishStroke(d, s) : dropOrphans(d, [], new Set(s.ids)), null);
  };
  const dropStroke = (): void => {
    const { draft: d, stroke: s } = live.current;
    if (s) setState(dropOrphans(d, [], new Set(s.ids)), null);
  };

  /** One click (or one typed point): a new point at `pos`, or an existing one when the click snapped to it. */
  const place = (pos: P3, reuse?: string): void => {
    const { draft: d0, stroke: s0, mode: m, degree: deg } = live.current;
    if (live.current.selected) { live.current = { ...live.current, selected: null }; setSelected(null); }   // drawing on: Backspace then removes the chain's last point
    let d = d0, id = reuse ?? '';
    if (!reuse) { const w = withPoint(d, pos); d = w.draft; id = w.id; }
    if (m === 'point') {
      if (reuse && d.entities.some((e) => e.type === 'point' && e.p === reuse)) return;
      setState(finishStroke(d, { mode: 'point', ids: [id], degree: deg }), null);
      return;
    }
    const last = s0?.ids[s0.ids.length - 1];
    if (s0 && last === id) { setState(d, s0, true); endStroke(); return; }   // the last point again ends the chain
    const ids = [...(s0?.ids ?? []), id];
    const s: Stroke = { mode: m, ids, degree: deg };
    const closes = ids.length >= 3 && ids[0] === id && (m === 'line' || m === 'spline' || m === 'cvspline');
    if (m === 'arc' && ids.length === 3) setState(finishStroke(d, s), null);
    else if (closes) setState(finishStroke(d, s), null);
    else setState(d, s);
  };

  const candidates = (): SnapCandidate[] => {
    const own: SnapCandidate[] = live.current.draft.points.map((q) => ({ p: posOf(q), kind: 'draft', id: q.id }));
    return live.current.snapOn ? [...own, ...host.candidates()] : own;
  };
  const snapAt = (x: number, y: number): Snap | null => {
    const ray = host.rayAt(x, y);
    if (!ray) return null;
    const m = live.current.onMesh ? host.mesh?.() ?? null : null;
    return snapRay(ray, candidates(), (q) => host.worldPerPixel(q), SNAP_PX, plane(), live.current.offset, m ? (r) => m.hit(r) : undefined);
  };

  /** Lay the curves of the draft on the mesh surface (see fitDraftToSurface). */
  const fit = (): void => {
    const m = host.mesh?.();
    if (!m) return;
    const s = live.current.stroke;
    const base = s ? (strokeReady(s) ? finishStroke(live.current.draft, s) : dropOrphans(live.current.draft, [], new Set(s.ids))) : live.current.draft;
    const dir = fitAlong === 'normal' ? plane().n : undefined;
    const r = fitDraftToSurface(base, { project: (q) => m.project(q, dir) });
    setFitNote(r.fitted ? t('sk3d.fitted', { n: r.fitted }) : t('sk3d.fitNone'));
    if (r.fitted) setState(r.draft, null);
  };

  // pointer: move shows the snap, a click places
  const pending = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef(0);
  useEffect(() => {
    host.setPlacement({
      move: (x, y) => {
        pending.current = { x, y };
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          const at = pending.current;
          if (at && !host.dragging()) { const next = snapAt(at.x, at.y); setCursor((prev) => (sameSnap(prev, next) ? prev : next)); }
        });
      },
      tap: (x, y) => {
        const s = snapAt(x, y);
        if (!s) return;
        place(s.pos, s.kind === 'draft' ? s.id : undefined);
        setCursor(null);
      },
      leave: () => setCursor(null),
    });
    return () => { host.setPlacement(null); if (frame.current) cancelAnimationFrame(frame.current); };
  }, [host, planes]);

  // the overlay: redrawn after every change except while a point is being dragged (the drag draws itself)
  const sinkRef = useRef<HandleDragSink | null>(null);
  const dragPos = useRef<P3 | null>(null);
  if (!sinkRef.current) {
    const specsWith = (moved?: { id: string; pos: P3 }): HandleSpec[] => {
      const l = live.current;
      return handleSpecs({ draft: l.draft, stroke: l.stroke, cursor: null, selected: l.selected, plane: plane(), offset: l.offset, wpp: (q) => host.worldPerPixel(q), hitPx: hitPx(), ...(moved ? { moved } : {}) });
    };
    const pid = (id: string): string => id.replace(/^p:/, '');
    sinkRef.current = {
      onStart: (id) => { live.current = { ...live.current, selected: pid(id) }; },
      onDrag: () => {},
      live: (id, _q, vec) => {
        const pt = live.current.draft.points.find((q) => q.id === pid(id));
        if (!pt) return null;
        const pos: P3 = [pt.x + vec[0], pt.y + vec[1], pt.z + vec[2]];
        dragPos.current = pos;
        return specsWith({ id: pid(id), pos });
      },
      onCommit: (id, _q, vec) => {
        const pt = live.current.draft.points.find((q) => q.id === pid(id));
        dragPos.current = null;
        setSelected(pid(id));
        if (pt && (vec[0] || vec[1] || vec[2])) setState(movePoint(live.current.draft, pt.id, [pt.x + vec[0], pt.y + vec[1], pt.z + vec[2]]), live.current.stroke);
      },
      onCancel: () => { dragPos.current = null; },
      // a click on a diamond: with a chain under way (or Shift in a line, arc or spline mode) it is a click on that existing point, so the chain continues
      // from, closes on or ends at it; otherwise it selects the point (row highlighted, Backspace / Delete removes it)
      onClick: (id, mods) => {
        const pt = live.current.draft.points.find((q) => q.id === pid(id));
        if (!pt) return;
        const { stroke: s, mode: m } = live.current;
        if (m !== 'point' && (s || mods.shift)) { place(posOf(pt), pt.id); setCursor(null); }
        else { live.current = { ...live.current, selected: pt.id }; setSelected(pt.id); }
      },
      format: () => (dragPos.current ? dragPos.current.map(fmt).join(', ') : ''),
      step: () => 1,
    };
  }
  useEffect(() => {
    host.setHandles(handleSpecs({ draft, stroke, cursor, selected, plane: plane(), offset, wpp: (q) => host.worldPerPixel(q), hitPx: hitPx() }), sinkRef.current);
  }, [draft, stroke, cursor, selected, planeId, offset, host]);
  useEffect(() => () => host.setHandles(null, null), [host]);

  const shown = useMemo(() => withStroke(draft, stroke), [draft, stroke]);
  const feature = useMemo(() => sketch3dFeature(p.featureId, shown, p.base), [shown, p.featureId, p.base]);
  const curves = shown.entities.filter((e) => e.type !== 'point').length;
  const asPath = isSplinePath(feature as never);
  const blocked = !shown.entities.length;

  const apply = (): void => {
    const s = live.current.stroke;
    const d = s ? (strokeReady(s) ? finishStroke(live.current.draft, s) : dropOrphans(live.current.draft, [], new Set(s.ids))) : live.current.draft;
    if (!d.entities.length) return;
    const f = sketch3dFeature(pr.current.featureId, d, pr.current.base);
    pr.current.onApply({ draft: d, feature: f, normalPlane: live.current.withPlane && isSplinePath(f as never) });
  };

  const addTyped = (): void => {
    const v = [typed.x, typed.y, typed.z].map((s) => Number(s));
    if (v.some((n) => !Number.isFinite(n))) return;
    place(v as P3);
  };
  const setCoord = (id: string, axis: 'x' | 'y' | 'z', raw: string): void => {
    const n = Number(raw);
    const pt = live.current.draft.points.find((q) => q.id === id);
    if (!pt || raw.trim() === '' || !Number.isFinite(n)) return;
    setState(movePoint(live.current.draft, id, [axis === 'x' ? n : pt.x, axis === 'y' ? n : pt.y, axis === 'z' ? n : pt.z]), live.current.stroke);
  };
  const deletePoint = (id: string): void => {
    const { draft: d, stroke: s } = live.current;
    const ns = s ? { ...s, ids: s.ids.filter((x) => x !== id) } : null;
    setState(removePoint(d, id), ns && ns.ids.length ? ns : null);
    if (live.current.selected === id) setSelected(null);
  };

  // keys: Enter finishes, Escape drops the chain then cancels, Backspace removes the last point of the chain or the selected point, Ctrl+Z undoes a step of the tool
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); undo(); return; }
      if (e.key === 'Enter') {
        if (el?.tagName === 'BUTTON') return;
        if (typing) { if (el!.closest('[data-sk3d-add]')) { e.preventDefault(); e.stopPropagation(); addTyped(); } return; }
        e.preventDefault(); e.stopPropagation(); apply(); return;
      }
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (live.current.stroke) dropStroke(); else pr.current.onCancel();
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !typing) {
        const { stroke: s, selected: sel } = live.current;
        const target = sel ?? s?.ids[s.ids.length - 1];
        if (target) { e.preventDefault(); e.stopPropagation(); deletePoint(target); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const changeMode = (m: Mode): void => {
    if (live.current.stroke) endStroke();
    setMode(m);
    live.current = { ...live.current, mode: m };
  };

  const [help, setHelp] = useState(false);

  return (
    <div class="fedit thread-editor prop-wizard sk3d-panel" tabIndex={0} data-testid="sk3d-panel">
      <div class="fedit-head">
        <Icon name="add-sketch3d" size={22} class="fedit-icon" />
        <div class="fedit-title">{t(p.edit ? 'sk3d.titleEdit' : 'sk3d.title')}</div>
        <button type="button" class="sk3d-help-btn" data-testid="sk3d-help-btn" aria-expanded={help} aria-controls="sk3d-help" title={t('sk3d.help')} aria-label={t('sk3d.help')} onClick={() => setHelp(!help)}>?</button>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body sk3d-body">
        {help ? (
          <div class="sk3d-help" id="sk3d-help" data-testid="sk3d-help">
            <div>{t('sk3d.helpText')}</div>
            <a href={GUIDE_URL} target="_blank" rel="noopener" data-testid="sk3d-learn">{t('sk3d.learn')}</a>
          </div>
        ) : null}

        <section class="sk3d-sec" data-sec="draw">
          <h3 class="sk3d-h">{t('sk3d.mode')}</h3>
          <div class="sk3d-modes" role="group" aria-label={t('sk3d.mode')} data-path="mode">
            {MODES.map((m) => (
              <button key={m} type="button" class="sk3d-mode" data-mode={m} aria-pressed={mode === m} title={MODE_LABEL(m)} onClick={() => changeMode(m)}>
                <Icon name={MODE_ICON[m]} size={20} />
                <span>{MODE_LABEL(m)}</span>
              </button>
            ))}
          </div>
          <div class="thread-hint sk3d-hint" data-testid="sk3d-hint">{MODE_HINT(mode)}</div>
          {mode === 'cvspline' ? (
            <label class="sk3d-fld sk3d-inline" data-path="degree">
              <span class="sk3d-lbl">{t('sk3d.degree')}</span>
              <input {...numberAttrs('integer')} type="number" min={1} max={9} step={1} value={String(degree)} aria-label={t('sk3d.degree')}
                onChange={(e) => { const v = Math.round(Number((e.currentTarget as HTMLInputElement).value)); if (v >= 1 && v <= 9) { setDegree(v); live.current = { ...live.current, degree: v }; } }} />
            </label>
          ) : null}
          {stroke ? (
            <div class="sk3d-row">
              <button type="button" class="fedit-card-btn" data-testid="sk3d-end" onClick={endStroke}>{t('sk3d.endChain')}</button>
              <button type="button" class="fedit-card-btn" data-testid="sk3d-undo" onClick={() => { const s = live.current.stroke; if (s) deletePoint(s.ids[s.ids.length - 1]); }}>{t('sk3d.undoPoint')}</button>
            </div>
          ) : null}
        </section>

        <section class="sk3d-sec" data-sec="where">
          <h3 class="sk3d-h">{t('sk3d.sec.where')}</h3>
          <div class="sk3d-pair">
            <label class="sk3d-fld" data-path="plane">
              <span class="sk3d-lbl">{t('sk3d.plane')}</span>
              <select value={planeId} aria-label={t('sk3d.plane')} onChange={(e) => setPlaneId((e.currentTarget as HTMLSelectElement).value)}>
                {planes.map((w) => <option key={w.id} value={w.id}>{PLANE_LABEL(w.id)}</option>)}
              </select>
            </label>
            <label class="sk3d-fld" data-path="offset">
              <span class="sk3d-lbl">{t('sk3d.offset')}</span>
              <span class="sk3d-unit"><input {...numberAttrs('signed')} type="number" step="any" value={String(offset)} aria-label={t('sk3d.offset')}
                onInput={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(v)) setOffset(v); }} /><span class="fedit-unit">mm</span></span>
            </label>
          </div>
          <label class="sk3d-check" data-path="snap">
            <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn((e.currentTarget as HTMLInputElement).checked)} aria-label={t('sk3d.snap')} />
            <span>{t('sk3d.snap')}</span>
          </label>
        </section>

        {mesh ? (
          <section class="sk3d-sec" data-sec="mesh">
            <h3 class="sk3d-h">{t('sk3d.sec.mesh')}</h3>
            <label class="sk3d-check" data-path="onMesh">
              <input type="checkbox" checked={onMesh} onChange={(e) => setOnMesh((e.currentTarget as HTMLInputElement).checked)} aria-label={t('sk3d.onMesh')} />
              <span>{t('sk3d.onMesh')}</span>
            </label>
            <div class="sk3d-fld" data-path="fit">
              <span class="sk3d-lbl">{t('sk3d.fit')}</span>
              <span class="sk3d-fitrow">
                <select value={fitAlong} aria-label={t('sk3d.fitHow')} onChange={(e) => setFitAlong((e.currentTarget as HTMLSelectElement).value as 'nearest' | 'normal')}>
                  <option value="nearest">{t('sk3d.fit.nearest')}</option>
                  <option value="normal">{t('sk3d.fit.normal')}</option>
                </select>
                <button type="button" class="fedit-card-btn" data-testid="sk3d-fit" disabled={blocked} onClick={fit}>{t('sk3d.fitGo')}</button>
              </span>
            </div>
            <div class="thread-hint" data-testid="sk3d-fit-note">{fitNote ?? t('sk3d.fitHint')}</div>
          </section>
        ) : null}

        <section class="sk3d-sec sk3d-add" data-sec="coords" data-sk3d-add data-path="add">
          <h3 class="sk3d-h">{t('sk3d.sec.coords')}</h3>
          <div class="sk3d-xyz">
            {AXES.map(([k, label]) => (
              <label key={k} class="sk3d-axis"><span>{label}</span>
                <input {...numberAttrs('signed')} type="number" step="any" value={typed[k]} aria-label={label} data-axis={k} onInput={(e) => setTyped({ ...typed, [k]: (e.currentTarget as HTMLInputElement).value })} /></label>
            ))}
            <button type="button" class="fedit-card-btn" data-testid="sk3d-add" onClick={addTyped}>{t('sk3d.add')}</button>
          </div>
        </section>

        <section class="sk3d-sec sk3d-points" data-sec="points" data-path="points">
          <h3 class="sk3d-h">{t('sk3d.points', { n: draft.points.length })}</h3>
          {draft.points.length ? (
            <div class="sk3d-list" data-testid="sk3d-points">
              <div class="sk3d-pt sk3d-pt-head" aria-hidden="true"><span /><span>X</span><span>Y</span><span>Z</span><span /></div>
              {draft.points.map((q) => (
                <div key={q.id} class={'sk3d-pt' + (q.id === selected ? ' sel' : '')} data-point={q.id} onClick={() => setSelected(q.id)}>
                  <span class="sk3d-id">{q.id}</span>
                  {AXES.map(([k, label]) => (
                    <input {...numberAttrs('signed')} key={k} type="number" step="any" value={fmt2(q[k])} title={fmt(q[k])} aria-label={`${q.id} ${label}`} data-axis={k}
                      onChange={(e) => setCoord(q.id, k, (e.currentTarget as HTMLInputElement).value)} onFocus={() => setSelected(q.id)} />
                  ))}
                  <button type="button" class="sk3d-del" data-act="delete" title={t('sk3d.delete', { id: q.id })} aria-label={t('sk3d.delete', { id: q.id })} onClick={(e) => { e.stopPropagation(); deletePoint(q.id); }}><Icon name="trash" size={15} /></button>
                </div>
              ))}
            </div>
          ) : <div class="sk3d-empty" data-testid="sk3d-empty">{t('sk3d.empty')}</div>}
        </section>

        {asPath ? (
          <section class="sk3d-sec" data-sec="path">
            <div class="thread-hint" data-testid="sk3d-path-note">{t('sk3d.pathNote')}</div>
            <label class="sk3d-check" data-path="withPlane">
              <input type="checkbox" checked={withPlane} onChange={(e) => setWithPlane((e.currentTarget as HTMLInputElement).checked)} aria-label={t('sk3d.pathPlane')} />
              <span>{t('sk3d.pathPlane')}</span>
            </label>
          </section>
        ) : null}
        <div class="thread-hint" data-testid="sk3d-status">{t('sk3d.status', { points: shown.points.length, curves })} {t('sk3d.keys')}</div>
        {p.hint ? <div class="fedit-hint" role="alert" data-testid="sk3d-fail">{p.hint}</div> : null}
      </div>
      <div class="prop-nav sk3d-actions">
        <button type="button" class="fedit-card-btn" data-testid="sk3d-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="sk3d-apply" disabled={blocked} aria-disabled={blocked} onClick={apply}>{t(p.edit ? 'sk3d.update' : 'sk3d.create')}</button>
      </div>
    </div>
  );
}
