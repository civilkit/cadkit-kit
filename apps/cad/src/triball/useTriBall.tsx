// Wires the positioning ball into the app: which selection it acts on, its frame and attached / detached state, how a drag
// previews and commits (one edit per gesture, through the same preview path the other handles use), the right-drag
// Move / Copy / pattern menu, the orientation and centre menus with their picks, and the dialogs for typed values.
// The drawing and the pointer work are in packages/viewport/src/triballLayer.ts; the ops are in ./ops.ts.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EditOp } from '@ck/session';
import type { Store } from '@kit/store';
import { parseVertexName } from '@kit/store';
import {
  moveFrame, V, WORLD_AXES, type Axes3, type TriFrame, type TriGesture, type TriSink, type TriTarget, type TriValue, type TriView, type Vec3, type Viewport,
} from '@kit/viewport';
import type { Controller } from '../controller';
import { ContextMenu } from '../ContextMenu';
import { faceInfo } from '../handles/geom';
import { HandleRunner } from '../handles/runner';
import type { MenuItem } from '../menuModel';
import { t } from '../i18n';
import { circleOf, cylinderOfFace } from '../threadData';
import { FieldsDialog, type DialogField } from './FieldsDialog';
import { aimAxis, bodyRefs, copyOps, copySource, faceMoveOps, mirrorOps, mirrorPlaneId, motionOf, moveOps, repeatOps, resolveTarget, shiftSketchOps, type RepeatSpec, type Target } from './ops';
import { saveTriPrefs, type TriPrefs } from './triballPrefs';

export interface TriBallDeps {
  controller: Controller;
  store: Store;
  viewport(): Viewport | null;
  /** The feature selected in the tree. */
  selectedFeature: string | null;
  /** Make the edit; true when the kernel accepted it. */
  commit(ops: EditOp[]): Promise<boolean>;
  editingId: string | null;
  sketching: boolean;
  prefs: TriPrefs;
  onPrefs(p: TriPrefs): void;
}

interface Ball { target: Target; frame: TriFrame; attached: boolean; axis: number | null }
type Pick = { prompt: string; mode: 'vertex' | 'edge' | 'face'; take(name: string): string | true };
type Dlg =
  | { kind: 'distance'; axis: 0 | 1 | 2 }
  | { kind: 'angle' }
  | { kind: 'repeat'; r: RepeatSpec }
  | { kind: 'snap' }
  | { kind: 'position' };

const AXIS_NAME = ['X', 'Y', 'Z'];
const fmt = (n: number): string => String(Math.round(n * 100) / 100);
const zeroValue = (): TriValue => ({ distance: 0, d1: 0, d2: 0, angle: 0, vec: [0, 0, 0], dir: [0, 0, 1] });

