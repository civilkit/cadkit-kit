import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createBrowserKernel, type BrowserKernel } from '@ck/kernel-client/browser';
import { Session, type EditOp } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { signal } from '@preact/signals-core';
import { availableLocales, locale as localeSignal, PSEUDO, setLocale } from '@kit/i18n';
import { BODY, createStore, MODE_FILTER, type DisplayLayer, type PickFilterKind, type SelectionMode, type Workspace } from '@kit/store';
import { toBodyMode } from './select/actions';
import { summarize } from './select/actions';
import { summaryText } from './select/summary';
import { SelectionList, chipsOf } from './select/SelectionList';
import { isBodyName } from './select/model';
import { FilterMenu } from './select/FilterMenu';
import { Viewport, markerStyleFor } from '@kit/viewport';
import { isPointSketch } from './featureCreators';
import { pickValue, LIST_PATHS, hasPointEntities, holeOps, type FeatureActions } from './featureCommands';
import { annotate, applySnapConstraints, boxSelect, constraintTargets, definitionMap, deleteEntity, fullyDefine, makeDriven, makeDriving, refAnnotations, refDimsOf, removeRefDim, markNewAsConstruction, setConstruction, entityDims, entityShape, movePoint, pickEntity, pointDims, removeConstraintById, setConstraintValue, setEntityDim, setPointDim, snapAt, toolById, OFFSET_FACE_KEY, sketchReferenceEdges, buildModelSnaps, attachModelSnap, EMPTY_MODEL_SNAPS, type ExtrusionSpan, type ModelSnaps, type FieldSpec, type SnapHit, type ToolEnv, type ToolEvent, type ToolOutput } from '@kit/sketch';
import type { SketchPreviewShape } from '@kit/viewport';
import {
  BusyOverlay, CommandPalette, type Command, Drawer, FeatureEditor, FeatureTree, HistoryLog, Icon, InlineName, Inspector, Ribbon, Slot, commandToItem, StatusBar, Tip, Toast, VarsContext,
  type HistoryFilter,
} from '@kit/ui';
import { createWebPlatform } from '@kit/platform';
import { Controller } from './controller';
import { DiagnosticsCard } from './DiagnosticsCard';
import { newBreakage, type DiagRoot, type Diagnosis } from './errorSummary';
import { dxfToSketch } from '@kit/io';
import { importDxfIntoSketch, importErrorNotice } from './dxfSketch';
import { exportObj, exportSketchDxf, exportStep, exportStl, exportViewsDxf, type ExportNotice, type ExportResult } from './exportFiles';
import { buildCommands, matchShortcut, EXPORT_KINDS, type ExportKind } from './commands';
import { useTreeInteraction } from './useTreeInteraction';
import { treeKey } from './treeCommands';
import { ExportMenu } from './ExportMenu';
import { toEntries, type Rejection } from './history';
import { CheckPanel } from './CheckPanel';
import { useDesignCheck } from './useDesignCheck';
import { InspectPanel } from './inspect/InspectPanel';
import { useInspect } from './inspect/useInspect';
import { SamplesDialog, type SampleEntry } from './SamplesDialog';
import { DiscardDialog } from './DiscardDialog';
import { FileManager } from './files/fileManager';
import { browserKV } from './files/storage';
import { withCacheCap } from './kernelCaps';
import { createAutosaver, clearAutosave, readAutosave, worthRestoring, type Autosave } from './files/autosave';
import { RestoreDialog, SaveAsDialog, DropOverlay } from './files/FileDialogs';
import { dragHasFiles, planDrop } from './files/drop';
import { dropKind, partNameOf, type DropKind } from './files/names';
import { importFcstd, resolveEdges } from '@kit/fcstd';
import type { RecentEntry } from './files/recent';
import { DisplayMenu } from './DisplayMenu';
import { createAnalysisStore } from './analysisState';
import { AnalysisLegend } from './AnalysisControls';
import { createLookStore, effectiveAppearance, componentAppearances, componentKey, anyHidden, LOOK_KEY } from './look';
import { VariablesPanel } from './VariablesPanel';
import { ScriptPanel } from './ScriptPanel';
import { runScript } from '@kit/script';
import { scopeOf } from './variables';
import { MaterialEditor, type MaterialChoice } from './MaterialEditor';
import { findMaterial, loadUseColour, appearanceOfMaterial } from './materials';
import { HoleEditor } from './HoleEditor';
import { optionsFor } from './FeatureOptions';
import { asSurfaceOp, closeWithLineOp, openProfile, thinOf } from './thinRules';
import { ThreadEditor } from './ThreadEditor';
import { followedFaces, patternedBy, threadParents, type ThreadEntry } from './patternThreads';
import { GearEditor } from './GearEditor';
import { gearOps, gearOwner, readGear, type GearParams } from './gearData';
import { cylinderOfFace, cylindersOfFaces, faceExtent, holeWallFaces, isHoleWall, loadThreadPrefs, threadGroup, threadOpsForFaces } from './threadData';
import { holeThreadEditOps, linkedThreads, type HoleThread } from './holeThread';
import type { ThreadEntryLike } from './handles/threadHandle';
import { SketchToolStrip, SketchRailSections, sketchRibbonGroups } from './SketchToolStrip';
import { ToolRail } from './ToolRail';
import { selectionKind } from './menuModel';
import { RIBBON_LAYOUT, SKETCH_TAB, activeRibbonTab, docKindOf, tabForKindChange, idleDuringEdit, isFileCommand, sketchChrome, type DocKind } from './toolbarModel';
import { SketchFields } from './SketchFields';
import { SketchReadout, ModelReadout, readout, clearReadout } from './sketchReadout';
import { DEFAULT_SKETCH_PREFS, loadSketchPrefs, saveSketchPrefs, toToolSettings, type SketchPrefs } from './sketchPrefs';
import { SketchAnnotations } from './SketchAnnotations';
import { SketchBar } from './SketchBar';
import { SketchConstraintList } from './SketchConstraintList';
import { SettingsDialog } from './SettingsDialog';
import { applyTheme, asTheme, type Theme } from './theme';
import { t } from './i18n';
import { installDismissGuard } from './dismissGuard';
import { useSignals } from './useSignals';
import { useHandles } from './useHandles';
import { registerShapeSelect, selectShapeFeature } from './shapeSelect';
import { CatalogPanel, CatalogGhost } from './catalog/CatalogPanel';
import { useCatalog } from './catalog/useCatalog';
import { setShapeSelector } from './catalog/state';
import { useTriBall } from './triball/useTriBall';
import { loadNavPrefs, saveNavPrefs, type NavPrefs } from './navPrefs';
import { loadTriPrefs, saveTriPrefs, type TriPrefs } from './triball/triballPrefs';
import { AssemblyPanel, type AsmHost, type Section as AsmSection } from './assembly/AssemblyPanel';
import { createAssemblyState } from './assembly/state';
import { DrawingWorkspace } from './drawing/DrawingWorkspace';
import { layoutHandles, layoutStyle, resetLayout } from './useLayout';
import { makeDrawingHost } from './drawing/host';
import { displayBody } from './assembly/display';
import { insertIds, isExploded } from './assembly/model';
import { viewOwner } from './treeActions';
import './tokens.css';
import './app.css';
import './toolbar.css';

const base = import.meta.env.BASE_URL;
const platform = createWebPlatform({ base });
const files = new FileManager(platform, browserKV());
/** True while a script run builds its part: nothing is autosaved meanwhile. */
let scriptRunning = false;
const autosaver = createAutosaver(browserKV(), { busy: () => store.busy.value || scriptRunning, onProblem: (r) => store.notify(t(`files.autosave.${r}`), 'warn') });
const startupAutosave: Autosave | null = (() => { const a = readAutosave(browserKV()); return worthRestoring(a) ? a : null; })();
const read = (key: string): unknown => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ } };
import { sketchTools, sketchShapes, shapeAtPoint, sketchOpenChains, nextExtrudeTarget, defaultCutRegions, withExactEdges } from '@kit/sketch';
import { defaultThickness } from './thinRules';
/** The compact vertical rail at the left edge: history, then the feature tools. Views are not here (they are on the cube and the
 *  View tab); a button only appears if its command exists. */
/** The ids a feature refers to by name in its fields (sketches, paths, sections ...): the tree tucks the sketches among them under it. */
const usedSketches = (f: unknown): string[] => {
  const out: string[] = [];
  for (const v of Object.values(f as Record<string, unknown>)) {
    for (const x of Array.isArray(v) ? v : [v]) {
      const id = typeof x === 'string' ? x : x && typeof x === 'object' ? (x as { id?: unknown }).id : undefined;   // a path is {kind:'sketch', id}
      if (typeof id === 'string' && /^[A-Za-z]+\d*$/.test(id)) out.push(id);
    }
  }
  return out;
};

const VIEW_KEYS: Record<string, 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom' | 'iso'> = { '1': 'top', '2': 'front', '3': 'right', '4': 'back', '5': 'left', '6': 'bottom', '7': 'iso' };
/** Sketch tools whose clicks pick a curve of the sketch. */
const OBJECT_SNAPS_OFF: SketchPrefs['snaps'] = Object.fromEntries(Object.keys(DEFAULT_SKETCH_PREFS.snaps).map((k) => [k, k === 'grid'])) as SketchPrefs['snaps'];
const ENTITY_PICK_TOOLS = new Set<string | null>(['offset']);
const SKETCH_TOOL_KEYS = new Map(sketchTools().flatMap((x) => (x.key ? [[x.key, x.id] as const] : [])));
const savedLocale = read('cad.locale');
const savedTheme = asTheme(read('cad.theme'));
applyTheme(savedTheme);
if (typeof savedLocale === 'string') setLocale(savedLocale);
const lookStore = createLookStore(read(LOOK_KEY));
const store = createStore((read('cad.display') as object | null) ?? {}, read('cad.workspace'));

