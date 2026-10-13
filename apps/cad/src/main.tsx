import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createBrowserKernel, type BrowserKernel } from '@ck/kernel-client/browser';
import { Session, type EditOp } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { signal } from '@preact/signals-core';
import { availableLocales, locale as localeSignal, PSEUDO, setLocale } from '@kit/i18n';
import { createStore, type DisplayLayer, type Workspace } from '@kit/store';
import { Viewport } from '@kit/viewport';
import { applySnapConstraints, DEFAULT_SETTINGS, deleteEntity, entityDims, entityShape, movePoint, pickEntity, setEntityDim, snapAt, toolById, type FieldSpec, type SnapHit, type ToolEvent, type ToolOutput } from '@kit/sketch';
import type { SketchPreviewShape } from '@kit/viewport';
import {
  BusyOverlay, CommandPalette, Drawer, FeatureEditor, FeatureTree, HistoryLog, Inspector, Ribbon, StatusBar, Toast,
  type HistoryFilter,
} from '@kit/ui';
import { createWebPlatform } from '@kit/platform';
import { Controller } from './controller';
import { buildCommands } from './commands';
import { toEntries, type Rejection } from './history';
import { SamplesDialog, type SampleEntry } from './SamplesDialog';
import { DisplayMenu } from './DisplayMenu';
import { SketchToolStrip } from './SketchToolStrip';
import { SketchFields } from './SketchFields';
import { SettingsDialog } from './SettingsDialog';
import { applyTheme, asTheme, type Theme } from './theme';
import { t } from './i18n';
import { useSignals } from './useSignals';
import './tokens.css';
import './app.css';

const base = import.meta.env.BASE_URL;
const platform = createWebPlatform({ base });
const read = (key: string): unknown => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ } };
import { sketchTools } from '@kit/sketch';
const VIEW_KEYS: Record<string, 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom' | 'iso'> = { '1': 'top', '2': 'front', '3': 'right', '4': 'back', '5': 'left', '6': 'bottom', '7': 'iso' };
const SKETCH_TOOL_KEYS = new Map(sketchTools().flatMap((x) => (x.key ? [[x.key, x.id] as const] : [])));
const savedLocale = read('cad.locale');
const savedTheme = asTheme(read('cad.theme'));
applyTheme(savedTheme);
if (typeof savedLocale === 'string') setLocale(savedLocale);
const store = createStore((read('cad.display') as object | null) ?? {}, read('cad.workspace'));

// One kernel worker for the app; cancel() restarts it.
let kernelP: Promise<BrowserKernel> = createBrowserKernel(platform.wasmUrl());
let session: Session | null = null;
let viewport: Viewport | null = null;
const controller = new Controller({
  store,
  view: {
    setBody: (b) => {
      viewport?.setBody(b as never);
      const body = b as { mesh?: { faceIds: string[]; triFace: ArrayLike<number> } } | null;
      store.facts.value = { ...store.facts.value, faces: body?.mesh?.faceIds.length ?? 0, triangles: body?.mesh?.triFace.length ?? 0 };
    },
    setHighlight: (n) => viewport?.setHighlight(n),
    setSketchEdit: (v) => viewport?.setSketchEdit(v as never),
  },
  kernel: {
    async open(doc: PartDoc) { session = new Session(doc, await kernelP, 'user'); return session; },
    cancel() { void kernelP.then((k) => k.close()); kernelP = createBrowserKernel(platform.wasmUrl()); },
  },
});
// Rejected edits are not in the session history, so record them here whatever the source (UI, console, agent).
const rejections = signal<Rejection[]>([]);
const rawEdit = controller.edit.bind(controller);
controller.edit = async (ops, reason) => {
  const at = session?.history().length ?? 0;
  const r = await rawEdit(ops, reason);
  if (!r.ok) {
    const hint = r.hints?.map((h) => h.hint).join('; ') || r.schemaError || 'edit failed';
    rejections.value = [...rejections.value, { at, time: Date.now(), reason: reason ?? '', hint, ops }];
  }
  return r;
};
if (import.meta.env.DEV) {
  const hook = { controller, store };                                          // for the browser console
  Object.defineProperty(hook, 'viewport', { get: () => viewport });            // created later by an effect
  Object.assign(window, { __cad: hook });
}