export function useTriBall(p: TriBallDeps) {
  const ref = useRef(p);
  ref.current = p;
  const [ball, setBallState] = useState<Ball | null>(null);
  const ballRef = useRef<Ball | null>(null);
  const setBall = (b: Ball | null) => { ballRef.current = b; setBallState(b); };
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; run(id: string): void; dismiss(): void } | null>(null);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const pickRef = useRef<Pick | null>(null);
  const pending = useRef<{ g: TriGesture; v: TriValue } | null>(null);
  const own = useRef(false);
  const lastRev = useRef(p.controller.revision);
  const shown = useRef(false);
  const runner = useRef<HandleRunner | null>(null);
  const dragging = useRef(false);

  if (!runner.current) {
    runner.current = new HandleRunner({
      preview: async (ops) => { const r = await ref.current.controller.preview(ops, 0); return { ok: r.ok, stale: r.stale, hint: r.hint }; },
      // a rebuilt body loses its selection highlight: draw it again
      cancelPreview: async () => { await ref.current.controller.cancelPreview(); ref.current.viewport()?.setHighlight(ref.current.store.selection.value); },
      commit: async (c) => { await ref.current.commit(c.ops); ref.current.viewport()?.setHighlight(ref.current.store.selection.value); },
      hint: setHint,
      busy: (on) => { dragging.current = on; },
    });
  }

  // ---- what a gesture does ----

  const faceIds = (): string[] => ref.current.controller.bodyFaces()?.faceIds ?? [];
  const opsFor = (b: Ball, g: TriGesture, v: TriValue): EditOp[] | null => {
    const doc = ref.current.controller.document();
    if (b.target.kind === 'feature') return shiftSketchOps(doc, b.target.sketch!, v.vec);
    if (b.target.kind === 'face') return faceMoveOps(doc, b.target.faces!, !!b.target.planar, b.frame.axes[2], v.distance);
    return moveOps(doc, motionOf(g, v, b.frame), bodyRefs(faceIds()), b.target.feature);
  };
  const advance = (b: Ball, g: TriGesture, v: TriValue): TriFrame =>
    g.kind === 'spin' ? moveFrame(b.frame, { axis: v.dir, origin: b.frame.origin, angle: v.angle }, [0, 0, 0]) : moveFrame(b.frame, null, b.target.kind === 'face' ? V.mul(b.frame.axes[2], v.distance) : v.vec);

  /** Commit one gesture as a move or a copy; a detached ball just moves itself. */
  const commitMove = async (g: TriGesture, v: TriValue, how: 'move' | 'copy' = 'move'): Promise<void> => {
    const b = ballRef.current;
    if (!b) return;
    if (!b.attached || g.kind === 'frame') { await runner.current!.cancel(); setBall({ ...b, frame: advance(b, g, v) }); return; }
    const ops = how === 'copy' ? copyOps(motionOf(g, v, b.frame), copySource(faceIds())) : opsFor(b, g, v);
    if (!ops) { await runner.current!.cancel(); return; }
    own.current = true;
    const before = ref.current.controller.revision;
    await runner.current!.commit({ ops, create: false });
    if (ref.current.controller.revision === before) { own.current = false; return; }   // rejected: the ball stays where it was
    if (how === 'move') setBall({ ...ballRef.current!, frame: advance(b, g, v) });
  };

  const valueAlong = (axes: Axes3, i: number, d: number): TriValue => ({ ...zeroValue(), distance: d, vec: V.mul(axes[i], d) });

  // ---- sink ----

  const sink = useRef<TriSink | null>(null);
  if (!sink.current) {
    sink.current = {
      start: () => { dragging.current = true; },
      update: (g, v) => {
        const b = ballRef.current;
        if (!b || !b.attached || g.kind === 'frame') return;
        runner.current!.drag(opsFor(b, g, v));
      },
      end: (g, v, button, at) => {
        const b = ballRef.current;
        if (!b) return;
        if (button === 'left' || !b.attached || g.kind === 'frame') { void commitMove(g, v); return; }
        pending.current = { g, v };
        const copyOk = b.target.kind === 'body';
        const items: MenuItem[] = [
          { id: 'move', label: t('triball.menu.move'), enabled: true },
          { id: 'copy', label: t('triball.menu.copy'), enabled: copyOk, reason: copyOk ? undefined : t('triball.noCopyFace') },
          { id: 'link', label: t('triball.menu.link'), enabled: false, reason: t('triball.noLink') },
          ...(g.kind === 'spin' ? [{ id: 'radial', label: t('triball.menu.radial'), enabled: copyOk, reason: copyOk ? undefined : t('triball.noCopyFace') }] : []),
          ...(g.kind === 'axis' ? [{ id: 'linear', label: t('triball.menu.linear'), enabled: copyOk, reason: copyOk ? undefined : t('triball.noCopyFace') }] : []),
          { id: '-', label: '', enabled: false, separator: true },
          { id: 'cancel', label: t('triball.menu.cancel'), enabled: true },
        ];
        setMenu({
          x: at.x, y: at.y, items,
          run: (id) => {
            setMenu(null);
            const pd = pending.current; pending.current = null;
            if (!pd) return;
            if (id === 'move') void commitMove(pd.g, pd.v, 'move');
            else if (id === 'copy') void commitMove(pd.g, pd.v, 'copy');
            else if (id === 'linear' && pd.g.kind === 'axis') openRepeat('linear', ballRef.current!.frame.axes[pd.g.axis], pd.v.distance || ref.current.prefs.distance, true);
            else if (id === 'radial') openRepeat('radial', pd.v.dir, 0, true, pd.v.angle || ref.current.prefs.angle);
            else void runner.current!.cancel();
          },
          dismiss: () => { setMenu(null); pending.current = null; void runner.current!.cancel(); },
        });
      },
      cancel: () => { void runner.current!.cancel(); },
      selectAxis: (axis) => { const b = ballRef.current; if (b) setBall({ ...b, axis }); },
      context: (target, at) => openContext(target, at),
      hover: (target) => setStatus(target ? t(statusKey(target, ballRef.current)) : null),
      increments: () => ref.current.prefs,
      label: (g, v) => {
        if (g.kind === 'plane') return [t('triball.distance1', { v: fmt(v.d1) }), t('triball.distance2', { v: fmt(v.d2) })];
        if (g.kind === 'spin') return [t('triball.angle', { v: fmt(v.angle) })];
        return [t('triball.distance', { v: fmt(v.distance) })];
      },
    };
  }

  const openRepeat = (kind: 'linear' | 'radial', dir: Vec3, distance: number, keepPreview: boolean, angle = ref.current.prefs.angle) => {
    const b = ballRef.current!;
    const origin = b.frame.origin;
    if (!keepPreview) void runner.current!.cancel();
    setDlg({ kind: 'repeat', r: { kind, number: 3, distance: Math.abs(distance), angle: Math.abs(angle) || 15, stepUp: 0, dir: distance < 0 && kind === 'linear' ? V.mul(dir, -1) : dir, origin } });
  };

  // ---- menus ----

  const showMenu = (at: { x: number; y: number }, items: MenuItem[], run: (id: string) => void) =>
    setMenu({ x: at.x, y: at.y, items, run: (id) => { setMenu(null); run(id); }, dismiss: () => setMenu(null) });

  const openContext = (target: TriTarget | null, at: { x: number; y: number }) => {
    const b = ballRef.current;
    if (!b) return;
    const body = b.target.kind === 'body';
    const noFace = body ? undefined : t('triball.noCopyFace');
    if (target?.kind === 'end') {
      const i = target.axis;
      showMenu(at, [
        { id: 'distance', label: t('triball.menu.editDistance'), enabled: true },
        { id: 'linear', label: t('triball.menu.linear'), enabled: body, reason: noFace },
      ], (id) => { if (id === 'distance') setDlg({ kind: 'distance', axis: i }); else openRepeat('linear', b.frame.axes[i], ref.current.prefs.distance, false); });
    } else if (target?.kind === 'stub') {
      const i = target.axis;
      const mirrorId = mirrorPlaneId(b.frame, i);
      showMenu(at, [
        { id: 'axis', label: t('triball.menu.parallelAxis'), enabled: true },
        { id: 'face', label: t('triball.menu.perpFace'), enabled: true },
        { id: 'edge', label: t('triball.menu.parallelEdge'), enabled: true },
        { id: 'reverse', label: t('triball.menu.reverse'), enabled: true },
        { id: '-', label: '', enabled: false, separator: true },
        { id: 'mirrorMove', label: t('triball.menu.mirrorMove'), enabled: false, reason: t('triball.noMirrorMove') },
        { id: 'mirrorCopy', label: t('triball.menu.mirrorCopy'), enabled: !!mirrorId && body, reason: mirrorId && body ? undefined : t('triball.noMirror') },
      ], (id) => orient(id, i));
    } else if (target?.kind === 'centre') {
      showMenu(at, [
        { id: 'position', label: t('triball.menu.editPosition'), enabled: true },
        { id: 'point', label: t('triball.menu.toPoint'), enabled: true },
        { id: 'center', label: t('triball.menu.toCenter'), enabled: true },
        { id: 'mid', label: t('triball.menu.toMid'), enabled: true },
      ], (id) => toPick(id));
    } else if (target?.kind === 'ring' || target?.kind === 'inner') {
      showMenu(at, [
        { id: 'angle', label: t('triball.menu.editAngle'), enabled: true },
        { id: 'radial', label: t('triball.menu.radial'), enabled: body, reason: noFace },
        { id: '-', label: '', enabled: false, separator: true },
        { id: 'snap', label: t('triball.menu.snap'), enabled: true },
      ], (id) => {
        if (id === 'angle') setDlg({ kind: 'angle' });
        else if (id === 'snap') setDlg({ kind: 'snap' });
        else openRepeat('radial', b.axis !== null ? b.frame.axes[b.axis] : viewDir(), 0, false);
      });
    }
  };

  /** The direction the camera looks along, as the unit vector from the ball to the camera. */
  const viewDir = (): Vec3 => {
    const o = ballRef.current!.frame.origin;
    const c = ref.current.viewport()?.cameraPosition();
    return c ? V.norm(V.sub(c, o)) : [0, 0, 1];
  };

  // ---- picks ----

  const endPick = () => {
    pickRef.current = null; setPick(null); setStatus(null);
    const vp = ref.current.viewport();
    vp?.setPickIntercept(null);
    vp?.setPickMode(ref.current.store.mode.value);
  };
  const startPick = (pk: Pick) => {
    const vp = ref.current.viewport();
    if (!vp) return;
    pickRef.current = pk; setPick(pk); setStatus(pk.prompt);
    vp.setPickMode(pk.mode);
    vp.setPickIntercept((name) => {
      const cur = pickRef.current;
      if (!cur || !name) return;
      const r = cur.take(name);
      if (r === true) endPick(); else setStatus(r);
    });
  };
  const edgeOf = (name: string) => ref.current.controller.bodyEdges().find((e) => e.key === name);

  /** Move the ball (detached) or the object with it (attached) so the ball origin lands on a point. */
  const gotoPoint = (pt: Vec3) => {
    const b = ballRef.current!;
    const d = V.sub(pt, b.frame.origin);
    if (V.len(d) < 1e-9) return;
    const v: TriValue = { ...zeroValue(), vec: d, distance: V.dot(d, b.frame.axes[2]) };
    void commitMove({ kind: 'plane', axis: 0 }, v);
  };
  const toPick = (id: string) => {
    if (id === 'position') { setDlg({ kind: 'position' }); return; }
    if (id === 'point') startPick({ prompt: t('triball.pick.point'), mode: 'vertex', take: (n) => { const v = parseVertexName(n); if (!v) return t('triball.pick.needVertex'); gotoPoint(v as Vec3); return true; } });
    else if (id === 'center') startPick({ prompt: t('triball.pick.center'), mode: 'edge', take: (n) => {
      const e = edgeOf(n); const c = e?.pts ? circleOf(e.pts) : null;
      if (!c) return t('triball.pick.needCircle');
      gotoPoint(c.c as Vec3); return true;
    } });
    else startPick({ prompt: t('triball.pick.mid'), mode: 'edge', take: (n) => {
      const e = edgeOf(n);
      const mid = e?.mid && e.mid.length === 3 ? e.mid : e?.pts ? e.pts[Math.floor(e.pts.length / 2)] : null;
      if (!mid) return t('triball.pick.needEdge');
      gotoPoint(mid as Vec3); return true;
    } });
  };

  const reorient = (i: 0 | 1 | 2, dir: Vec3, keepSense = true) => {
    const b = ballRef.current!;
    setBall({ ...b, frame: { ...b.frame, axes: aimAxis(b.frame.axes, i, dir, keepSense) } });
  };
  const orient = (id: string, i: number) => {
    const ax = i as 0 | 1 | 2;
    if (id === 'mirrorCopy') {
      const pid = mirrorPlaneId(ballRef.current!.frame, i);
      const ops = pid ? mirrorOps(ref.current.controller.document(), pid) : null;
      if (ops) { own.current = true; void ref.current.commit(ops); }
      return;
    }
    if (id === 'reverse') { reorient(ax, V.mul(ballRef.current!.frame.axes[ax], -1), false); return; }
    if (id === 'axis') startPick({ prompt: t('triball.pick.axis'), mode: 'face', take: (n) => {
      const c = cylinderOfFace(n, ref.current.controller.bodyEdges());
      if (!c) return t('triball.pick.needCylinder');
      reorient(ax, c.axisDir as Vec3); return true;
    } });
    else if (id === 'face') startPick({ prompt: t('triball.pick.face'), mode: 'face', take: (n) => {
      const mesh = ref.current.controller.bodyFaces();
      const info = mesh ? faceInfo(mesh, n) : null;
      if (!info?.planar) return t('triball.pick.needPlane');
      reorient(ax, info.normal, false); return true;
    } });
    else if (id === 'edge') startPick({ prompt: t('triball.pick.edge'), mode: 'edge', take: (n) => {
      const pts = edgeOf(n)?.pts;
      if (!pts || pts.length < 2) return t('triball.pick.needEdge');
      const a = pts[0], z = pts[pts.length - 1];
      if (Math.hypot(z[0] - a[0], z[1] - a[1], z[2] - a[2]) < 1e-9) return t('triball.pick.needEdge');
      reorient(ax, V.norm(V.sub(z as Vec3, a as Vec3))); return true;
    } });
  };

  // ---- toggling and retargeting ----

  const resolve = (): ReturnType<typeof resolveTarget> => {
    const { controller, store, selectedFeature } = ref.current;
    return resolveTarget({ doc: controller.document(), selection: store.selection.value, mode: store.mode.value, selectedFeature, mesh: controller.bodyFaces(), box: controller.bodyBox() });
  };
  const turnOff = () => { endPick(); setMenu(null); setDlg(null); pending.current = null; setBall(null); setStatus(null); setHint(null); };
  const toggle = () => {
    if (ballRef.current) { turnOff(); return; }
    const r = resolve();
    if (!r.ok) { ref.current.store.notify(t('triball.need.' + r.reason), 'warn'); return; }
    setBall({ target: r.target, frame: r.target.frame, attached: true, axis: null });
  };
  const canToggle = (): boolean => !!ballRef.current || resolve().ok;

  // follow the selection and the document
  const sel = p.store.selection.value;
  useEffect(() => {
    const b = ballRef.current;
    if (!b || dragging.current) return;
    if (!sel.length && !p.selectedFeature) return;          // a click on empty space keeps the ball where it is
    const r = resolve();
    if (r.ok) setBall({ target: r.target, frame: r.target.frame, attached: b.attached, axis: null });
    else turnOff();
  }, [sel, p.selectedFeature]);
  const rev = p.controller.revision;
  useEffect(() => {
    if (rev === lastRev.current) return;
    lastRev.current = rev;
    if (own.current) { own.current = false; return; }
    const b = ballRef.current;
    if (!b) return;
    const r = resolve();                                      // undo, redo, an edit elsewhere: the frame is read again
    if (r.ok) setBall({ target: r.target, frame: r.target.frame, attached: b.attached, axis: null });
    else turnOff();
  }, [rev]);

  // show the ball on the canvas
  const visible = !!ball && !p.sketching && !p.editingId;
  useEffect(() => {
    const vp = p.viewport();
    if (!vp) return;
    if (visible && ball) {
      const view: TriView = { frame: ball.frame, attached: ball.attached, axis: ball.axis, off: ball.target.off };
      if (!shown.current) { vp.setTriBall(view, sink.current); shown.current = true; } else vp.setTriBallView(view);
    } else if (shown.current) { vp.setTriBall(null, null); shown.current = false; }
  }, [visible, ball]);
  useEffect(() => () => { p.viewport()?.setTriBall(null, null); }, []);

  // keys: Space attaches / detaches, Escape ends a pick or the ball
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ballRef.current) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)) return;
      if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && !dragging.current) {
        e.preventDefault();
        const b = ballRef.current;
        setBall({ ...b, attached: !b.attached, axis: null });
        ref.current.store.notify(t(b.attached ? 'triball.detached' : 'triball.attached'));
      } else if (e.key === 'Escape') {
        // the ball takes this Escape: it must not also clear the selection or close a panel
        e.stopPropagation();
        if (pickRef.current) endPick(); else if (!dragging.current) turnOff();
      }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, []);

  // ---- dialogs ----

  const num = (v: unknown): number => Number(v);
  let dialogEl = null;
  if (dlg && ball) {
    const how: DialogField | null = ball.target.kind === 'body' && ball.attached
      ? { key: 'how', label: t('triball.how'), type: 'choice', value: 'move', options: [{ value: 'move', label: t('triball.menu.move') }, { value: 'copy', label: t('triball.menu.copy') }] } : null;
    const close = () => setDlg(null);
    if (dlg.kind === 'distance') {
      const i = dlg.axis;
      dialogEl = <FieldsDialog title={t('triball.menu.editDistance')} fields={[{ key: 'd', label: t('triball.field.distance'), value: 0, unit: 'mm' }, ...(how ? [how] : [])]} onCancel={close}
        onOk={(v) => { close(); void commitMove({ kind: 'axis', axis: i }, valueAlong(ball.frame.axes, i, num(v.d)), v.how === 'copy' ? 'copy' : 'move'); }} />;
    } else if (dlg.kind === 'angle') {
      dialogEl = <FieldsDialog title={t('triball.menu.editAngle')} onCancel={close}
        fields={[{ key: 'a', label: t('triball.field.angle'), value: 0, unit: '°' },
          { key: 'about', label: t('triball.field.about'), type: 'choice', value: ball.axis !== null ? String(ball.axis) : 'view', options: [{ value: '0', label: 'X' }, { value: '1', label: 'Y' }, { value: '2', label: 'Z' }, { value: 'view', label: t('triball.field.view') }] },
          ...(how ? [how] : [])]}
        onOk={(v) => {
          close();
          const ax: 0 | 1 | 2 | 'view' = v.about === 'view' ? 'view' : (Number(v.about) as 0 | 1 | 2);
          const dir = ax === 'view' ? viewDir() : ball.frame.axes[ax];
          void commitMove({ kind: 'spin', axis: ax }, { ...zeroValue(), angle: num(v.a), dir }, v.how === 'copy' ? 'copy' : 'move');
        }} />;
    } else if (dlg.kind === 'snap') {
      dialogEl = <FieldsDialog title={t('triball.snap.title')} onCancel={close}
        fields={[{ key: 'distance', label: t('triball.snap.distance'), value: p.prefs.distance, unit: 'mm', min: 1e-6 }, { key: 'angle', label: t('triball.snap.angle'), value: p.prefs.angle, unit: '°', min: 1e-6 }]}
        onOk={(v) => { close(); const n = { distance: num(v.distance), angle: num(v.angle) }; saveTriPrefs(n); ref.current.onPrefs(n); }} />;
    } else if (dlg.kind === 'position') {
      const o = ball.frame.origin;
      dialogEl = <FieldsDialog title={t('triball.menu.editPosition')} onCancel={close} note={ball.attached ? t('triball.position.attached') : t('triball.position.detached')}
        fields={[{ key: 'x', label: 'X', value: +o[0].toFixed(4), unit: 'mm' }, { key: 'y', label: 'Y', value: +o[1].toFixed(4), unit: 'mm' }, { key: 'z', label: 'Z', value: +o[2].toFixed(4), unit: 'mm' }]}
        onOk={(v) => { close(); gotoPoint([num(v.x), num(v.y), num(v.z)]); }} />;
    } else {
      const r = dlg.r;
      dialogEl = <FieldsDialog title={t('triball.repeat.title')} onCancel={() => { close(); void runner.current!.cancel(); }}
        fields={[
          { key: 'number', label: t('triball.repeat.number'), value: r.number, integer: true, min: 1 },
          { key: 'distance', label: t('triball.repeat.distance'), value: +r.distance.toFixed(4), unit: 'mm', disabled: r.kind !== 'linear', min: 0 },
          { key: 'angle', label: t('triball.repeat.angle'), value: +r.angle.toFixed(4), unit: '°', disabled: r.kind !== 'radial' },
          { key: 'stepUp', label: t('triball.repeat.stepUp'), value: r.stepUp, unit: 'mm', disabled: r.kind !== 'radial' },
        ]}
        onOk={(v) => {
          close();
          const spec: RepeatSpec = { ...r, number: num(v.number), distance: num(v.distance), angle: num(v.angle), stepUp: num(v.stepUp) };
          const ops = repeatOps(spec, copySource(faceIds()));
          if (!ops.length) { void runner.current!.cancel(); return; }
          own.current = true;
          void runner.current!.commit({ ops, create: false });
        }} />;
    }
  }

  const menuEl = menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onRun={menu.run} onClose={menu.dismiss} /> : null;
  const text = pick ? status : hint ?? status;
  const statusEl = ball && visible && text ? <div class={'handle-hint tb-status' + (hint && !pick ? ' warn' : '')} role="status">{text}</div> : null;
  return { on: !!ball, attached: ball?.attached ?? false, toggle, canToggle, menuEl, dialogEl, statusEl, openSnap: () => setDlg({ kind: 'snap' }) };
}

function statusKey(target: TriTarget, b: Ball | null): string {
  switch (target.kind) {
    case 'centre': return b && !b.attached ? 'triball.status.reposition' : 'triball.status.pull';
    case 'stub': return 'triball.status.align';
    case 'end': return 'triball.status.pull';
    case 'plane': return 'triball.status.plane';
    case 'ring': return b?.axis !== null && b?.axis !== undefined ? 'triball.status.axisRotate' : 'triball.status.ringRotate';
    default: return 'triball.status.axisRotate';
  }
}

export { WORLD_AXES };