// One kernel worker for the app; cancel() restarts it.
let kernelP: Promise<BrowserKernel> = createBrowserKernel(platform.wasmUrl());
let session: Session | null = null;
let viewport: Viewport | null = null;
const asmState = createAssemblyState();
const analysisStore = createAnalysisStore();
let lastBody: unknown = null;
/** The body as it is drawn: components hidden or moved apart in the exploded view (the kernel's body is not touched). */
const shownBody = (b: unknown): unknown => {
  const d = controller.document();
  if (!b || !d) return b;
  return displayBody(b as never, { inserts: insertIds(d as never), hidden: new Set(asmState.hidden.value), explode: asmState.explode.value }) as unknown;
};
const controller = new Controller({
  store,
  view: {
    setBody: (b) => {
      // sketches that a feature references are drawn quietly; compute them from the document
      const used = new Set<string>();
      const d = controller.document();
      const sketchIds = new Set((d?.features ?? []).filter((f) => f.type === 'sketch' || f.type === 'sketch3d').map((f) => f.id));
      for (const f of d?.features ?? []) {
        if (f.type === 'sketch' || f.type === 'sketch3d') continue;
        for (const v of Object.values(f as unknown as Record<string, unknown>)) {
          for (const x of Array.isArray(v) ? v : [v]) if (typeof x === 'string' && sketchIds.has(x)) used.add(x);
        }
      }
      viewport?.setConsumedSketches([...used]);
      lastBody = b;
      viewport?.setBody(shownBody(b) as never);
      viewport?.setBodies(controller.selModel()?.bodies() ?? []);
      const body = b as { mesh?: { faceIds: string[]; triFace: ArrayLike<number> }; surfaces?: Array<{ mesh: { faceIds: string[]; triFace: ArrayLike<number> } }> } | null;
      const sheets = body?.surfaces ?? [];   // surface bodies count with the solid's faces and triangles
      store.facts.value = {
        ...store.facts.value,
        faces: (body?.mesh?.faceIds.length ?? 0) + sheets.reduce((n, x) => n + x.mesh.faceIds.length, 0),
        triangles: (body?.mesh?.triFace.length ?? 0) + sheets.reduce((n, x) => n + x.mesh.triFace.length, 0),
      };
    },
    setHighlight: (n) => viewport?.setHighlight(n),
    setThreads: (items) => viewport?.setThreads(items as never),
    setThreadFocus: (id) => viewport?.setThreadFocus(id),
    setSketchEdit: (v) => viewport?.setSketchEdit(v as never),
  },
  kernel: {
    async open(doc: PartDoc) { session = new Session(doc, withCacheCap(await kernelP), 'user'); return session; },
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
    const hint = controller.rejection()?.summary || r.hints?.map((h) => h.hint).join('; ') || r.schemaError || 'edit failed';
    rejections.value = [...rejections.value, { at, time: Date.now(), reason: reason ?? '', hint, ops }];
  }
  return r;
};
if (import.meta.env.DEV) {
  const hook = { controller, store };                                          // for the browser console
  Object.defineProperty(hook, 'viewport', { get: () => viewport });            // created later by an effect
  Object.assign(window, { __cad: hook });
}

const timed = async <T,>(f: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  try { return await f(); } finally { store.facts.value = { ...store.facts.value, rebuildMs: Math.round(performance.now() - t0) }; }
};

function App() {
  const host = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState('Home');
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const [guard, setGuard] = useState<(() => void) | null>(null);
  const cleanSig = useRef<string | null>(null);
  const sigCache = useRef(new WeakMap<object, string>());
  const [refSel, setRefSel] = useState<string | null>(null);
  const [refHover, setRefHover] = useState<string | null>(null);
  const [ortho, setOrthoState] = useState<boolean>(() => { try { return localStorage.getItem('cad.ortho') === '1'; } catch { return false; } });
  const [leftTab, setLeftTab] = useState<'Outliner' | 'Features' | 'Editor' | 'Catalog' | 'Variables' | 'Script'>('Features');
  const [asmSection, setAsmSection] = useState<AsmSection>('parts');
  const [drawerTab, setDrawerTab] = useState('history');
  const measureRef = useRef(false);   // the Measure tool is on: picks add up instead of replacing
  const [histFilter, setHistFilter] = useState<HistoryFilter>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickingPath, setPickingPath] = useState<string | null>(null);
  const holeSketchRef = useRef(false);   // the sketch being drawn is for a hole: Point tool, and a hole is added on confirm
  const [picked, setPicked] = useState<{ path: string; value: unknown } | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [previewHint, setPreviewHintRaw] = useState<string | null>(null);
  // the live preview's failure: its cause/consequence sort, and whether it is breakage the committed model did not have
  const [previewDiag, setPreviewDiag] = useState<{ d: Diagnosis; fresh: DiagRoot[] } | null>(null);
  const setPreviewHint = (h: string | null) => { setPreviewHintRaw(h); if (h === null) setPreviewDiag(null); };
  const onPreviewResult = (r: { ok: boolean; hint?: string; diagnosis?: Diagnosis | null }) => {
    setPreviewHint(r.ok ? null : (r.hint ?? null));
    if (!r.ok && r.diagnosis?.roots.length) setPreviewDiag({ d: r.diagnosis, fresh: newBreakage(r.diagnosis, controller.diagnosis()) });
  };
  const [sketching, setSketching] = useState<{ id: string; name: string; plane?: string } | null>(null);
  const [sketchHint, setSketchHint] = useState<string | null>(null);
  // Per-sketch mode: new geometry from the draw tools is made as construction (dashed, never extruded). UI state, not saved.
  const [constructionMode, setConstructionMode] = useState(false);
  const constructionModeRef = useRef(false);
  // For the project tool: what was selected in the 3D view before the sketch opened, and the pointer's pick radius in sketch units.
  const projectSelRef = useRef<string[]>([]);
  const toolTolRef = useRef(0);
  constructionModeRef.current = constructionMode;
  // The viewport is constructed once, so its sketch callbacks read these refs
  // instead of closing over state from the render they were created in.
  const sketchMoveRef = useRef<((pointId: string, u: number, v: number) => void) | null>(null);
  const sketchConfirmRef = useRef<(() => void) | null>(null);
  const sketchingRef = useRef(false);
  const ctxMenuRef = useRef<((n: string | null, x: number, y: number, m: import('@kit/viewport').PickMode) => void) | null>(null);
  const sketchCancelRef = useRef<(() => void) | null>(null);
  // Sketch tools: the active tool, its state and its last output live in refs because the viewport and the
  // key handler are created once; the React state below only drives what is drawn.
  const [sketchToolId, setSketchToolId] = useState<string | null>(null);
  const [toolOut, setToolOut] = useState<{ fields: FieldSpec[]; x: number; y: number; pending?: string[]; snapLabel?: string; snapModel?: boolean } | null>(null);
  const dwellRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const sketchToolRef = useRef<string | null>(null);
  // Select mode: the picked entity and the size field shown beside it.
  const [entityOut, setEntityOut] = useState<{ fields: FieldSpec[]; x: number; y: number } | null>(null);
  const selEntityRef = useRef<{ kind: 'entity' | 'point'; id: string; x: number; y: number } | null>(null);
  // Hover and constraint highlights, a dimension being edited in place, and a tick that re-projects labels when the camera moves.
  const hoverRef = useRef<{ entity?: string; point?: string; constraint?: string }>({});
  const [sketchPrefs, setSketchPrefs] = useState<SketchPrefs>(loadSketchPrefs);
  const [triPrefs, setTriPrefs] = useState<TriPrefs>(loadTriPrefs);
  const [navPrefs, setNavPrefs] = useState<NavPrefs>(loadNavPrefs);
  const changeNav = (patch: Partial<NavPrefs>) => { const next = { ...navPrefs, ...patch }; setNavPrefs(next); saveNavPrefs(next); viewport?.setNavigation(next); };
  const triRef = useRef<ReturnType<typeof useTriBall> | null>(null);
  const updatePrefs = (patch: Partial<SketchPrefs>) => { const next = { ...prefsRef.current, ...patch }; setSketchPrefs(next); saveSketchPrefs(next); };
  const prefsRef = useRef(sketchPrefs);
  prefsRef.current = sketchPrefs;
  const [hotConstraint, setHotConstraint] = useState<string | null>(null);
  // a small tip beside the pointer in Select mode: the value of what is under it, and that it can be edited
  const [hoverTip, setHoverTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [dimEdit, setDimEdit] = useState<{ id: string; x: number; y: number; value: number; expr?: string } | null>(null);
  const [, viewTick] = useState(0);
  // Select mode, several entities: Ctrl or Shift click toggles, a rubber band replaces (or adds with Shift/Ctrl). The transform tools act on these.
  const multiSelRef = useRef<string[]>([]);
  const toolEntitiesRef = useRef<string[]>([]);
  const [boxRect, setBoxRect] = useState<{ x0: number; y0: number; x1: number; y1: number; crossing: boolean } | null>(null);
  const [defining, setDefining] = useState(false);
  const sketchBoxRef = useRef<((ev: import('@kit/viewport').SketchBoxEvent) => void) | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const bodyDoubleRef = useRef<((face: string) => void) | null>(null);
  const treeKeyRef = useRef<(e: KeyboardEvent, onCanvas: boolean) => boolean>(() => false);
  const sketchHoverRef = useRef<((ev: import('@kit/viewport').SketchPointerEvent) => void) | null>(null);
  const sketchDoubleRef = useRef<((ev: import('@kit/viewport').SketchPointerEvent) => void) | null>(null);
  const sketchSelectRef = useRef<((ev: import('@kit/viewport').SketchPointerEvent) => void) | null>(null);
  const toolStateRef = useRef<unknown>(null);
  const lastOutRef = useRef<ToolOutput<unknown> | null>(null);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const sketchPointerRef = useRef<((ev: import('@kit/viewport').SketchPointerEvent) => void) | null>(null);
  const sketchKeyRef = useRef<((e: KeyboardEvent) => boolean) | null>(null);
  const sketchUndoRef = useRef<(() => void) | null>(null);
  const [samples, setSamples] = useState<SampleEntry[] | null>(null);
  const [restore, setRestore] = useState<Autosave | null>(startupAutosave);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [, redraw] = useState(0);
  useSignals(() => { store.busy.value; store.hover.value; store.notices.value; store.featureStatus.value; store.featureWarnings.value; store.mode.value; store.filters.value; store.display.value; store.workspace.value; store.facts.value; store.selection.value; lookStore.look.value; lookStore.hidden.value; analysisStore.opts.value; analysisStore.legend.value; asmState.hidden.value; asmState.explode.value; rejections.value; localeSignal.value; });
  const ws = store.workspace.value;

  useEffect(() => {
    const vp = new Viewport(host.current!, {
      onPick: (names, additive) => store.select(names, additive || measureRef.current),
      onHover: (n) => { store.hover.value = n; },
      onSketchMove: (pointId, u, v) => sketchMoveRef.current?.(pointId, u, v),
      onSketchPointer: (ev) => sketchPointerRef.current?.(ev),
      onSketchSelect: (ev) => sketchSelectRef.current?.(ev),
      onSketchHover: (ev) => sketchHoverRef.current?.(ev),
      onSketchDouble: (ev) => sketchDoubleRef.current?.(ev),
      onSketchBox: (ev) => sketchBoxRef.current?.(ev),
      onSketchView: () => viewTick((n) => n + 1),
      onHoverPoint: (p) => { readout.model.value = p; },
      onPlaneCursor: (c) => { readout.cursor.value = c; if (!c) { readout.snapAt.value = null; readout.snapName.value = null; } },
      onAnalysisLegend: (l) => { analysisStore.legend.value = l; },
      onContextMenu: (n, x, y, m) => ctxMenuRef.current?.(n, x, y, m),
      onBodyDouble: (face) => bodyDoubleRef.current?.(face),
      onBoxSelect: (names, additive) => { if (!store.filters.value[MODE_FILTER[store.mode.value]]) return; store.select(names, additive); },
      onPlaneFeaturePick: (id) => { if (!store.filters.value.planes) return; setRefSel(null); store.select([]); setSelectedId(id); },
      onRefPlanePick: (id) => { if (!store.filters.value.planes) return; setRefSel(id); setSelectedId(null); store.select([]); },
    });
    viewport = vp;
    let ownerDoc: unknown = null, ownerInserts: ReadonlySet<string> = new Set();
    vp.setOwnerFn((n) => {
      const d = controller.document();
      if (d !== ownerDoc) { ownerDoc = d; ownerInserts = d ? insertIds(d as never) : new Set(); }
      return viewOwner(n, ownerInserts);
    });
    try { if (localStorage.getItem('cad.ortho') === '1') vp.setOrtho(true); } catch { /* private window */ }
    vp.setNavigation(loadNavPrefs());
    const ro = new ResizeObserver(() => vp.resize());
    ro.observe(host.current!);
    return () => { ro.disconnect(); vp.dispose(); viewport = null; };
  }, []);
  useEffect(() => { viewport?.setHighlight(store.selection.value); }, [store.selection.value]);
  // A selection made while a reference field is in the picking state lands in that field's draft.
  useEffect(() => {
    if (!pickingPath) return;
    const list = LIST_PATHS.has(pickingPath);
    const value = pickValue(pickingPath, store.selection.value, controller.bodyEdges());
    if (value !== null) { setPicked({ path: pickingPath, value }); if (!list) setPickingPath(null); }
  }, [store.selection.value, pickingPath]);
  useEffect(() => {
    const d = store.display.value;
    for (const k of Object.keys(d)) viewport?.setLayerVisible(k, d[k as DisplayLayer]);
    write('cad.display', d);
  }, [store.display.value]);
  const lk = lookStore.look.value, hid = lookStore.hidden.value;
  const partName = controller.document()?.name || 'part';
  // the part's colour: the one picked in Display > Appearance, else the material's (when "Use material colour" is on)
  const [useMatColour, setUseMatColour] = useState<boolean>(() => loadUseColour());
  const [editingMaterial, setEditingMaterial] = useState(false);
  const matColor = findMaterial(controller.document()?.material)?.color ?? null;
  const appearance = effectiveAppearance(lk, partName, appearanceOfMaterial(controller.document()?.material), useMatColour);
  // an assembly shows each component in its own material's colour and finish (and the user's override of it)
  const compParts = ((controller.document()?.features ?? []) as Array<{ type: string; id: string; suppressed?: boolean; part?: { material?: string } }>)
    .filter((f) => f.type === 'insertPart' && f.part).map((f) => ({ id: f.id, material: f.part?.material ?? null }));
  const compKey = compParts.map((c) => c.id + ':' + c.material).join('|') + '|' + JSON.stringify(lk.appearances) + '|' + useMatColour;
  useEffect(() => {
    const vp = viewport;
    if (!vp) return;
    vp.setLook({ style: lk.style, ghostOpacity: lk.ghostOpacity, appearance });
    vp.setComponentLooks(compParts.length ? componentAppearances(lk, partName, compParts, appearanceOfMaterial, useMatColour) : null);
    vp.setLighting(lk.light, lk.intensity, lk.reflections);
    vp.setEdges(lk.edgeWidth, lk.silhouette);
    vp.setBackground(lk.background);
    write(LOOK_KEY, lk);
  }, [lk, partName, appearance.color, appearance.material, compKey]);
  useEffect(() => { viewport?.setHidden({ body: hid.body, ids: hid.ids }); }, [hid]);
  // hovering a tree row tints what that feature made (soft, apart from the hover and selection colours); the reverse: the row of the face under the pointer
  const [treeHover, setTreeHover] = useState<string | null>(null);
  useEffect(() => { viewport?.setFeatureHover(treeHover ? [treeHover] : []); }, [treeHover]);
  const viewOwnerOf = (n: string): string | null => { const d = controller.document(); return d ? viewOwner(n, insertIds(d as never)) : null; };
  const compAppearances = compParts.length ? componentAppearances(lk, partName, compParts, appearanceOfMaterial, useMatColour) : new Map<string, import('@kit/viewport').Appearance>();
  const selOwner = store.selection.value.length ? viewOwnerOf(store.selection.value[0]) : null;
  const selComp = selOwner && compAppearances.has(selOwner) ? { id: selOwner, name: ((controller.document()?.features ?? []) as Array<{ id: string; name?: string }>).find((f) => f.id === selOwner)?.name ?? selOwner } : null;
  const faceHover = store.hover.value;
  const hoverRowId = !treeHover && faceHover && !sketching ? viewOwnerOf(faceHover) : null;
  const toggleHideFeature = (id: string) => {
    const h = lookStore.hidden.value;
    lookStore.hidden.value = { ...h, ids: h.ids.includes(id) ? h.ids.filter((x) => x !== id) : [...h.ids, id] };
  };
  const an = analysisStore.opts.value;
  useEffect(() => { viewport?.setAnalysis(an); }, [an]);
  // hidden components and the exploded view: only the drawn body changes; the exploded arrangement is kept with the file
  const asmHidden = asmState.hidden.value, asmExplode = asmState.explode.value;
  useEffect(() => {
    controller.setDocExtra('explode', isExploded(asmExplode) ? asmExplode : null);
    if (!viewport || !lastBody) return;
    viewport.setHoldView(true);
    try { viewport.setBody(shownBody(lastBody) as never); viewport.setHighlight([...store.selection.value]); } finally { viewport.setHoldView(false); }
  }, [asmHidden, asmExplode]);
  useEffect(() => {
    write('cad.workspace', ws);
    viewport?.setHighlightWidth(ws.lineWidth);
    const r = document.documentElement.style;
    r.setProperty('--alpha', String(ws.opacity));
    r.setProperty('--blur', `${ws.blur}px`);
    requestAnimationFrame(() => viewport?.resize());
  }, [ws]);

  /** Signature of a document, remembered per object so a render does not stringify a big part again. */
  const sigOf = (d: PartDoc | null): string | null => {
    if (!d) return null;
    let s = sigCache.current.get(d);
    if (s === undefined) { s = JSON.stringify(d); sigCache.current.set(d, s); }
    return s;
  };
  const isDirty = (): boolean => { const d = controller.document(); return !!d && cleanSig.current !== null && sigOf(d) !== cleanSig.current; };
  const markClean = () => { cleanSig.current = sigOf(controller.document()); };
  /** Run `go` now, or after the user decides what to do with unsaved changes. */
  const guarded = (go: () => void | Promise<void>) => { if (isDirty()) setGuard(() => go); else void go(); };
  /** Open a part from text. `file` is the file it came from (null for a sample or a new part); `keep` leaves the file bookkeeping alone. */
  const load = async (text: string, o: { file?: string | null; keep?: boolean; restored?: boolean } = {}) => {
    const prevSig = cleanSig.current;
    try {
      const doc = JSON.parse(text) as PartDoc;
      asmState.reset(doc);
      // While the part loads, controller.document() already changes (and a render can land in between) but the clean
      // signature is still the old part's: that read as "modified". null means "not tracked", so nothing is dirty until markClean.
      cleanSig.current = null;
      viewport?.requestFit();
      await timed(() => controller.load(doc));
      if (o.restored) cleanSig.current = '';   // a restored session was never saved to a file: it counts as changed
      else { markClean(); autosaver.clear(); }
      if (!o.keep) { files.opened(o.file ?? null); if (o.file) files.noteFile(o.file); }
      files.names.seen(doc.name);
      setEditingId(null); setEditingMaterial(false); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null); setLeftTab('Features');   // an editor left open belongs to the old part
      setSelectedId(null); setRefSel(null); store.select([]); rejections.value = []; redraw((n) => n + 1);
      store.notify(t(o.restored ? 'files.restored' : 'app.notice.opened', { name: doc.name || t('app.part.unnamed') }));
    } catch (e) { if (cleanSig.current === null) cleanSig.current = prevSig; store.notify(t('app.notice.openFailed', { message: (e as Error).message }), 'error'); }
  };
  const edit = async (ops: EditOp[]) => {
    await timed(() => controller.edit(ops));
    redraw((n) => n + 1);
  };
  const gotoStep = async (count: number) => {
    // a material change made on the way is undone with the steps (it is not in the session's history)
    for (let i = 0; i < 1000 && (session?.history().length ?? 0) > count; i++) await controller.undo();
    redraw((n) => n + 1);
  };
  const setMode = (m: SelectionMode) => {
    if (!store.filters.value[MODE_FILTER[m]]) { store.notify(t('select.filter.off'), 'warn'); return; }
    // entering Body mode keeps the bodies that hold what was selected
    if (m === 'body' && store.mode.value !== 'body') { const mdl = controller.selModel(); if (mdl && store.selection.value.length) store.select(toBodyMode(mdl, store.selection.value)); }
    store.mode.value = m; viewport?.setPickMode(m);
  };
  const [boxOn, setBoxOn] = useState(false);
  const toggleBox = () => { const on = !boxOn; setBoxOn(on); viewport?.setBoxMode(on); if (on) store.notify(t('select.box.on')); };
  const setFilter = (k: PickFilterKind, on: boolean) => {
    store.setFilter(k, on);
    // the pick mode whose type was just switched off gives way to one that is still on
    if (!on && MODE_FILTER[store.mode.value] === k) { const next = (['face', 'edge', 'vertex', 'body'] as const).find((m) => store.filters.value[MODE_FILTER[m]]); if (next) setMode(next); }
  };
  const applySelection = (r: { names: string[]; mode: SelectionMode }) => {
    if (r.mode !== store.mode.value) { store.mode.value = r.mode; viewport?.setPickMode(r.mode); }
    store.select(r.names);
  };
  const toggleProjection = () => {
    const next = !(viewport?.isOrtho() ?? ortho);
    viewport?.setOrtho(next);
    setOrthoState(next);
    try { localStorage.setItem('cad.ortho', next ? '1' : '0'); } catch { /* private window */ }
  };
  /** The Plane feature (an offset or tangent reference plane) selected in the tree or clicked in the viewport. */
  const selectedPlaneFeature = () => (selectedId ? controller.document()?.features.find((x) => x.id === selectedId && x.type === 'plane') ?? null : null);
  const planeLabel = (id: string) => { const f = controller.document()?.features.find((x) => x.id === id) as { name?: string } | undefined; return f?.name ?? id; };
  const sketchHere = () => {
    const face = selectedFace();
    const plane = refSel === 'front' || refSel === 'top' || refSel === 'right' ? refSel : null;
    const pf = selectedPlaneFeature();
    if (face) startNewSketch({ kind: 'face', id: face });
    else if (plane) startNewSketch(plane);
    else if (pf) startNewSketch({ kind: 'feature', id: pf.id });
    else store.notify(t('app.sketch.pickFirst'), 'error');
  };
  const toggleDrawer = () => store.setWorkspace({ drawerOpen: !store.workspace.value.drawerOpen });
  const check = useDesignCheck(controller, store, () => viewport, () => { setDrawerTab('check'); store.setWorkspace({ drawerOpen: true }); });
  /** What H would hide: the selected faces' body, or the selected sketch / plane / curve feature. */
  const hideTarget = () => {
    const f = selectedId ? controller.document()?.features.find((x) => x.id === selectedId) : undefined;
    return { names: store.selection.value, featureId: f?.id ?? null, featureType: f?.type ?? null, surfaceOf: (n: string) => controller.surfaceOf(n), surfaceIds: controller.surfaceBodies().map((x) => x.id), solid: controller.hasSolid() };
  };
  const hideSelected = () => {
    const before = lookStore.hidden.value;
    lookStore.hide(hideTarget());
    if (lookStore.hidden.value !== before) store.notify(t('app.look.hidden'));
  };
  const openInspect = () => { setDrawerTab('inspect'); store.setWorkspace({ drawerOpen: true }); };
  const inspect = useInspect(controller, store, () => viewport, openInspect, measureRef);
  const toggleLeftPanel = () => store.setWorkspace({ leftCollapsed: !store.workspace.value.leftCollapsed });

  const showNotices = (ns: ExportNotice[]) => { for (const n of ns) store.notify(t(n.key, n.params), n.level); };
  /** Add a DXF file's geometry to the open sketch. */
  const importDxf = async () => {
    if (!controller.sketchDraft()) { showNotices([{ level: 'error', key: 'io.dxf.noSketch' }]); return; }
    const f = await platform.openFile({ accept: ['.dxf'] });
    if (!f) return;
    const r = await importDxfIntoSketch(controller, f.text);
    showNotices(r.notices);
    if (r.ok) { viewTick((n) => n + 1); viewport?.fit(); }
  };
  /** Open a DXF file as a new sketch on the selected face or plane (front when nothing is selected). */
  const sketchFromDxf = async () => {
    const f = await platform.openFile({ accept: ['.dxf'] });
    if (f) sketchFromDxfText(f.text);
  };
  const sketchFromDxfText = (text: string) => {
    const f = { text };
    const pre = dxfToSketch(f.text);
    if (!pre.ok) { showNotices([importErrorNotice(pre.error)]); return; }
    const face = selectedFace();
    const plane = refSel === 'front' || refSel === 'top' || refSel === 'right' ? refSel : null;
    startNewSketch(face ? { kind: 'face', id: face } : plane ?? 'front', async () => {
      const r = await importDxfIntoSketch(controller, f.text);
      showNotices(r.notices);
      viewTick((n) => n + 1);
      if (r.ok) viewport?.fit();
    });
  };

  /** The sketch to export: the one being edited, else the one selected in the feature tree. */
  const sketchToExport = () => {
    const draft = controller.sketchDraft();
    if (draft) return { points: draft.points, entities: draft.entities, id: draft.id, name: draft.name };
    const f = controller.document()?.features.find((x) => x.id === selectedId);
    return f && f.type === 'sketch' ? (f as unknown as { points: Array<{ id: string; x: number; y: number }>; entities: Array<{ id: string }>; id: string; name?: string }) : null;
  };
  const canExport = (kind: ExportKind): boolean => {
    if (!controller.document()) return false;
    if (kind === 'dxf-sketch') return sketchToExport() !== null;
    return controller.bodyMesh() !== null;
  };
  const exportAs = async (kind: ExportKind) => {
    const d = controller.document();
    if (!d) return;
    try {
      let r: ExportResult;
      const mesh = controller.bodyMesh();
      if (kind === 'stl') r = exportStl(mesh, d.name, true);
      else if (kind === 'stl-ascii') r = exportStl(mesh, d.name, false);
      else if (kind === 'obj') r = exportObj(mesh, d.name);
      else if (kind === 'dxf-sketch') r = exportSketchDxf(sketchToExport(), d.name);
      else if (kind === 'dxf-views') r = exportViewsDxf(controller.bodyEdges() as Array<{ pts: number[][] }>, controller.bodyBox(), d.name);
      else {
        store.busy.value = true;
        try { r = exportStep(mesh ? await controller.exportStep() : null, d.name); } finally { store.busy.value = false; }
      }
      if (r.file) await platform.saveFile(r.file.name, r.file.data, r.file.mime);
      showNotices(r.notices);
    } catch (e) {
      showNotices([{ level: 'error', key: 'io.failed', params: { message: (e as Error).message } }]);
    }
  };

  // ---- files: save, save as, open by type, STEP, drop ----
  const finishSave = (r: Awaited<ReturnType<FileManager['save']>>) => {
    if (r.ok) { markClean(); autosaver.clear(); store.notify(t('files.saved', { file: r.file })); redraw((n) => n + 1); }
    else if (!r.cancelled) store.notify(t('files.saveFailed', { message: r.message ?? '' }), 'error');
  };
  const doSave = async (saveAs: boolean) => {
    const d = controller.document();
    if (!d) return;
    if (saveAs && files.needsNameDialog()) { setSaveAsOpen(true); return; }
    finishSave(await files.save(d, { saveAs }));
  };
  /** STEP text into a new part named after the file (view only, see files/stepImport.ts). */
  const importStepText = (text: string, file: string) => guarded(async () => {
    await load(JSON.stringify(emptyPart(partNameOf(file))), { file: null });
    const r = await controller.importStep(text, partNameOf(file));
    if (r.ok) { viewport?.fit(); store.notify(t('files.step.done', { name: file, faces: r.faces })); }
    else store.notify(t('files.step.failed', { name: file, message: r.message }), 'error');
  });
  /** A FreeCAD file becomes a new part with the mapped features; what could not be mapped is listed in a notice (see packages/fcstd). */
  const importFcstdBytes = (bytes: Uint8Array, file: string) => guarded(async () => {
    const r = await resolveEdges(await importFcstd(bytes, partNameOf(file)));   // no kernel resolver here yet: fillets / chamfers are left out and listed
    if (!r.part.features.length) { store.notify(t('files.fcstd.failed', { name: file, message: r.warnings[0]?.message ?? 'nothing to import' }), 'error'); return; }
    await load(JSON.stringify(r.part), { file: null });
    viewport?.fit();
    const total = r.steps.length + r.skipped.length;
    if (r.warnings.length) store.notify(t('files.fcstd.done', { name: file, features: r.steps.length, total, warnings: r.warnings.length, first: `${r.warnings[0].object}: ${r.warnings[0].message}` }), 'warn');
    else store.notify(t('files.fcstd.clean', { name: file, total }));
  });
  /** Open a file by what it is: a part, STEP, DXF or FreeCAD; anything else gets a notice. `bytes` reads binary files. */
  const openByKind = (name: string, read: () => Promise<string>, kind: DropKind, bytes?: () => Promise<Uint8Array>) => {
    if (kind === 'fcstd') { if (bytes) void bytes().then((b) => importFcstdBytes(b, name)); return; }
    if (kind === 'part') guarded(async () => { await load(await read(), { file: name }); });
    else if (kind === 'step') void read().then((text) => importStepText(text, name));
    else if (kind === 'dxf') void read().then((text) => { if (controller.sketchDraft()) void importDxfIntoSketch(controller, text).then((r) => { showNotices(r.notices); viewTick((n) => n + 1); if (r.ok) viewport?.fit(); }); else sketchFromDxfText(text); });
    else if (kind === 'stl') store.notify(t('files.drop.stl'), 'warn');
    else store.notify(t('files.drop.unknown', { name }), 'error');
  };
  const dropFiles = (list: File[]) => {
    const plan = planDrop(list.map((f) => f.name));
    if (plan.action === 'none') return;
    if (plan.action === 'multiple') { store.notify(t('files.drop.one'), 'warn'); return; }
    openByKind(plan.name, () => list[0].text(), plan.kind, async () => new Uint8Array(await list[0].arrayBuffer()));
  };
  const openRecent = (e: RecentEntry) => {
    setSamples(null);
    if (e.kind === 'sample') { guarded(async () => { const r = await fetch(e.url ?? ''); await load(await r.text(), { file: null }); files.noteSample(e.id, e.name, e.url ?? ''); }); return; }
    guarded(async () => {
      const r = await files.reopen(e);
      if (r.ok) await load(r.text, { keep: true });
      else store.notify(t(r.reason === 'noHandle' ? 'files.recent.noHandle' : r.reason === 'denied' ? 'files.recent.denied' : 'files.recent.gone', { name: e.name }), 'warn');
    });
  };

  // A thread on each selected cylindrical face (one edit, so one undo step), the size nearest to the first face's diameter, then the Thread editor opens on them.
  const addThread = async (faces: string[]) => {
    // a face that is a copy made by a pattern already carries the thread of its source: edit that one instead of adding another
    const followed = followedFaces(faces, controller.threadsNow() as ThreadEntry[]);
    const copies = Object.keys(followed);
    if (copies.length) {
      const src = followed[copies[0]];
      store.notify(t('app.thread.followed', { face: copies[0], id: src }), 'info');
      faces = faces.filter((f) => !followed[f]);
      if (!faces.length) { startEditing(src); return; }
    }
    const cyls = cylindersOfFaces(faces, controller.bodyEdges());
    const rows = await controller.threadSizes('metric').catch(() => []);
    const ops = cyls && rows.length ? threadOpsForFaces(cyls, rows) : null;
    if (!ops) { store.notify(t('app.thread.noTable'), 'error'); return; }
    await createFeature(ops);
  };
  const ti = useTreeInteraction({ controller, store, viewport: () => viewport, selectedId, setSelectedId, setRefSel, redraw: () => redraw((n) => n + 1), edit, startEditing: (id) => startEditing(id) });
  bodyDoubleRef.current = ti.onBodyDouble;
  treeKeyRef.current = (e, onCanvas) => treeKey(e, ti.actions, onCanvas);
  const featureActions: FeatureActions = {
    context: () => ({ doc: controller.document(), selection: store.selection.value, mode: store.mode.value, box: controller.bodyBox(), edges: controller.bodyEdges(), selectedId, selectedIds: ti.actions.selected(), refPlane: refSel }),
    create: (ops) => void createFeature(ops),
    holeOnFace: (face) => { holeSketchRef.current = true; startNewSketch({ kind: 'face', id: face }); },
    holeFlip: (sketchId) => controller.extrudeFlip(sketchId, 'cut'),
    addThread: (faces) => void addThread(faces),
    select: (names) => store.select(names),
    notify: (text, level) => store.notify(text, level),
  };
  const commands = buildCommands({
    catalog: () => showCatalog(),
    variables: () => showVariables(),
    script: () => showScript(),
    open: async () => { const f = await platform.openFile({ accept: ['.ckpart', '.json', '.step', '.stp', '.dxf', '.fcstd'] }); if (f) openByKind(f.name, async () => f.text, dropKind(f.name), async () => f.bytes ?? new Uint8Array()); },
    save: () => doSave(false),
    files: {
      saveAs: () => void doSave(true),
      importStep: () => void (async () => { const f = await platform.openFile({ accept: ['.step', '.stp'] }); if (f) openByKind(f.name, async () => f.text, dropKind(f.name) === 'step' ? 'step' : 'unknown'); })(),
    },
    samples: async () => setSamples(await platform.listSamples()),
    undo: async () => { await controller.undo(); redraw((n) => n + 1); },
    redo: async () => { await controller.redo(); redraw((n) => n + 1); },
    palette: () => setPalette(true),
    toggleDrawer,
    resetLayout: () => resetLayout(store),
    sketchHere,
    toggleProjection,
    toggleUpAxis: () => changeNav({ upAxis: navPrefs.upAxis === 'y' ? 'z' : 'y' }),
    toggleLeftPanel,
    settings: () => setSettings(true),
    hasDocument: () => controller.document() !== null,
    newPart: async () => guarded(async () => { await load(JSON.stringify(emptyPart(files.names.next()))); setRefSel(null); }),
    newSketch: (plane) => startNewSketch(plane),
    sketchOnFace: () => { const f = selectedFace(); if (f) startNewSketch({ kind: 'face', id: f }); },
    hasFaceSelection: () => selectedFace() !== null,
    addExtrude: (op, thin) => void addExtrude(op, thin),
    features: featureActions,
    inspect: {
      toggleMeasure: () => inspect.toggleMeasure(), isMeasuring: () => inspect.measuring,
      massProps: () => { openInspect(); void inspect.runMass(); }, interference: () => { openInspect(); void inspect.runInterference(); },
      toggleSection: inspect.toggleSection, isSectioned: () => inspect.sectionOn, hasSolid: () => controller.bodyBox() !== null,
    },
    assembly: {
      open: (sec) => showAssembly(sec), hasDocument: () => controller.document() !== null,
      isExploded: () => isExploded(asmState.explode.value), hasComponents: () => (controller.document()?.features ?? []).some((f) => f.type === 'insertPart'),
    },
    tree: ti.actions,
    io: { importDxf: () => void importDxf(), sketchFromDxf: () => void sketchFromDxf(), isSketching: () => sketchingRef.current, exportAs: (k) => void exportAs(k), openExportMenu: () => setExportOpen(true), canExport },
    setView: (v) => viewport?.setView(v),
    fit: () => viewport?.fit(),
    setMode: (m) => setMode(m),
    select: {
      model: () => controller.selModel(), selection: () => store.selection.value, mode: () => store.mode.value, hasDocument: () => controller.document() !== null,
      apply: applySelection, clear: () => store.select([]), setMode: (m) => setMode(m), box: { isOn: () => boxOn, toggle: toggleBox },
      notify: (text, level) => store.notify(text, level ?? 'info'),
    },
    selectBody: () => { store.mode.value = 'face'; viewport?.setPickMode('face'); store.select([BODY]); },
    triball: { toggle: () => triRef.current?.toggle(), isOn: () => triRef.current?.on ?? false, canToggle: () => triRef.current?.canToggle() ?? false },
    mode: () => store.mode.value,
    toggleLayer: (l) => store.setDisplay(l, !store.display.value[l]),
    layer: (l) => store.display.value[l],
    analysis: {
      mode: () => analysisStore.opts.value.mode, toggleMode: (m) => analysisStore.toggleMode(m),
      comb: () => analysisStore.opts.value.comb, toggleComb: () => analysisStore.toggleComb(),
      hasBody: () => !!controller.bodyBox(),
    },
    look: {
      style: () => lookStore.look.value.style, setStyle: (style) => lookStore.set({ style }),
      light: () => lookStore.look.value.light, setLight: (light) => lookStore.set({ light }),
      background: () => lookStore.look.value.background, setBackground: (background) => lookStore.set({ background }),
      hideSelection: hideSelected, canHide: () => hideTarget().names.length > 0 || !!hideTarget().featureId,
      showAll: () => lookStore.showAll(), anyHidden: () => anyHidden(lookStore.hidden.value),
    },
  });

  const dropFilesRef = useRef(dropFiles);
  dropFilesRef.current = dropFiles;
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const onCanvas = !t || t === document.body || !!t.closest?.('#vp');
      if (treeKeyRef.current(e, onCanvas)) { e.preventDefault(); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey && sketchingRef.current && sketchUndoRef.current) { e.preventDefault(); sketchUndoRef.current(); return; }
      // the common commands' keys (not while a sketch tool owns the letters, except Ctrl combinations)
      if (!sketchingRef.current || e.metaKey || e.ctrlKey) {
        const hit = matchShortcut(commandsRef.current, e);
        if (hit && (hit.enabled?.() ?? true)) { e.preventDefault(); hit.run(); return; }
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A') && sketchingRef.current && sketchKeyRef.current?.(e)) return;   // select all in a sketch
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (sketchKeyRef.current?.(e)) return;
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setPalette(true); }
      else if (e.key === '\\') { e.preventDefault(); toggleDrawer(); }
      else if (e.key === '[') { e.preventDefault(); toggleLeftPanel(); }
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

  const hoverLabel = (n: string | null) => (n && isBodyName(n) ? chipsOf([n], controller.selModel())[0].label : n);
  const selModelNow = store.selection.value.length ? controller.selModel() : null;
  const selText = selModelNow ? summaryText(summarize(selModelNow, store.selection.value)) : '';
  const doc = controller.document();
  const wireFeatures = (doc?.features ?? []) as unknown as Array<Record<string, unknown>>;
  const threadUnder = doc ? threadParents(wireFeatures) : {};
  const patterned = doc ? patternedBy(wireFeatures) : {};
  const rows = doc ? doc.features.map((f) => ({ id: f.id, type: f.type, name: f.name, op: f.type === 'sketch' && isPointSketch(f as never) ? 'point' : (f as { op?: string }).op, suppressed: (f as { suppressed?: boolean }).suppressed, uses: usedSketches(f), under: threadUnder[f.id], note: patterned[f.id] ? t('tree.patternedBy', { id: patterned[f.id].join(', ') }) : undefined })) : [];
  const feature = doc && selectedId ? (doc.features.find((f) => f.id === selectedId) as unknown as Record<string, unknown> | undefined) ?? null : null;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const records = session?.history() ?? [];
  const entries = toEntries(records, rejections.value);
  const failures = store.featureStatus.value.filter((s) => !s.ok);
  const facts = store.facts.value;

  const editShapes = (() => {
    const ef = editingId && doc ? doc.features.find((f) => f.id === editingId) as unknown as { type?: string; sketch?: string } | undefined : undefined;
    if (!ef || (ef.type !== 'extrude' && ef.type !== 'revolve') || !ef.sketch) return [];
    const sk = doc!.features.find((f) => f.id === ef.sketch);
    const all = sketchShapes(sk as never);
    // a thin wall can be made of open curves too: they are listed after the closed shapes
    const chains = thinOf({ ...ef, ...draft } as Record<string, unknown>) ? sketchOpenChains(sk as never).map((c, i) => ({ id: c.id, label: t('app.shape.chain', { n: i + 1, count: c.entityIds.length }) })) : [];
    return [...all.map((sh, i) => {
      const parent = all.find((o) => o.id === sh.inside);
      const holes = all.filter((o) => o.inside === sh.id);
      // the projected-outline-plus-offset sketch gets plain names; other nestings say which shape they wrap or sit in
      const label = parent?.reference ? t('app.shape.insideOffset')
        : sh.reference && holes.length && !holes.every((h) => h.reference) ? t('app.shape.wall')
        : parent ? t('app.shape.insideShape', { m: all.indexOf(parent) + 1 })
        : holes.length ? t('app.shape.withHole', { n: i + 1, m: all.indexOf(holes[0]) + 1 })
        : t('app.shape.' + sh.kind, { n: i + 1, d: Math.round(sh.radius * 2 * 100) / 100, count: sh.entityIds.length });
      return { id: sh.id, label };
    }), ...chains];
  })();
  const editingFeature = editingId && doc ? (doc.features.find((f) => f.id === editingId) as unknown as Record<string, unknown> | undefined) ?? null : null;
  // An Extrude / Cut / Revolve of an open sketch (no thin wall): the editor shows a hint card with three ways out instead of the kernel's dead-end error.
  const openCard = editingFeature && (editingFeature.type === 'extrude' || editingFeature.type === 'revolve') && !thinOf({ ...editingFeature, ...draft })
    ? openProfile(doc, editingFeature.sketch) : null;
  useEffect(() => {
    const g = openCard?.gap;
    viewport?.highlightSketchGap(g && openCard ? openCard.sketchId : null, g?.a, g?.b);
    return () => viewport?.highlightSketchGap(null);
  }, [openCard?.sketchId, openCard?.gap?.a[0], openCard?.gap?.a[1], openCard?.gap?.b[0], openCard?.gap?.b[1], editingId]);
  // Click the shaded region of the sketch in the viewport to choose what an Extrude / Revolve uses (the same toggle as the Shapes list);
  // pointing at one lights its outline. The ref holds the current draft, so the hook installed below never goes stale.
  const regionRef = useRef<{ move(u: number, v: number | null): void; tap(u: number, v: number): boolean } | null>(null);
  regionRef.current = {
    move: (u, v) => {
      const ef = editingFeature as { sketch?: string } | null;
      const sk = ef?.sketch ? doc?.features.find((f) => f.id === ef.sketch) : null;
      const sh = v !== null && sk ? shapeAtPoint(sk as never, sketchShapes(sk as never), u, v) : null;
      viewport?.highlightSketchEntities(sh ? ef!.sketch! : null, sh?.entityIds ?? []);
    },
    tap: (u, v) => {
      const ef = editingFeature as { sketch?: string; regions?: string[] } | null;
      const sk = ef?.sketch ? doc?.features.find((f) => f.id === ef.sketch) : null;
      if (!ef || !sk || editShapes.length < 2) return false;
      const sh = shapeAtPoint(sk as never, sketchShapes(sk as never), u, v);
      if (!sh || !editShapes.some((x) => x.id === sh.id)) return false;
      const cur = (draft.regions !== undefined ? draft.regions : ef.regions) as string[] | null | undefined;
      const checked = new Set(Array.isArray(cur) ? editShapes.filter((x) => cur.includes(x.id)).map((x) => x.id) : editShapes.map((x) => x.id));
      if (checked.has(sh.id)) checked.delete(sh.id); else checked.add(sh.id);
      if (!checked.size) return true;   // at least one stays
      setPicked({ path: 'regions', value: checked.size === editShapes.length ? null : editShapes.filter((x) => checked.has(x.id)).map((x) => x.id) });
      return true;
    },
  };
  const regionFrame = editShapes.length > 1 && editingFeature?.sketch ? controller.sketchFrameOf(String(editingFeature.sketch)) : null;
  useEffect(() => {
    if (!regionFrame) return;
    viewport?.setRegionPicker({ frame: regionFrame as never, move: (u, v) => regionRef.current?.move(u, v), tap: (u, v) => regionRef.current?.tap(u, v) ?? false });
    return () => { viewport?.setRegionPicker(null); viewport?.highlightSketchEntities(null, []); };
  }, [viewport, editingId, !!regionFrame]);
  const thinActions = {
    closeWithLine: (sketchId: string) => {
      const op = closeWithLineOp(doc, sketchId);
      if (op) void timed(() => controller.commit([op], 'closeProfile')).then(() => { redraw((n) => n + 1); if (editingId) { const ops = opsFromDraft(draft); if (ops.length) void controller.preview(ops).then((r) => setPreviewHint(r.ok ? null : (r.hint ?? null))); } });
    },
    asSurface: () => {
      if (!editingFeature) return;
      void timed(() => controller.commit([asSurfaceOp({ ...editingFeature, ...draft })], 'surfaceExtrude')).then(() => { setDraft({}); setPreviewHint(null); redraw((n) => n + 1); });
    },
  };
  const opsOne = (f: Record<string, unknown>, id: string, next: Record<string, unknown>): EditOp[] => {
    // `regions: null` means every shape again: the field is dropped, which a plain `set` cannot do
    // (the Hole editor uses the same null-means-remove rule for fields such as a plain `diameter`)
    if (Object.values(next).some((v) => v === null)) {
      const feature = { ...f, ...next } as Record<string, unknown>;
      for (const k of Object.keys(next)) if (next[k] === null) delete feature[k];
      return JSON.stringify(feature) === JSON.stringify(f) ? [] : [{ op: 'replace' as const, id, feature }];
    }
    return Object.entries(next)
      .filter(([path, value]) => f[path] !== value)
      .map(([path, value]) => ({ op: 'set' as const, id, path, value }));
  };
  // Threads made together (one Shift+T on several faces) are edited together: the draft goes to each of them. The group is read once per editor.
  const groupRef = useRef<{ id: string; ids: string[] } | null>(null);
  if (editingFeature?.type !== 'thread') groupRef.current = null;
  else if (groupRef.current?.id !== editingId) groupRef.current = { id: editingId!, ids: threadGroup((doc?.features ?? []) as unknown as Array<Record<string, unknown>>, editingId!) };
  const groupIds = groupRef.current?.ids ?? (editingId ? [editingId] : []);
  // A hole's threads (one per position) follow the hole editor's draft: added, replaced or removed with the hole's own ops.
  const holeWalls = editingFeature?.type === 'hole' && editingId ? holeWallFaces(editingId, controller.bodyEdges()) : [];
  const holeLinked = editingFeature?.type === 'hole' && editingId ? linkedThreads((doc?.features ?? []) as unknown as Array<Record<string, unknown>>, editingId) : [];
  const opsFromDraft = (next: Record<string, unknown>, thread?: HoleThread | null): EditOp[] => {
    if (!editingFeature) return [];
    const feats = (doc?.features ?? []) as unknown as Array<Record<string, unknown>>;
    const ops = editingFeature.type === 'thread' && groupIds.length > 1
      ? groupIds.flatMap((id) => { const f = feats.find((x) => x.id === id); return f ? opsOne(f, id, next) : []; })
      : opsOne(editingFeature, editingId!, next);
    return thread !== undefined && editingFeature.type === 'hole' ? [...ops, ...holeThreadEditOps(editingId!, holeLinked, thread, holeWalls)] : ops;
  };
  const onDraft = (next: Record<string, unknown>, thread?: HoleThread | null) => {
    setDraft(next);
    const ops = opsFromDraft(next, thread);
    if (!ops.length) return;
    void controller.preview(ops).then(onPreviewResult);
  };
  const onConfirm = async (next: Record<string, unknown>, thread?: HoleThread | null) => {
    viewport?.highlightSketchEntities(null, []);
    const ops = opsFromDraft(next, thread);
    if (ops.length) {
      const r = await timed(() => controller.commit(ops));
      if (!r.ok) {
        // refused: the editor stays open on the same draft with the structured error and its hint (nothing is reverted or discarded silently)
        const rej = controller.rejection();
        setPreviewHint(rej?.summary ?? (r.hints?.map((h) => h.hint).join('; ') || (r as { schemaError?: string }).schemaError || 'edit failed'));
        if (rej) setPreviewDiag({ d: rej.diagnosis, fresh: newBreakage(rej.diagnosis, controller.diagnosis()) });
        redraw((n) => n + 1);
        return;
      }
    }
    setEditingId(null); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
    if (editingId) setSelectedId(editingId);
    setLeftTab('Features');   // back to the history tree, with the feature you just edited selected
    redraw((n) => n + 1);
  };
  const selectFailed = (id: string) => { setSelectedId(id); if (!editingId) setLeftTab('Features'); };
  const onCancel = async () => {
    viewport?.highlightSketchEntities(null, []);
    await controller.cancelPreview();
    setEditingId(null); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
    setLeftTab('Features');
    redraw((n) => n + 1);
  };

  // The Thread editor on the part: the threaded face lit, its length range bracketed, a length handle at the far end.
  // The face geometry is read once per editor (a modeled preview rebuilds the wall, which would change the reading).
  const threadFace = editingFeature?.type === 'thread' ? String(editingFeature.face ?? '') : '';
  const threadGeom = useRef<{ id: string; cyl: ReturnType<typeof cylinderOfFace>; ext: ReturnType<typeof faceExtent> } | null>(null);
  if (!threadFace) threadGeom.current = null;
  else if (threadGeom.current?.id !== editingId || (!threadGeom.current.cyl && controller.bodyEdges().length)) {
    const edges = controller.bodyEdges();
    threadGeom.current = { id: editingId!, cyl: cylinderOfFace(threadFace, edges), ext: faceExtent(threadFace, edges, controller.bodyFaces()) };
  }
  const threadCyl = threadGeom.current?.cyl ?? null;
  const threadExtent = threadGeom.current?.ext ?? null;
  const threadInternal = (controller.threadsNow() as Array<{ id?: string; internal?: boolean }>).find((x) => x.id === editingId)?.internal ?? (isHoleWall(threadFace) ? true : threadCyl?.internal);
  const threadEntry = threadFace ? (controller.threadsShown() as ThreadEntryLike[]).find((x) => x.id === editingId) : undefined;
  const [handleInject, setHandleInject] = useState<{ seq: number; patch: Record<string, unknown> } | null>(null);
  useEffect(() => { viewport?.setHighlight([...new Set([...store.selection.value, ...(threadFace ? [threadFace] : [])])]); }, [threadFace, store.selection.value]);
  useEffect(() => { viewport?.setThreadFocus(threadFace ? editingId : null); return () => viewport?.setThreadFocus(null); }, [threadFace, editingId]);
  // The move / rotate ball (F10): see triball/useTriBall.tsx and docs/triball.md. While it is on, the contextual handles step aside.
  const tri = useTriBall({
    controller, store, viewport: () => viewport, selectedFeature: selectedId,
    commit: async (ops) => { const r = await timed(() => controller.commit(ops)); redraw((n) => n + 1); return r.ok; },
    editingId, sketching: !!sketching, prefs: triPrefs, onPrefs: setTriPrefs,
  });
  triRef.current = tri;
  // Contextual handles (arrows and dots on the selection) and the right-click menu: see useHandles.tsx and docs/contextual-handles.md
  const handles = useHandles({
    controller, store, viewport: () => viewport, commands,
    create: (ops) => createFeature(ops),
    commitInPlace: async (ops) => { const r = await timed(() => controller.commit(ops)); if (r && !r.ok) await controller.cancelPreview(); redraw((n) => n + 1); },
    editingId, selectedId, sketching: !!sketching, enabled: ws.handles && !tri.on,
    thread: threadEntry && editingId ? { id: editingId, entry: threadEntry, maxLength: threadExtent?.length ?? null, ops: (length) => opsFromDraft({ ...draft, length }) } : null,
    onDraftPatch: (patch) => setHandleInject((x) => ({ seq: (x?.seq ?? 0) + 1, patch })),
    restorePreview: () => { if (editingId) { const ops = opsFromDraft(draft); if (ops.length) void controller.preview(ops); } },
  });
  ctxMenuRef.current = handles.onContextMenu;
  // selectShapeFeature(id) (shapeSelect.ts): the catalog drop and commands select a shape so its size box shows at once
  useEffect(() => registerShapeSelect((id) => {
    store.select([]); setRefSel(null);
    setEditingId(null); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
    setSelectedId(id); setLeftTab('Features'); redraw((n) => n + 1);
  }), []);

  const openMaterial = () => {
    if (!doc) return;
    if (editingId) void onCancel();
    setEditingMaterial(true);
    if (store.workspace.value.leftTabs) setLeftTab('Editor');
  };
  const closeMaterial = () => { setEditingMaterial(false); setLeftTab('Features'); };
  const applyMaterial = (c: MaterialChoice) => {
    setUseMatColour(c.useColour);
    if (controller.setMaterial(c.name)) store.notify(t('material.changed', { name: c.name }));
    closeMaterial(); redraw((n) => n + 1);
  };
  const startEditing = (id: string) => {
    // a thread copy made by a pattern is read-only: its source thread is the one to edit, and every copy follows
    const copy = id.includes('@') ? (controller.threadsNow() as ThreadEntry[]).find((x) => x.id === id) : undefined;
    if (copy?.instanceOf && doc?.features.some((x) => x.id === copy.instanceOf)) { store.notify(t('app.thread.followed', { face: copy.face ?? id, id: copy.instanceOf }), 'info'); id = copy.instanceOf; }
    setEditingMaterial(false);
    setSelectedId(id);
    const f = doc?.features.find((x) => x.id === id) as { type?: string; name?: string } | undefined;
    const gear = gearOwner((controller.document()?.features ?? []) as unknown[], id);
    if (gear) {   // any feature a gear made opens the Gear editor on its parameters
      setSelectedId(gear.profileId); setEditingId(gear.profileId);
      setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
      setLeftTab('Editor');
      return;
    }
    if (f?.type === 'sketch') {
      setEditingId(null); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
      setSketchHint(null);
      void (async () => {
        const view = await controller.beginSketch(id);
        if (!view) { store.notify(t('app.sketch.failed'), 'error'); return; }
        setSketching({ id, name: f.name ?? id });
        if (!prefsRef.current.keepView) viewport?.orientToSketch();   // the setting 'keep view when entering a sketch' (default on)
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
    // entities picked in Select mode go to the tool (move, copy, rotate, scale, patterns) and the selection itself is let go
    toolEntitiesRef.current = id ? selectedEntityIds() : [];
    if (id) { selEntityRef.current = null; multiSelRef.current = []; setEntityOut(null); }
    if (dwellRef.current.timer) { clearTimeout(dwellRef.current.timer); dwellRef.current.timer = null; }
    dwellRef.current.fired = false;
    sketchToolRef.current = entry ? entry.id : null;
    toolStateRef.current = entry ? entry.tool.start() : null;
    lastOutRef.current = null;
    setSketchToolId(entry ? entry.id : null);
    setToolOut(null);
    viewport?.setSketchTool(!!entry);
    readout.snapAt.value = null; readout.snapName.value = null; readout.from.value = null;
    if (!entry) { viewport?.setSketchPreview([]); applyHighlight(); }
    // Offset chosen while the sketch is on a face: offer that face's outline offset inward right away
    else if (entry.id === 'offset' && projectSelRef.current.length) runTool({ type: 'key', key: OFFSET_FACE_KEY });
    else if (toolEntitiesRef.current.length) runTool({ type: 'move', at: { x: 0, y: 0 }, mods: { shift: false, ctrl: false, alt: false } });   // lets a tool that acts on a selection take it up at once
  };
  /** What the pointer is snapped to, drawn as markers and dotted guides, plus the ring on the chain end. */
  const snapVisuals = (draft: import('@kit/sketch').SketchDraft, snap: SnapHit | undefined, out: ToolOutput<unknown>): SketchPreviewShape[] => {
    const shapes: SketchPreviewShape[] = [];
    const style = markerStyleFor(snap);
    if (snap && style && snap.kind !== 'align') {
      // the glyph says what the point is (see snapMarks.ts); model snaps use the same glyphs in the model colour, with a dashed guide through the body
      shapes.push({ kind: 'marker', at: snap.at, style, ...(snap.model ? { model: true } : {}) });
      if (snap.model && snap.guide) shapes.push({ kind: 'guide', a: snap.guide.a, b: snap.guide.b, model: true });
    }
    else if (snap?.kind === 'align') {
      shapes.push({ kind: 'marker', at: snap.at, style: 'align' });
      for (const id of [snap.alignTo?.x, snap.alignTo?.y]) {
        const src = id ? draft.points.find((p) => p.id === id) : undefined;
        if (src) { shapes.push({ kind: 'marker', at: { x: src.x, y: src.y }, style: 'align' }); shapes.push({ kind: 'guide', a: { x: src.x, y: src.y }, b: snap.at }); }
      }
    }
    if (out.anchor) shapes.push({ kind: 'marker', at: out.anchor, style: 'anchor' });
    // an inferred horizontal or vertical: a dotted guide through the start of the segment, running past both ends
    const seg = out.preview[0];
    if (out.from && seg && seg.kind === 'line' && out.pending?.some((p) => p === 'horizontal' || p === 'vertical')) {
      const f = out.from, e = seg.b;
      shapes.push({ kind: 'guide', a: { x: f.x - (e.x - f.x) * 0.6, y: f.y - (e.y - f.y) * 0.6 }, b: { x: f.x + (e.x - f.x) * 2.5, y: f.y + (e.y - f.y) * 2.5 } });
    }
    return shapes;
  };
  const runTool = (ev: ToolEvent) => {
    const entry = sketchToolRef.current ? toolById(sketchToolRef.current) : undefined;
    const draft = controller.sketchDraft();
    if (!entry || !draft) return;
    const snap = ev.type === 'move' || ev.type === 'click' ? ev.snap : undefined;
    const frame = controller.sketchFrame();
    const plainEdges: import('@kit/sketch').BodyEdge[] = controller.bodyEdges().flatMap((e) => (e.pts && e.pts.length >= 2 ? [{ key: e.key, faces: e.faces, pts: e.pts }] : []));
    // an edge that is the wall of an extruded sketch spline projects as that spline itself, not a fit through its tessellation
    const edges = withExactEdges(plainEdges, (controller.document()?.features ?? []) as never, (id) => controller.sketchFrameOf(id));
    // curves of the other (consumed) sketches are reference edges too
    const refEdges = sketchReferenceEdges((controller.document()?.features ?? []) as never, (id) => controller.sketchFrameOf(id), draft.id, edges);
    edges.push(...refEdges);
    const env: ToolEnv = { ...(frame ? { body: { frame, edges } } : {}), tol: toolTolRef.current, selection: projectSelRef.current, entities: toolEntitiesRef.current };
    const out = entry.tool.step(toolStateRef.current, ev, draft, toToolSettings(prefsRef.current), env);
    // a click that snapped to a midpoint or an alignment makes that a real constraint, so it survives later edits
    if (ev.type === 'click' && out.draft !== draft && prefsRef.current.autoConstraints && prefsRef.current.guideConstraints && !ev.mods.shift) out.draft = applySnapConstraints(draft, out.draft, snap);
    // Shift+click on a model point attaches the new point to the model (a fixed reference point there); without Shift it only positions it
    if (ev.type === 'click' && out.draft !== draft && ev.mods.shift && snap?.model) out.draft = attachModelSnap(draft, out.draft, snap);
    if (out.draft !== draft && constructionModeRef.current && entry.group === 'draw') out.draft = markNewAsConstruction(draft, out.draft);
    toolStateRef.current = out.state;
    lastOutRef.current = out;
    viewport?.setSketchPreview([...(out.preview as SketchPreviewShape[]), ...snapVisuals(draft, snap, out)]);
    readout.snapAt.value = snap ? snap.at : null;
    readout.snapName.value = snap && snap.kind !== 'grid' ? t('app.sketch.snap.' + (snap.model ?? (snap.kind === 'point' ? snap.role ?? 'point' : snap.kind))) : snap ? t('app.sketch.snap.grid') : null;
    readout.from.value = out.from ?? out.anchor ?? null;
    setToolOut({ fields: out.fields, x: lastPosRef.current.x, y: lastPosRef.current.y, pending: out.pending, snapLabel: snap ? t('app.sketch.snap.' + (snap.model ?? (snap.kind === 'point' ? snap.role ?? 'point' : snap.kind))) : undefined, snapModel: !!snap?.model });
    if (out.hint) setSketchHint(t(out.hint));
    if (out.draft !== draft) {
      if (['move', 'copy', 'rotate', 'scale'].includes(entry.id)) toolEntitiesRef.current = [];   // done: the next run picks again
      const before = new Set(draft.constraints.map((c) => c.id));
      void controller.applySketchDraft(out.draft).then((r) => {
        setSketchHint(r.ok || r.stale ? (out.hint ? t(out.hint) : null) : (r.hint ? t(r.hint) : null));
        viewTick((n) => n + 1);   // the solver's answer (degrees of freedom, constraint list) arrives after the tool's own redraw
        if (r.ok && !r.stale) settleDimensions(before, r.status);
      });
    }
  };
  /** Draw the highlights: the selected item, what the pointer is over, and what a hovered constraint refers to. */
  const applyHighlight = () => {
    const draft = controller.sketchDraft();
    if (!draft) { viewport?.setSketchPreview([]); return; }
    const shapes: SketchPreviewShape[] = [];
    const sel = selEntityRef.current;
    const h = hoverRef.current;
    const entities = new Set<string>();
    const points = new Set<string>();
    if (sel?.kind === 'entity') entities.add(sel.id);
    for (const id of multiSelRef.current) entities.add(id);
    if (sel?.kind === 'point') points.add(sel.id);
    if (h.entity) entities.add(h.entity);
    if (h.point) points.add(h.point);
    if (h.constraint) {
      const targets = constraintTargets(draft, h.constraint);
      targets.entities.forEach((e) => entities.add(e));
      targets.points.forEach((p) => points.add(p));
    }
    for (const id of entities) shapes.push(...(entityShape(draft, id) as SketchPreviewShape[]));
    for (const id of points) {
      const p = draft.points.find((q) => q.id === id);
      if (p) shapes.push({ kind: 'marker', at: { x: p.x, y: p.y }, style: 'point' });
    }
    viewport?.setSketchPreview(shapes);
  };
  /** Pick (or clear) what is under a click in Select mode: highlight it and offer its size or position as editable fields. */
  const selectItem = (kind: 'entity' | 'point', id: string | null, x: number, y: number, focus = false) => {
    const draft = controller.sketchDraft();
    if (!id || !draft) {
      selEntityRef.current = null;
      setEntityOut(null);
      applyHighlight();
      return;
    }
    selEntityRef.current = { kind, id, x, y };
    applyHighlight();
    setEntityOut({ fields: kind === 'entity' ? entityDims(draft, id) : pointDims(draft, id), x, y });
    if (focus) setTimeout(() => { const f = document.querySelector<HTMLInputElement>('.sketch-fields input'); f?.focus(); f?.select(); }, 30);
  };
  const selectEntity = (id: string | null, x: number, y: number, focus = false) => selectItem('entity', id, x, y, focus);
  sketchSelectRef.current = (ev) => {
    if (sketchToolRef.current) return;
    const draft = controller.sketchDraft();
    if (!draft) return;
    setDimEdit(null);
    setHoverTip(null);
    const id = pickEntity(draft, { x: ev.u, y: ev.v }, ev.tol);
    if (ev.mods.ctrl || ev.mods.shift) {
      // add to / take from the selection; a single entity already picked joins it
      const cur = selectedEntityIds();
      const next = id ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : cur;
      setMultiSelection(next);
      return;
    }
    multiSelRef.current = [];
    selectEntity(id, ev.x, ev.y);
    viewTick((n) => n + 1);
  };
  /** The entities selected in Select mode: the several of a box or Ctrl click, else the one picked. */
  function selectedEntityIds(): string[] {
    const sel = selEntityRef.current;
    if (multiSelRef.current.length) return [...multiSelRef.current];
    return sel?.kind === 'entity' ? [sel.id] : [];
  }
  /** Replace the selection with these entities: one behaves like a click (size field), several are just highlighted. */
  function setMultiSelection(ids: string[]) {
    if (ids.length <= 1) { multiSelRef.current = []; selEntityRef.current = null; setEntityOut(null); if (ids[0]) selectEntity(ids[0], lastPosRef.current.x, lastPosRef.current.y); else applyHighlight(); viewTick((n) => n + 1); return; }
    selEntityRef.current = null;
    setEntityOut(null);
    multiSelRef.current = ids;
    applyHighlight();
    viewTick((n) => n + 1);
  }
  sketchBoxRef.current = (ev) => {
    if (ev.phase === 'move') { setBoxRect({ x0: ev.x0, y0: ev.y0, x1: ev.x1, y1: ev.y1, crossing: ev.crossing }); return; }
    setBoxRect(null);
    const draft = controller.sketchDraft();
    if (ev.phase !== 'end' || !draft) return;
    const hit = boxSelect(draft, { x0: ev.u0, y0: ev.v0, x1: ev.u1, y1: ev.v1 }, ev.crossing ? 'crossing' : 'window');
    const merged = ev.mods.shift || ev.mods.ctrl ? [...new Set([...selectedEntityIds(), ...hit])] : hit;
    setDimEdit(null); setHoverTip(null);
    setMultiSelection(merged);
  };
  sketchHoverRef.current = (ev) => {
    if (sketchToolRef.current) return;
    const draft = controller.sketchDraft();
    if (!draft) return;
    const at = { x: ev.u, y: ev.v };
    const pt = snapAt(draft, at, { tolerance: ev.tol, midpoints: false, align: false });
    const next = pt?.pointId ? { point: pt.pointId } : { entity: pickEntity(draft, at, ev.tol) ?? undefined };
    const cur = hoverRef.current;
    // say what is under the pointer and that clicking edits it
    const r2 = (v: number) => String(Math.round(v * 100) / 100);
    let tip: string | null = null;
    if (pt?.pointId) { const p = draft.points.find((q) => q.id === pt.pointId); if (p && !p.fixed) tip = t('app.sketch.tip.point', { x: r2(p.x), y: r2(p.y) }); }
    else if ((next as { entity?: string }).entity) {
      const f = entityDims(draft, (next as { entity: string }).entity)[0];
      if (f) tip = t(f.id === 'len' ? 'app.sketch.tip.length' : 'app.sketch.tip.radius', { value: r2(f.value) });
    }
    setHoverTip(tip ? { text: tip, x: ev.x + 14, y: ev.y + 16 } : null);
    if (cur.point === next.point && cur.entity === (next as { entity?: string }).entity) return;
    hoverRef.current = { ...next, constraint: cur.constraint };
    applyHighlight();
  };
  sketchDoubleRef.current = (ev) => {
    if (sketchToolRef.current) return;
    const draft = controller.sketchDraft();
    if (!draft) return;
    const at = { x: ev.u, y: ev.v };
    const pt = snapAt(draft, at, { tolerance: ev.tol, midpoints: false, align: false });
    if (pt?.pointId) { selectItem('point', pt.pointId, ev.x, ev.y, true); return; }
    const id = pickEntity(draft, at, ev.tol);
    if (id) selectEntity(id, ev.x, ev.y, true);
  };
  const applyEntityEdit = (next: import('@kit/sketch').SketchDraft | null) => {
    const sel = selEntityRef.current;
    if (!next || !sel) return;
    void controller.applySketchDraft(next).then((r) => {
      setSketchHint(r.ok || r.stale ? null : (r.hint ? t(r.hint) : null));
      selectItem(sel.kind, sel.id, sel.x, sel.y);   // show the solved size
      viewTick((n) => n + 1);
    });
  };
  const entityFieldEvent = (id: string, value: number | null, commit: boolean) => {
    const sel = selEntityRef.current;
    const draft = controller.sketchDraft();
    if (!commit || value === null || !sel || !draft) return;
    if (sel.kind === 'point') applyEntityEdit(setPointDim(draft, sel.id, id === 'x' ? 'x' : 'y', value));
    else applyEntityEdit(setEntityDim(draft, sel.id, id === 'len' ? 'len' : 'radius', value));
  };
  /** Edit a dimension's value in place (double-click on its label or its row in the panel). */
  const startDimEdit = (constraintId: string) => {
    const draft = controller.sketchDraft();
    const a = draft ? annotate(draft).find((x) => x.id === constraintId) : undefined;
    if (!a || a.value === undefined) return;
    const px = viewport?.sketchToScreen(a.at.x, a.at.y);
    setDimEdit({ id: constraintId, x: px?.x ?? 200, y: px?.y ?? 200, value: a.value, ...(a.expr ? { expr: a.expr } : {}) });
    setTimeout(() => { const f = document.querySelector<HTMLInputElement>('.sketch-fields.dimedit input'); f?.focus(); f?.select(); }, 30);
  };
  const dimEditEvent = (_id: string, value: number | null, commit: boolean, expr?: string) => {
    const draft = controller.sketchDraft();
    const edit = dimEdit;
    if (!commit || value === null || !draft || !edit) return;
    const next = setConstraintValue(draft, edit.id, value, expr);
    setDimEdit(null);
    if (next) void controller.applySketchDraft(next).then((r) => { setSketchHint(r.ok || r.stale ? null : (r.hint ? t(r.hint) : null)); viewTick((n) => n + 1); });
  };
  /** The selected entity (Select mode) flips between normal and construction. */
  const toggleSelectedConstruction = () => {
    const ids = selectedEntityIds();
    const draft = controller.sketchDraft();
    if (!ids.length || !draft) return;
    void controller.applySketchDraft(setConstruction(draft, ids, ids.some((i) => !draft.entities.find((e) => e.id === i)?.construction))).then((r) => {
      setSketchHint(r.ok || r.stale ? null : (r.hint ? t(r.hint) : null));
      viewTick((n) => n + 1);
    });
  };
  const hoverConstraint = (id: string | null) => {
    hoverRef.current = { ...hoverRef.current, constraint: id ?? undefined };
    setHotConstraint(id);
    applyHighlight();
  };
  const deleteConstraint = (id: string) => {
    const draft = controller.sketchDraft();
    if (!draft) return;
    hoverRef.current = { ...hoverRef.current, constraint: undefined };
    setHotConstraint(null);
    void controller.applySketchDraft(id.startsWith('r') && refDimsOf(draft).some((r) => r.id === id) ? removeRefDim(draft, id) : removeConstraintById(draft, id)).then((r) => { setSketchHint(r.ok || r.stale ? null : (r.hint ? t(r.hint) : null)); viewTick((n) => n + 1); applyHighlight(); });
  };
  /** Apply a changed draft and refresh what depends on the answer. */
  const applyDraft = (next: import('@kit/sketch').SketchDraft | null, then?: (r: Awaited<ReturnType<typeof controller.applySketchDraft>>) => void) => {
    if (!next) return;
    void controller.applySketchDraft(next).then((r) => {
      setSketchHint(r.ok || r.stale ? null : (r.hint ? t(r.hint) : null));
      viewTick((n) => n + 1);
      applyHighlight();
      then?.(r);
    });
  };
  /** A dimension the solver finds already fixed by others (or in conflict) is kept as a reference dimension instead of
   *  over-constraining the sketch. `before` is the ids of the constraints before the step that added it. */
  function settleDimensions(before: Set<string>, status: import('@ck/part-model').SketchSolverStatus | undefined) {
    const draft = controller.sketchDraft();
    if (!draft || !status) return;
    const bad = new Set([...status.conflicts, ...status.redundant]);
    const dims = draft.constraints.filter((c) => !before.has(c.id) && bad.has(c.id) && typeof c.value === 'number' && ['distance', 'hdist', 'vdist', 'pldist', 'radius', 'diameter', 'angle'].includes(c.type));
    if (!dims.length) return;
    let next: import('@kit/sketch').SketchDraft | null = draft;
    for (const c of dims) next = next ? makeDriven(next, c.id) : null;
    if (next) applyDraft(next, () => store.notify(t('app.sketch.madeReference')));
  }
  /** Reference <-> driving for a dimension (constraint id `k..` or reference id `r..`). */
  const toggleDriven = (id: string, driven: boolean) => {
    const draft = controller.sketchDraft();
    if (!draft) return;
    const next = driven ? makeDriving(draft, id) : makeDriven(draft, id);
    if (!next) { setSketchHint(t('app.sketch.hint.constraint.conflict')); return; }
    hoverRef.current = { ...hoverRef.current, constraint: undefined };
    setHotConstraint(null);
    applyDraft(next);
  };
  /** Fully define: relations as drawn, then dimensions, until nothing can move. One undo step. */
  const fullyDefineNow = async () => {
    const draft = controller.sketchDraft();
    if (!draft || defining) return;
    setDefining(true);
    setSketchHint(t('app.sketch.defining'));
    try {
      const r = await fullyDefine(draft, (d) => controller.probeSketch(d));
      const added = r.relations + r.dimensions;
      if (added > 0) await controller.applySketchDraft(r.draft);
      const st = controller.sketchStatus();
      const msg = r.status?.conflicts.length ? t('app.sketch.fullyDefined.conflict')
        : r.fully && added === 0 ? t('app.sketch.fullyDefined.already')
        : r.fully ? t('app.sketch.fullyDefined.added', { relations: r.relations, dimensions: r.dimensions })
        : added > 0 ? t('app.sketch.fullyDefined.partial', { relations: r.relations, dimensions: r.dimensions, dof: st?.dof ?? r.status?.dof ?? 0 })
        : t('app.sketch.fullyDefined.nothing');
      setSketchHint(null);
      store.notify(msg, r.fully || added > 0 ? 'info' : 'error');
    } finally { setDefining(false); viewTick((n) => n + 1); applyHighlight(); }
  };
  /** Model snaps of the open sketch: built once per sketch session and when the body, the plane or the picked extrusion changes, not per pointer move. */
  const modelSnapCache = useRef<{ edges: unknown; key: string; snaps: ModelSnaps } | null>(null);
  const modelSnapsNow = (): ModelSnaps => {
    const frame = controller.sketchFrame();
    const edges = controller.bodyEdges();
    if (!frame || !edges.length) return EMPTY_MODEL_SNAPS;
    const doc0 = controller.document();
    const ids = new Set<string>([...(editingId ? [editingId] : []), ...store.selection.value]);
    const spans: ExtrusionSpan[] = [];
    for (const f of (doc0?.features ?? []) as unknown as Array<Record<string, unknown>>) {
      if (f.type !== 'extrude' || !ids.has(String(f.id)) || typeof f.depth !== 'number') continue;
      const fr = controller.sketchFrameOf(String(f.sketch));
      if (!fr) continue;
      spans.push({ frame: fr, depth: f.depth, dir: (f.op === 'cut' ? -1 : 1) * (f.flip ? -1 : 1) as 1 | -1, ...(f.end === 'mid' ? { mid: true } : {}) });
    }
    const key = JSON.stringify([frame, spans]);
    const c = modelSnapCache.current;
    if (c && c.edges === edges && c.key === key) return c.snaps;
    const snaps = buildModelSnaps(frame, edges.flatMap((e) => (e.pts && e.pts.length >= 2 ? [{ key: e.key, faces: e.faces, pts: e.pts }] : [])), { extrusions: spans });
    modelSnapCache.current = { edges, key, snaps };
    return snaps;
  };
  sketchPointerRef.current = (ev) => {
    if (!sketchToolRef.current) return;
    if (ev.type === 'leave') { viewport?.setSketchPreview([]); setToolOut(null); readout.snapAt.value = null; readout.snapName.value = null; return; }
    lastPosRef.current = { x: ev.x, y: ev.y };
    toolTolRef.current = ev.tol;
    const draft = controller.sketchDraft();
    if (!draft) return;
    const at = { x: ev.u, y: ev.v };
    let snap = ev.mods.alt ? undefined : snapAt(draft, at, { tolerance: ev.tol, kinds: prefsRef.current.snapOn ? prefsRef.current.snaps : OBJECT_SNAPS_OFF, ...(prefsRef.current.snapOn ? { model: modelSnapsNow() } : {}), ...(lastOutRef.current?.from ?? lastOutRef.current?.anchor ? { from: (lastOutRef.current?.from ?? lastOutRef.current?.anchor)! } : {}), ...(prefsRef.current.gridSnap ? { grid: ev.grid } : {}) });
    // tools that pick a whole curve need the curve under the pointer, not only a midpoint snap
    if (ENTITY_PICK_TOOLS.has(sketchToolRef.current) && !snap?.entityId) {
      const entityId = pickEntity(draft, at, ev.tol);
      if (entityId) snap = snap ? { ...snap, entityId } : { kind: 'grid', at, entityId };
    }
    runTool({ type: ev.type, at, snap, mods: ev.mods });
    // Resting the pointer on the chain end flips the line tool between a line and a tangent arc; moving off re-arms it.
    const anchor = lastOutRef.current?.anchor;
    const d = dwellRef.current;
    if (prefsRef.current.arcSwitch === 'hover' && anchor && ev.type === 'move') {
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
    if (!sketchToolRef.current && multiSelRef.current.length) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const draft = controller.sketchDraft();
        e.preventDefault();
        if (draft) { const next = multiSelRef.current.reduce(deleteEntity, draft); multiSelRef.current = []; void controller.applySketchDraft(next).then(() => { applyHighlight(); viewTick((n) => n + 1); }); }
        return true;
      }
      if (e.key === 'Escape') { e.preventDefault(); setMultiSelection([]); return true; }
    }
    if (!sketchToolRef.current && (e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      const draft = controller.sketchDraft();
      if (draft) { e.preventDefault(); setMultiSelection(draft.entities.map((x) => x.id)); return true; }
    }
    if (sel && !sketchToolRef.current) {
      // a digit starts typing the selected item's size: focus its field, then the key lands in it (not the view keys)
      if (/^[0-9.\-]$/.test(e.key)) {
        const first = document.querySelector<HTMLInputElement>('.sketch-fields input');
        if (first) { first.focus(); first.select(); return true; }
      }
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
  /** The one selected face, if exactly one face is selected. */
  const selectedFace = (): string | null => {
    const sel = store.selection.value;
    return store.mode.value === 'face' && sel.length === 1 && sel[0] !== BODY ? sel[0] : null;
  };
  const startNewSketch = (plane: 'front' | 'top' | 'right' | { kind: 'face' | 'feature'; id: string }, after?: () => Promise<void>) => {
    setRefSel(null); setRefHover(null);   // the chosen plane's highlight must not tint the sketch
    void (async () => {
      setSketchHint(null);
      let view = await controller.beginNewSketch(plane);
      // A curved face (cylinder, sphere) has no flat sketch plane: sketch on a plane touching it at the clicked point.
      if (!view && typeof plane === 'object' && plane.kind === 'face') {
        const at = viewport?.lastPickPoint();
        if (at) {
          const before = controller.document()?.features.length ?? 0;
          await timed(() => controller.edit([{ op: 'add', feature: { type: 'plane', mode: 'tangent', face: plane.id, tangentTo: 'point', at, name: t('app.sketch.tangentPlane') } }]));
          const made = controller.document()?.features;
          const pl = made && made.length > before ? made[made.length - 1] : null;
          const bad = store.featureStatus.value.find((s) => s.id === pl?.id && !s.ok);
          if (pl && !bad) view = await controller.beginNewSketch({ kind: 'feature', id: pl.id });
          else if (pl) await timed(() => controller.edit([{ op: 'remove', id: pl.id }]));    // not a cylinder or sphere: undo the plane
        }
      }
      if (!view) { store.notify(t('app.sketch.failedCurved'), 'error'); return; }
      projectSelRef.current = [...store.selection.value];   // kept for the Project tool
      store.select([], false);   // the picked face's highlight would cover the sketch
      setSketching({ id: view.featureId, name: t('app.sketch.newName'), plane: typeof plane === 'string' ? t('app.ref.' + plane) : plane.kind === 'feature' ? planeLabel(plane.id) : t('app.sketch.dialog.onFace') });
      if (!prefsRef.current.keepView) viewport?.orientToSketch();   // default: the view stays exactly as it was; Look normal squares up
      selectTool(holeSketchRef.current ? 'point' : 'line');
      if (holeSketchRef.current) setSketchHint(t('app.hole.hint'));
      if (after) await after();
    })();
  };
  // Add an extrude (or cut) from the selected sketch, or the last sketch in the tree, and open it in the editor.
  const addExtrude = async (op: 'add' | 'cut', thin = false) => {
    const d = controller.document();
    if (!d) return;
    const target = nextExtrudeTarget(d.features as never, selectedId);
    if (!target) { store.notify(d.features.some((f) => f.type === 'sketch') ? t('app.allSketchesUsed') : t('app.noSketch'), 'error'); return; }
    const before = d.features.length;
    // a cut of a projected outline with a loop inside it is a pocket: the inner loop, not the wall that coincides with the body
    const regions = target.regions ?? (op === 'cut' ? defaultCutRegions(d.features.find((f) => f.id === target.sketchId) as never) : null);
    await edit([{ op: 'add', feature: { type: 'extrude', op, sketch: target.sketchId, end: 'blind', depth: 10, ...(thin ? { thin: { thickness: defaultThickness(d.features.find((f) => f.id === target.sketchId) as never), side: 'inside', ends: 'flat', cornerStyle: 'mitre' } } : {}), ...(regions ? { regions } : {}), ...(controller.extrudeFlip(target.sketchId, op) ? { flip: true } : {}) } }]);
    const now = controller.document();
    const added = now && now.features.length > before ? now.features[now.features.length - 1] : null;
    if (added) startEditing(added.id);
  };
  // Add the feature the ops describe as one edit, clear the selection that fed it, and open the Editor on it.
  const createFeature = async (ops: EditOp[]) => {
    const before = controller.document()?.features.length ?? 0;
    // the picked edges, faces or corners are consumed by the feature: clear them first so the rebuild does not report them as lost
    const picked = [...store.selection.value];
    store.select([]);
    const r = await controller.edit(ops);
    redraw((n) => n + 1);
    if (!r.ok) { store.select(picked); return; }
    const now = controller.document();
    const added = now && now.features.length > before ? now.features[now.features.length - 1] : null;
    if (added) startEditing(added.id);
  };
  const fieldEvent = (id: string, value: number | null, commit: boolean) => runTool({ type: 'field', id, value, commit });
  const confirmSketch = async () => {
    if (!sketching) return;
    selectTool(null);
    selectEntity(null, 0, 0);
    setDimEdit(null); hoverRef.current = {}; setHotConstraint(null);
    const wasHole = holeSketchRef.current; holeSketchRef.current = false;
    projectSelRef.current = [];
    const sketchId = sketching.id;
    await timed(() => controller.commitSketch());
    setSketching(null); setSketchHint(null); multiSelRef.current = []; toolEntitiesRef.current = [];
    // a sketch you just made must not vanish because the layer was switched off earlier: turn it back on and say so
    if (!store.display.value.sketches) { store.setDisplay('sketches', true); store.notify(t('app.sketch.layerOn')); }
    const made = controller.document()?.features.find((f) => f.id === sketchId);
    if (wasHole && made && hasPointEntities(made as never)) void createFeature(holeOps(sketchId, controller.extrudeFlip(sketchId, 'cut')));
    else if (wasHole) store.notify(t('app.hole.hint'), 'error');
    redraw((n) => n + 1);
  };
  const cancelSketch = async () => {
    if (!sketching) return;
    selectTool(null);
    selectEntity(null, 0, 0);
    setDimEdit(null); hoverRef.current = {}; setHotConstraint(null);
    await controller.cancelSketch();
    holeSketchRef.current = false;
    projectSelRef.current = [];
    setSketching(null); setSketchHint(null); multiSelRef.current = []; toolEntitiesRef.current = [];
    redraw((n) => n + 1);
  };
  sketchingRef.current = !!sketching;
  useEffect(() => { viewport?.setSketchGrid({ base: sketchPrefs.gridSpacing, visible: sketchPrefs.gridSnap }); }, [viewport, sketching?.id, sketchPrefs.gridSpacing, sketchPrefs.gridSnap]);
  useEffect(() => { if (!sketching) clearReadout(); }, [!!sketching]);
  sketchConfirmRef.current = confirmSketch;
  sketchCancelRef.current = cancelSketch;
  // Dimensions and constraint symbols, projected onto the screen for this frame.
  const sketchDraftNow = sketching ? controller.sketchDraft() : null;
  // How defined each entity is: probed a moment after the sketch stops changing (blue under, dark fully, red over).
  const stForKey = sketching ? controller.sketchStatus() : null;
  const defKey = sketchDraftNow && stForKey
    ? `${stForKey.dof}|${stForKey.state}|${stForKey.conflicts.join(',')}|${sketchDraftNow.constraints.map((c) => c.id + (typeof c.value === 'number' ? '=' + c.value : '')).join(',')}|${sketchDraftNow.points.map((q) => q.id + ':' + q.x.toFixed(3) + ',' + q.y.toFixed(3)).join(';')}|${sketchDraftNow.entities.length}`
    : '';
  useEffect(() => {
    if (!defKey || !sketchPrefs.show.colours) { viewport?.setSketchDefinition(null); return; }
    let stale = false;
    const timer = setTimeout(async () => {
      const draft = controller.sketchDraft(), st = controller.sketchStatus();
      if (!draft || !st) return;
      const map = await definitionMap(draft, st, (d) => controller.probeSketch(d), { cancelled: () => stale });
      if (!stale) viewport?.setSketchDefinition(Object.fromEntries(map));
    }, 350);
    return () => { stale = true; clearTimeout(timer); };
  }, [defKey, sketchPrefs.show.colours]);
  const show = sketchPrefs.show;
  const annotItems = sketchDraftNow
    ? [...annotate(sketchDraftNow), ...(show.reference ? refAnnotations(sketchDraftNow) : [])]
      .filter((a) => a.driven ? show.reference : a.kind === 'dimension' ? show.dimensions : show.relations)
      .flatMap((a) => { const p = viewport?.sketchToScreen(a.at.x, a.at.y); return p ? [{ id: a.id, text: a.text, kind: a.kind, driven: !!a.driven, ...(a.expr ? { fx: true } : {}), x: p.x, y: p.y + (a.kind === 'dimension' ? -16 : 14) }] : []; })
    : [];
  const stNow = sketching ? controller.sketchStatus() : null;
  const blame = (id: string) => (stNow?.conflicts.includes(id) ? 'conflict' as const : stNow?.redundant.includes(id) ? 'redundant' as const : undefined);
  const conRows = sketchDraftNow ? [
    ...sketchDraftNow.constraints.map((c) => ({ id: c.id, type: c.type, refs: c.refs ?? [], ...(typeof c.value === 'number' ? { value: c.value } : {}), ...(typeof c.expr === 'string' && c.expr ? { expr: c.expr } : {}), ...(blame(c.id) ? { blame: blame(c.id)! } : {}) })),
    ...refDimsOf(sketchDraftNow).map((r) => ({ id: r.id, type: r.type, refs: r.refs, driven: true })),
  ] : [];
  const rowName = (id: string) => {
    const c = sketchDraftNow?.constraints.find((x) => x.id === id);
    return c ? `${t('app.sketch.constraint.' + c.type, undefined, c.type)}${typeof c.value === 'number' ? ' ' + Math.round(c.value * 100) / 100 : ''} (${id})` : id;
  };
  const sketchFeat = sketching && doc ? (doc.features.find((f) => f.id === sketching.id) as unknown as { plane?: unknown } | undefined) : undefined;
  const sketchPlaneLabel = (() => {
    const pl = sketchFeat?.plane;
    if (pl === 'front' || pl === 'top' || pl === 'right') return t('app.ref.' + pl);
    return pl && typeof pl === 'object' ? t('app.sketch.dialog.onFace') : '';
  })();
  const sketchBar = sketching ? (
    <SketchBar
      name={sketching.name} plane={sketching.plane ?? sketchPlaneLabel}
      onOk={() => void confirmSketch()} onCancel={() => void cancelSketch()}
      construction={constructionMode} onConstruction={() => setConstructionMode(!constructionMode)}
      {...((entityOut && selEntityRef.current?.kind === 'entity' || multiSelRef.current.length > 1) && !sketchToolId ? { onToggleSelected: toggleSelectedConstruction } : {})}
      onLookNormal={() => viewport?.orientToSketch()} hint={sketchHint}
      status={stNow} busy={defining} prefs={sketchPrefs}
      onPrefs={updatePrefs}
      onFullyDefine={() => void fullyDefineNow()}
      selected={selectedEntityIds().length > 1 ? selectedEntityIds().length : 0}
      onClearSelection={() => setMultiSelection([])}
      list={<SketchConstraintList rows={conRows} status={stNow} hot={hotConstraint} onHover={hoverConstraint} onDelete={deleteConstraint} onEdit={startDimEdit} onToggleDriven={toggleDriven} />}
    />
  ) : null;
  const tree = (
    <FeatureTree rows={rows} partName={doc?.name}
      refs={doc ? [
        { id: 'material', label: t('app.ref.material', { name: doc.material ?? t('app.ref.noMaterial') }), icon: 'ref-material', swatch: appearance.color, editable: true, editLabel: t('material.edit') },
        { id: 'front', label: t('app.ref.front'), icon: 'feature-plane', tag: 'XY', choosable: true },
        { id: 'top', label: t('app.ref.top'), icon: 'feature-plane', tag: 'XZ', choosable: true },
        { id: 'right', label: t('app.ref.right'), icon: 'feature-plane', tag: 'ZY', choosable: true },
        { id: 'origin', label: t('app.ref.origin'), icon: 'ref-origin', choosable: true },
      ] : []}
      selectedRef={refSel} onSelectRef={(id) => { setRefSel(id); if (id) { setSelectedId(null); store.select([]); } }} onHoverRef={setRefHover}
      onOpenRef={(id) => { if (id === 'material') openMaterial(); else if (id === 'front' || id === 'top' || id === 'right') startNewSketch(id); }}
      status={store.featureStatus.value} warnings={store.featureWarnings.value} selectedId={selectedId}
      hiddenIds={hid.ids} onToggleHide={toggleHideFeature} onHoverFeature={setTreeHover} hoverId={hoverRowId}
      {...ti.treeProps}
      onEdit={startEditing}
      onMove={(id, to) => edit([{ op: 'move', id, to }])} />
  );
  const showAssembly = (section: AsmSection) => {
    if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true });
    if (store.workspace.value.leftPanel === 'hidden') store.setWorkspace({ leftPanel: 'docked' });
    setAsmSection(section); setLeftTab('Outliner'); setTab('Assembly');
  };
  const asmErrors = new Map(store.featureStatus.value.filter((s) => !s.ok).map((s) => [s.id, s.code ?? 'error'] as const));
  const asmDof = new Map(controller.components().map((c) => [c.id, c.dof] as const));
  const asmHost: AsmHost = {
    doc: doc as never, dof: asmDof, errors: asmErrors, report: controller.assemblyExtra().report, featureErrors: controller.assemblyExtra().errors, hidden: asmState.hidden.value, explode: asmState.explode.value, selection: store.selection.value,
    hover: setTreeHover,
    faceNames: () => controller.bodyFaces()?.faceIds ?? [],
    bodyFaces: (n) => controller.selModel()?.bodyOfFace(n)?.faces ?? [n],
    select: (names) => { store.mode.value = 'face'; viewport?.setPickMode('face'); store.select(names); },
    frame: (names) => viewport?.frameNames(names),
    edit: async (ops) => { const r = await timed(() => controller.edit(ops)); redraw((n) => n + 1); return r.ok; },
    preview: async (ops) => { const r = await controller.preview(ops, 0); return { ok: r.ok, hint: r.hint }; },
    cancelPreview: async () => { await controller.cancelPreview(); redraw((n) => n + 1); },
    samples: () => platform.listSamples(),
    readUrl: async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status}`); return r.text(); },
    openFile: (opts) => platform.openFile(opts),
    saveFile: (name, data, mime) => platform.saveFile(name, data, mime),
    partVolume: async (part) => (await controller.partMass(part)).volume,
    notify: (text, level) => store.notify(text, level ?? 'info'),
    toggleHidden: (id) => asmState.toggleHidden(id),
    setExplode: (patch) => asmState.setExplode(patch),
    interference: { data: inspect.props.interference, stale: inspect.props.interferenceStale, busy: inspect.props.interferenceBusy, run: inspect.props.onInterference },
  };
  const outliner = (
    <div class="outliner">
      <AssemblyPanel host={asmHost} section={asmSection} onSection={setAsmSection} />
    </div>
  );
  const holeEntry = holeWalls.length ? (controller.threadsShown() as Array<{ id?: string; face?: string; modeled?: boolean }>).find((x) => x.face === holeWalls[0]) : undefined;
  const holeWallLength = holeWalls.length ? faceExtent(holeWalls[0], controller.bodyEdges(), controller.bodyFaces())?.length ?? null : null;
  // the faces of a group of threads: name, diameter and kind of each, for the group chip and the per-face fit line
  const groupFaces = groupIds.length > 1 ? groupIds.map((id) => {
    const face = String((doc?.features.find((f) => f.id === id) as unknown as { face?: string } | undefined)?.face ?? '');
    const cyl = cylinderOfFace(face, controller.bodyEdges());
    const entry = (controller.threadsNow() as Array<{ id?: string; internal?: boolean }>).find((x) => x.id === id);
    return { id, face, dia: cyl ? cyl.radius * 2 : null, internal: entry?.internal ?? (isHoleWall(face) ? true : cyl?.internal) };
  }) : null;
  // The Gear editor works on the whole parameter record: every draft regenerates the gear's features (preview), OK commits them as one edit.
  const gearRec = editingFeature?.type === 'sketch' ? readGear(editingFeature) : null;
  const gearEditOps = (next: GearParams): EditOp[] => gearOps(doc as never, next, gearRec?.roles);
  const onGearDraft = (next: GearParams) => { void controller.preview(gearEditOps(next)).then(onPreviewResult); };
  const onGearConfirm = async (next: GearParams) => {
    await timed(() => controller.commit(gearEditOps(next), 'gear'));
    setEditingId(null); setDraft({}); setPreviewHint(null);
    setLeftTab('Features');
    redraw((n) => n + 1);
  };
  const featureEditor = gearRec ? (
    <GearEditor key={editingId} params={gearRec.params} name={String(editingFeature?.name ?? '').replace(/ profile$/, '')} onDraft={onGearDraft} onConfirm={onGearConfirm} onCancel={onCancel} hint={previewHint} />
  ) : editingFeature?.type === 'thread' ? (
    <ThreadEditor key={editingId} feature={editingFeature} extent={threadExtent} entryModeled={(controller.threadsNow() as Array<{ id?: string; modeled?: boolean }>).find((x) => x.id === editingId)?.modeled} modeledMs={loadThreadPrefs().modeledMs ?? null} inject={handleInject} onDraft={onDraft} onConfirm={onConfirm} onCancel={onCancel} hint={previewHint}
      loadStandards={() => controller.threadStandards()} loadSizes={(std) => controller.threadSizes(std)}
      group={groupFaces ?? undefined} warnings={store.featureWarnings.value}
      faceDiameter={threadCyl ? threadCyl.radius * 2 : null} internal={threadInternal} warning={editingId ? store.featureWarnings.value[editingId] ?? null : null} />
  ) : editingFeature?.type === 'hole' ? (
    <HoleEditor key={editingId} feature={editingFeature} onDraft={onDraft} onConfirm={onConfirm} onCancel={onCancel} hint={previewHint} linked={holeLinked}
      threads={{
        loadStandards: () => controller.threadStandards(), loadSizes: (std) => controller.threadSizes(std), wallLength: holeWallLength,
        entryModeled: holeEntry?.modeled, modeledMs: loadThreadPrefs().modeledMs ?? null, warning: holeEntry?.id ? store.featureWarnings.value[holeEntry.id] ?? null : null,
      }} />
  ) : (
    <FeatureEditor
      feature={editingFeature}
      onDraft={onDraft}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onPickRequest={(path) => {
        if (LIST_PATHS.has(path)) {   // edge and face lists: fill from the selection now, keep following it until Done
          if (pickingPath === path) { setPickingPath(null); return; }
          const value = pickValue(path, store.selection.value, controller.bodyEdges());
          if (value !== null) setPicked({ path, value });
          setPickingPath(path);
          return;
        }
        setPickingPath(path); store.select([]);
      }}
      pickingPath={pickingPath}
      picked={picked}
      key={`${editingId}:${String(editingFeature?.type)}`}
      options={(a) => optionsFor(a, doc, thinActions)}
      hint={openCard ? null : previewHint}
      diag={previewDiag ? <DiagnosticsCard diagnosis={previewDiag.d} variant="editor" onSelect={selectFailed} onCancel={onCancel} /> : null}
      okBlocked={previewDiag?.fresh.length ? t('diag.okBlocked', { id: previewDiag.fresh[0].id }) : null}
      shapes={editShapes}
      onShapeHover={(id) => {
        const ef = editingFeature as { sketch?: string } | null;
        const sk = ef?.sketch ? doc?.features.find((f) => f.id === ef.sketch) : null;
        const shape = id && sk ? sketchShapes(sk as never).find((s) => s.id === id) : null;
        viewport?.highlightSketchEntities(shape ? ef!.sketch! : null, shape?.entityIds ?? []);
      }}
    />
  );
  const materialEditor = editingMaterial && doc ? (
    <MaterialEditor key="material" current={doc.material} useColour={useMatColour} onApply={applyMaterial} onCancel={closeMaterial}
      loadVolume={async () => { const m = controller.hasSolid() ? await controller.massProps() : null; return typeof m?.volume === 'number' ? m.volume : null; }} />
  ) : null;
  const editor = materialEditor ?? featureEditor;
  const leftBody = !doc ? <div class="empty">{t('app.left.empty')}</div>
    : editingId || editingMaterial ? editor : tree;
  const catalog = useCatalog({
    controller, viewport: () => viewport, notify: (text, level) => store.notify(text, level),
    placed: () => redraw((n) => n + 1),
    hide: (ids) => { const h = lookStore.hidden.value; lookStore.hidden.value = { ...h, ids: [...new Set([...h.ids, ...ids])] }; },
  });
  const catalogPanel = <CatalogPanel hasDoc={!!doc} hasSolid={controller.hasSolid()} onItemDown={catalog.onItemDown} onItemKey={catalog.onItemKey} />;
  const variablesPanel = <VariablesPanel doc={doc} onApply={async (patch, reason) => { const r = await controller.applyDocPatch(patch, reason); redraw((n) => n + 1); return r; }} />;
  const showVariables = () => { if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true }); if (store.workspace.value.leftPanel === 'hidden') store.setWorkspace({ leftPanel: 'docked' }); setLeftTab('Variables'); };
  const showScript = () => { if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true }); if (store.workspace.value.leftPanel === 'hidden') store.setWorkspace({ leftPanel: 'docked' }); setLeftTab('Script'); };
  const scriptPanel = <ScriptPanel saved={String((doc as unknown as { script?: string } | null)?.script ?? '')} onRun={(code, run) => new Promise((resolve) => {
    // a script always builds a NEW untitled part; the unsaved-changes guard decides whether the current one may be left
    guarded(async () => {
      // while it runs: busy (the autosave waits), and the part that is open stays as it is until the finished list is opened in one step
      store.busy.value = true; scriptRunning = true;
      try {
        const r = await runScript(code, {
          load: (d) => load(JSON.stringify({ ...emptyPart(files.names.next()), ...d })),
          edit: async (ops, why) => (await controller.edit(ops, why)) as never,
          geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
          ...(controller.canScratchBuild() ? {
            build: (d, view) => controller.scratchBuild(d as never, view) as never,
            release: () => controller.scratchRelease(),
            facts: (need) => controller.scratchFacts(need),
          } : {}),
        }, {}, { ...run, ...(new URLSearchParams(location.search).has('legacyScript') ? { batched: false } : {}) });
        if (r.cancelled) { store.notify(t('script.cancelled')); resolve([]); return; }
        controller.setDocExtra('script', code);
        redraw((n) => n + 1);
        setLeftTab('Script');
        if (!r.errors.length) store.notify(t('script.done', { count: r.ops.length }));
        resolve(r.errors);
      } finally { store.busy.value = false; scriptRunning = false; }
    });
  })} />;
  const showCatalog = () => { if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true }); if (store.workspace.value.leftPanel === 'hidden') store.setWorkspace({ leftPanel: 'docked' }); setLeftTab('Catalog'); };
  // after a catalog drop the new shape is the selection: its tree row and its size box
  useEffect(() => setShapeSelector((id) => { selectShapeFeature(id); }), []);
  const left = ws.leftPanel === 'hidden' ? null : (
    <div class={'tree-wrap ' + ws.leftPanel}>
      {ws.leftTabs ? (
        <>
          <div class="ptabs">
            {(['Outliner', 'Features', 'Editor', 'Catalog', 'Variables', 'Script'] as const).map((id) => {
              const label = t('app.leftTab.' + id);
              const icon = { Outliner: 'feature-part', Features: 'add-extrude', Catalog: 'open-catalog', Editor: 'edit', Variables: 'open-variables', Script: 'open-script' }[id];
              return <button key={id} class="pt" aria-selected={leftTab === id} aria-label={label} title={label} onClick={() => setLeftTab(id)}><Icon name={icon} size={18} />{leftTab === id ? <span class="pt-label">{label}</span> : null}</button>;
            })}
          </div>
          {leftTab === 'Outliner' ? outliner : leftTab === 'Features' ? leftBody
            : leftTab === 'Catalog' ? catalogPanel
            : leftTab === 'Variables' ? variablesPanel
            : leftTab === 'Script' ? scriptPanel
            : editor}
        </>
      ) : leftBody}
    </div>
  );
  // the properties panel only exists while there is a feature to show: no empty column, nothing to close
  const rightMode = feature ? ws.rightPanel : 'off';
  const right = rightMode === 'off' ? null : (
    <div class={'insp-wrap ' + rightMode}>
      <Inspector feature={feature} onSet={(path, value) => {
        clearTimeout(pending);
        pending = setTimeout(() => edit([{ op: 'set', id: selectedId!, path, value }]), 150);
      }} />
    </div>
  );

  // reference planes: all three for an empty part, otherwise the one chosen or hovered in the tree
  const planeIds = ['front', 'top', 'right'] as const;
  const emptyPart1 = !!doc && doc.features.length === 0 && !sketching && !editingId && !controller.hasSolid() && !controller.hasImportedBody();   // an imported part has no features but is not an empty start
  const refPlane = (id: string | null) => (id === 'front' || id === 'top' || id === 'right' ? id : null);
  useEffect(() => {
    viewport?.setRefPlanes(
      emptyPart1 ? [...planeIds] : [],
      sketching ? null : refPlane(refHover) ?? refPlane(refSel),
      { front: t('app.ref.front') + ' (XY)', top: t('app.ref.top') + ' (XZ)', right: t('app.ref.right') + ' (ZY)' },
    );
  }, [emptyPart1, sketching, refHover, refSel, !!doc]);
  useEffect(() => { if (!controller.document()) void (async () => { viewport?.requestFit(); await controller.load(emptyPart(files.names.next())); markClean(); redraw((n) => n + 1); })(); }, []);
  useEffect(() => installDismissGuard(), []);   // the click that closes a menu must not also start a sketch point
  // autosave: a changed part is written 400 ms after the last change, and at once when the page is hidden
  const autoPayload = () => { const d = controller.document(); return d ? { name: files.partName ?? d.name, doc: files.partName ? { ...d, name: files.partName } : d } : null; };
  useEffect(() => { if (controller.document() && isDirty()) autosaver.schedule(autoPayload, (controller.document()?.features.length ?? 0) > 200 ? 5000 : undefined); });
  useEffect(() => {
    const hide = () => { if (isDirty()) autosaver.flush(autoPayload); };
    addEventListener('pagehide', hide);
    const vis = () => { if (document.visibilityState === 'hidden') hide(); };
    document.addEventListener('visibilitychange', vis);
    return () => { removeEventListener('pagehide', hide); document.removeEventListener('visibilitychange', vis); };
  }, []);
  // drag and drop of files onto the window
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => { if (!dragHasFiles(e.dataTransfer)) return; e.preventDefault(); depth++; setDragging(true); };
    const over = (e: DragEvent) => { if (dragHasFiles(e.dataTransfer)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!dragHasFiles(e.dataTransfer)) return; depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false); };
    const drop = (e: DragEvent) => { if (!dragHasFiles(e.dataTransfer)) return; e.preventDefault(); depth = 0; setDragging(false); dropFilesRef.current(Array.from(e.dataTransfer?.files ?? [])); };
    addEventListener('dragenter', enter); addEventListener('dragover', over); addEventListener('dragleave', leave); addEventListener('drop', drop);
    return () => { removeEventListener('dragenter', enter); removeEventListener('dragover', over); removeEventListener('dragleave', leave); removeEventListener('drop', drop); };
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, []);

  // the contextual ribbon: a sketch replaces the tabs by the Sketch tab; an open feature editor greys the model commands; an assembly opens on its tab
  const fileIds = new Set(commands.filter((c) => isFileCommand(c.id)).map((c) => c.id));
  const ribbonCommands = editingId ? commands.map((c) => (idleDuringEdit(c.id) ? { ...c, enabled: () => false } : c)) : commands;
  const ribbonLayout = sketching
    ? { ...RIBBON_LAYOUT, [SKETCH_TAB]: sketchRibbonGroups({ active: sketchToolId, onPick: selectTool, labels: ws.toolLabels !== 'icons', }) }
    : RIBBON_LAYOUT;
  const kindRef = useRef<DocKind | null>(null);
  const kindNow = docKindOf(doc as never);
  useEffect(() => {
    const next = tabForKindChange(kindRef.current, kindNow, tab);
    kindRef.current = kindNow;
    if (next !== tab) setTab(next);
  }, [kindNow]);
  const chrome = sketchChrome(ws, !!sketching);
  // Every action of the sketch bar and every sketch tool is also a command in the F search while a sketch is open (not on the ribbon: the bar and the Sketch tab carry them there)
  const sketchSetShow = (k: 'dimensions' | 'relations') => { const next = { ...sketchPrefs, show: { ...sketchPrefs.show, [k]: !sketchPrefs.show[k] } }; setSketchPrefs(next); saveSketchPrefs(next); };
  const sketchCommands: Command[] = sketching ? [
    { id: 'sketch-ok', label: t('app.sketch.confirm'), tab: 'Sketch', group: 'Finish', run: () => void confirmSketch() },
    { id: 'sketch-cancel', label: t('app.sketch.cancel'), tab: 'Sketch', group: 'Finish', run: () => void cancelSketch() },
    { id: 'sketch-fully-define', label: t('app.sketch.fullyDefine'), tip: t('app.sketch.fullyDefine.tip'), tab: 'Sketch', group: 'Sketch', run: () => void fullyDefineNow() },
    { id: 'sketch-construction', label: t('app.sketch.constructionMode'), tip: t('app.sketch.constructionMode.tip'), tab: 'Sketch', group: 'Sketch', pressed: () => constructionMode, run: () => setConstructionMode(!constructionMode) },
    { id: 'sketch-look-normal', label: t('app.sketch.lookNormal'), tab: 'Sketch', group: 'Sketch', run: () => viewport?.orientToSketch() },
    { id: 'sketch-show-dimensions', label: t('app.sketch.show.dimensions'), tab: 'Sketch', group: 'Sketch', pressed: () => sketchPrefs.show.dimensions, run: () => sketchSetShow('dimensions') },
    { id: 'sketch-show-relations', label: t('app.sketch.show.relations'), tab: 'Sketch', group: 'Sketch', pressed: () => sketchPrefs.show.relations, run: () => sketchSetShow('relations') },
    { id: 'sketch-select', label: t('app.sketch.select'), tab: 'Sketch', group: 'Sketch', run: () => selectTool(null) },
    ...sketchTools().map((x) => ({ id: 'sketch-tool-' + x.id, label: t('app.sketch.tool.' + x.id), ...(x.key ? { keys: x.key.toUpperCase() } : {}), tab: 'Sketch', group: t('app.sketch.group.' + x.group), run: () => selectTool(x.id) })),
  ] : [];
  const lay = layoutHandles(store, ws);
  return (
    <VarsContext.Provider value={scopeOf(doc)}>
    <div id="app" style={layoutStyle(ws)} data-ribbon={ws.ribbon} data-left={ws.leftPanel} data-right={rightMode} data-drawer={ws.drawerOpen} data-rail={ws.toolRail} data-lcol={ws.leftCollapsed}>
      <div class="topbar">
        <Tip label={t('cmd.new-part')} keys="Ctrl+N" side="bottom"><button class="rb-btn tb-icon" aria-label={t('cmd.new-part')} onClick={() => commands.find((c) => c.id === 'new-part')!.run()}><Icon name="new-part" size={18} /></button></Tip>
        <Tip label={t('cmd.open')} side="bottom"><button class="rb-btn tb-icon" aria-label={t('cmd.open')} onClick={() => commands.find((c) => c.id === 'open')!.run()}><Icon name="open" size={18} /></button></Tip>
        <Tip label={t('cmd.save')} side="bottom"><button class="rb-btn tb-icon" aria-label={t('cmd.save')} disabled={!doc} onClick={() => commands.find((c) => c.id === 'save')!.run()}><Icon name="save" size={18} /></button></Tip>
        <ExportMenu items={EXPORT_KINDS.map((k) => commands.find((c) => c.id === `export-${k}`)!)} open={exportOpen && !!doc} onOpenChange={setExportOpen} keys="Ctrl+E" disabled={!doc} />
        <Slot id="file-more" variant="icon" side="bottom" menu icon="more" title={t('app.fileMore')} items={['save-as', 'import-step'].flatMap((id) => { const c = commands.find((x) => x.id === id); return c ? [commandToItem(c)] : []; })} />
        <Tip label={t('cmd.samples')} side="bottom"><button class="rb-btn tb-icon" aria-label={t('cmd.samples')} onClick={() => commands.find((c) => c.id === 'samples')!.run()}><Icon name="samples" size={18} /></button></Tip>
        {ti.topRename.active && doc
          ? <InlineName class="doc-name" value={doc.name} onCommit={ti.topRename.commit} onCancel={ti.topRename.end} />
          : null}
        <b class="doc-name" hidden={ti.topRename.active && !!doc} onDblClick={() => { if (doc) ti.topRename.begin(); }}>{files.partName ?? doc?.name ?? t('app.noPart')}{isDirty() ? <span class="doc-dirty" title={t('app.discard.modified')}> •</span> : null}</b>
        <div class="mode-tabs" role="tablist" aria-label={t('drawing.title')}>
          <button role="tab" aria-selected={!drawingOpen} class="rb-btn" onClick={() => setDrawingOpen(false)}>{t('drawing.tab.part')}</button>
          <button role="tab" aria-selected={drawingOpen} class="rb-btn" disabled={!doc} onClick={() => setDrawingOpen(true)}>{t('drawing.tab.drawing')}</button>
        </div>
        <button class="search-btn" onClick={() => setPalette(true)}>{t('app.search')} <kbd>F</kbd></button>
        <Tip label={t('app.settings.title')} side="bottom"><button class="rb-btn tb-icon" aria-label={t('app.settings.title')} onClick={() => setSettings(true)}><Icon name="settings" size={18} /></button></Tip>
      </div>
      {ws.ribbon !== 'off' ? <div class={'ribbon-wrap ' + ws.ribbon}><Ribbon commands={ribbonCommands} activeTab={activeRibbonTab(tab, !!sketching)} onTab={setTab} labels={ws.toolLabels} layout={ribbonLayout} hidden={fileIds} onlyTab={sketching ? SKETCH_TAB : undefined} tabLabel={(x) => (x === SKETCH_TAB && sketching ? t('app.sketch.editing', { name: sketching.name }) : undefined)} caption={(c) => t('rb.' + c.id, undefined, c.label)} /></div> : null}
      {ws.leftPanel === 'docked' ? left : null}
      {lay.docked}
      <div id="vp" ref={host}>
        {handles.menuEl}{handles.aboutEl}{handles.fieldsEl}{handles.askEl}{handles.hintEl}{tri.menuEl}{tri.dialogEl}{tri.statusEl}
        {ws.leftPanel === 'floating' ? left : null}
        {rightMode === 'floating' ? right : null}
        {lay.floating}
        {chrome.leftColumn !== 'none' ? (
          <ToolRail commands={commands} kind={selectionKind(store.selection.value, store.mode.value)} labels={ws.toolLabels !== 'icons'} caption={(c) => t('rb.' + c.id, undefined, c.label)}
            {...(chrome.leftColumn === 'model' ? {} : { only: ['history'] })}
            {...(chrome.leftColumn === 'sketch' ? { after: <SketchRailSections active={sketchToolId} onPick={selectTool} labels={ws.toolLabels !== 'icons'} /> } : {})} />
        ) : null}
        {ws.selectionBar && !sketching ? (
          <div class="selmodes" role="toolbar" aria-label={t('app.selectionMode')}>
            {([['face', 'cmd.sel-face', 'Q'], ['edge', 'cmd.sel-edge', 'E'], ['vertex', 'cmd.sel-vertex', 'V'], ['body', 'cmd.sel-body', 'B']] as const).map(([m, l, k]) => (
              <Tip key={m} label={t(l)} keys={k}>
                <button aria-pressed={store.mode.value === m} disabled={!store.filters.value[MODE_FILTER[m]]} aria-label={ws.toolLabels === 'icons' ? t(l) : undefined} onClick={() => setMode(m)}>
                  <Icon name={'sel-' + m} size={ws.toolLabels === 'icons' ? 20 : 16} />
                  {ws.toolLabels === 'icons' ? null : <><kbd>{k}</kbd>{t(l)}</>}
                </button>
              </Tip>
            ))}
            <span class="sel-sep" />
            <Tip label={t('cmd.select-box')} keys="X">
              <button aria-pressed={boxOn} aria-label={t('cmd.select-box')} onClick={toggleBox}><Icon name="sel-box" size={ws.toolLabels === 'icons' ? 20 : 16} />{ws.toolLabels === 'icons' ? null : <kbd>X</kbd>}</button>
            </Tip>
            <FilterMenu filters={store.filters.value} onChange={setFilter} />
          </div>
        ) : null}
        {!sketching ? <SelectionList selection={store.selection.value} model={controller.selModel()} onClear={() => store.select([])}
          onRemove={(n) => store.select(store.selection.value.filter((x) => x !== n))} onHover={(n) => viewport?.setHover(n, true)} /> : null}
        {!sketching && !selectedFace() && selectedPlaneFeature() ? <button class="face-sketch-chip" data-act="sketch-on-plane" onClick={() => { const p = selectedPlaneFeature(); if (p) startNewSketch({ kind: 'feature', id: p.id }); }}>{t('app.sketch.onPlane')}</button> : null}
        {!sketching && selectedFace() ? <button class="face-sketch-chip" onClick={() => { const f = selectedFace(); if (f) startNewSketch({ kind: 'face', id: f }); }}>{t('app.sketch.onFace')}</button> : null}
        <AnalysisLegend legend={analysisStore.legend.value} />
        <DisplayMenu display={store.display.value} onToggle={(l, on) => store.setDisplay(l, on)} analysis={{ opts: an, onChange: (patch) => analysisStore.set(patch) }} look={{
          style: lk.style, ghostOpacity: lk.ghostOpacity, light: lk.light, background: lk.background, intensity: lk.intensity, reflections: lk.reflections, edgeWidth: lk.edgeWidth, silhouette: lk.silhouette, appearance: selComp ? (compAppearances.get(selComp.id) ?? appearance) : appearance,
          onLook: (patch) => lookStore.set(patch), onAppearance: (patch) => lookStore.setAppearance(selComp ? componentKey(partName, selComp.id) : partName || 'part', patch),
          componentName: selComp?.name,
          anyHidden: anyHidden(hid), onShowAll: () => lookStore.showAll(),
        }} />
        {sketchBar}
        {boxRect ? <div class={'sketch-box' + (boxRect.crossing ? ' crossing' : '')} style={{ left: Math.min(boxRect.x0, boxRect.x1) + 'px', top: Math.min(boxRect.y0, boxRect.y1) + 'px', width: Math.abs(boxRect.x1 - boxRect.x0) + 'px', height: Math.abs(boxRect.y1 - boxRect.y0) + 'px' }} title={boxRect.crossing ? t('app.sketch.box.crossing') : t('app.sketch.box.window')} /> : null}
        {sketching && !sketchToolId && !entityOut && hoverTip ? <div class="sketch-tip" style={{ left: hoverTip.x + 'px', top: hoverTip.y + 'px' }}>{hoverTip.text}</div> : null}
        {sketching ? <SketchAnnotations items={annotItems} hot={hotConstraint} onEdit={startDimEdit} onHover={hoverConstraint} onToggleDriven={toggleDriven} /> : null}
        {sketching && dimEdit ? <SketchFields cls="dimedit" fields={[{ id: 'value', label: 'app.sketch.field.value', value: dimEdit.value, locked: true, unit: 'length', ...(dimEdit.expr ? { expr: dimEdit.expr } : {}) }]} x={dimEdit.x} y={dimEdit.y} onField={dimEditEvent} /> : null}
        {chrome.rightPalette ? <SketchToolStrip layout="palette" active={sketchToolId} onPick={selectTool} labels={ws.toolLabels} /> : null}
        {emptyPart1 ? (
          <div class="start-card" role="region" aria-label={t('app.start.title')}>
            <b>{t('app.start.title')}</b>
            <span>{t('app.start.text')}</span>
            <div class="start-planes">
              {planeIds.map((id) => (
                <button key={id} class={'rb-btn' + (refPlane(refSel) === id ? ' on' : '')} onMouseEnter={() => setRefHover(id)} onMouseLeave={() => setRefHover(null)} onClick={() => startNewSketch(id)}>
                  <Icon name={'sketch-new-' + id} size={18} /> {t('app.start.sketchOn', { plane: t('app.ref.' + id) })}
                </button>
              ))}
            </div>
            <span class="start-or">{t('app.start.or')}</span>
          </div>
        ) : null}
        <div class="cube-tools">
          <Tip label={t('cmd.fit')} keys="Z" side="bottom"><button aria-label={t('cmd.fit')} onClick={() => viewport?.fit()}><Icon name="fit" size={18} /></button></Tip>
          <Tip label={ortho ? t('app.view.parallel') : t('app.view.perspective')} side="bottom"><button aria-label={t('cmd.toggle-projection')} aria-pressed={ortho} class={ortho ? 'on' : ''} onClick={toggleProjection}><Icon name={ortho ? 'projection-ortho' : 'toggle-projection'} size={18} /></button></Tip>
        </div>
        {sketching && !sketchToolId && entityOut ? <SketchFields fields={entityOut.fields} x={entityOut.x} y={entityOut.y} onField={entityFieldEvent} /> : null}
        {sketching && toolOut ? <SketchFields fields={toolOut.fields} x={toolOut.x} y={toolOut.y} onField={fieldEvent} /> : null}
        {sketching && toolOut && (toolOut.pending?.length || toolOut.snapLabel) ? <div class={'sketch-pending' + (toolOut.snapModel ? ' model' : '')} style={{ left: toolOut.x + 16 + 'px', top: toolOut.y - 8 + 'px' }}>{[...(toolOut.pending ?? []), toolOut.snapLabel].filter(Boolean).join(' · ')}</div> : null}
        <div id="vp-layer">
          <BusyOverlay busy={store.busy.value} onCancel={async () => { await controller.cancel(); redraw((n) => n + 1); }} />
          <Toast notices={store.notices.value} />
        </div>
      </div>
      {rightMode === 'docked' ? right : null}
      {ws.drawerOpen ? (
        <Drawer active={drawerTab} onTab={setDrawerTab} onClose={toggleDrawer}
          tabs={[
            { id: 'history', label: t('app.drawer.history'), badge: entries.length, content: <HistoryLog entries={entries} here={records.length} filter={histFilter} onFilter={setHistFilter} onGoto={gotoStep} /> },
            { id: 'diagnostics', label: t('app.drawer.diagnostics'), badge: failures.length || (controller.rejection() ? 1 : 0), bad: failures.length > 0 || !!controller.rejection(), content: (() => {
              const dg = controller.diagnosis(); const rej = controller.rejection();
              if (dg.roots.length) return <DiagnosticsCard diagnosis={dg} onSelect={selectFailed} onUndo={records.length ? () => { void controller.undo().then(() => redraw((n) => n + 1)); } : undefined} />;
              if (rej) return <DiagnosticsCard diagnosis={rej.diagnosis} onSelect={selectFailed} note={t('diag.rejected')} />;
              return failures.length ? (
                <div>{failures.map((f) => <div key={f.id} class="issue"><b>{f.code ?? t('app.diagnostics.error')}</b> {t('app.diagnostics.on')} {f.id}<div class="why">{f.hint}</div><button class="btn" onClick={() => selectFailed(f.id)}>{t('app.diagnostics.show')}</button></div>)}</div>
              ) : <div class="empty">{t('app.diagnostics.none')}</div>;
            })() },
            { id: 'inspect', label: t('app.drawer.inspect'), content: <InspectPanel {...inspect.props} /> },
            { id: 'check', label: t('app.drawer.check'), badge: check.badge, bad: check.badge > 0, content: <CheckPanel {...check.props} /> },
            { id: 'console', label: t('app.drawer.console'), content: (
              <pre class="log">{store.notices.value.map((n) => `${n.level.padEnd(5)} ${n.text}`).join('\n') || t('app.console.none')}</pre>
            ) },
          ]} />
      ) : null}
      {drawingOpen && doc ? (() => {
        const h = makeDrawingHost(controller, { save: (n, d, m) => platform.saveFile(n, d, m), notify: (x, l) => store.notify(x, l ?? 'info'), changed: () => redraw((n) => n + 1), close: () => setDrawingOpen(false) });
        return h ? <DrawingWorkspace host={h} /> : null;
      })() : null}
      <div class="status-wrap">
        <StatusBar notices={store.notices.value} hover={hoverLabel(store.hover.value)} busy={store.busy.value}
          sketch={sketching ? <SketchReadout snapOn={sketchPrefs.snapOn} gridOn={sketchPrefs.gridSnap} gridBase={sketchPrefs.gridSpacing}
            onSnap={(on) => updatePrefs({ snapOn: on })} onGrid={(on) => updatePrefs({ gridSnap: on })} onSpacing={(mm) => updatePrefs({ gridSpacing: mm })} /> : <ModelReadout />}
          items={[
            ...(selText ? [{ label: t('app.status.selection'), value: selText }] : []),
            { label: t('app.status.features'), value: String(rows.length) },
            { label: t('app.status.faces'), value: String(facts.faces) },
            { label: t('app.status.triangles'), value: String(facts.triangles) },
            ...(check.chip ? [check.chip] : []),
            ...(facts.rebuildMs !== null ? [{ label: t('app.status.lastRebuild'), value: t('app.status.secondsUnit', { value: (facts.rebuildMs / 1000).toFixed(1) }) }] : []),
            { label: t('app.status.errors'), value: String(failures.filter((f) => !f.blockedBy).length) + (failures.some((f) => f.blockedBy) ? ' ' + t('app.status.blocked', { n: failures.filter((f) => f.blockedBy).length }) : ''), tone: failures.length ? ('err' as const) : ('ok' as const) },
          ]}
          drawerOpen={ws.drawerOpen} onToggleDrawer={toggleDrawer} />
      </div>
      {palette ? <CommandPalette commands={sketchCommands.length ? [...commands, ...sketchCommands] : commands} pinned={['view-iso', 'fit', 'undo', 'redo', 'samples', 'settings']} onClose={() => setPalette(false)} /> : null}
      {samples ? <SamplesDialog samples={samples} thumbBase={base} onClose={() => setSamples(null)} recent={files.recent()} onPickRecent={openRecent}
        onPick={(s) => { setSamples(null); guarded(async () => { const r = await fetch(s.url); await load(await r.text(), { file: null }); files.noteSample(s.id, s.title, s.url); }); }} /> : null}
      {restore ? <RestoreDialog name={restore.name} savedAt={restore.savedAt}
        onNew={() => { clearAutosave(browserKV()); setRestore(null); }}
        onRestore={() => { const a = restore; setRestore(null); void load(JSON.stringify(a.doc), { restored: true }); }} /> : null}
      {saveAsOpen ? <SaveAsDialog initial={files.partName ?? doc?.name ?? 'Part1'} onCancel={() => setSaveAsOpen(false)}
        onSave={async (fileName) => { setSaveAsOpen(false); const d = controller.document(); if (d) finishSave(await files.save(d, { saveAs: true, fileName })); }} /> : null}
      {dragging ? <DropOverlay /> : null}
      <CatalogGhost />
      {guard ? <DiscardDialog name={doc?.name ?? ''} onCancel={() => setGuard(null)}
        onDiscard={() => { const go = guard; setGuard(null); void go(); }}
        onSave={async () => { const go = guard; setGuard(null); await commands.find((c) => c.id === 'save')!.run(); if (!isDirty()) void go(); }} /> : null}
      {settings ? <SettingsDialog workspace={ws} onChange={(p: Partial<Workspace>) => store.setWorkspace(p)} onPreset={(n) => store.applyPreset(n)} onResetLayout={() => resetLayout(store)} onClose={() => setSettings(false)}
        locale={localeSignal.value} locales={[...availableLocales(), ...(import.meta.env.DEV ? [PSEUDO] : [])]} pseudo={PSEUDO}
        onLocale={(c) => { setLocale(c); write('cad.locale', c); }}
        navPrefs={navPrefs} onNavPrefs={changeNav}
        triPrefs={triPrefs} onTriPrefs={(patch) => { const next = { ...triPrefs, ...patch }; setTriPrefs(next); saveTriPrefs(next); }}
        sketchPrefs={sketchPrefs} onSketchPrefs={(patch) => { const next = { ...sketchPrefs, ...patch }; setSketchPrefs(next); saveSketchPrefs(next); }}
        theme={theme} onTheme={(v) => { setTheme(v); applyTheme(v); write('cad.theme', v); viewport?.refreshTheme(); }} /> : null}
    </div>
    </VarsContext.Provider>
  );
}

render(<App />, document.getElementById('root')!);