const I = (d: string) => `<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const RAIL_ICONS: Record<string, string> = {
  undo: I('<path d="M6 3 3 6l3 3M3 6h6a4 4 0 010 8H6"/>'),
  redo: I('<path d="m10 3 3 3-3 3M13 6H7a4 4 0 000 8h3"/>'),
  'view-iso': I('<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5zM2.5 5 8 8.2 13.5 5M8 8.2v6"/>'),
  'view-front': I('<rect x="3" y="3" width="10" height="10" rx="1"/><path d="M3 8h10" opacity=".4"/>'),
  'view-top': I('<path d="M2.5 11.5 5 4.5h8.5l-2.5 7z"/>'),
  'view-back': I('<rect x="3" y="3" width="10" height="10" rx="1"/><path d="M3 8h10" opacity=".4"/>'),
  'view-left': I('<path d="M13 3H7L3 5.5V13h10z"/>'),
  'view-bottom': I('<path d="M2.5 4.5 5 11.5h8.5l-2.5-7z"/>'),
  'view-right': I('<path d="M3 3h6l4 2.5v7.5H3z"/>'),
  fit: I('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
};
const timed = async <T,>(f: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  try { return await f(); } finally { store.facts.value = { ...store.facts.value, rebuildMs: Math.round(performance.now() - t0) }; }
};

function App() {
  const host = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState('Home');
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const [leftTab, setLeftTab] = useState<'Outliner' | 'Features' | 'Assets' | 'Editor'>('Features');
  const [drawerTab, setDrawerTab] = useState('history');
  const [histFilter, setHistFilter] = useState<HistoryFilter>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickingPath, setPickingPath] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ path: string; value: unknown } | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [previewHint, setPreviewHint] = useState<string | null>(null);
  const [sketching, setSketching] = useState<{ id: string; name: string } | null>(null);
  const [sketchHint, setSketchHint] = useState<string | null>(null);
  // The viewport is constructed once, so its sketch callbacks read these refs
  // instead of closing over state from the render they were created in.
  const sketchMoveRef = useRef<((pointId: string, u: number, v: number) => void) | null>(null);
  const sketchConfirmRef = useRef<(() => void) | null>(null);
  const sketchCancelRef = useRef<(() => void) | null>(null);
  // Sketch tools: the active tool, its state and its last output live in refs because the viewport and the
  // key handler are created once; the React state below only drives what is drawn.
  const [sketchToolId, setSketchToolId] = useState<string | null>(null);
  const [toolOut, setToolOut] = useState<{ fields: FieldSpec[]; x: number; y: number; pending?: string[]; snapLabel?: string } | null>(null);
  const dwellRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const sketchToolRef = useRef<string | null>(null);
  // Select mode: the picked entity and the size field shown beside it.
  const [entityOut, setEntityOut] = useState<{ fields: FieldSpec[]; x: number; y: number } | null>(null);
  const selEntityRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const sketchSelectRef = useRef<((ev: import('@kit/viewport').SketchPointerEvent) => void) | null>(null);
  const toolStateRef = useRef<unknown>(null);
  const lastOutRef = useRef<ToolOutput<unknown> | null>(null);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const sketchPointerRef = useRef<((ev: import('@kit/viewport').SketchPointerEvent) => void) | null>(null);
  const sketchKeyRef = useRef<((e: KeyboardEvent) => boolean) | null>(null);
  const sketchUndoRef = useRef<(() => void) | null>(null);
  const [samples, setSamples] = useState<SampleEntry[] | null>(null);
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const [, redraw] = useState(0);
  useSignals(() => { store.busy.value; store.hover.value; store.notices.value; store.featureStatus.value; store.mode.value; store.display.value; store.workspace.value; store.facts.value; store.selection.value; rejections.value; localeSignal.value; });
  const ws = store.workspace.value;

  useEffect(() => {
    const vp = new Viewport(host.current!, {
      onPick: (names, additive) => store.select(names, additive),
      onHover: (n) => { store.hover.value = n; },
      onSketchMove: (pointId, u, v) => sketchMoveRef.current?.(pointId, u, v),
      onSketchPointer: (ev) => sketchPointerRef.current?.(ev),
      onSketchSelect: (ev) => sketchSelectRef.current?.(ev),
    });
    viewport = vp;
    const ro = new ResizeObserver(() => vp.resize());
    ro.observe(host.current!);
    return () => { ro.disconnect(); vp.dispose(); viewport = null; };
  }, []);
  useEffect(() => { viewport?.setHighlight(store.selection.value); }, [store.selection.value]);
  // A selection made while a reference field is in the picking state lands in that field's draft.
  useEffect(() => {
    if (!pickingPath) return;
    const id = store.selection.value[0];
    if (id) { setPicked({ path: pickingPath, value: id }); setPickingPath(null); }
  }, [store.selection.value, pickingPath]);
  useEffect(() => {
    const d = store.display.value;
    for (const k of Object.keys(d)) viewport?.setLayerVisible(k, d[k as DisplayLayer]);
    write('cad.display', d);
  }, [store.display.value]);
  useEffect(() => {
    write('cad.workspace', ws);
    const r = document.documentElement.style;
    r.setProperty('--alpha', String(ws.opacity));
    r.setProperty('--blur', `${ws.blur}px`);
    requestAnimationFrame(() => viewport?.resize());
  }, [ws]);

  const load = async (text: string) => {
    try {
      const doc = JSON.parse(text) as PartDoc;
      await timed(() => controller.load(doc));
      setSelectedId(null); store.select([]); rejections.value = []; redraw((n) => n + 1);
      store.notify(t('app.notice.opened', { name: doc.name || t('app.part.unnamed') }));
    } catch (e) { store.notify(t('app.notice.openFailed', { message: (e as Error).message }), 'error'); }
  };
  const edit = async (ops: EditOp[]) => {
    await timed(() => controller.edit(ops));
    redraw((n) => n + 1);
  };
  const gotoStep = async (count: number) => {
    const have = session?.history().length ?? 0;
    for (let i = have; i > count; i--) await controller.undo();
    redraw((n) => n + 1);
  };
  const setMode = (m: 'face' | 'edge') => { store.mode.value = m; viewport?.setPickMode(m); };
  const toggleDrawer = () => store.setWorkspace({ drawerOpen: !store.workspace.value.drawerOpen });

  const commands = buildCommands({
    open: async () => { const f = await platform.openFile(); if (f) await load(f.text); },
    save: async () => { const d = controller.document(); if (d) await platform.saveFile(`${d.name || 'part'}.ckpart`, JSON.stringify(d, null, 1)); },
    samples: async () => setSamples(await platform.listSamples()),
    undo: async () => { await controller.undo(); redraw((n) => n + 1); },
    redo: async () => { await controller.redo(); redraw((n) => n + 1); },
    palette: () => setPalette(true),
    toggleDrawer,
    settings: () => setSettings(true),
    hasDocument: () => controller.document() !== null,
    newPart: async () => { await load(JSON.stringify(emptyPart('Part'))); },
    newSketch: (plane) => startNewSketch(plane),
    addExtrude: (op) => void addExtrude(op),
    setView: (v) => viewport?.setView(v),
    fit: () => viewport?.fit(),
    setMode: (m) => setMode(m === 'edge' ? 'edge' : 'face'),
    mode: () => store.mode.value,
    toggleLayer: (l) => store.setDisplay(l, !store.display.value[l]),
    layer: (l) => store.display.value[l],
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && sketchUndoRef.current) { e.preventDefault(); sketchUndoRef.current(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (sketchKeyRef.current?.(e)) return;
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setPalette(true); }
      else if (e.key === '\\') { e.preventDefault(); toggleDrawer(); }
      else if (VIEW_KEYS[e.key]) { e.preventDefault(); viewport?.setView(VIEW_KEYS[e.key]); }
      else if (e.key === 'q' || e.key === 'Q') setMode('face');
      else if (e.key === 'e' || e.key === 'E') setMode('edge');
      else if (e.key === 'z' || e.key === 'Z') viewport?.fit();
      else if (e.key === 'Enter' && sketchConfirmRef.current) { e.preventDefault(); void sketchConfirmRef.current(); }
      else if (e.key === 'Escape') {
        if (sketchCancelRef.current) { e.preventDefault(); void sketchCancelRef.current(); return; }
        setPalette(false); setSettings(false); setSamples(null);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const doc = controller.document();
  const rows = doc ? doc.features.map((f) => ({ id: f.id, type: f.type, name: f.name, suppressed: (f as { suppressed?: boolean }).suppressed })) : [];
  const feature = doc && selectedId ? (doc.features.find((f) => f.id === selectedId) as unknown as Record<string, unknown> | undefined) ?? null : null;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const records = session?.history() ?? [];
  const entries = toEntries(records, rejections.value);
  const failures = store.featureStatus.value.filter((s) => !s.ok);
  const facts = store.facts.value;

  const editingFeature = editingId && doc ? (doc.features.find((f) => f.id === editingId) as unknown as Record<string, unknown> | undefined) ?? null : null;
  const opsFromDraft = (next: Record<string, unknown>): EditOp[] => {
    if (!editingFeature) return [];
    return Object.entries(next)
      .filter(([path, value]) => editingFeature[path] !== value)
      .map(([path, value]) => ({ op: 'set' as const, id: editingId!, path, value }));
  };
  const onDraft = (next: Record<string, unknown>) => {
    setDraft(next);
    const ops = opsFromDraft(next);
    if (!ops.length) return;
    void controller.preview(ops).then((r) => setPreviewHint(r.ok ? null : (r.hint ?? null)));
  };
  const onConfirm = async (next: Record<string, unknown>) => {
    const ops = opsFromDraft(next);
    if (ops.length) await timed(() => controller.commit(ops));
    setEditingId(null); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
    redraw((n) => n + 1);
  };
  const onCancel = async () => {
    await controller.cancelPreview();
    setEditingId(null); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
    redraw((n) => n + 1);
  };

  const startEditing = (id: string) => {
    setSelectedId(id);
    const f = doc?.features.find((x) => x.id === id) as { type?: string; name?: string } | undefined;
    if (f?.type === 'sketch') {
      setEditingId(null); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
      setSketchHint(null);
      void (async () => {
        const view = await controller.beginSketch(id);
        if (!view) { store.notify(t('app.sketch.failed'), 'error'); return; }
        setSketching({ id, name: f.name ?? id });
        viewport?.orientToSketch();
      })();
      return;
    }
    setEditingId(id);
    setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
    setLeftTab('Editor');
  };

  // Sketch session handlers. The viewport was built once, so it calls through
  // these refs; the actual work reads the controller's current draft (which
  // carries the solver's folds from earlier drags).
  sketchMoveRef.current = (pointId, u, v) => {
    const d = controller.sketchDraft();
    if (!d) return;
    void controller.updateSketch(movePoint(d, pointId, u, v)).then((r) => {
      setSketchHint(r.ok || r.stale ? null : (r.hint ? t(r.hint) : null));
    });
  };
  const selectTool = (id: string | null) => {
    const entry = id ? toolById(id) : undefined;
    if (id) { selEntityRef.current = null; setEntityOut(null); }
    if (dwellRef.current.timer) { clearTimeout(dwellRef.current.timer); dwellRef.current.timer = null; }
    dwellRef.current.fired = false;
    sketchToolRef.current = entry ? entry.id : null;
    toolStateRef.current = entry ? entry.tool.start() : null;
    lastOutRef.current = null;
    setSketchToolId(entry ? entry.id : null);
    setToolOut(null);
    viewport?.setSketchTool(!!entry);
    if (!entry) viewport?.setSketchPreview([]);
  };
  /** What the pointer is snapped to, drawn as markers and dotted guides, plus the ring on the chain end. */
  const snapVisuals = (draft: import('@kit/sketch').SketchDraft, snap: SnapHit | undefined, out: ToolOutput<unknown>): SketchPreviewShape[] => {
    const shapes: SketchPreviewShape[] = [];
    if (snap?.kind === 'point') shapes.push({ kind: 'marker', at: snap.at, style: 'point' });
    else if (snap?.kind === 'midpoint') shapes.push({ kind: 'marker', at: snap.at, style: 'midpoint' });
    else if (snap?.kind === 'align') {
      shapes.push({ kind: 'marker', at: snap.at, style: 'align' });
      for (const id of [snap.alignTo?.x, snap.alignTo?.y]) {
        const src = id ? draft.points.find((p) => p.id === id) : undefined;
        if (src) { shapes.push({ kind: 'marker', at: { x: src.x, y: src.y }, style: 'align' }); shapes.push({ kind: 'guide', a: { x: src.x, y: src.y }, b: snap.at }); }
      }
    }
    if (out.anchor) shapes.push({ kind: 'marker', at: out.anchor, style: 'anchor' });
    return shapes;
  };
  const runTool = (ev: ToolEvent) => {
    const entry = sketchToolRef.current ? toolById(sketchToolRef.current) : undefined;
    const draft = controller.sketchDraft();
    if (!entry || !draft) return;
    const snap = ev.type === 'move' || ev.type === 'click' ? ev.snap : undefined;
    const out = entry.tool.step(toolStateRef.current, ev, draft, DEFAULT_SETTINGS);
    // a click that snapped to a midpoint or an alignment makes that a real constraint, so it survives later edits
    if (ev.type === 'click' && out.draft !== draft && DEFAULT_SETTINGS.autoConstraints && !ev.mods.shift) out.draft = applySnapConstraints(draft, out.draft, snap);
    toolStateRef.current = out.state;
    lastOutRef.current = out;
    viewport?.setSketchPreview([...(out.preview as SketchPreviewShape[]), ...snapVisuals(draft, snap, out)]);
    setToolOut({ fields: out.fields, x: lastPosRef.current.x, y: lastPosRef.current.y, pending: out.pending, snapLabel: snap ? t('app.sketch.snap.' + snap.kind) : undefined });
    if (out.hint) setSketchHint(t(out.hint));
    if (out.draft !== draft) {
      void controller.applySketchDraft(out.draft).then((r) => {
        setSketchHint(r.ok || r.stale ? (out.hint ? t(out.hint) : null) : (r.hint ? t(r.hint) : null));
      });
    }
  };
  /** Pick (or clear) the entity under a click in Select mode: highlight it and offer its size as an editable field. */
  const selectEntity = (id: string | null, x: number, y: number) => {
    const draft = controller.sketchDraft();
    if (!id || !draft) {
      selEntityRef.current = null;
      setEntityOut(null);
      viewport?.setSketchPreview([]);
      return;
    }
    selEntityRef.current = { id, x, y };
    viewport?.setSketchPreview(entityShape(draft, id));
    setEntityOut({ fields: entityDims(draft, id), x, y });
  };
  sketchSelectRef.current = (ev) => {
    if (sketchToolRef.current) return;
    const draft = controller.sketchDraft();
    if (!draft) return;
    selectEntity(pickEntity(draft, { x: ev.u, y: ev.v }, ev.tol), ev.x, ev.y);
  };
  const applyEntityEdit = (next: import('@kit/sketch').SketchDraft | null) => {
    const sel = selEntityRef.current;
    if (!next || !sel) return;
    void controller.applySketchDraft(next).then((r) => {
      setSketchHint(r.ok || r.stale ? null : (r.hint ? t(r.hint) : null));
      selectEntity(sel.id, sel.x, sel.y);   // show the solved size
    });
  };
  const entityFieldEvent = (id: string, value: number | null, commit: boolean) => {
    const sel = selEntityRef.current;
    const draft = controller.sketchDraft();
    if (!commit || value === null || !sel || !draft) return;
    applyEntityEdit(setEntityDim(draft, sel.id, id === 'len' ? 'len' : 'radius', value));
  };
  sketchPointerRef.current = (ev) => {
    if (!sketchToolRef.current) return;
    if (ev.type === 'leave') { viewport?.setSketchPreview([]); setToolOut(null); return; }
    lastPosRef.current = { x: ev.x, y: ev.y };
    const draft = controller.sketchDraft();
    if (!draft) return;
    const at = { x: ev.u, y: ev.v };
    const snap = ev.mods.alt ? undefined : snapAt(draft, at, { tolerance: ev.tol, grid: ev.grid });
    runTool({ type: ev.type, at, snap, mods: ev.mods });
    // Resting the pointer on the chain end flips the line tool between a line and a tangent arc; moving off re-arms it.
    const anchor = lastOutRef.current?.anchor;
    const d = dwellRef.current;
    if (DEFAULT_SETTINGS.arcSwitch === 'hover' && anchor && ev.type === 'move') {
      const near = Math.hypot(anchor.x - at.x, anchor.y - at.y) < ev.tol;
      if (near && !d.timer && !d.fired) {
        d.timer = setTimeout(() => {
          d.timer = null; d.fired = true;
          runTool({ type: 'key', key: lastOutRef.current?.mode === 'arc' ? 'l' : 'm' });
        }, 300);
      } else if (!near) {
        if (d.timer) { clearTimeout(d.timer); d.timer = null; }
        if (Math.hypot(anchor.x - at.x, anchor.y - at.y) > ev.tol * 2) d.fired = false;
      }
    }
  };
  // Keys while a sketch tool is active. A tool that is mid-shape (a rubber band or fields showing) gets Escape,
  // Enter and its own keys; an idle tool lets Escape leave the tool, Enter confirm the sketch and letters pick tools.
  sketchKeyRef.current = (e) => {
    if (!sketching) return false;
    const sel = selEntityRef.current;
    if (sel && !sketchToolRef.current) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const draft = controller.sketchDraft();
        e.preventDefault();
        if (draft) void controller.applySketchDraft(deleteEntity(draft, sel.id)).then(() => selectEntity(null, 0, 0));
        return true;
      }
      if (e.key === 'Escape') { e.preventDefault(); selectEntity(null, 0, 0); return true; }
    }
    const busy = !!lastOutRef.current && (lastOutRef.current.preview.length > 0 || lastOutRef.current.fields.length > 0);
    if (sketchToolRef.current && busy) {
      if (/^[0-9.\-]$/.test(e.key)) {
        const first = document.querySelector<HTMLInputElement>('.sketch-fields input');
        if (first) { first.focus(); first.select(); return true; }    // the key then types into the field, not the view keys
      }
      e.preventDefault();
      runTool({ type: 'key', key: e.key });
      return true;
    }
    if (e.key === 'Escape' && sketchToolRef.current) { e.preventDefault(); selectTool(null); return true; }
    const hit = SKETCH_TOOL_KEYS.get(e.key.toLowerCase());
    if (hit && e.key.length === 1) { e.preventDefault(); selectTool(hit); return true; }
    return false;
  };
  sketchUndoRef.current = () => { void controller.undoSketch(); };
  const startNewSketch = (plane: 'front' | 'top' | 'right') => {
    void (async () => {
      setSketchHint(null);
      const view = await controller.beginNewSketch(plane);
      if (!view) { store.notify(t('app.sketch.failed'), 'error'); return; }
      setSketching({ id: view.featureId, name: t('app.sketch.newName') });
      viewport?.orientToSketch();
      selectTool('line');
    })();
  };
  // Add an extrude (or cut) from the selected sketch, or the last sketch in the tree, and open it in the editor.
  const addExtrude = async (op: 'add' | 'cut') => {
    const d = controller.document();
    if (!d) return;
    const selected = d.features.find((f) => f.id === selectedId && f.type === 'sketch');
    const sketch = selected ?? [...d.features].reverse().find((f) => f.type === 'sketch');
    if (!sketch) { store.notify(t('app.noSketch'), 'error'); return; }
    const before = d.features.length;
    await edit([{ op: 'add', feature: { type: 'extrude', op, sketch: sketch.id, end: 'blind', depth: 10 } }]);
    const now = controller.document();
    const added = now && now.features.length > before ? now.features[now.features.length - 1] : null;
    if (added) startEditing(added.id);
  };
  const fieldEvent = (id: string, value: number | null, commit: boolean) => runTool({ type: 'field', id, value, commit });
  const confirmSketch = async () => {
    if (!sketching) return;
    selectTool(null);
    selectEntity(null, 0, 0);
    await timed(() => controller.commitSketch());
    setSketching(null); setSketchHint(null);
    redraw((n) => n + 1);
  };
  const cancelSketch = async () => {
    if (!sketching) return;
    selectTool(null);
    selectEntity(null, 0, 0);
    await controller.cancelSketch();
    setSketching(null); setSketchHint(null);
    redraw((n) => n + 1);
  };
  sketchConfirmRef.current = confirmSketch;
  sketchCancelRef.current = cancelSketch;
  const sketchBanner = sketching ? (
    <div class="sketch-banner" role="toolbar" aria-label={t('app.sketch.editing', { name: sketching.name })}>
      <span class="sketch-name">{t('app.sketch.editing', { name: sketching.name })}</span>
      {sketchHint ? <span class="sketch-hint" role="status">{sketchHint}</span> : null}
      <button class="rb-btn" onClick={() => viewport?.orientToSketch()}>{t('app.sketch.lookNormal')}</button>
      <button class="rb-btn ok" onClick={() => void confirmSketch()} title={t('app.sketch.confirm')}>✓</button>
      <button class="rb-btn no" onClick={() => void cancelSketch()} title={t('app.sketch.cancel')}>✗</button>
    </div>
  ) : null;
  const tree = (
    <FeatureTree rows={rows} status={store.featureStatus.value} selectedId={selectedId}
      onSelect={setSelectedId}
      onEdit={startEditing}
      onMove={(id, to) => edit([{ op: 'move', id, to }])}
      onRemove={(id) => edit([{ op: 'remove', id }])}
      onToggleSuppress={(id) => { const f = doc!.features.find((x) => x.id === id) as { suppressed?: boolean } | undefined; edit([{ op: 'set', id, path: 'suppressed', value: !f?.suppressed }]); }} />
  );
  const outliner = (
    <div class="outliner">
      {['insertPart', 'cpattern', 'lpattern', 'mate'].map((type) => {
        const list = rows.filter((r) => r.type === type);
        return list.length ? (
          <div key={type}><div class="grp">{type === 'insertPart' ? t('app.outliner.parts') : type === 'mate' ? t('app.outliner.mates') : t('app.outliner.patterns')}</div>
            {list.map((r) => <div key={r.id} class={'row' + (selectedId === r.id ? ' sel' : '')} onClick={() => setSelectedId(r.id)}><span class="row-id">{r.id}</span><span class="row-name">{r.name ?? r.type}</span></div>)}
          </div>
        ) : null;
      })}
      {rows.length === 0 ? <div class="empty">{t('app.outliner.empty')}</div> : <div class="empty">{t('app.outliner.hint')}</div>}
    </div>
  );
  const editor = (
    <FeatureEditor
      feature={editingFeature}
      onDraft={onDraft}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onPickRequest={(path) => { setPickingPath(path); store.select([]); }}
      pickingPath={pickingPath}
      picked={picked}
      hint={previewHint}
    />
  );
  const leftBody = !rows.length ? <div class="empty">{t('app.left.empty')}</div>
    : editingId ? editor : tree;
  const left = ws.leftPanel === 'hidden' ? null : (
    <div class={'tree-wrap ' + ws.leftPanel}>
      {ws.leftTabs ? (
        <>
          <div class="ptabs">
            {(['Outliner', 'Features', 'Editor', 'Assets'] as const).map((id) => <button key={id} class="pt" aria-selected={leftTab === id} onClick={() => setLeftTab(id)}>{t('app.leftTab.' + id)}</button>)}
          </div>
          {leftTab === 'Outliner' ? outliner : leftTab === 'Features' ? leftBody
            : leftTab === 'Editor' ? editor : (
            <div class="empty">{t('app.assets.text')} <button class="rb-btn" onClick={async () => setSamples(await platform.listSamples())}>{t('app.assets.browse')}</button></div>
          )}
        </>
      ) : leftBody}
    </div>
  );
  const right = ws.rightPanel === 'off' ? null : (
    <div class={'insp-wrap ' + ws.rightPanel}>
      <Inspector feature={feature} onSet={(path, value) => {
        clearTimeout(pending);
        pending = setTimeout(() => edit([{ op: 'set', id: selectedId!, path, value }]), 150);
      }} />
    </div>
  );

  return (
    <div id="app" data-ribbon={ws.ribbon} data-left={ws.leftPanel} data-right={ws.rightPanel} data-drawer={ws.drawerOpen}>
      <div class="topbar">
        <b class="doc-name">{doc?.name ?? t('app.noPart')}</b>
        <button class="rb-btn" onClick={() => commands.find((c) => c.id === 'open')!.run()}>{t('cmd.open')}</button>
        <button class="rb-btn" disabled={!doc} onClick={() => commands.find((c) => c.id === 'save')!.run()}>{t('cmd.save')}</button>
        <button class="rb-btn" disabled={!doc} onClick={() => commands.find((c) => c.id === 'undo')!.run()}>{t('cmd.undo')}</button>
        <button class="rb-btn" disabled={!doc} onClick={() => commands.find((c) => c.id === 'redo')!.run()}>{t('cmd.redo')}</button>
        <button class="search-btn" onClick={() => setPalette(true)}>{t('app.search')} <kbd>F</kbd></button>
        <button class="rb-btn" onClick={() => setSettings(true)} title={t('app.settings.title')}>{t('app.settings')}</button>
      </div>
      {ws.ribbon !== 'off' ? <div class={'ribbon-wrap ' + ws.ribbon}><Ribbon commands={commands} activeTab={tab} onTab={setTab} /></div> : null}
      {ws.leftPanel === 'docked' ? left : null}
      <div id="vp" ref={host}>
        {ws.leftPanel === 'floating' ? left : null}
        {ws.rightPanel === 'floating' ? right : null}
        {ws.toolRail ? (
          <div class="tool-rail" role="toolbar" aria-label={t('app.tools')}>
            {commands.filter((c) => ['view-iso', 'view-front', 'view-top', 'view-right', 'fit', 'undo', 'redo'].includes(c.id)).map((c) => (
              <button key={c.id} title={c.label} aria-label={c.label} disabled={c.enabled ? !c.enabled() : false} onClick={c.run} dangerouslySetInnerHTML={{ __html: RAIL_ICONS[c.id] ?? c.label.slice(0, 2) }} />
            ))}
          </div>
        ) : null}
        {ws.selectionBar ? (
          <div class="selmodes" role="toolbar" aria-label={t('app.selectionMode')}>
            {([['face', 'cmd.sel-face', 'Q'], ['edge', 'cmd.sel-edge', 'E']] as const).map(([m, l, k]) => (
              <button key={m} aria-pressed={store.mode.value === m} onClick={() => setMode(m)}><kbd>{k}</kbd>{t(l)}</button>
            ))}
          </div>
        ) : null}
        <DisplayMenu display={store.display.value} onToggle={(l, on) => store.setDisplay(l, on)} />
        {sketchBanner}
        {sketching ? <SketchToolStrip active={sketchToolId} onPick={selectTool} /> : null}
        {sketching && !sketchToolId && entityOut ? <SketchFields fields={entityOut.fields} x={entityOut.x} y={entityOut.y} onField={entityFieldEvent} /> : null}
        {sketching && toolOut ? <SketchFields fields={toolOut.fields} x={toolOut.x} y={toolOut.y} onField={fieldEvent} /> : null}
        {sketching && toolOut && (toolOut.pending?.length || toolOut.snapLabel) ? <div class="sketch-pending" style={{ left: toolOut.x + 16 + 'px', top: toolOut.y - 8 + 'px' }}>{[...(toolOut.pending ?? []), toolOut.snapLabel].filter(Boolean).join(' · ')}</div> : null}
        <div id="vp-layer">
          <BusyOverlay busy={store.busy.value} onCancel={async () => { await controller.cancel(); redraw((n) => n + 1); }} />
          <Toast notices={store.notices.value} />
        </div>
      </div>
      {ws.rightPanel === 'docked' ? right : null}
      {ws.drawerOpen ? (
        <Drawer active={drawerTab} onTab={setDrawerTab} onClose={toggleDrawer}
          tabs={[
            { id: 'history', label: t('app.drawer.history'), badge: entries.length, content: <HistoryLog entries={entries} here={records.length} filter={histFilter} onFilter={setHistFilter} onGoto={gotoStep} /> },
            { id: 'diagnostics', label: t('app.drawer.diagnostics'), badge: failures.length, bad: failures.length > 0, content: failures.length ? (
              <div>{failures.map((f) => <div key={f.id} class="issue"><b>{f.code ?? t('app.diagnostics.error')}</b> {t('app.diagnostics.on')} {f.id}<div class="why">{f.hint}</div><button class="btn" onClick={() => { setSelectedId(f.id); setLeftTab('Features'); }}>{t('app.diagnostics.show')}</button></div>)}</div>
            ) : <div class="empty">{t('app.diagnostics.none')}</div> },
            { id: 'console', label: t('app.drawer.console'), content: (
              <pre class="log">{store.notices.value.map((n) => `${n.level.padEnd(5)} ${n.text}`).join('\n') || t('app.console.none')}</pre>
            ) },
          ]} />
      ) : null}
      <div class="status-wrap">
        <StatusBar notices={store.notices.value} hover={store.hover.value} busy={store.busy.value}
          items={[
            { label: t('app.status.features'), value: String(rows.length) },
            { label: t('app.status.faces'), value: String(facts.faces) },
            { label: t('app.status.triangles'), value: String(facts.triangles) },
            ...(facts.rebuildMs !== null ? [{ label: t('app.status.lastRebuild'), value: t('app.status.secondsUnit', { value: (facts.rebuildMs / 1000).toFixed(1) }) }] : []),
            { label: t('app.status.errors'), value: String(failures.length), tone: failures.length ? ('err' as const) : ('ok' as const) },
          ]}
          drawerOpen={ws.drawerOpen} onToggleDrawer={toggleDrawer} />
      </div>
      {palette ? <CommandPalette commands={commands} pinned={['view-iso', 'fit', 'undo', 'redo', 'samples', 'settings']} onClose={() => setPalette(false)} /> : null}
      {samples ? <SamplesDialog samples={samples} thumbBase={base} onClose={() => setSamples(null)}
        onPick={async (s) => { setSamples(null); const r = await fetch(s.url); await load(await r.text()); }} /> : null}
      {settings ? <SettingsDialog workspace={ws} onChange={(p: Partial<Workspace>) => store.setWorkspace(p)} onPreset={(n) => store.applyPreset(n)} onClose={() => setSettings(false)}
        locale={localeSignal.value} locales={[...availableLocales(), ...(import.meta.env.DEV ? [PSEUDO] : [])]} pseudo={PSEUDO}
        onLocale={(c) => { setLocale(c); write('cad.locale', c); }}
        theme={theme} onTheme={(v) => { setTheme(v); applyTheme(v); write('cad.theme', v); viewport?.refreshTheme(); }} /> : null}
    </div>
  );
}

render(<App />, document.getElementById('root')!);
