import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createBrowserKernel } from '@ck/kernel-client/browser';
import { Session, type EditOp } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { signal } from '@preact/signals-core';
import { availableLocales, locale as localeSignal, PSEUDO, setLocale } from '@kit/i18n';
import { BODY, createStore, MODE_FILTER, type DisplayLayer, type PickFilterKind, type SelectionMode, type Workspace } from '@kit/store';
import { toBodyMode } from './select/actions';
import { summarize } from './select/actions';
import { summaryText } from './select/summary';
import { SelectionList, chipsOf } from './select/SelectionList';
import { useRevealInTree } from './useRevealInTree';
import { isBodyName } from './select/model';
import { FilterMenu } from './select/FilterMenu';
import { Viewport, markerStyleFor } from '@kit/viewport';
import { autoCutFlip, cutProblem, editorFixes } from './editorFixes';
import { defaultExtrudeOp, KERNEL_SUPPORTS_NEW_BODY, nextBodyName } from './extrudeOp';
import { featureLabel, loftMoveAfter, pipeCutNotice } from './featureCreators';
import { tangentChainOn, chainSelection, chainRefs } from './roundChain';
import { pickValue, LIST_PATHS, hasPointEntities, holeOps, revolveOps, type FeatureActions } from './featureCommands';
import { selectionInField } from './listPick';
import { annotate, gridCapture, expandFocus, rectangleAxisLocks, layoutDimensions, applySnapConstraints, boxSelect, conflictingGeometry, constraintTargets, definitionMap, deleteEntity, fullyDefine, makeDriven, makeDriving, refAnnotations, refDimsOf, shownValue, removeDimension, removeRefDim, toggleRadiusDiameter, markNewAsConstruction, setConstruction, entityDims, entityShape, movePoint, pickEntity, pointDims, removeConstraintById, setConstraintValue, setEntityDim, setPointDim, snapAt, toolById, OFFSET_FACE_KEY, sketchReferenceEdges, buildModelSnaps, attachModelSnap, EMPTY_MODEL_SNAPS, type ExtrusionSpan, type ModelSnaps, type FieldSpec, type PanelSpec, type SnapHit, type ToolEnv, type ToolEvent, type ToolOutput } from '@kit/sketch';
import type { SketchPreviewShape } from '@kit/viewport';
import {
  errorText, BusyOverlay, CommandPalette, type Command, Drawer, FeatureEditor, FeatureTree, HistoryLog, Icon, InlineName, Inspector, Ribbon, Slot, commandToItem, StatusBar, Tip, Toast, VarsContext, Sheet, BottomNav,
  type HistoryFilter, type SheetSnap, ToolTray, SPLIT_FRACTION, BROWSE_FRACTION,
} from '@kit/ui';
import { setIconSet, type IconSet } from '@kit/ui';
import { createWebPlatform, fileText } from '@kit/platform';
import { Controller, type ViewEdge, type ViewSink } from './controller';
import { TabSet } from './tabs/tabSet';
import { StartCard } from './StartHereCard';
import { showStartCard, isStartDismissed, dismissStart, resetStartDismissal, viewportContentRev, startDismissed } from './startContent';
import { TabStrip, type TabInfo } from './tabs/TabStrip';
import { DocSwitcher } from './tabs/DocSwitcher';
import { DiagnosticsCard } from './DiagnosticsCard';
import { ViewNav } from './ViewNav';
import { newBreakage, type DiagRoot, type Diagnosis } from './errorSummary';
import { maxSizeOf, maxSizeText } from './diagnosticsText';
import { dxfToSketch, svgToSketch } from '@kit/io';
import { importDxfIntoSketch, importErrorNotice } from './dxfSketch';
import { importSvgIntoSketch, svgErrorNotice } from './svgSketch';
import { EXTRACT_KEYS, planExtract, planFolderExport, REFUSAL_KEYS, type ExtractRefusal, type FolderFormat } from './folderExport';
import { fileStem, exportCkpart, exportGlb, exportObj, exportThreeMf, exportSketchDxf, exportStep, exportStl, exportViewsDxf, meshRequest, type ExportNotice, type ExportResult } from './exportFiles';
import { buildCommands, matchShortcut, EXPORT_KINDS, type ExportKind } from './commands';
import { useTreeInteraction } from './useTreeInteraction';
import { treeKey } from './treeCommands';
import { ExportMenu, MESH_QUALITIES, type MeshQuality } from './ExportMenu';
import { ContextMenu } from './ContextMenu';
import { HISTORY_FOLDER } from './historyFolder';
import { toEntries, type Rejection } from './history';
import { CheckPanel } from './CheckPanel';
import { useDesignCheck } from './useDesignCheck';
import { InspectPanel } from './inspect/InspectPanel';
import { useInspect } from './inspect/useInspect';
import { QuickMeasure, useQuickMeasure } from './inspect/QuickMeasure';
import { LibraryDialog, type SampleEntry } from './LibraryDialog';
import { partItem } from './library/entries';
import { DiscardDialog } from './DiscardDialog';
import { KnurlExportAsk, KnurlExportFailed } from './KnurlExportDialog';
import { BakeCache, idbBakeBackend } from './bakeCache';
import { chooseKnurlExport, type BakeRun } from './knurlExport';
import { mayBeSlow } from './exportKnurl';
import { KNURL_BAKE_SECONDS, loadExportPrefs, saveExportPrefs, type ExportPrefs } from './exportPrefs';
import { FileManager } from './files/fileManager';
import { seemsZUp } from './files/importOrient';
import { SKP_DEFAULT_ORIENT, nextSkpOrient, skpImportOpts, skpNotices, type SkpOrient } from './files/skpImport';
import { stripThumbnail } from './files/docThumb';
import { createSaveThumbs } from './files/saveThumb';
import { whenIdle } from './library/thumbs';
import { browserKV } from './files/storage';
import { withCacheCap } from './kernelCaps';
import { createKernelRouter, chipOf } from './kernelService';
import { packText, unpackDoc, warmPackCache, problemKey, packDocCached, assetSize, lightDoc } from './files/assets';
import { createAutosaver, clearAutosave, AUTOSAVE_ASSET_BUDGET, readAutosave, worthRestoring, isTabs, sessionParts, type Autosave, type AutosaveTabs } from './files/autosave';
import { cleanSigAfterSave, mayClearAutosave } from './files/saveState';
import { RestoreDialog, RecoverDialog, SaveAsDialog, DropOverlay } from './files/FileDialogs';
import { ImportReportDialog } from './files/ImportReportDialog';
import { allSolid, importSummary, needsRepair, parseParts, parseRepairReport, repairOp, repairSummary, type ImportPart } from './files/importReport';
import { partOfStep, VOLUME_TOLERANCE } from './files/sldprtImport';
import { createSnapshots, idbBackend, featureCount } from './files/snapshots';
import { createViewCache, createBuildId, findSnapshot, keepSnapshot, idbViewBackend, embedSnapshot, checkEmbedded, takeEmbedded, type ViewData } from './files/viewCache';
import { cachedChip } from './files/cachedChip';
import { createAgentLink } from './agentLink/link';
import { dragHasFiles, planDrop } from './files/drop';
import { dropKind, partNameOf, OPEN_ACCEPT, IMPORT_ACCEPT, type DropKind } from './files/names';
import { importFcstd, resolveReferences, fcstdResolvers } from '@kit/fcstd';
import { importSolidcraft, kernelResolvers, kernelStepTools, type ScPart } from '@kit/solidcraft';
import type { RecentEntry } from './files/recent';
import { DisplayMenu } from './DisplayMenu';
import { createAnalysisStore } from './analysisState';
import { AnalysisLegend } from './AnalysisControls';
import { createLookStore, effectiveAppearance, componentAppearances, componentKey, anyHidden, LOOK_KEY } from './look';
import { VariablesPanel } from './VariablesPanel';
import { BodiesPanel } from './BodiesPanel';
import { combineBodyOps, copyBodyOps, freeBodyName, removeBodyOps, renameBodyOps, usedBodyNames, type BodyTarget, type CombineOp } from './bodyOps';
import { bodyShapes, faceMoments, faceVolumes, hideOthers, matchLumps, listBodies, readBodyFields, resolveFaceLooks, rowOfName, setHidden, solo, showAll, splitBodies, viewSpec, withLook, withLooks, withName, type BodyLookSpec, type BodyRow, visibleMesh } from './bodies';
import { ScriptPanel } from './ScriptPanel';
import { isTextEntry, scriptOwnsKey } from './keyGuard';
import { runsInPlace } from './scriptTarget';
import { shouldWarnOnUnload } from './urlFlags';
import { evaluate as evaluateScript, runScript } from '@kit/script';
import { scopeOf } from './variables';
import { MaterialEditor, type MaterialChoice } from './MaterialEditor';
import { findMaterial, loadUseColour, appearanceOfMaterial } from './materials';
import { HoleEditor } from './HoleEditor';
import { CornerHolesPanel, plateFromOutline, type PlateInfo } from './CornerHolesPanel';
import { KnurlWizard } from './KnurlWizard';
import { ScrewWizard } from './ScrewWizard';
import { DEFAULT_SCREW, screwIssue, screwOps, type ScrewParams } from './screw';
import { WasherWizard } from './WasherWizard';
import { DEFAULT_WASHER, washerIssue, washerOps, type WasherParams } from './washer';
import { holeFromPick, type HoleResult } from './washerHole';
import { BearingWizard } from './BearingWizard';
import { FramePanel } from './frame/FramePanel';
import { adoptFrameLibraries, loadStoredLibrary } from './frame/frameUserLib';
import { Sketch3dPanel, type Sketch3dHost, type Sketch3dResult } from './sketch3d/Sketch3dPanel';
import { draftOf as sk3dDraftOf, emptyDraft as sk3dEmpty, normalPlane as sk3dNormalPlane, sketch3dCurves, sketch3dOps, type Draft3, type P3 as P3d, type SnapCandidate } from './sketch3d/model';
import { MeshPanel } from './meshes/MeshPanel';
import { MeshImportDialog } from './meshes/MeshImportDialog';
import { ImportKindDialog, readChoice, type ImportKind } from './files/ImportKindDialog';
import { orientOf, SKP_MESH_MAX_FACES, SKP_ROT, skpMeshRecord } from './files/skpMesh';
import { meshesOf, matRuns, nextMeshId, matrixOf, decode as decodeMesh, pickMeshes, nearestOnMeshes, projectAlong, allWorldBox, worldBox, MESH_KEY, type MeshRec } from './meshes/meshDoc';
import { buildRecord, guessUnit, probeStl, type MeshProbe } from './meshes/meshImport';
import { planeThrough, type PlaneKind } from './meshes/meshEdit';
import { treeMeshRows } from './meshes/meshTree';
import type { StlUnit } from '@kit/io';
import { frameDrawing, refreshTables } from './frame/frameDrawing';
import { sanitizeDrawing } from './drawing/model';
import { DEFAULT_FRAME, ensureForDocument, ensureProfiles, partMaterialFor, type FrameReport, jointFaces, jointOfFace, frameFeature, frameOps, freeId, paramsFromFeature, readFrames, skeletons, type FrameParams } from './frame/frameLib';
import { bearingIssue, bearingOps, DEFAULT_BEARING, seatOnFace, type BearingParams } from './bearing';
import { knurlDependents, knurlOwner, knurlReplaceOps, paramsFromCosmetic, replaceCosmetic, type KnurlOwner } from './knurlEdit';
import { DEFAULT_KNURL, cosmeticToCutOps, knurlCosmetic, knurlIssue, knurlOps, knurlTarget, readCosmeticKnurls, suggestCount, suggestDepth, type KnurlParams } from './knurl';
import { DEFAULT_CORNER, faceOutline, readCornerHoles, withCornerHoles, type CornerRecord, type Pt as HolePt } from './cornerHoles';
import { holeDiameter, loadHolePrefs, newHole } from './holeData';
import { optionsFor } from './FeatureOptions';
import { asSurfaceOp, closeWithLineOp, openProfile, thinOf } from './thinRules';
import { ThreadEditor } from './ThreadEditor';
import { followedFaces, type ThreadEntry } from './patternThreads';
import { GearEditor } from './GearEditor';
import { gearCommitOps, gearOwner, readGear, type GearParams } from './gearData';
import { PropellerWizard } from './PropellerWizard';
import { MarineWizard } from './MarineWizard';
import { DEFAULT_MARINE, MarineError, marineErrors, marineOps, marineOwner, marinePlan, marineSpacings, type MarineParams } from './marineData';
import { ImpellerWizard } from './ImpellerWizard';
import { DEFAULT_IMPELLER, ImpellerError, impellerErrors, impellerOps, impellerOwner, impellerPlan, impellerStationsTried, type ImpellerParams } from './impellerData';
import { DEFAULT_PROP, PropError, freePrefix, propErrors, propOps, propOwner, propPlan, type PropParams } from './propData';
import { defineVariable, readVars } from './variables';
import { dimensionMenu } from './sketchDimMenu';
import { cylinderOfFace, cylindersOfFaces, faceExtent, holeWallFaces, isHoleWall, loadThreadPrefs, threadGroup, threadOpsForFaces } from './threadData';
import { holeThreadEditOps, linkedThreads, type HoleThread } from './holeThread';
import type { ThreadEntryLike } from './handles/threadHandle';
import { SketchToolStrip, SketchRailSections, sketchRibbonGroups } from './SketchToolStrip';
import { ToolRail } from './ToolRail';
import { selectionKind } from './menuModel';
import { useSheet } from './sheet/useSheet';
import { applyCornerPick, cornerSelectionKeep } from './sheet/options';
import { flangeActions, setSpanPicked } from './sheet/flangeActions';
import { legFrame, nearestOnPolyline, patchSpanPoints, profileOf, segBounds, spanOf } from './sheet/flangeShape';
import { freeFeatureNumber, outlineCandidates } from './sheet/flangeSketch';
import { legGeometry } from './sheet/legGeometry';
import { tabForSheetChange } from './sheet/model';
import { RIBBON_LAYOUT, SKETCH_TAB, activeRibbonTab, docKindOf, tabForKindChange, idleDuringEdit, isFileCommand, sketchChrome, type DocKind } from './toolbarModel';
import { SketchFields, appendSeed } from './SketchFields';
import { TextPanel } from './TextPanel';
import { PatternPanel } from './PatternPanel';
import { EquationPanel } from './EquationPanel';
import { makeFontsApi } from './textFonts';
import { webFontSource } from './fonts';
import { isText, patchText, textFields, textNotes, textOutlineOf, type TextPatch } from '@kit/sketch';
import { equationFields, equationSpec, isEquation, patchEquation, type EquationFields, type EquationResult } from '@kit/sketch';
import { SketchReadout, ModelReadout, CursorLabel, readout, clearReadout } from './sketchReadout';
import { uppForPercent } from './sketchStatus';
import { DEFAULT_SKETCH_PREFS, constrainsFromGuides, escapeCancelsSketch, lookChipNeeded, loadSketchPrefs, saveSketchPrefs, toToolSettings, type SketchPrefs } from './sketchPrefs';
import { SketchAnnotations, type AnnotationItem } from './SketchAnnotations';
import { separateMarks, visibleChips } from './annotChips';
import { useSketchSessionGone, useEditorGone } from './sessionGone';
import { projectShape, labelBox } from './dimGraphics';
import { SketchBar, SketchNotes, type SketchControls } from './SketchBar';
import { SketchConstraintList } from './SketchConstraintList';
import { SketchReportSheet, SketchReportWindow } from './SketchReport';
import { sketchReport } from './reportData';
import { SettingsDialog } from './SettingsDialog';
import { applyTheme, asTheme, type Theme } from './theme';
import { loadIconSet, chooseIconSet } from './iconSetPref';
import { t } from './i18n';
import { featureRows, refRows, treeKnurlRows } from './treeModel';
import { runningBundle, watchForUpdate } from './updateCheck';
import { runsInstalled, registerServiceWorker, watchInstall, type InstallEvent } from './installPrompt';
import { installDismissGuard } from './dismissGuard';
import { useSignals } from './useSignals';
import { useHandles } from './useHandles';
import type { DepthArrowCtx } from './handles/depthArrow';
import { profileCentre } from './handles/sizeBox';
import { registerShapeSelect, selectShapeFeature } from './shapeSelect';
import { CatalogPanel, CatalogGhost } from './catalog/CatalogPanel';
import type { LibraryActions } from './library/LibraryBrowser';
import { useCatalog } from './catalog/useCatalog';
import { libraryRegistry } from './library';
import { makeThumbRenderer } from './library/renderThumb';
import { liveSources } from './library/insert';
import { insertPart, openText, downloadName } from './library/actions';
import { catalogActive, catalogPlane, setShapeSelector } from './catalog/state';
import { useTriBall } from './triball/useTriBall';
import { docUpAxis, loadNavPrefs, saveNavPrefs, type NavPrefs } from './navPrefs';
import { loadMassPrefs, saveMassPrefs, setMassPrefs, type MassPrefs } from './massPrefs';
import { cacheSize, clearOnlineCache, library as onlineLibrary, online, setOnlineEnabled, startOnlineTextures } from './onlineRuntime';
import { loadTriPrefs, saveTriPrefs, type TriPrefs } from './triball/triballPrefs';
import { AssemblyPanel, type AsmHost, type Section as AsmSection } from './assembly/AssemblyPanel';
import { createAssemblyState } from './assembly/state';
import { DrawingWorkspace } from './drawing/DrawingWorkspace';
import { layoutHandles, layoutStyle, resetLayout } from './useLayout';
import { asLayoutPref, effectiveWorkspace, LAYOUT_KEY, layout, layoutPref, viewportInfo, watchViewport } from './layoutMode';
import { makeDrawingHost } from './drawing/host';
import { displayBody } from './assembly/display';
import { insertIds, isExploded } from './assembly/model';
import { faceOwner, viewOwner, componentNames } from './treeActions';
import './tokens.css';
import './app.css';
import './toolbar.css';

const base = import.meta.env.BASE_URL;
const platform = createWebPlatform({ base });
const files = new FileManager(platform, browserKV());
/** True while a script run builds its part: nothing is autosaved meanwhile. */
let scriptRunning = false;
/** A SolidCraft import in progress (the file, how far it has read, and how to stop it); null when none runs. */
/** The line the busy overlay shows instead of "Rebuilding model" while an export cuts knurl grooves. */
const busyNote = signal<string | null>(null);
const importing = signal<{ name: string; done: number; total: number; abort: () => void; /** 'reading' while the importer works, 'building' while the finished part is loaded into the kernel (it cannot be stopped) */ phase?: 'reading' | 'building' } | null>(null);
const autosaver = createAutosaver(browserKV(), { busy: () => store.busy.value || scriptRunning || !!importing.value, onProblem: (r) => store.notify(t(`files.autosave.${r}`), 'warn') });
/** Rolling snapshots of the open part (IndexedDB): whatever happens to the live document, an earlier state can be restored. */
const snapshots = createSnapshots(idbBackend());
/** Stored views of parts (IndexedDB): a part opens on its stored view while the kernel rebuilds it. Keyed by the recipe and the kernel's wasm hash. */
const viewCache = createViewCache(idbViewBackend());
let wasmBuild: (() => Promise<string | null>) | null = null;
/** The build id of the kernel the next session talks to; null (no cache) for a local service, whose build the app does not hash. */
const kernelBuild = (): Promise<string | null> => {
  if (kernelRouter.prefs.value.mode !== 'builtin') return Promise.resolve(null);
  return (wasmBuild ??= createBuildId(() => fetch(platform.wasmUrl()).then((r) => { if (!r.ok) throw new Error('wasm'); return r.arrayBuffer(); }))) ();
};
/** Results of the export bake (cosmetic knurls cut for a file): exporting the same part again does not cut again. Kept in IndexedDB where there is any. */
const bakeCache = new BakeCache({ build: kernelBuild, backend: (() => { try { return idbBakeBackend(); } catch { return null; } })() });
const startupAutosave: Autosave | null = (() => { const a = readAutosave(browserKV()); return worthRestoring(a) ? a : null; })();
const read = (key: string): unknown => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ } };
import { sketchTools, sketchShapes, shapeAtPoint, sketchOpenChains, nextExtrudeTarget, defaultCutRegions, defaultShapeIds, toggleRegion, withExactEdges } from '@kit/sketch';
import { defaultThickness } from './thinRules';
loadStoredLibrary();   // the user's own frame stock and fittings, from this browser
/** The compact vertical rail at the left edge: history, then the feature tools. Views are not here (they are on the cube and the
 *  View tab); a button only appears if its command exists. */
const VIEW_KEYS: Record<string, 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom' | 'iso'> = { '1': 'top', '2': 'front', '3': 'right', '4': 'back', '5': 'left', '6': 'bottom', '7': 'iso' };
/** Sketch tools whose clicks pick a curve of the sketch. */
const OBJECT_SNAPS_OFF: SketchPrefs['snaps'] = Object.fromEntries(Object.keys(DEFAULT_SKETCH_PREFS.snaps).map((k) => [k, k === 'grid'])) as SketchPrefs['snaps'];
const ENTITY_PICK_TOOLS = new Set<string | null>(['offset']);
const SKETCH_TOOL_KEYS = new Map(sketchTools().flatMap((x) => (x.key ? [[x.key, x.id] as const] : [])));
const savedLocale = read('cad.locale');
const savedTheme = asTheme(read('cad.theme'));
applyTheme(savedTheme);
const savedIconSet = loadIconSet();
setIconSet(savedIconSet);
if (typeof savedLocale === 'string') setLocale(savedLocale);
layoutPref.value = asLayoutPref(read(LAYOUT_KEY));
watchViewport();   // the layout (phone, tablet, desktop) follows the window, the pointer and Settings
const lookStore = createLookStore(read(LOOK_KEY));
const store = createStore((read('cad.display') as object | null) ?? {}, read('cad.workspace'));

// One kernel for the app (the built-in wasm worker, or a local native service chosen in Settings); cancel() restarts it.
/** Curated fonts are fetched from /fonts when picked (or when a document names one). */
const fontSource = webFontSource(base);
const kernelRouter = createKernelRouter({
  kv: browserKV(),
  makeBuiltin: () => createBrowserKernel(platform.wasmUrl()),
  wrap: withCacheCap,
  notify: (text, level) => store.notify(text, level),
  // the kernel under the open document changed (a new choice in Settings, or the service failed): reopen it there, keeping the undo history
  reopen: () => { void controller.cancel(); },
});
void kernelRouter.transport();   // start connecting at launch, as the built-in worker always did
window.addEventListener('pagehide', () => kernelRouter.dispose());
let session: Session | null = null;
let viewport: Viewport | null = null;
const asmState = createAssemblyState();
const analysisStore = createAnalysisStore();
let lastBody: unknown = null;
/** The cosmetic knurl the Knurl wizard is previewing (drawn with the saved ones, never saved). */
let knurlDraft: ReturnType<typeof knurlCosmetic> | null = null;
/** Index of the saved cosmetic knurl the wizard is editing: it is not drawn while its replacement is previewed. */
let knurlHidden: number | null = null;
/** What the viewport is told about bodies: their looks, the hidden ones and the per-face colours. */
function bodyViewNow(): ReturnType<typeof viewSpec> {
  const rows = bodyRowsFor(false);
  const imp = controller.importedLook();   // an imported SketchUp body: its colours come from the file, not from the document
  const spec = viewSpec(rows, { ...resolveFaceLooks(readBodyFields(controller.document()).faceAppearance, rows.flatMap((r) => r.faces)), ...imp?.faces });
  if (imp) { spec.bodies.push(...imp.bodies); Object.assign(spec.looks, imp.looks); }
  const knurls = [...readCosmeticKnurls((controller.document() as unknown as Record<string, unknown> | null)?.cosmeticKnurls).filter((_, i) => i !== knurlHidden), ...(knurlDraft ? [knurlDraft] : [])];
  if (knurls.length) spec.knurls = knurls;
  return spec;
}
/** The Bodies of what is on screen with their names, looks and visibility from the document (`volumes`: also the volume of each, for the list). */
function bodyRowsFor(volumes: boolean): BodyRow[] {
  const m = controller.selModel();
  if (!m) return [];
  const d = controller.document();
  const feats = new Map((d?.features ?? []).map((f) => [f.id, (f as { name?: string }).name ?? null] as const));
  // the names the document gives its bodies: asked of the kernel (controller.lumps) and matched to the list by volume and centre
  const docNames = controller.lumps.length ? matchLumps(bodyShapes(m.bodies(), faceMoments(controller.bodyFaces())), controller.lumps) : undefined;
  return listBodies(m.bodies(), readBodyFields(d), {
    featureName: (id) => feats.get(id) ?? null, ...(docNames ? { docNames } : {}), defaultName: (n) => t('bodies.default', { n }),
    ...(volumes ? { volumes: faceVolumes(controller.bodyFaces()) } : {}),
  });
}
/** The 3D sketch being edited by the 3D Sketch panel: the panel draws it itself, so the viewport leaves its committed curves out meanwhile. */
let sk3dEditing: string | null = null;
/** The curves of the document's 3D sketches added to the body (the kernel draws sketch3d features nowhere): a part that is only 3D sketches gets an empty solid to hang them on. */
const withSketch3d = (b: unknown, d: { features: unknown[] } | null | undefined): unknown => {
  const feats = (d?.features ?? []) as Array<Record<string, unknown>>;
  const curves = feats.some((f) => f.type === 'sketch3d') ? sketch3dCurves(feats, sk3dEditing) : [];
  // reference meshes (an imported STL) count for the framing and the ground grid, as the curves do
  const mb = allWorldBox(meshesOf(d));
  if (!curves.length && !mb) return b;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const c of curves) for (const q of c.pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], q[i]); hi[i] = Math.max(hi[i], q[i]); }
  if (mb) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], mb.min[i]); hi[i] = Math.max(hi[i], mb.max[i]); }
  const body = (b ?? { mesh: { positions: new Float32Array(0), normals: new Float32Array(0), triFace: new Int32Array(0), faceIds: [] as string[] }, edges: [], box: { min: lo, max: hi }, sketches: [], curves: [], planes: [], markers: [] }) as { mesh: { triFace: ArrayLike<number> }; box: { min: number[]; max: number[] }; curves?: unknown[] };
  const empty = body.mesh.triFace.length === 0;
  const box = empty || mb ? { min: body.box.min.map((v, i) => Math.min(v, lo[i])), max: body.box.max.map((v, i) => Math.max(v, hi[i])) } : body.box;
  return { ...body, box, curves: [...(body.curves ?? []), ...curves] };
};
/** The body as it is drawn: components hidden or moved apart in the exploded view (the kernel's body is not touched), with the 3D sketches' curves. */
const shownBody = (b: unknown): unknown => {
  const d = controller.document();
  if (!b || !d) return withSketch3d(b, d);
  return withSketch3d(displayBody(b as never, { inserts: insertIds(d as never), hidden: new Set(asmState.hidden.value), explode: asmState.explode.value, doc: d as never }), d);
};
/** The mesh the Mesh panel is previewing (shown in place of the saved record of that id, never saved until Done) and the one it has open. */
let meshPreview: MeshRec | null = null;
let meshOpen: string | null = null;
/** The reference meshes as shown: the document's, with the preview in place of its saved record. */
const meshesShown = (): MeshRec[] => meshesOf(controller.document()).map((m) => (meshPreview && meshPreview.id === m.id ? meshPreview : m));
/** Push the meshes to the viewport (shaded, placed by their matrix; the vertex arrays are shared, not copied). */
const applyMeshes = (): void => {
  viewport?.setMeshes(meshesShown().filter((m) => m.visible).map((m) => {
    const d = decodeMesh(m);
    void d.prepare();   // the picking tree is built now, in slices of a few ms, not on the first click
    const groups = matRuns(m);
    return { id: m.id, key: m.id + '|' + m.sig, vertices: d.mesh.vertices, indices: d.mesh.indices, matrix: matrixOf(m), color: m.color, opacity: m.opacity, wire: m.wire, selected: m.id === meshOpen, box: worldBox(m), ...(groups ? { groups } : {}) };
  }));
};
/** The component (insertPart row) selected in the tree, whose faces and edges are lit with the picked ones; null for any other row. */
let compSel: string | null = null;
const hlNames = (): string[] => {
  const d = compSel ? controller.document() : null;
  if (!compSel || !d) return [...store.selection.value];
  const inserts = insertIds(d as never);
  if (!inserts.has(compSel)) return [...store.selection.value];
  return [...new Set([...store.selection.value, ...componentNames([...controller.pickableNames('face'), ...controller.pickableNames('edge')], compSel, inserts)])];
};
/** After the meshes of the document changed (import, delete, undo, move): the viewport gets them and the body is told the new framing for the grid and Fit. */
const refreshMeshes = (fit = false): void => {
  if (!viewport) return;
  viewport.setHoldView(!fit);
  try { viewport.setBody(shownBody(lastBody) as never); viewport.setHighlight(hlNames()); } finally { viewport.setHoldView(false); }
  applyMeshes();
  if (fit) viewport.fit();
};
/** What the 3D Sketch panel reaches in the viewport and the document. */
const sketch3dHost: Sketch3dHost = {
  rayAt: (x, y) => (viewport?.rayAt(x, y) as { o: P3d; d: P3d } | null) ?? null,
  worldPerPixel: (p) => viewport?.worldPerPixel(p) ?? 1,
  setPlacement: (h) => viewport?.setPlacementHook(h ? { move: (x, y) => h.move(x, y), tap: (x, y) => h.tap(x, y), ...(h.leave ? { leave: h.leave } : {}) } : null),
  setHandles: (specs, sink) => viewport?.setHandles(specs, sink),
  dragging: () => !!viewport?.handleDragging(),
  upAxis: () => viewport?.getUpAxis() ?? 'y',
  mesh: () => {
    const ms = meshesShown().filter((m) => m.visible);
    if (!ms.length) return null;
    return {
      hit: (ray) => { const h = pickMeshes(ms, ray); return h ? { pos: h.pos, normal: h.normal } : null; },
      project: (p, dir) => (dir ? projectAlong(ms, p, dir) : nearestOnMeshes(ms, p))?.pos ?? null,
    };
  },
  planes: () => ((lastBody as { planes?: Array<{ id: string; frame: { o: number[]; z: number[] } }> } | null)?.planes ?? []),
  candidates: () => {
    const out: SnapCandidate[] = [];
    for (const e of controller.bodyEdges()) {
      const pts = e.pts;
      if (!pts || pts.length < 2) continue;
      out.push({ p: pts[0] as P3d, kind: 'endpoint' }, { p: pts[pts.length - 1] as P3d, kind: 'endpoint' }, { p: (e.mid ?? pts[pts.length >> 1]) as P3d, kind: 'midpoint' });
    }
    for (const f of (controller.document()?.features ?? []) as unknown as Array<Record<string, unknown>>) {
      if (f.type === 'sketch3d') {
        if (f.id === sk3dEditing) continue;
        for (const q of (f.points as Array<{ x: number; y: number; z: number }> | undefined) ?? []) out.push({ p: [q.x, q.y, q.z], kind: 'sketch' });
      } else if (f.type === 'sketch') {
        const fr = controller.sketchFrameOf(String(f.id));
        if (!fr) continue;
        for (const q of (f.points as Array<{ x: number; y: number }> | undefined) ?? []) out.push({ p: [fr.o[0] + fr.x[0] * q.x + fr.y[0] * q.y, fr.o[1] + fr.x[1] * q.x + fr.y[1] * q.y, fr.o[2] + fr.x[2] * q.x + fr.y[2] * q.y], kind: 'sketch' });
      }
    }
    return out;
  },
};
/** What belongs to one open document: its own controller (session, undo history, selection), its file, its camera and its look. */
interface TabRec {
  id: number;
  controller: Controller;
  file: { fileName: string | null; handle: unknown | null; partName: string | null };
  cleanSig: string | null;
  hidden: { body: boolean; ids: string[] } | null;
  camera: ReturnType<Viewport['cameraState']> | null;
  /** A component opened from an assembly tab: where Done writes it back (the assembly's tab and the component's feature id). */
  parent?: { tabId: number; featureId: string; part: string; asm: string };
}
const tabSet = new TabSet<TabRec>();
/** What the viewport is told by the active document's controller (the others stay silent: their work finishes in the background). */
const realView: ViewSink = {
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
      viewport?.setBodyView(bodyViewNow(), false);
      viewport?.setBody(shownBody(b) as never);
      applyMeshes();
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
  };
const makeController = (tabId: number): Controller => {
  const live = () => tabSet.activeId === tabId;
  const view = Object.fromEntries(Object.entries(realView).map(([k, fn]) => [k, (...a: unknown[]) => { if (live()) (fn as (...x: unknown[]) => void)(...a); }])) as unknown as ViewSink;
  const c = new Controller({
    store,
    view,
    kernel: {
      async open(doc: PartDoc) { session = new Session(doc, await kernelRouter.transport(), 'user'); return session; },
      cancel() { kernelRouter.cancel(); },
    },
    fonts: fontSource,
    bakeCache,
  });
  c.beforeUndo = (d) => { void snapshots.note(packDocCached(d).doc, d.name, 'undo'); };   // every undo first keeps the state it leaves
  // Rejected edits are not in the session history, so record them here whatever the source (UI, console, agent).
  const rawEdit = c.edit.bind(c);
  c.edit = async (ops, reason) => {
    await c.settled();   // after a cached open the edit waits for the rebuild, and the history is the real session's
    const at = c.history().length;
    const r = await rawEdit(ops, reason);
    if (!r.ok) {
      const hint = c.rejection()?.summary || r.hints?.map((h) => h.hint).join('; ') || r.schemaError || 'edit failed';
      rejections.value = [...rejections.value, { at, time: Date.now(), reason: reason ?? '', hint, ops }];
    }
    return r;
  };
  return c;
};
const newTabRec = (): TabRec => { const id = tabSet.nextId(); return { id, controller: makeController(id), file: { fileName: null, handle: null, partName: null }, cleanSig: null, hidden: null, camera: null }; };
/** The app talks to `controller` as ever; it is the active tab's controller. */
const controller: Controller = new Proxy({} as Controller, {
  get: (_t, k) => { const c = tabSet.active!.controller; const v = Reflect.get(c, k, c); return typeof v === 'function' ? v.bind(c) : v; },
  set: (_t, k, v) => { const c = tabSet.active!.controller as unknown as Record<PropertyKey, unknown>; c[k] = v; return true; },
});
const rejections = signal<Rejection[]>([]);
tabSet.add(newTabRec());
/** The Text panel's font picker; `apply` goes to the text edit of the current render. */
const textEditRef: { current: (patch: TextPatch) => void } = { current: () => {} };
/** The agent link: off at every start; the user turns it on in Settings, Agent link (docs/agent-bridge.md). */
startOnlineTextures();   // the viewport's textures come through the online library (the cache first; the network only when the setting is on)
const agentLink = createAgentLink({ controller, store: store as never });
const fontsApi = makeFontsApi({ controller, source: fontSource, apply: (p) => textEditRef.current(p) });
if (import.meta.env.DEV) {
  const hook = { controller, store };                                          // for the browser console
  Object.defineProperty(hook, 'viewport', { get: () => viewport });            // created later by an effect
  Object.assign(window, { __cad: hook });
}

/** While the view on screen is a stored one, nothing can be picked (the kernel has no state to answer for it yet): say so, once in a while. */
let lastPickHint = 0;
const pickBlocked = (): boolean => {
  if (!store.cached.value) return false;
  if (Date.now() - lastPickHint > 4000) { lastPickHint = Date.now(); store.notify(t('files.cache.pickWait'), 'info'); }
  return true;
};
const timed = async <T,>(f: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  try { return await f(); } finally { store.facts.value = { ...store.facts.value, rebuildMs: Math.round(performance.now() - t0) }; }
};

function App() {
  const host = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState('Home');
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const [iconSet, setIconSetState] = useState<IconSet>(savedIconSet);
  const [guard, setGuard] = useState<(() => void) | null>(null);
  const [guardSave, setGuardSave] = useState<(() => Promise<void>) | null>(null);   // what Save does in the unsaved-changes dialog when it is not the file save (a component tab: write back)
  const [stale, setStale] = useState(false);   // a newer build was deployed while this tab was open
  const [installEv, setInstallEv] = useState<InstallEvent | null>(null);   // the browser can install the site as an app: the top bar then shows an Install button (see installPrompt.ts)
  const cleanSig = useRef<string | null>(null);
  const sigCache = useRef(new WeakMap<object, string>());
  /** The picture written into a file on Save: kept outside the document, so it never counts as a change or a history step. */
  const saveThumbs = useMemo(() => createSaveThumbs({ render: makeThumbRenderer(controller), hasSolid: () => controller.hasSolid(), idle: whenIdle }), []);
  const [refSel, setRefSel] = useState<string | null>(null);
  const [refHover, setRefHover] = useState<string | null>(null);
  const [ortho, setOrthoState] = useState<boolean>(() => { try { return localStorage.getItem('cad.ortho') === '1'; } catch { return false; } });
  const [leftTab, setLeftTabState] = useState<'Outliner' | 'Features' | 'Editor' | 'Catalog' | 'Variables' | 'Script' | 'Bodies'>('Features');
  const [asmSection, setAsmSection] = useState<AsmSection>('parts');
  const [drawerTab, setDrawerTab] = useState('history');
  /** Phone: which sheet is open (tree, properties or editor, diagnostics and the rest of the drawer) and how high it stands. */
  const [sheet, setSheet] = useState<'tree' | 'props' | 'diag' | null>(null);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('half');
  const [navH, setNavH] = useState(56);
  /** Phone: the tool strip (the ribbon's tools in one row above the bottom bar) is open, and the document list of the top bar. */
  const [tray, setTray] = useState(false);
  const [docList, setDocList] = useState(false);
  const skpOrient = useRef<SkpOrient>(SKP_DEFAULT_ORIENT);   // the last SketchUp orientation chosen this session
  const skpShown = useRef<{ bytes: Uint8Array; file: string; hidden: boolean; /** set when it went into the part as a reference mesh */ meshId?: string } | null>(null);   // the SketchUp file on screen, for Flip orientation
  const [kindDlg, setKindDlg] = useState<{ kind: ImportKind; name: string; text?: string; bytes?: Uint8Array; hidden: boolean } | null>(null);   // STEP / SketchUp: a saved thing or view only?
  const measureRef = useRef(false);   // the Measure tool is on: picks add up instead of replacing
  const [histFilter, setHistFilter] = useState<HistoryFilter>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoPick, setAutoPickState] = useState(() => { try { return localStorage.getItem('cad.autopick') !== '0'; } catch { return true; } });   // hover and click take the corner, edge or face nearest the pointer
  const autoPickRef = useRef(autoPick);
  autoPickRef.current = autoPick;
  const startSketchRef = useRef<(plane: 'front' | 'top' | 'right') => void>(() => {});   // the viewport callbacks are created once
  const editingIdRef = useRef<string | null>(null);   // read by the viewport callbacks, which are created once
  // a feature (a new Plane after OK, a clicked plane) and a Front / Top / Right row are never both selected: the Plane tool reads ONE base from the tree
  useEffect(() => { if (selectedId) setRefSel(null); }, [selectedId]);
  const [editingId, setEditingId] = useState<string | null>(null);
  editingIdRef.current = editingId;
  // The Propeller wizard: a new propeller (roles null) or a built one being edited (its role map and the name of its hub sketch)
  const [propWiz, setPropWiz] = useState<{ params: PropParams; roles: Record<string, string> | null; hubId?: string; marine?: MarineParams } | null>(null);   // `marine` set: the marine family
  const [impWiz, setImpWiz] = useState<{ params: ImpellerParams; roles: Record<string, string> | null; hubId?: string } | null>(null);   // the turbo-impeller wizard (standalone)
  const [knurlWiz, setKnurlWiz] = useState<{ params: KnurlParams; reason: string | null; edit?: { owner: KnurlOwner } | { cosmeticIndex: number }; refusal?: string | null } | null>(null);   // the Knurl wizard: the cylinder read from the face selected when it opened
  useEffect(() => { if (!knurlWiz && knurlHidden !== null) { knurlHidden = null; viewport?.setBodyView(bodyViewNow()); } }, [knurlWiz]);   // the saved cosmetic knurl comes back when the wizard closes
  const [screwWiz, setScrewWiz] = useState<{ params: ScrewParams } | null>(null);   // the Screw wizard: a fastener over the screw() helper
  const [washerPick, setWasherPick] = useState<{ id: number; result: HoleResult } | null>(null);   // the hole just picked for the Washer wizard (washerHole.ts)
  const washerPickRef = useRef({ n: 0, openSel: '' });
  const [washerWiz, setWasherWiz] = useState<{ params: WasherParams } | null>(null);   // the Washer wizard: a flat or spring washer over the washer() helper
  const [bearingWiz, setBearingWiz] = useState<{ params: BearingParams } | null>(null);   // the Bearing wizard: a ball bearing over the bearing() helper
  const [frameWiz, setFrameWiz] = useState<{ params: FrameParams; editId: string | null } | null>(null);   // the Frame panel: a new frame, or the frame `editId` being edited
  const [frameJoint, setFrameJoint] = useState<string | null>(null);   // the joint picked in the viewport or the panel's list
  const [frameHover, setFrameHover] = useState<string | null>(null);
  const [frameReport, setFrameReport] = useState<FrameReport | null>(null);   // the kernel's report of the frame as drafted (joints, hardware placed)
  useEffect(() => { if (frameWiz && (propWiz || impWiz || knurlWiz || screwWiz || washerWiz || bearingWiz || editingId)) setFrameWiz(null); }, [propWiz, impWiz, knurlWiz, screwWiz, washerWiz, bearingWiz, editingId]);   // another editor took the panel
  const [sk3dWiz, setSk3dWiz] = useState<{ editId: string | null; draft: Draft3 } | null>(null);   // the 3D Sketch panel: a new sketch, or the sketch3d `editId` being edited
  useEffect(() => { if (sk3dWiz && (propWiz || impWiz || knurlWiz || screwWiz || washerWiz || bearingWiz || frameWiz || editingId)) setSk3dWiz(null); }, [propWiz, impWiz, knurlWiz, screwWiz, washerWiz, bearingWiz, frameWiz, editingId]);
  const [meshWiz, setMeshWiz] = useState<string | null>(null);   // the Mesh panel: the id of the reference mesh it is open on
  const [meshDlg, setMeshDlg] = useState<{ name: string; bytes: Uint8Array; probe: MeshProbe; unit: StlUnit } | null>(null);   // the STL import dialog
  const [meshPick, setMeshPick] = useState<null | { stage: 'aim' } | { stage: 'plane'; pos: P3d; normal: P3d }>(null);   // starting a sketch by clicking the mesh surface
  useEffect(() => { if (meshWiz && (propWiz || impWiz || knurlWiz || screwWiz || washerWiz || bearingWiz || frameWiz || sk3dWiz || editingId)) closeMeshPanel(); }, [propWiz, impWiz, knurlWiz, screwWiz, washerWiz, bearingWiz, frameWiz, sk3dWiz, editingId]);
  useEffect(() => { if (sk3dWiz && meshWiz) closeMeshPanel(); }, [sk3dWiz]);
  const sk3dMounted = useRef(false);
  useEffect(() => {   // the sketch being edited is drawn by the panel: its committed curves leave the screen while the panel is open and come back after
    sk3dEditing = sk3dWiz?.editId ?? null;
    if (!sk3dMounted.current) { sk3dMounted.current = true; if (!sk3dWiz) return; }
    if (!viewport) return;
    viewport.setHoldView(true);
    try { viewport.setBody(shownBody(lastBody) as never); viewport.setHighlight(hlNames()); } finally { viewport.setHoldView(false); }
  }, [sk3dWiz?.editId ?? null, !!sk3dWiz]);
  const [pickingPath, setPickingPath] = useState<string | null>(null);
  const [holeCorner, setHoleCorner] = useState<{ plate: PlateInfo; rec: CornerRecord } | null>(null);   // the Corner holes control of the open Hole-on-face sketch
  const holeSketchRef = useRef(false);   // the sketch being drawn is for a hole: Point tool, and a hole is added on confirm
  const [picked, setPicked] = useState<{ path: string; value: unknown; once?: boolean } | null>(null);
  useEffect(() => { if (picked?.once) setPicked(null); }, [picked]);   // a one-click fix lands in the draft once; later typing in that field is not overridden
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** Set while an edge or face list field of the open editor is active: the viewport's picks go to it (see listPick.ts). */
  const listPickRef = useRef<((names: string[], addOnly: boolean) => void) | null>(null);
  const cornerPickRef = useRef(false);   // a sheet corner's corners field is picking: a click or tap on a vertex adds it or takes it out, no modifier key
  const listSelRef = useRef<{ path: string | null; sel: string[] }>({ path: null, sel: [] });
  const cornerSelRef = useRef<string[]>([]);   // the vertices selected while a sheet corner's corners field is picking
  const pickQueueRef = useRef<Promise<void>>(Promise.resolve());   // list picks apply in order, each after the body it is read on is ready
  const beforeRef = useRef<{ id: string; edges: ViewEdge[] } | null>(null);   // the edges of the body the edited feature is applied to (edgesBeforeCached)
  const [previewHint, setPreviewHintRaw] = useState<string | null>(null);
  // the live preview's failure: its cause/consequence sort, and whether it is breakage the committed model did not have
  const [previewDiag, setPreviewDiag] = useState<{ d: Diagnosis; fresh: DiagRoot[] } | null>(null);
  const setPreviewHint = (h: string | null) => { setPreviewHintRaw(h); if (h === null) setPreviewDiag(null); };
  const onPreviewResult = (r: { ok: boolean; hint?: string; diagnosis?: Diagnosis | null }) => {
    setPreviewHint(r.ok ? null : (r.hint ?? null));
    if (!r.ok && r.diagnosis?.roots.length) setPreviewDiag({ d: r.diagnosis, fresh: newBreakage(r.diagnosis, controller.diagnosis()) });
  };
  const [sketching, setSketching] = useState<{ id: string; name: string; plane?: string } | null>(null);
  const [lookChip, setLookChip] = useState(false);   // the 'Look normal (N)' chip of the sketch bar: shown when a sketch is entered with the view angled to its plane
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
  const lastPressOnCanvas = useRef(false);   // the last pointer press was on the 3D canvas (which takes no focus)
  const scriptTabRef = useRef(false);   // the Script tab is showing (read by the key handler)
  const ctxMenuRef = useRef<((n: string | null, x: number, y: number, m: import('@kit/viewport').PickMode) => void) | null>(null);
  const sketchCancelRef = useRef<((fromKey?: boolean) => void) | null>(null);
  // Sketch tools: the active tool, its state and its last output live in refs because the viewport and the
  // key handler are created once; the React state below only drives what is drawn.
  const [sketchToolId, setSketchToolId] = useState<string | null>(null);
  const [toolOut, setToolOut] = useState<{ fields: FieldSpec[]; panel?: PanelSpec; x: number; y: number; pending?: string[]; snapLabel?: string; snapModel?: boolean } | null>(null);
  const dwellRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const sketchToolRef = useRef<string | null>(null);
  /** Characters typed while no typed-entry field had focus yet (see the digit branch of the sketch keys), and the seed the fields component puts in the first field. */
  const seedBufRef = useRef('');
  const [fieldSeed, setFieldSeed] = useState<{ n: number; text: string | null }>({ n: 0, text: '' });
  // Select mode: the picked entity and the size field shown beside it.
  const textPickRef = useRef<string | null>(null);
  /** The kernel's verdict on the equation curve being edited, for the fields it was asked about (`key`). */
  const eqResultRef = useRef<{ key: string; r: EquationResult | null }>({ key: '', r: null });
  const [entityOut, setEntityOut] = useState<{ fields: FieldSpec[]; x: number; y: number } | null>(null);
  const selEntityRef = useRef<{ kind: 'entity' | 'point'; id: string; x: number; y: number } | null>(null);
  // Hover and constraint highlights, a dimension being edited in place, and a tick that re-projects labels when the camera moves.
  const hoverRef = useRef<{ entity?: string; point?: string; constraint?: string }>({});
  const [sketchPrefs, setSketchPrefs] = useState<SketchPrefs>(loadSketchPrefs);
  const [triPrefs, setTriPrefs] = useState<TriPrefs>(loadTriPrefs);
  const [navPrefs, setNavPrefs] = useState<NavPrefs>(loadNavPrefs);
  const [massPrefs, setMassPrefsState] = useState<MassPrefs>(() => { const v = loadMassPrefs(); setMassPrefs(v); return v; });
  const changeMass = (patch: Partial<MassPrefs>) => { const next = { ...massPrefs, ...patch }; setMassPrefs(next); setMassPrefsState(next); saveMassPrefs(next); };
  const [exportPrefs, setExportPrefs] = useState<ExportPrefs>(loadExportPrefs);
  const changeExport = (patch: Partial<ExportPrefs>) => { const next = { ...exportPrefs, ...patch }; setExportPrefs(next); saveExportPrefs(next); };
  const [knurlAsk, setKnurlAsk] = useState<{ count: number; resolve(c: 'include' | 'plain' | 'cancel'): void } | null>(null);
  const [knurlFail, setKnurlFail] = useState<{ reason: 'timeout' | 'failed'; message: string; resolve(c: 'plain' | 'cancel'): void } | null>(null);
  const changeNav = (patch: Partial<NavPrefs>) => { const next = { ...navPrefs, ...patch }; setNavPrefs(next); saveNavPrefs(next); viewport?.setNavigation(next); };
  /** A document's own up axis (set by its script) is shown for as long as it is open; a document without one shows the user's saved setting. Camera only: nothing is saved. */
  const showDocUpAxis = (d: unknown): void => {
    const want = docUpAxis(d) ?? loadNavPrefs().upAxis;
    if (want === navPrefs.upAxis) return;
    const next = { ...navPrefs, upAxis: want };
    setNavPrefs(next); viewport?.setNavigation(next);
  };
  const triRef = useRef<ReturnType<typeof useTriBall> | null>(null);
  const updatePrefs = (patch: Partial<SketchPrefs>) => { const next = { ...prefsRef.current, ...patch }; setSketchPrefs(next); saveSketchPrefs(next); };
  const prefsRef = useRef(sketchPrefs);
  prefsRef.current = sketchPrefs;
  const [hotConstraint, setHotConstraint] = useState<string | null>(null);
  /** The entity or point under the pointer in Select mode, kept a moment after it leaves so a constraint chip beside it can be reached. */
  const [hoverFocus, setHoverFocus] = useState<string | null>(null);
  const hoverFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The constraint chip last clicked on the canvas: Delete removes it. */
  const [selConstraint, setSelConstraint] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  /** Starting a sketch with nothing chosen: the three origin planes are drawn in the 3D view to pick from (a click on one, on a flat face or on a datum plane starts the sketch). */
  const [planePick, setPlanePick] = useState(false);
  const planePickRef = useRef(false);
  planePickRef.current = planePick;
  const startOnFeatureRef = useRef<(id: string) => void>(() => {});
  const [reportSnap, setReportSnap] = useState<SheetSnap>('half');
  // a small tip beside the pointer in Select mode: the value of what is under it, and that it can be edited
  const [hoverTip, setHoverTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [dimMenu, setDimMenu] = useState<{ id: string; type: string; driven: boolean; x: number; y: number } | null>(null);
  const [dimEdit, setDimEdit] = useState<{ id: string; x: number; y: number; value: number; expr?: string } | null>(null);
  const [, viewTick] = useState(0);
  // Select mode, several entities: Ctrl or Shift click toggles, a rubber band replaces (or adds with Shift/Ctrl). The transform tools act on these.
  const multiSelRef = useRef<string[]>([]);
  const toolEntitiesRef = useRef<string[]>([]);
  const [boxRect, setBoxRect] = useState<{ x0: number; y0: number; x1: number; y1: number; crossing: boolean } | null>(null);
  const [defining, setDefining] = useState(false);
  const sketchBoxRef = useRef<((ev: import('@kit/viewport').SketchBoxEvent) => void) | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportVisible, setExportVisibleState] = useState<boolean>(() => { try { return localStorage.getItem('cad.export.visible') === '1'; } catch { return false; } });
  const setExportVisible = (v: boolean) => { setExportVisibleState(v); try { localStorage.setItem('cad.export.visible', v ? '1' : '0'); } catch { /* private window */ } };
  const [exportQuality, setExportQualityState] = useState<MeshQuality>(() => { try { const q = localStorage.getItem('cad.export.quality'); return MESH_QUALITIES.includes(q as MeshQuality) ? (q as MeshQuality) : 'normal'; } catch { return 'normal'; } });
  const setExportQuality = (q: MeshQuality) => { setExportQualityState(q); try { localStorage.setItem('cad.export.quality', q); } catch { /* private window */ } };
  const [exportChord, setExportChord] = useState('');   // mm, empty: the quality preset's own chord (not kept between sessions: an absolute tolerance belongs to one part)
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
  /** A finger is drawing with a sketch tool: the tool's state when it went down (a cancelled gesture goes back to it) and whether it became a drag. */
  const touchRef = useRef<{ state: unknown; out: ToolOutput<unknown> | null; dragged: boolean } | null>(null);
  /** A circle was just dragged out by a finger: the entities there were before it, so the new one can be picked and its radius typed. */
  const touchPlaceRef = useRef<Set<string> | null>(null);
  const [samples, setSamples] = useState<SampleEntry[] | null>(null);
  const [restore, setRestore] = useState<Autosave | null>(startupAutosave);
  const [recoverOpen, setRecoverOpen] = useState(false);
  /** The import report on screen (what became of each part of the imported file), with its Repair action. */
  const [importReport, setImportReport] = useState<{ name: string; parts: ImportPart[]; viewOnly: boolean; repair: () => void } | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [, redraw] = useState(0);
  useSignals(() => { importing.value; kernelRouter.status.value; kernelRouter.prefs.value; store.busy.value; busyNote.value; store.cached.value; store.hover.value; store.notices.value; store.featureStatus.value; store.featureWarnings.value; store.mode.value; store.filters.value; store.display.value; store.workspace.value; store.facts.value; store.selection.value; lookStore.look.value; lookStore.hidden.value; analysisStore.opts.value; analysisStore.legend.value; asmState.hidden.value; asmState.explode.value; rejections.value; viewportContentRev.value; startDismissed.value; localeSignal.value; layout.value; layoutPref.value; viewportInfo.value; });
  const stored = store.workspace.value;   // what Settings edits and what is saved; the layout draws a variant of it
  const phone = layout.value === 'phone';
  const phoneOrTablet = layout.value !== 'desktop';
  const ws = effectiveWorkspace(stored, layout.value);

  useEffect(() => {
    const vp = new Viewport(host.current!, {
      onPick: (names, additive, mode) => {
        if (pickBlocked()) return;
        // auto pick: the selection takes the kind of what was clicked, and does not mix kinds
        if (autoPickRef.current && mode !== store.mode.value) { store.mode.value = mode; viewport?.setPickMode(mode); additive = false; }
        // an active edge or face list field: a click or tap adds to it or takes out, with or without a modifier key; empty space changes nothing
        if (listPickRef.current) { listPickRef.current(names, false); return; }
        if (cornerPickRef.current) {
          const sel = store.selection.value, hit = names.filter((n) => n.startsWith('v:'));
          if (hit.length) store.select([...sel.filter((n) => !hit.includes(n)), ...hit.filter((n) => !sel.includes(n))]);
          return;
        }
        store.select(names, additive || measureRef.current);
        // a click on empty space also lets go of the selected feature: the properties panel and the handles close.
        // An open editor (editingId) keeps its feature, and a measuring click never deselects.
        if (!names.length && !additive && !measureRef.current && !editingIdRef.current) { setSelectedId(null); setRefSel(null); }
      },
      onHover: (n) => { if (!store.cached.value) store.hover.value = n; },
      onSketchMove: (pointId, u, v) => sketchMoveRef.current?.(pointId, u, v),
      onSketchPointer: (ev) => sketchPointerRef.current?.(ev),
      onSketchSelect: (ev) => sketchSelectRef.current?.(ev),
      onSketchHover: (ev) => sketchHoverRef.current?.(ev),
      onSketchDouble: (ev) => sketchDoubleRef.current?.(ev),
      onSketchBox: (ev) => sketchBoxRef.current?.(ev),
      onSketchView: () => viewTick((n) => n + 1),
      onHoverPoint: (p) => { readout.model.value = p; },
      onSketchZoom: (v) => { readout.view.value = v; },
      onPlaneCursor: (c) => { readout.cursor.value = c; if (!c) { readout.snapAt.value = null; readout.snapName.value = null; } },
      onAnalysisLegend: (l) => { analysisStore.legend.value = l; },
      onContextMenu: (n, x, y, m) => ctxMenuRef.current?.(n, x, y, m),
      onBodyDouble: (face) => bodyDoubleRef.current?.(face),
      onBoxSelect: (names, additive, mode) => {
        if (pickBlocked()) return;
        if (autoPickRef.current && mode !== store.mode.value) { store.mode.value = mode; viewport?.setPickMode(mode); additive = false; }
        if (!store.filters.value[MODE_FILTER[store.mode.value]]) return;
        if (listPickRef.current) { listPickRef.current(names, true); return; }   // a box adds to an active list field, never takes out
        store.select(names, additive);
      },
      onPlaneFeaturePick: (id) => { if (listPickRef.current) return; if (planePickRef.current) { startOnFeatureRef.current(id); return; } if (!store.filters.value.planes) return; setRefSel(null); store.select([]); setSelectedId(id); },
      // hovering lights a plane up; a plain click on it starts the sketch (while something else is being edited or measured, it only selects)
      onRefPlaneHover: (id) => setRefHover(id),
      onRefPlanePick: (id) => {
        if (!store.filters.value.planes || listPickRef.current) return;   // an empty-space tap while edges are being picked must not clear them
        if (!editingIdRef.current && !measureRef.current) { setSelectedId(null); store.select([]); startSketchRef.current(id); return; }
        setRefSel(id); setSelectedId(null); store.select([]);
      },
    });
    viewport = vp;
    vp.setAutoPick(autoPickRef.current);
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
  // With edges picked and no editor open, the edges a Fillet or Chamfer would add through the tangent chain are lit as well, so they show before the command runs
  useEffect(() => {
    const sel = store.selection.value;
    const chain = store.mode.value === 'edge' && (!editingId || pickingPath === 'edges') && !sketching && sel.length && tangentChainOn() ? chainSelection(sel, controller.bodyEdges()).extras : [];
    const comp = !editingId && !sketching && selectedId && controller.document()?.features.some((x) => x.id === selectedId && x.type === 'insertPart') ? selectedId : null;
    compSel = comp;
    const base = chain.length ? [...sel, ...chain] : sel;
    viewport?.setHighlight(comp ? [...new Set([...base, ...hlNames()])] : base);
  }, [store.selection.value, store.mode.value, editingId, pickingPath, sketching, selectedId]);
  // The Plane being edited (or selected in the tree) is drawn as a sheet so its offset can be seen.
  useEffect(() => {
    const id = editingId ?? selectedId;
    const f = id ? controller.document()?.features.find((x) => x.id === id) : undefined;
    viewport?.setActivePlane(f?.type === 'plane' ? f.id : null);
  }, [viewport, editingId, selectedId]);
  // A selection made while a reference field is in the picking state lands in that field's draft. A list field (edges, faces) takes the
  // viewport's picks itself (listPickRef); what other tools add to the selection meanwhile (select a loop, select all) is added to it.
  useEffect(() => {
    if (!pickingPath) return;
    const sel = store.selection.value;
    if (pickingPath === 'span') return;   // two points clicked in the view (flangeActions.pickSpan), not a selection
    if (pickingPath === 'corners') {   // a sheet corner: each vertex picked is added to the corners (and a deselected one taken out) until Done
      const prev = cornerSelRef.current;
      cornerSelRef.current = sel;
      const cur = fieldNow(editingIdRef.current, 'corners');
      const next = applyCornerPick(Array.isArray(cur) ? cur : [], prev, sel);
      if (next) { draftRef.current = { ...draftRef.current, corners: next }; setPicked({ path: 'corners', value: next }); }
      return;
    }
    if (LIST_PATHS.has(pickingPath)) {
      const prev = listSelRef.current;
      listSelRef.current = { path: pickingPath, sel };
      const added = prev.path === pickingPath ? sel.filter((n) => !prev.sel.includes(n)) : [];
      if (added.length) listPickRef.current?.(added, true);
      return;
    }
    const value = pickValue(pickingPath, sel, controller.bodyEdges(), tangentChainOn());
    if (value !== null) { setPicked({ path: pickingPath, value }); setPickingPath(null); }
  }, [store.selection.value, pickingPath]);
  // An edges field is read on the body its feature is applied to (the features before it), not the body on screen, which has the
  // feature applied: an edge the feature shortened or split names the edge it was, and the tangent chain runs on the edges as they were
  // (see listPick.ts). Built once when the editor opens; a pick made before it is ready waits for it.
  useEffect(() => { if (editingId && controller.document()?.features.some((f) => f.id === editingId && (f.type === 'fillet' || f.type === 'chamfer'))) void controller.edgesBeforeCached(editingId).then((edges) => { beforeRef.current = { id: editingId, edges }; }, () => {}); }, [editingId, controller.revision]);
  const fieldNow = (id: string | null, path: string): unknown => {
    if (draftRef.current[path] !== undefined) return draftRef.current[path];
    const f = id ? controller.document()?.features.find((x) => x.id === id) as unknown as Record<string, unknown> | undefined : undefined;
    return f?.[path];
  };
  // the active list field's current value (the draft, else the feature's) with one pick applied; the selection lights up what is in it
  cornerPickRef.current = pickingPath === 'corners';
  listPickRef.current = pickingPath && LIST_PATHS.has(pickingPath) && editingId ? (names, addOnly) => {
    const path = pickingPath, id = editingId, shown = controller.shownEdges();
    pickQueueRef.current = pickQueueRef.current.then(async () => {
      const r = await controller.pickIntoList(id, path, () => fieldNow(id, path), () => store.selection.value, names, tangentChainOn(), addOnly, shown).catch(() => null);
      if (!r || editingIdRef.current !== id) return;
      draftRef.current = { ...draftRef.current, [path]: r.value };
      listSelRef.current = { path, sel: r.selection };   // this selection change is the pick itself, not something to add again
      setPicked({ path, value: r.value });
      store.select(r.selection);
    });
  } : null;
  // an edge taken out of the field with its chip stops being lit
  useEffect(() => {   // a corner taken out of the sheet corner's field with its chip stops being lit
    if (pickingPath !== 'corners' || !Array.isArray(draft.corners)) return;
    const sel = store.selection.value, keep = cornerSelectionKeep(sel, draft.corners);
    if (keep.length !== sel.length) { cornerSelRef.current = keep; store.select(keep); }
  }, [draft, pickingPath]);
  useEffect(() => {
    if (!pickingPath || !LIST_PATHS.has(pickingPath) || draft[pickingPath] === undefined) return;
    const sel = store.selection.value;
    const before = beforeRef.current?.id === editingId ? beforeRef.current.edges : null;
    const keep = selectionInField(pickingPath, sel, draft[pickingPath], controller.shownEdges(), tangentChainOn(), before);
    if (keep.length !== sel.length) { listSelRef.current = { path: pickingPath, sel: keep }; store.select(keep); }
  }, [draft, pickingPath]);
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
    try { viewport.setBody(shownBody(lastBody) as never); viewport.setHighlight(hlNames()); } finally { viewport.setHoldView(false); }
  }, [asmHidden, asmExplode]);
  useEffect(() => {
    write('cad.workspace', stored);
    viewport?.setHighlightWidth(stored.lineWidth);
    const r = document.documentElement.style;
    r.setProperty('--alpha', String(stored.opacity));
    r.setProperty('--blur', `${stored.blur}px`);
    requestAnimationFrame(() => viewport?.resize());
  }, [stored]);
  useEffect(() => { requestAnimationFrame(() => viewport?.resize()); }, [layout.value]);
  useEffect(() => { const n = document.querySelector<HTMLElement>('.bottom-nav'); if (n) setNavH(n.offsetHeight); }, [phone, viewportInfo.value.w, viewportInfo.value.h]);
  useEffect(() => { if (!phone) { setSheet(null); setTray(false); } }, [phone]);
  useEffect(() => { setSheetSnap('half'); }, [sheet]);   // each sheet opens at its own first snap, not wherever the last one was left

  /** Signature of a document, remembered per object so a render does not stringify a big part again. */
  const sigOf = (d: PartDoc | null): string | null => {
    if (!d) return null;
    let s = sigCache.current.get(d);
    if (s === undefined) { s = JSON.stringify(lightDoc(d)); sigCache.current.set(d, s); }
    return s;
  };
  const isDirty = (): boolean => { const d = controller.document(); return !!d && cleanSig.current !== null && sigOf(d) !== cleanSig.current; };
  /** `saved` is the document a finished write held; a part edited since then stays unsaved. */
  const markClean = (saved?: PartDoc | null) => { cleanSig.current = cleanSigAfterSave(saved ?? null, controller.document(), sigOf); };
  // ---- document tabs: each tab has its own controller; these park the active one and bring another back ----
  const tabDirty = (tb: TabRec): boolean => {
    if (tb.id === tabSet.activeId) return isDirty();
    const d = tb.controller.document();
    return !!d && tb.cleanSig !== null && sigOf(d) !== tb.cleanSig;
  };
  const anyDirty = (): boolean => tabSet.tabs.some(tabDirty);
  /** What a tab being left must keep: its file, its unsaved-changes mark, its look and its camera. */
  const parkActive = () => {
    const cur = tabSet.active;
    if (!cur) return;
    cur.file = files.snapshot(); cur.cleanSig = cleanSig.current; cur.hidden = lookStore.hidden.value; cur.camera = viewport?.cameraState() ?? null;
  };
  /** Nothing the user has opened or changed in the active tab yet: a new document may take its place instead of a new tab. */
  const activeIsBlank = (): boolean => {
    const d = controller.document();
    return !d || (d.features.length === 0 && !files.fileName && !isDirty());
  };
  /** A sketch in progress is finished (as the check mark does) so the tab can be left with it kept; false when it cannot be (the sketch stays open and says so). */
  const settleSketch = async (): Promise<boolean> => {
    if (!controller.sketchDraft()) return true;
    await confirmSketch();
    if (controller.sketchDraft()) { store.notify(t('tabs.finishSketch'), 'warn'); return false; }
    store.notify(t('tabs.sketchKept', { name: files.partName ?? controller.document()?.name ?? t('app.noPart') }));
    return true;
  };
  const leaveEditing = async () => {
    await controller.cancelPreview();
    setDrawingOpen(false);   // the drawing sheet belongs to the document being left
    setEditingId(null); setEditingMaterial(false); setPropWiz(null); setImpWiz(null); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
    setSelectedId(null); setRefSel(null); store.select([]); rejections.value = [];
    viewport?.setSketchEdit(null);   // the sketch overlay belongs to the tab being left (a background tab's own clear never reaches the viewport)
  };
  /** The active tab (just changed in `tabSet`) takes over the app: its file, look, view and camera. */
  const showActive = async () => {
    const tb = tabSet.active!;
    files.restore(tb.file); cleanSig.current = tb.cleanSig;
    lookStore.hidden.value = tb.hidden ?? { body: false, ids: [] };
    const d = controller.document();
    if (d) { asmState.reset(d); showDocUpAxis(d); }
    store.busy.value = true;
    try { await controller.reshow(); } finally { store.busy.value = false; }
    if (tb.camera) viewport?.setCameraState(tb.camera); else viewport?.requestFit();
    redraw((n) => n + 1);
  };
  const switchTab = async (id: number) => {
    if (id === tabSet.activeId || !tabSet.get(id) || !(await settleSketch())) return;
    await leaveEditing();
    parkActive();
    tabSet.activate(id);
    await showActive();
  };
  /** A new, empty tab becomes active (the caller loads something into it). False when it could not be made. */
  const addTab = async (): Promise<boolean> => {
    if (tabSet.full()) { store.notify(t('tabs.limit'), 'warn'); return false; }
    if (!(await settleSketch())) return false;
    await leaveEditing();
    parkActive();
    tabSet.add(newTabRec());
    files.restore({ fileName: null, handle: null, partName: null });
    cleanSig.current = null;
    lookStore.hidden.value = { body: false, ids: [] };
    return true;
  };
  const forceCloseTab = async (id: number) => {
    const wasActive = id === tabSet.activeId;
    if (wasActive) await leaveEditing();
    const next = tabSet.remove(id);
    if (!next) {   // the last one went: a blank part stays
      tabSet.add(newTabRec());
      files.restore({ fileName: null, handle: null, partName: null });
      cleanSig.current = null;
      await load(JSON.stringify(emptyPart(files.names.next())), { file: null });
      return;
    }
    if (wasActive) await showActive(); else redraw((n) => n + 1);
  };
  /** Close tab `id`; a tab with unsaved changes is brought up first and the usual Save / Don't save / Cancel decides. */
  const closeTab = async (id: number) => {
    const tb = tabSet.get(id);
    if (!tb) return;
    if (!tabDirty(tb)) { await forceCloseTab(id); return; }
    if (id !== tabSet.activeId) await switchTab(id);
    if (id !== tabSet.activeId) return;
    if (tb.parent) setGuardSave(() => () => finishEditingPart(true));   // Save on a component tab writes it back into its assembly
    setGuard(() => () => forceCloseTab(id));
  };
  /** Run `go` on a fresh document: in the active tab when that is still blank, else in a new tab. Nothing is asked: the current part stays open in its tab. */
  const guarded = (go: () => void | Promise<void>) => { void (async () => { if (!activeIsBlank() && !(await addTab())) return; await go(); })(); };
  /** Bring back a stored session: each changed part in a tab of its own (the first may take the blank tab the app starts with), the one that was active shown. */
  const restoreSession = async (a: Autosave) => {
    const parts = sessionParts(a);
    for (const [i, part] of parts.entries()) {
      if ((i > 0 || !activeIsBlank()) && !(await addTab())) break;
      await load(JSON.stringify(part.doc), { restored: true });
    }
    const act = parts.findIndex((x) => x.active), target = act >= 0 ? tabSet.tabs[Math.min(act, tabSet.tabs.length - 1)] : null;
    if (target && target.id !== tabSet.activeId) await switchTab(target.id);
  };
  /** Run `go` (leaving the page) now, or after the user decides what to do with unsaved changes. */
  const guardedAll = (go: () => void | Promise<void>) => { if (!anyDirty()) { void go(); return; } const d = tabSet.tabs.find(tabDirty); if (d && d.id !== tabSet.activeId) void switchTab(d.id); setGuard(() => go); };
  /** Open a part from text. `file` is the file it came from (null for a sample or a new part); `keep` leaves the file bookkeeping alone. */
  /** Keep the stored view of the part just built (a file opened without one, so the next open is instant). Same tick: the document and its view. */
  /** Saves keep the built view in the file (File > Save geometry in file; the Save As box). A file opened with its view keeps it on Save. */
  const [embedPref, setEmbedPref] = useState(() => { try { return localStorage.getItem('cad.embedgeometry') === '1'; } catch { return false; } });
  const openedWithView = useRef(false);
  const chooseEmbed = (on: boolean) => { setEmbedPref(on); try { localStorage.setItem('cad.embedgeometry', on ? '1' : '0'); } catch { /* private window */ } };
  /** The `embed` option of a save: the view `v` taken with the document, written as the file's `viewCache` field. */
  const embedOpt = (on: boolean, v: ViewData | null) => (on && v ? { embed: (w: { name: string }) => embedSnapshot(kernelBuild, w, v) } : {});
  const rememberView = () => { const d = controller.document(), v = controller.viewData(); if (d && v) void keepSnapshot(viewCache, kernelBuild, d, v); };
  const load = async (text: string, o: { file?: string | null; keep?: boolean; restored?: boolean; keepView?: boolean } = {}) => {
    const prevSig = cleanSig.current;
    { const cur = controller.document(); if (cur) void snapshots.note(packDocCached(cur).doc, files.partName ?? cur.name, 'load'); }   // the part being left stays recoverable
    try {
      const { doc: plain, thumbnail } = stripThumbnail(JSON.parse(text) as PartDoc);   // the file's picture is not part of the document
      const { doc: packedDoc, embedded } = takeEmbedded(plain);   // nor is the view it may carry
      // reference meshes and STEP text are stored packed (files/assets.ts); a damaged one is left out and said, the rest of the part opens
      const { doc, problems: assetProblems } = await unpackDoc(packedDoc);
      saveThumbs.remember(thumbnail);
      asmState.reset(doc);
      // While the part loads, controller.document() already changes (and a render can land in between) but the clean
      // signature is still the old part's: that read as "modified". null means "not tracked", so nothing is dirty until markClean.
      cleanSig.current = null;
      if (!o.keepView) viewport?.requestFit();   // a script rebuilding its own part in place keeps the camera
      // a stored view of exactly this recipe and kernel build is shown at once; the kernel rebuilds behind it
      let stored = o.restored ? null : await findSnapshot(viewCache, kernelBuild, doc);
      let rejected: 'recipe' | 'build' | 'version' | 'corrupt' | null = null;   // why the view the file carries is not used (no notice when the file has none)
      if (!stored && !o.restored && embedded !== undefined) {
        const r = await checkEmbedded(kernelBuild, doc, embedded);
        if (r.ok) stored = r.snapshot; else rejected = r.reason;   // reason null: nothing to judge by, no notice
      }
      if (!o.keep) openedWithView.current = embedded !== undefined;
      const t0 = performance.now();
      await timed(() => controller.load(doc, stored ? { cached: stored.data } : undefined));
      if (!o.keepView) showDocUpAxis(doc);   // a part built along Z opens Z-up
      if (stored) void controller.settled().then(() => { store.facts.value = { ...store.facts.value, rebuildMs: Math.round(performance.now() - t0) }; redraw((n) => n + 1); });
      else if (!o.restored) rememberView();
      if (o.restored) cleanSig.current = '';   // a restored session was never saved to a file: it counts as changed
      else { markClean(); autosaver.clear(); }
      if (!o.keep) { files.opened(o.file ?? null); if (o.file) { files.noteFile(o.file); files.noteThumb(o.file, thumbnail); } }
      files.names.seen(doc.name);
      if (!o.keepView) resetStartDismissal(tabSet.activeId);   // a document opened or started in this tab gets its card back
      setEditingId(null); setEditingMaterial(false); setPropWiz(null); setImpWiz(null); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null); setLeftTab('Features');   // an editor left open belongs to the old part
      setSelectedId(null); setRefSel(null); store.select([]); rejections.value = []; viewport?.setSketchEdit(null); redraw((n) => n + 1);
      store.notify(t(o.restored ? 'files.restored' : 'app.notice.opened', { name: doc.name || t('app.part.unnamed') }));
      for (const p of assetProblems) { const k = problemKey(p); store.notify(t(k.key, k.params), 'error'); }
      void warmPackCache(controller.document()).then(() => redraw((n) => n + 1));   // the backups then find the assets packed already
      if (!o.keepView && meshesOf(controller.document()).length) refreshMeshes(true);   // a part of meshes (and sketches on them) has no body to frame: frame the meshes
      if (rejected) store.notify(rejected === 'recipe' ? t('files.cache.rejected.recipe') : rejected === 'build' ? t('files.cache.rejected.build') : rejected === 'version' ? t('files.cache.rejected.version') : t('files.cache.rejected.corrupt'), 'info');
    } catch (e) { if (cleanSig.current === null) cleanSig.current = prevSig; store.notify(t('app.notice.openFailed', { message: (e as Error).message }), 'error'); }
  };
  const edit = async (ops: EditOp[]) => {
    await timed(() => controller.edit(ops));
    redraw((n) => n + 1);
  };
  const gotoStep = async (count: number) => {
    // a material change made on the way is undone with the steps (it is not in the session's history)
    for (let i = 0; i < 1000 && controller.history().length > count; i++) await controller.undo();
    redraw((n) => n + 1);
  };
  const chooseAutoPick = (on: boolean) => { setAutoPickState(on); viewport?.setAutoPick(on); try { localStorage.setItem('cad.autopick', on ? '1' : '0'); } catch { /* private window */ } };
  useEffect(() => { const f = store.filters.value; viewport?.setPickKinds({ face: f.faces, edge: f.edges, vertex: f.vertices, body: f.bodies }); }, [store.filters.value]);
  const setMode = (m: SelectionMode) => {
    if (!store.filters.value[MODE_FILTER[m]]) { store.notify(t('select.filter.off'), 'warn'); return; }
    // entering Body mode keeps the bodies that hold what was selected
    if (m === 'body' && store.mode.value !== 'body') { const mdl = controller.selModel(); if (mdl && store.selection.value.length) store.select(toBodyMode(mdl, store.selection.value)); }
    store.mode.value = m; viewport?.setPickMode(m);
    chooseAutoPick(false);   // choosing a kind by hand is the filter
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
  const planeLabel = (id: string) => { const d = controller.document(); const f = d?.features.find((x) => x.id === id); return f ? featureLabel(d, f as never) : id; };
  const sketchHere = () => {
    const face = selectedFace();
    const plane = refSel === 'front' || refSel === 'top' || refSel === 'right' ? refSel : null;
    const pf = selectedPlaneFeature();
    if (face) startNewSketch({ kind: 'face', id: face });
    else if (plane) startNewSketch(plane);
    else if (pf) startNewSketch({ kind: 'feature', id: pf.id });
    else if (!editingIdRef.current && !measureRef.current && !sketchingRef.current) beginPlanePick();
    else store.notify(t('app.sketch.pickFirst'), 'error');
  };
  /** Show the origin planes as sheets to pick from; a flat face in the model can be picked too. */
  const beginPlanePick = () => {
    if (!controller.document()) return;
    setSelectedId(null); setRefSel(null); store.select([]);
    if (store.mode.value !== 'face') { store.mode.value = 'face'; viewport?.setPickMode('face'); }
    setPlanePick(true);
  };
  /** Open (or, on a phone, raise as a sheet) the bottom drawer; `toggleSheet` is the bottom bar's button. */
  const toggleSheet = (id: 'tree' | 'props' | 'diag') => { setTray(false); setSheet((cur) => (cur === id ? null : id)); };
  const openDrawer = () => { if (layout.value === 'phone') setSheet('diag'); else store.setWorkspace({ drawerOpen: true }); };
  const toggleDrawer = () => { if (layout.value === 'phone') toggleSheet('diag'); else store.setWorkspace({ drawerOpen: !store.workspace.value.drawerOpen }); };
  /** The left panel was asked for (a command, a wizard, Variables): unhide it, or open the tree sheet on a phone. */
  const revealLeft = () => { if (layout.value === 'phone') setSheet('tree'); else if (store.workspace.value.leftPanel === 'hidden') store.setWorkspace({ leftPanel: 'docked' }); };
  /** The Editor tab is the properties sheet on a phone. */
  scriptTabRef.current = leftTab === 'Script';
  const setLeftTab = (v: typeof leftTab) => { if (v === 'Editor' && layout.value === 'phone') { setSheet('props'); return; } setLeftTabState(v); };
  const check = useDesignCheck(controller, store, () => viewport, () => { setDrawerTab('check'); openDrawer(); });
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
  const showWarning = (id: string) => { selectFailed(id); setDrawerTab('diagnostics'); openDrawer(); };
  const openInspect = () => { setDrawerTab('inspect'); openDrawer(); };
  const inspect = useInspect(controller, store, () => viewport, openInspect, measureRef);
  const toggleLeftPanel = () => { if (layout.value === 'phone') toggleSheet('tree'); else store.setWorkspace({ leftCollapsed: !store.workspace.value.leftCollapsed }); };

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

  /** Add an SVG file's geometry to the open sketch. */
  const importSvg = async () => {
    if (!controller.sketchDraft()) { showNotices([{ level: 'error', key: 'io.svg.noSketch' }]); return; }
    const f = await platform.openFile({ accept: ['.svg'] });
    if (!f) return;
    const r = await importSvgIntoSketch(controller, f.text);
    showNotices(r.notices);
    if (r.ok) { viewTick((n) => n + 1); viewport?.fit(); }
  };
  /** Open an SVG file as a new sketch on the selected face or plane (front when nothing is selected). */
  const sketchFromSvg = async () => {
    const f = await platform.openFile({ accept: ['.svg'] });
    if (f) sketchFromSvgText(f.text);
  };
  const sketchFromSvgText = (text: string) => {
    const pre = svgToSketch(text);
    if (!pre.ok) { showNotices([svgErrorNotice(pre.error)]); return; }
    const face = selectedFace();
    const plane = refSel === 'front' || refSel === 'top' || refSel === 'right' ? refSel : null;
    startNewSketch(face ? { kind: 'face', id: face } : plane ?? 'front', async () => {
      const r = await importSvgIntoSketch(controller, text);
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
  /** Cosmetic knurls become real cuts: the records are cleared, then the cuts committed (two undo steps: the cuts go first, then the records come back). */
  const convertCosmeticKnurls = async (): Promise<void> => {
    const d = controller.document();
    const recs = readCosmeticKnurls((d as unknown as Record<string, unknown> | null)?.cosmeticKnurls);
    if (!d || !recs.length) return;
    store.busy.value = true;
    try {
      let ops;
      try { ops = cosmeticToCutOps(d as never, recs); } catch (e) { store.notify(t('knurl.convertFailed', { reason: (e as Error).message.replace(/^knurl\(\): /, '') }), 'error'); return; }
      controller.setUndoableExtra('cosmeticKnurls', []);
      const r = await timed(() => controller.commit(ops, 'knurl'));
      if (!r.ok) {
        await controller.undo();   // takes the clearing back: the records stay
        viewport?.setBodyView(bodyViewNow());
        store.notify(t('knurl.convertFailed', { reason: r.hints?.map((h) => h.hint).join('; ') || (r as { schemaError?: string }).schemaError || 'edit failed' }), 'error');
        return;
      }
      viewport?.setBodyView(bodyViewNow());
      store.notify(t('knurl.converted'));
      redraw((n) => n + 1);
    } finally { store.busy.value = false; }
  };
  /** Ask whether to include the cosmetic knurls; the tick keeps the answer as the Settings choice. */
  const askKnurl = (count: number) => new Promise<'include' | 'plain' | 'cancel'>((resolve) => {
    setKnurlAsk({ count, resolve: (c) => resolve(c) });
  });
  const answerKnurl = (a: { choice: 'include' | 'plain' | 'cancel'; remember: boolean }) => {
    const ask = knurlAsk;
    setKnurlAsk(null);
    if (a.remember && a.choice !== 'cancel') changeExport({ knurl: a.choice === 'include' ? 'on' : 'off' });
    ask?.resolve(a.choice);
  };
  const failKnurl = (reason: 'timeout' | 'failed', message: string) => new Promise<'plain' | 'cancel'>((resolve) => { setKnurlFail({ reason, message, resolve }); });
  const chooseKnurl = (c: 'plain' | 'cancel') => { const f = knurlFail; setKnurlFail(null); f?.resolve(c); };
  /** What an export does about the document's cosmetic knurls (see knurlExport.ts); `make` cuts them in a scratch copy and reads the geometry back. */
  const knurlChoice = <T,>(recs: readonly unknown[], make: () => Promise<BakeRun<T>>, slow = false) => chooseKnurlExport<T>({
    mode: loadExportPrefs().knurl, count: recs.length,
    ask: () => askKnurl(recs.length),
    run: async () => {
      if (slow) store.notify(t('knurl.exportHeavy'), 'info');
      busyNote.value = t('knurl.exportBaking');
      try { return await make(); } finally { busyNote.value = null; }
    },
    failed: failKnurl,
  });
  const exportAs = async (kind: ExportKind) => {
    await controller.settled();   // an export is never made from a stored view
    const d = controller.document();
    if (!d) return;
    try {
      let r: ExportResult;
      const rows = exportVisible ? bodyRowsFor(false) : [];
      const anyHidden = rows.some((r) => r.hidden);
      let mesh = anyHidden ? visibleMesh(controller.bodyFaces() ?? controller.bodyMesh(), rows) : controller.bodyMesh();
      const bodyKind = kind === '3mf' || kind === 'glb' || kind === 'obj';   // one object / node per body, so the mesh keeps its face ids and is split by body below
      let full: Parameters<typeof splitBodies>[0] = bodyKind ? controller.bodyFaces() ?? controller.bodyMesh() : null;
      const meshKind = kind === 'stl' || kind === 'stl-ascii' || kind === 'obj' || bodyKind;
      const asked = meshKind && mesh ? meshRequest(exportQuality, exportChord) : ({ custom: false } as const);
      if ('error' in asked) { showNotices([asked.error]); return; }
      // cosmetic knurls: cut into a scratch copy that the file is made from (the open part stays as it is)
      const recs = ['stl', 'stl-ascii', 'obj', '3mf', 'glb', 'step'].includes(kind) ? readCosmeticKnurls((d as unknown as Record<string, unknown>).cosmeticKnurls) : [];
      const hiddenMesh = anyHidden && kind !== 'step';   // the visible bodies cannot be told apart in the copy: the plain solid, with the warning
      let bakedStep: string | null = null, bakedCount = 0, bakedCached = false;
      if (recs.length && !hiddenMesh) {
        const want = kind === 'step' ? 'step' : 'mesh';
        const slow = mayBeSlow(recs) && !(await controller.bakeCached(recs, want));
        const c = await knurlChoice(recs, async () => {
          const b = await controller.bakeBuild(recs, want, KNURL_BAKE_SECONDS);
          return b.ok ? { ok: true, value: b } : b;
        }, slow);
        if (c.kind === 'cancel') return;
        if (c.kind === 'baked') {
          bakedCount = c.value.baked;
          bakedCached = !!c.value.cached;
          if (kind === 'step') bakedStep = c.value.step ?? null;
          else { mesh = c.value.mesh ?? mesh; if (bodyKind) full = c.value.mesh ?? full; if (asked.custom) showNotices([{ level: 'warn', key: 'knurl.exportMeshTol', params: { file: fileStem(d.name) } }]); }
        }
      }
      if (asked.custom && !bakedCount) {
        // meshed again at the asked tolerance: the kernel keeps the body, so the mesh on screen is not touched
        store.busy.value = true;
        try {
          const rep = await controller.exportMesh({ quality: asked.quality, ...(asked.chord_mm !== undefined ? { chord_mm: asked.chord_mm } : {}) });
          if (rep) {
            mesh = visibleMesh(rep.mesh, anyHidden ? rows : []);
            if (bodyKind) full = rep.mesh;
            showNotices([{ level: 'info', key: 'io.meshTol', params: { chord: +rep.chord.toPrecision(3) } }, ...(rep.chordRaised ? [{ level: 'warn' as const, key: 'io.chordRaised', params: { chord: +rep.chord.toPrecision(3) } }] : [])]);
          }
        } finally { store.busy.value = false; }
      }
      if (anyHidden && kind === 'step') store.notify(t('io.visibleStep'), 'warn');
      if (kind === 'stl') r = exportStl(mesh, d.name, true);
      else if (kind === 'stl-ascii') r = exportStl(mesh, d.name, false);
      else if (bodyKind) {
        // a knurl-cut copy has other faces than the open part, so it goes out as one body; otherwise the bodies keep their names and colours
        const bodies = splitBodies(full, bakedCount ? [] : bodyRowsFor(false), d.name || fileStem(d.name), exportVisible);
        if (kind === '3mf') { store.busy.value = true; try { r = await exportThreeMf(bodies, d.name); } finally { store.busy.value = false; } }
        else if (kind === 'obj') r = exportObj(mesh, d.name, bodies);
        else r = exportGlb(bodies, d.name);
      }
      else if (kind === 'dxf-sketch') r = exportSketchDxf(sketchToExport(), d.name);
      else if (kind === 'dxf-views') r = exportViewsDxf(controller.bodyEdges() as Array<{ pts: number[][] }>, controller.bodyBox(), d.name);
      else {
        store.busy.value = true;
        try { r = exportStep(bakedStep ?? (mesh ? await controller.exportStep() : null), d.name); } finally { store.busy.value = false; }
      }
      if (r.file) await platform.saveFile(r.file.name, r.file.data, r.file.mime);
      showNotices(r.notices);
      if (bakedCount && r.file) store.notify(t(bakedCached ? 'knurl.exportIncludedCached' : 'knurl.exportIncluded', { count: bakedCount, file: r.file.name }), 'info');
      // a cosmetic knurl that was not cut into the file (setting Off, the plain solid chosen, hidden bodies) is not in it: say so, and offer the real cut
      else if (recs.length && r.file) store.notify(t(hiddenMesh ? 'knurl.exportHidden' : 'knurl.exportWarn', { count: recs.length, file: r.file.name }), 'warn', { label: t('knurl.exportConvert'), run: () => { void convertCosmeticKnurls(); } });
    } catch (e) {
      showNotices([{ level: 'error', key: 'io.failed', params: { message: (e as Error).message } }]);
    }
  };

  /** Right-click a folder > Export: the bodies its features made or changed, as STEP, STL or a frozen .ckpart. */
  const exportFolder = async (name: string, ids: string[], format: FolderFormat) => {
    await controller.settled();   // an export is never made from a stored view
    const d = controller.document();
    if (!d) return;
    const plan = planFolderExport(d, name, ids, bodyRowsFor(false), controller.rollbackCount() !== null);
    if (!plan.ok) { store.notify(`${t(REFUSAL_KEYS[plan.reason].message, plan.params)} ${t(REFUSAL_KEYS[plan.reason].hint)}`, 'warn'); return; }
    store.busy.value = true;
    try {
      // the cosmetic knurls whose cylinder the folder holds are cut into the scratch copy the file is made from
      const mode = loadExportPrefs().knurl;
      const recs = mode === 'off' ? [] : readCosmeticKnurls((d as unknown as Record<string, unknown>).cosmeticKnurls);
      const bake = recs.length ? { recs, seconds: KNURL_BAKE_SECONDS, ...(mode === 'ask' ? { confirm: (n: number) => askKnurl(n) } : {}) } : undefined;
      if (bake) busyNote.value = t('knurl.exportBaking');
      let b = await controller.folderBuild(plan.doc, d, name, format, bake);
      if (!b.ok && b.bake) {
        if (b.bake.reason === 'cancelled') return;
        store.busy.value = false;
        const go = await failKnurl(b.bake.reason, b.message);
        store.busy.value = true;
        if (go === 'cancel') return;
        b = await controller.folderBuild(plan.doc, d, name, format);
      }
      if (!b.ok) { showNotices([{ level: 'error', key: 'io.folder.failed', params: { name, message: b.message } }]); return; }
      const stem = `${d.name} - ${name}`;
      const r = format === 'stl' ? exportStl(b.data as { positions: ArrayLike<number> }, stem, true) : format === 'step' ? exportStep(b.data as string, stem) : exportCkpart(await packText(b.data as string), stem);
      if (r.file) await platform.saveFile(r.file.name, r.file.data, r.file.mime);
      showNotices(r.notices);
      if (b.baked) store.notify(t('knurl.exportIncluded', { count: b.baked, file: r.file?.name ?? stem }), 'info');
      else if (b.left && r.file) store.notify(t('knurl.exportWarn', { count: b.left, file: r.file.name }), 'warn', { label: t('knurl.exportConvert'), run: () => { void convertCosmeticKnurls(); } });
      if (plan.shared) store.notify(t('io.folder.shared', { count: plan.shared }), 'info');
    } catch (e) {
      showNotices([{ level: 'error', key: 'io.failed', params: { message: (e as Error).message } }]);
    } finally { busyNote.value = null; store.busy.value = false; }
  };

  /** Right-click a folder > Extract: its features (with the variables they use) become a new document. */
  const extractFolder = async (name: string, ids: string[]) => {
    await controller.settled();
    const d = controller.document();
    if (!d) return;
    const rows = bodyRowsFor(false);
    const geo = planFolderExport(d, name, ids, rows, controller.rollbackCount() !== null);
    const plan = planExtract(d, name, ids, controller.rollbackCount() !== null, geo.ok ? geo.shared : 0);
    const refuse = (reason: ExtractRefusal, params: Record<string, string | number>) => store.notify(`${t(EXTRACT_KEYS[reason].message, params)} ${t(EXTRACT_KEYS[reason].hint)}`, 'warn');
    if (!plan.ok) { refuse(plan.reason, plan.params); return; }
    store.busy.value = true;
    try {
      const built = await controller.extractCheck(plan.part);
      if (!built.ok) { refuse('failed', { name, message: built.message }); return; }
      // a folder that stands alone gives back the bodies it made (a feature that acts on outside geometry without naming it does not)
      if (geo.ok && geo.shared === 0) {
        const want = await controller.folderBuild(geo.doc, d, name, 'step');
        if (want.ok && (built.volume === null || Math.abs(built.volume - want.volume) > VOLUME_TOLERANCE * want.volume)) { refuse('differs', { name, part: built.volume === null ? 0 : +built.volume.toFixed(3), folder: +want.volume.toFixed(3) }); return; }
      }
    } finally { store.busy.value = false; }
    guarded(async () => {
      await load(JSON.stringify(plan.part), { file: null });
      store.notify(t('io.extract.done', { name, count: plan.part.features.length, vars: plan.variables.length }));
      if (plan.shared) store.notify(t('io.extract.shared', { count: plan.shared }), 'info');
    });
  };

  // ---- files: save, save as, open by type, STEP, drop ----
  const finishSave = (r: Awaited<ReturnType<FileManager['save']>>, saved: PartDoc | null) => {
    if (r.ok) {
      markClean(saved); if (mayClearAutosave(saved, controller.document())) autosaver.clear(); store.notify(t('files.saved', { file: r.file })); redraw((n) => n + 1);
      // the view stored beside the file is keyed by the recipe as written (the part name chosen); only when nothing changed meanwhile
      const d = controller.document(), v = controller.viewData();
      if (d && v && d === saved) void keepSnapshot(viewCache, kernelBuild, { ...d, name: r.partName }, v);
    }
    else if (!r.cancelled) store.notify(t('files.saveFailed', { message: r.message ?? '' }), 'error');
  };
  const doSave = async (saveAs: boolean) => {
    if (tabSet.active?.parent) { store.notify(t('asm.editpart.saveBlocked'), 'warn'); return; }
    const d = controller.document();
    if (!d) return;
    if (saveAs && files.needsNameDialog()) { setSaveAsOpen(true); return; }
    const v = controller.viewData();   // the view of this very document, taken before anything is awaited
    finishSave(await files.save(d, { saveAs, thumbnail: await saveThumbs.forSave(d), ...embedOpt(embedPref || openedWithView.current, v) }), d);
  };
  /** An imported part that seems to lie on its back (Z up in the Y-up view) is offered the Z-up view; nothing is rotated and nothing is offered otherwise. */
  const offerZUp = (mesh: Parameters<typeof seemsZUp>[0]) => {
    if (navPrefs.upAxis !== 'y' || !seemsZUp(mesh)) return;
    store.notify(t('files.import.zUp'), 'info', { label: t('files.import.zUp.action'), run: () => { changeNav({ upAxis: 'z' }); viewport?.fit(); } });
  };
  /** STEP text into a new part named after the file (view only, see files/stepImport.ts). */
  const importStepText = (text: string, file: string) => guarded(async () => {
    await load(JSON.stringify(emptyPart(partNameOf(file))), { file: null });
    const r = await controller.importStep(text, partNameOf(file));
    if (r.ok) {
      viewport?.fit(); store.notify(t('files.step.done', { name: file, faces: r.faces })); offerZUp(r.view.mesh);
      // view only: Repair makes the file an editable part (the STEP text held by an importStep step) and adds Repair Part after it
      reportImport(file, r.parts, true, () => void repairAsPart(file, async () => text));
    }
    else store.notify(t('files.step.failed', { name: file, message: r.message }), 'error');
  });
  /** After an import: when a part is not a solid, a notice says what became of the parts and opens the import report. */
  const reportImport = (file: string, parts: ImportPart[], viewOnly: boolean, repair: () => void) => {
    if (!parts.length || allSolid(parts)) return;
    const open = () => setImportReport({ name: file, parts, viewOnly, repair: () => { setImportReport(null); repair(); } });
    store.notify(importSummary(parts, t), 'warn', { label: t('import.report.open'), run: open });
  };
  /** Repair Part on an importStep step of the open part: one undoable `repairPart` step after it; the notice says what it did. */
  const repairImport = async (target: string) => {
    const op = repairOp(target, controller.features());
    const res = await controller.commit([op as never], t('import.report.repair'));
    // a refused repair (nothing to repair, a bad gap) is not added: the edit is rejected with the kernel's reason
    if (!res.ok) {
      const e = (res.errors ?? []).find(([fid]) => fid === op.feature.id)?.[1];
      const detail = e?.params && typeof e.params.detail === 'string' ? e.params.detail : e?.code ?? res.schemaError ?? '';
      store.notify(t('import.repair.failed', { name: target, message: detail }), 'error');
      return;
    }
    const w = store.featureWarnings.value[op.feature.id];
    const rep = [w, ...(w?.all ?? [])].find((x) => x?.code === 'repairReport');
    const lines = parseRepairReport(rep?.params);
    const words = repairSummary(lines, t);
    words.forEach((line, i) => store.notify(line, lines[i].valid ? 'info' : 'warn'));
  };
  /** A view-only import made an editable part, then repaired: `step` gives the file as STEP (the original text, or the kernel's
   *  STEP of the imported bodies, surface bodies included). */
  const repairAsPart = async (file: string, step: () => Promise<string | null>) => {
    const text = await step();
    if (!text) { store.notify(t('import.repair.failed', { name: file, message: 'the import could not be written as STEP' }), 'error'); return; }
    await load(JSON.stringify(await partOfStep(text, partNameOf(file), file)), { file: null });
    await repairImport('F1');
  };
  /** A SolidWorks part into a new part named after the file: its feature history when the kernel can rebuild it, else an editable imported body (see files/sldprtImport.ts); when that cannot be built, the solid is shown view only as for STEP. */
  const importSldprtBytes = (bytes: Uint8Array, file: string) => guarded(async () => {
    const name = partNameOf(file);
    await load(JSON.stringify(emptyPart(name)), { file: null });
    const made = await controller.sldprtPart(bytes, name);
    if (made.ok) {
      await load(JSON.stringify(made.part), { file: null });
      viewport?.fit(); store.notify(made.history && made.historyInfo ? t(made.historyInfo.complete ? 'files.sldprt.history' : 'files.sldprt.historyPartial', { name: file, features: made.historyInfo.rebuilt, faces: made.faces, folder: HISTORY_FOLDER }) : t('files.sldprt.part', { name: file, faces: made.faces })); offerZUp(made.view.mesh);
      reportImport(file, made.parts, false, () => void repairImport('F1'));
      return;
    }
    const r = await controller.importSldprt(bytes, name);
    if (r.ok) {
      viewport?.fit(); store.notify(t('files.sldprt.done', { name: file, faces: r.faces })); offerZUp(r.view.mesh);
      reportImport(file, r.parts, true, () => void repairAsPart(file, () => controller.importedStep(name)));
    }
    else store.notify(t('files.step.failed', { name: file, message: r.message }), 'error');
  });
  /** A SketchUp file into a new part named after the file (view only). The notice says what came in and, for a surface model that is not closed, that solid operations may not apply. */
  const importSkpBytes = (bytes: Uint8Array, file: string, hidden = false, orient: SkpOrient = skpOrient.current) => guarded(async () => {
    const name = partNameOf(file).replace(/\.skp$/i, '');
    await load(JSON.stringify(emptyPart(name)), { file: null });
    const r = await controller.importSkp(bytes, name, skpImportOpts(orient, hidden));
    if (!r.ok) { store.notify(t('files.skp.failed', { name: file, code: r.code, message: r.message }), 'error'); return; }
    viewport?.fit();
    skpOrient.current = r.up;   // the last choice stays for the next file of this session
    const shown = { bytes, file, hidden };
    skpShown.current = shown;
    // "Flip orientation" re-imports this file with the next orientation (same hidden-geometry choice); a stale notice does nothing once another model is shown
    const flip = () => { if (skpShown.current === shown && controller.importedLook()) importSkpBytes(bytes, file, hidden, nextSkpOrient(skpOrient.current)); };
    for (const n of skpNotices(r.summary, { file, up: r.up, hidden }, t, { flip, showHidden: () => importSkpBytes(bytes, file, true, skpOrient.current) })) store.notify(n.text, n.level, n.action);
    reportImport(file, r.parts, true, () => void repairAsPart(file, () => controller.importedStep(name)));
  });
  /** A SketchUp file added to the open part as a reference mesh (the default): per-face colours and translucency kept, saved with the part, drawn on like an STL.
   *  `replaceId`: the mesh to swap for a new read of the same file (Show hidden geometry), keeping where the user put it. */
  const importSkpMesh = async (bytes: Uint8Array, file: string, hidden = false, replaceId?: string) => {
    if (!controller.document()) { store.notify(t('mesh.noDoc'), 'warn'); return; }
    store.notify(t('mesh.import.reading', { name: file }));
    const name = partNameOf(file).replace(/\.skp$/i, '') || 'SketchUp';
    const r = await controller.readSkp(bytes, name, { hidden, maxFaces: SKP_MESH_MAX_FACES });
    if (!r.ok) { store.notify(t('files.skp.failed', { name: file, code: r.code, message: r.message }), 'error'); return; }
    try {
      const have = meshesOf(controller.document());
      const old = replaceId ? have.find((m) => m.id === replaceId) : undefined;
      const up = old ? orientOf(old.rot) ?? skpOrient.current : skpOrient.current;
      const { rec: made, summary } = skpMeshRecord(r, { id: old?.id ?? nextMeshId(have), name, up });
      const rec: MeshRec = old ? { ...made, name: old.name, pos: old.pos, rot: old.rot, scale: old.scale, opacity: old.opacity, visible: old.visible, wire: old.wire } : made;
      controller.setUndoableExtra(MESH_KEY, old ? have.map((m) => (m.id === old.id ? rec : m)) : [...have, rec]);
      refreshMeshes(true);
      void warmPackCache(controller.document()).then(() => redraw((n) => n + 1));
      const shown = { bytes, file, hidden, meshId: rec.id };
      skpShown.current = shown;
      const cur = orientOf(rec.rot) ?? up;
      skpOrient.current = cur;
      for (const n of skpNotices(summary, { file, up: cur, hidden, mesh: rec.tris }, t, { flip: () => { if (skpShown.current === shown) flipSkpMesh(rec.id); }, showHidden: () => { void importSkpMesh(bytes, file, true, rec.id); } })) store.notify(n.text, n.level, n.action);
      redraw((n) => n + 1);
    } catch (e) { store.notify(t('mesh.failed', { name: file, reason: (e as Error).message }), 'error'); }
  };
  /** Flip orientation of a SketchUp mesh: its rotation goes to the next of upright, as in the file, upside down. One undo step. */
  const flipSkpMesh = (id: string) => {
    const list = meshesOf(controller.document());
    const m = list.find((x) => x.id === id);
    if (!m) return;
    const next = nextSkpOrient(orientOf(m.rot) ?? skpOrient.current);
    skpOrient.current = next;
    saveMeshes(list.map((x) => (x.id === id ? { ...x, rot: [...SKP_ROT[next]] as [number, number, number] } : x)));
    store.notify(next === 'y' ? t('files.skp.orient.y') : next === 'z' ? t('files.skp.orient.z') : t('files.skp.orient.yFlip'));
  };
  /** A STEP file as a part whose first feature is the solid (`importStep`, the text embedded in the part): saved with it, rebuilt on open, usable by later
   *  features. When the part cannot be built the solid is shown view only instead, with the reason. */
  const importStepFeature = (text: string, file: string) => guarded(async () => {
    const name = partNameOf(file);
    await load(JSON.stringify(emptyPart(name)), { file: null });
    const r = await controller.importStep(text, name);   // the read and the report (faces, parts, what is not a solid)
    if (!r.ok) { store.notify(t('files.step.failed', { name: file, message: r.message }), 'error'); return; }
    const part = await partOfStep(text, name, file);
    await load(JSON.stringify(part), { file: null });
    const bad = controller.buildErrors()[0];
    if (bad) {
      // the part did not build: keep the view-only solid on screen, say why
      const reason = `${bad[0]}: ${bad[1].code ?? 'error'}`;
      await load(JSON.stringify(emptyPart(name)), { file: null });
      const again = await controller.importStep(text, name);
      store.notify(t('files.step.featureFallback', { message: again.ok ? reason : again.message }), 'warn');
      if (again.ok) viewport?.fit();
      return;
    }
    viewport?.fit();
    store.notify(t('files.step.feature', { name: file, faces: r.faces })); offerZUp(r.view.mesh);
    reportImport(file, r.parts, false, () => void repairImport('F1'));
  });
  /** File menu "Rotate imported model": the shown SketchUp model again, in the next orientation. */
  const rotateSkp = () => {
    const k = skpShown.current;
    if (k?.meshId) { flipSkpMesh(k.meshId); return; }
    if (k && controller.importedLook()) importSkpBytes(k.bytes, k.file, k.hidden, nextSkpOrient(skpOrient.current));
  };
  /** A scratch session on the part built so far (only the rebuild: verify() also meshes and validates the whole body, which on a big file takes minutes per question; the kernel keeps the earlier states, so each question after the first costs a fraction of a second). */
  const importSession = async (partBefore: unknown, tag = 'solidcraft-import') => {
    const transport = await kernelRouter.transport();
    const r = await transport.request({ type: 'regen', tag, part: partBefore, opts: { noView: true } });
    if (r.trap || !r.ok) throw new Error(String(r.trap ?? r.error ?? 'the kernel could not rebuild the part'));
    return new Session(partBefore as unknown as PartDoc, transport, 'import', tag);
  };
  /** A FreeCAD file becomes a new part with the mapped features; what could not be mapped is listed in a notice (see packages/fcstd). */
  const importFcstdBytes = (bytes: Uint8Array, file: string) => guarded(async () => {
    // the kernel names the edges and faces FreeCAD's stored shapes point at (fillets, chamfers, Thickness, Draft, up to face, sketches on faces); a feature it cannot find them for is left out and listed
    const r = await resolveReferences(await importFcstd(bytes, partNameOf(file)), fcstdResolvers((partBefore) => importSession(partBefore)));
    if (!r.part.features.length) { store.notify(t('files.fcstd.failed', { name: file, message: r.warnings[0]?.message ?? 'nothing to import' }), 'error'); return; }
    await load(JSON.stringify(r.part), { file: null });
    viewport?.fit();
    const total = r.steps.length + r.skipped.length;
    if (r.warnings.length) store.notify(t('files.fcstd.done', { name: file, features: r.steps.length, total, warnings: r.warnings.length, first: `${r.warnings[0].object}: ${r.warnings[0].message}` }), 'warn');
    else store.notify(t('files.fcstd.clean', { name: file, total }));
  });
  /** The kernel's answers for the importer (which edge, face or rim is at a position): the part built so far is regenerated on a scratch tag of its own, so the open part is untouched. */
  const scResolvers = kernelResolvers((partBefore) => importSession(partBefore));
  /** The kernel's answers about the original solid of a converted file: its STEP read to the right body, and the volume the operations of the file have to rebuild. */
  const scStep = kernelStepTools(() => kernelRouter.transport());
  /** Open a component's own part in a tab of its own (next to the assembly's); Done writes it back into the assembly, Cancel just closes the tab. */
  const editComponent = (id: string) => {
    const asm = controller.document() as unknown as PartDoc | null;
    const f = asm?.features.find((x) => x.id === id) as (Record<string, unknown> & { part?: PartDoc; name?: string }) | undefined;
    if (!asm || !f?.part) { store.notify(t('asm.editpart.missing'), 'warn'); return; }
    const parentId = tabSet.activeId;
    const part = String(f.name ?? f.part.name ?? id), asmName = String(files.partName ?? asm.name ?? t('app.part.unnamed'));
    const existing = tabSet.tabs.find((x) => x.parent?.tabId === parentId && x.parent.featureId === id);
    if (existing) { void switchTab(existing.id); return; }   // already open: go to it
    void (async () => {
      if (!(await addTab())) return;
      tabSet.active!.parent = { tabId: parentId, featureId: id, part, asm: asmName };
      await load(JSON.stringify(f.part), { file: null });
      redraw((n) => n + 1);
    })();
  };
  /** Close the component's tab and go back to its assembly; `commit` first writes the edited part into the assembly (one undo step there). */
  const finishEditingPart = async (commit: boolean) => {
    const child = tabSet.active;
    const ctx = child?.parent;
    if (!child || !ctx) return;
    const owner = tabSet.get(ctx.tabId);
    if (commit && owner) {
      const edited = controller.document() as unknown as PartDoc | null;
      if (!edited) return;
      const r = await owner.controller.edit([{ op: 'set', id: ctx.featureId, path: 'part', value: JSON.parse(JSON.stringify(edited)) }], 'edit part');
      if (!r.ok) { store.notify(t('asm.editpart.rejected', { part: ctx.part, asm: ctx.asm }), 'error'); return; }
    }
    await leaveEditing();
    tabSet.remove(child.id);
    if (owner) tabSet.activate(owner.id); else if (!tabSet.active && tabSet.tabs[0]) tabSet.activate(tabSet.tabs[0].id);
    await showActive();
    store.notify(t(commit ? 'asm.editpart.back' : 'asm.editpart.cancelled', { asm: ctx.asm, part: ctx.part }));
  };
  /** A SolidCraft file becomes a new part with the features that map; the notice says what did not, and a feature that could not be mapped stays as a suppressed placeholder (see packages/solidcraft). */
  const importSolidcraftBytes = (bytes: Uint8Array, file: string) => guarded(async () => {
    const name = file.replace(/\.solidcraft$/i, '');
    if (importing.value) { store.notify(t('files.solidcraft.failed', { name: file, message: 'another import is still running' }), 'warn'); return; }
    // shown at once: a big file takes minutes, and the page would otherwise look as if nothing had happened
    const ctl = new AbortController();
    importing.value = { name: file, done: 0, total: 0, abort: () => ctl.abort(), phase: 'reading' };
    const tStart = Date.now();
    let r: Awaited<ReturnType<typeof importSolidcraft>>;
    try {
      r = await importSolidcraft(bytes, name, { ...scResolvers, ...scStep, signal: ctl.signal, onProgress: (done, total) => { importing.value = { name: file, done, total, abort: () => ctl.abort(), phase: 'reading' }; } });
    } catch (e) {
      importing.value = null;
      store.notify(t('files.solidcraft.failed', { name: file, message: (e as Error).message }), 'error');
      return;
    }
    if (r.refused === 'cancelled') { importing.value = null; store.notify(t('files.solidcraft.cancelled', { name: file }), 'warn'); return; }
    if (!r.part) { importing.value = null; store.notify(t('files.solidcraft.failed', { name: file, message: r.refused ?? 'nothing to import' }), 'error'); return; }
    // the finished part is rebuilt in the kernel next: with thousands of features that is minutes, so the overlay stays up with its own line and the seconds
    const tRead = Date.now();
    importing.value = { name: file, done: 0, total: 0, abort: () => {}, phase: 'building' };
    try { await load(JSON.stringify(r.part as ScPart), { file: null }); } finally { importing.value = null; }
    store.notify(t('files.solidcraft.timings', { name: file, read: ((tRead - tStart) / 1000).toFixed(1), build: ((Date.now() - tRead) / 1000).toFixed(1) }));
    // their app hides a sketch and a plane once a feature uses it: only the model is shown, as there (a view setting, not in the part)
    lookStore.hidden.value = { body: false, ids: (r.part.features as Array<{ type: string; id: string }>).filter((x) => x.type === 'sketch' || x.type === 'sketch3d' || x.type === 'plane' || x.type === 'helix').map((x) => x.id) };
    viewport?.fit();
    const total = r.rows.length - r.summary.skipped;
    const bad = r.rows.filter((x) => x.status === 'unsupported');
    if (bad.length) store.notify(t('files.solidcraft.done', { name: file, converted: r.summary.converted, total, first: `${bad[0].name}: ${bad[0].reason}`, more: bad.length > 1 ? ` (and ${bad.length - 1} more)` : '' }), 'warn');
    else store.notify(t('files.solidcraft.clean', { name: file, total }));
    if (r.summary.notes) store.notify(t('files.solidcraft.notes', { name: file, count: r.summary.notes }), 'warn');
  });
  /** Open a file by what it is: a part, STEP, DXF, SVG, FreeCAD or SolidCraft; anything else gets a notice. `bytes` reads binary files. */
  const openByKind = (name: string, read: () => Promise<string>, kind: DropKind, bytes?: () => Promise<Uint8Array>) => {
    if (kind === 'fcstd') { if (bytes) void bytes().then((b) => importFcstdBytes(b, name)); return; }
    if (kind === 'solidcraft') { if (bytes) void bytes().then((b) => importSolidcraftBytes(b, name)); return; }
    if (kind === 'skp') { if (bytes) void bytes().then((b) => setKindDlg({ kind: 'skp', name, bytes: b, hidden: false })); return; }
    if (kind === 'sldprt') { if (bytes) void bytes().then((b) => importSldprtBytes(b, name)); return; }
    if (kind === 'part') guarded(async () => { await load(await read(), { file: name }); });
    else if (kind === 'step') void read().then((text) => setKindDlg({ kind: 'step', name, text, hidden: false }));
    else if (kind === 'dxf') void read().then((text) => { if (controller.sketchDraft()) void importDxfIntoSketch(controller, text).then((r) => { showNotices(r.notices); viewTick((n) => n + 1); if (r.ok) viewport?.fit(); }); else sketchFromDxfText(text); });
    else if (kind === 'svg') void read().then((text) => { if (controller.sketchDraft()) void importSvgIntoSketch(controller, text).then((r) => { showNotices(r.notices); viewTick((n) => n + 1); if (r.ok) viewport?.fit(); }); else sketchFromSvgText(text); });
    else if (kind === 'stl') { if (bytes) void bytes().then((b) => importStlBytes(b, name)); }
    else store.notify(t('files.drop.unknown', { name }), 'error');
  };
  const dropFiles = (list: File[]) => {
    const plan = planDrop(list.map((f) => f.name));
    if (plan.action === 'none') return;
    if (plan.action === 'multiple') { store.notify(t('files.drop.one'), 'warn'); return; }
    openByKind(plan.name, () => fileText(list[0]), plan.kind, async () => new Uint8Array(await list[0].arrayBuffer()));
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
  const ti = useTreeInteraction({ controller, store, viewport: () => viewport, selectedId, setSelectedId, setRefSel, redraw: () => redraw((n) => n + 1), edit, startEditing: (id) => startEditing(id), rows: () => rows, exportFolder: (name, ids, format) => void exportFolder(name, ids, format), extractFolder: (name, ids) => void extractFolder(name, ids) });
  bodyDoubleRef.current = ti.onBodyDouble;
  treeKeyRef.current = (e, onCanvas) => treeKey(e, ti.actions, onCanvas);
  const featureActions: FeatureActions = {
    context: () => ({ doc: controller.document(), selection: store.selection.value, mode: store.mode.value, box: controller.bodyBox(), edges: controller.bodyEdges(), selectedId, selectedIds: ti.actions.selected(), refPlane: refSel, tangentChain: tangentChainOn() }),
    create: (ops) => void createFeature(ops),
    holeOnFace: (face) => { holeSketchRef.current = true; startNewSketch({ kind: 'face', id: face }); },
    holeFlip: (sketchId) => controller.extrudeFlip(sketchId, 'cut'),
    addThread: (faces) => void addThread(faces),
    select: (names) => store.select(names),
    notify: (text, level) => store.notify(text, level),
  };
  const revealRef = useRef<{ canShow(): boolean; show(): void }>({ canShow: () => false, show: () => {} });   // filled by useRevealInTree below (the commands are built before the tree rows exist)
  const sheetUi = useSheet({
    controller, doc: controller.document(), editingId, draft, context: featureActions.context,
    create: (ops) => void createFeature(ops), startEditing: (id) => startEditing(id), redraw: () => redraw((n) => n + 1),
    notify: (text, level) => store.notify(text, level), save: (name, data, mime) => platform.saveFile(name, data, mime),
  });
  const commands = buildCommands({
    catalog: () => showCatalog(),
    variables: () => showVariables(),
    script: () => showScript(),
    propeller: () => openPropeller(),
    impeller: () => openImpeller(),
    knurl: () => openKnurl(),
    screw: () => openScrew(),
    washer: () => openWasher(),
    bearing: () => openBearing(),
    frame: () => openFrame(null),
    sketch3d: () => openSketch3d(null),
    cutList: () => void openCutList(),
    open: async () => { const f = await platform.openFile({ accept: OPEN_ACCEPT }); if (f) openByKind(f.name, async () => f.text, dropKind(f.name), async () => f.bytes ?? new Uint8Array()); },
    save: () => doSave(false),
    files: {
      saveAs: () => void doSave(true),
      embedOn: () => embedPref,
      toggleEmbed: () => chooseEmbed(!embedPref),
      recover: () => setRecoverOpen(true),
      rotateSkp: () => rotateSkp(),
      hasSkp: () => !!skpShown.current && (skpShown.current.meshId ? meshesOf(controller.document()).some((m) => m.id === skpShown.current!.meshId) : !!controller.importedLook()),
      importSkpHidden: () => void (async () => { const f = await platform.openFile({ accept: ['.skp'] }); if (f && dropKind(f.name) === 'skp') setKindDlg({ kind: 'skp', name: f.name, bytes: f.bytes ?? new Uint8Array(), hidden: true }); })(),
      importStep: () => void (async () => { const f = await platform.openFile({ accept: IMPORT_ACCEPT }); if (f) openByKind(f.name, async () => f.text, ['step', 'stl', 'sldprt', 'skp'].includes(dropKind(f.name)) ? dropKind(f.name) : 'unknown', async () => f.bytes ?? new TextEncoder().encode(f.text)); })(),
    },
    samples: async () => setSamples(await platform.listSamples()),
    undo: async () => { await controller.undo(); redraw((n) => n + 1); },
    redo: async () => { await controller.redo(); redraw((n) => n + 1); },
    palette: () => setPalette(true),
    toggleDrawer,
    resetLayout: () => resetLayout(store),
    sketchHere,
    sketchPickPlane: beginPlanePick,
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
    sheet: sheetUi.actions,
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
    io: { importDxf: () => void importDxf(), sketchFromDxf: () => void sketchFromDxf(), importSvg: () => void importSvg(), sketchFromSvg: () => void sketchFromSvg(), isSketching: () => sketchingRef.current, exportAs: (k) => void exportAs(k), openExportMenu: () => setExportOpen(true), canExport },
    setView: (v) => viewport?.setView(v),
    fit: () => viewport?.fit(),
    setMode: (m) => setMode(m),
    select: {
      model: () => controller.selModel(), selection: () => store.selection.value, mode: () => store.mode.value, hasDocument: () => controller.document() !== null,
      apply: applySelection, clear: () => store.select([]), setMode: (m) => setMode(m), box: { isOn: () => boxOn, toggle: toggleBox },
      notify: (text, level) => store.notify(text, level ?? 'info'),
      revealInTree: { can: () => revealRef.current.canShow(), run: () => revealRef.current.show() },
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
  // Tabs: Ctrl+Tab / Ctrl+Shift+Tab step through them (also from the Script box); Ctrl+Alt+1..9 jump to one (9 is the last), Ctrl+Alt+T opens a new part, Ctrl+Alt+W closes the active one
  const tabKeysRef = useRef<(e: KeyboardEvent) => boolean>(() => false);
  tabKeysRef.current = (e) => {
    if (!e.ctrlKey || e.metaKey) return false;
    const n = tabSet.count, at = tabSet.index(tabSet.activeId);
    let to: number | null = null;
    if (e.key === 'Tab' && !e.altKey) to = (at + (e.shiftKey ? -1 : 1) + n) % n;
    else if (e.altKey && /^Digit[1-9]$/.test(e.code)) { const d = +e.code.slice(5); to = d === 9 ? n - 1 : Math.min(d - 1, n - 1); }
    else if (e.altKey && e.code === 'KeyW') { void closeTab(tabSet.activeId); return true; }
    else if (e.altKey && e.code === 'KeyT') { void (async () => { if (await addTab()) await load(JSON.stringify(emptyPart(files.names.next())), { file: null }); })(); return true; }
    if (to === null) return false;
    const target = tabSet.tabs[to];
    if (target && target.id !== tabSet.activeId) void switchTab(target.id);
    return true;
  };
  useEffect(() => {
    const onTabKey = (e: KeyboardEvent) => { if (tabKeysRef.current(e)) e.preventDefault(); };
    addEventListener('keydown', onTabKey);
    return () => removeEventListener('keydown', onTabKey);
  }, []);
  useEffect(() => {
    const onPress = (e: PointerEvent) => { lastPressOnCanvas.current = (e.target as HTMLElement | null)?.tagName === 'CANVAS'; };
    addEventListener('pointerdown', onPress, true);
    return () => removeEventListener('pointerdown', onPress, true);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (isTextEntry(t)) { if (t?.closest?.('.sketch-fields')) seedBufRef.current = ''; return; }   // a field or editor has the keys: nothing is waiting to be put into it
      // Script tab showing and focus not in the viewport (lost after a tab switch, Fit or a cancelled prompt): typed characters belong to the script box, never to the single-key shortcuts
      if (!sketchingRef.current && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && scriptOwnsKey(scriptTabRef.current && !!document.querySelector('.script-panel')?.getClientRects().length, t, lastPressOnCanvas.current)) { document.querySelector<HTMLTextAreaElement>('.script-panel textarea')?.focus({ preventScroll: true }); return; }
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
      // Enter with nothing in progress (no sketch, no feature being edited, no measuring, no dialog) runs the last command again
      else if (e.key === 'Enter' && onCanvas && !sketchingRef.current && !editingIdRef.current && !measureRef.current && !document.querySelector('dialog[open], [role="dialog"]')) {
        const again = commandsRef.current.find((c) => c.id === 'repeat-last');
        if (again && (again.enabled?.() ?? true)) { e.preventDefault(); again.run(); }
      }
      else if (e.key === 'Escape') {
        if (sketchCancelRef.current) { e.preventDefault(); void sketchCancelRef.current(true); return; }
        setPalette(false); setSettings(false); setSamples(null);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // a body is called by its name from the Bodies list (a script / user name or its feature's), 'Body n' only when it has none
  let bodyRowsCache: BodyRow[] | null = null;
  const bodyNameOf = (n: string): string | null => { const r = rowOfName(bodyRowsCache ??= bodyRowsFor(false), n); return r?.named ? r.name : null; };
  const hoverLabel = (n: string | null) => (n && isBodyName(n) ? chipsOf([n], controller.selModel(), bodyNameOf)[0].label : n);
  const selModelNow = store.selection.value.length ? controller.selModel() : null;
  const selText = selModelNow ? summaryText(summarize(selModelNow, store.selection.value)) : '';
  const quickText = useQuickMeasure(controller, store.selection.value, selText, inspect.measuring || !!sketching);
  const doc = controller.document();
  const rows = doc ? featureRows(doc as never) : [];
  const rev = useRevealInTree(store.selection.value, rows.map((r) => r.id), doc ? insertIds(doc as never) : new Set<string>(), !sketching);
  revealRef.current = rev;
  const feature = doc && selectedId ? (doc.features.find((f) => f.id === selectedId) as unknown as Record<string, unknown> | undefined) ?? null : null;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const records = controller.history();
  const entries = toEntries(records, rejections.value);
  const failures = store.featureStatus.value.filter((s) => !s.ok);
  const warnList = Object.entries(store.featureWarnings.value);
  const facts = store.facts.value;

  const editShapes = (() => {
    const ef = editingId && doc ? doc.features.find((f) => f.id === editingId) as unknown as { type?: string; sketch?: string } | undefined : undefined;
    if (!ef || (ef.type !== 'extrude' && ef.type !== 'revolve' && ef.type !== 'sheetCut') || !ef.sketch) return [];
    const sk = doc!.features.find((f) => f.id === ef.sketch);
    const all = sketchShapes(sk as never);
    // a thin wall can be made of open curves too: they are listed after the closed shapes
    const thin = !!thinOf({ ...ef, ...draft } as Record<string, unknown>);
    const chains = thin ? sketchOpenChains(sk as never).map((c, i) => ({ id: c.id, label: t('app.shape.chain', { n: i + 1, count: c.entityIds.length }), byDefault: true })) : [];
    // without `regions` the kernel extrudes by even-odd nesting (holes stay open): those are the boxes ticked by default (a thin wall uses every shape)
    const byDefault = new Set(thin ? all.map((sh) => sh.id) : defaultShapeIds(all));
    return [...all.map((sh, i) => {
      const parent = all.find((o) => o.id === sh.inside);
      const holes = all.filter((o) => o.inside === sh.id);
      // the projected-outline-plus-offset sketch gets plain names; other nestings say which shape they wrap or sit in
      const label = parent?.reference ? t('app.shape.insideOffset')
        : sh.reference && holes.length && !holes.every((h) => h.reference) ? t('app.shape.wall')
        : parent ? t('app.shape.insideShape', { m: all.indexOf(parent) + 1 })
        : holes.length ? t('app.shape.withHole', { n: i + 1, m: all.indexOf(holes[0]) + 1 })
        : t('app.shape.' + sh.kind, { n: i + 1, d: Math.round(sh.radius * 2 * 100) / 100, count: sh.entityIds.length });
      return { id: sh.id, label, byDefault: byDefault.has(sh.id) };
    }), ...chains];
  })();
  const editingFeature = editingId && doc ? (doc.features.find((f) => f.id === editingId) as unknown as Record<string, unknown> | undefined) ?? null : null;
  // An Undo (or a delete) can remove the very feature whose editor is open. The editor then has nothing to show ("No feature
  // selected.") and must not stand in for the feature tree: close it once the feature that was there is gone.
  const editorGone = useEditorGone(editingId, !!editingFeature, !!doc, () => {
    setEditingId(null); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null); setLeftTab('Features');
  });
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
      const value = toggleRegion(editShapes.map((x) => x.id), cur, sh.id, editShapes.filter((x) => x.byDefault !== false).map((x) => x.id));
      if (value === undefined) return true;   // at least one stays
      setPicked({ path: 'regions', value });
      return true;
    },
  };
  const regionFrame = editShapes.length > 1 && editingFeature?.sketch ? controller.sketchFrameOf(String(editingFeature.sketch)) : null;
  useEffect(() => {
    if (!regionFrame) return;
    viewport?.setRegionPicker({ frame: regionFrame as never, move: (u, v) => regionRef.current?.move(u, v), tap: (u, v) => regionRef.current?.tap(u, v) ?? false });
    return () => { viewport?.setRegionPicker(null); viewport?.highlightSketchEntities(null, []); };
  }, [viewport, editingId, !!regionFrame]);
  const cutProblemNow = cutProblem(editingFeature ? { ...editingFeature, ...draft } : null, previewDiag?.d.roots ?? null);
  const thinActions = {
    cutProblem: cutProblemNow,
    closeWithLine: (sketchId: string) => {
      const op = closeWithLineOp(doc, sketchId);
      if (op) void timed(() => controller.commit([op], 'closeProfile')).then(() => { redraw((n) => n + 1); if (editingId) { const ops = opsFromDraft(draft); if (ops.length) void controller.preview(ops).then((r) => setPreviewHint(r.ok ? null : (r.hint ?? null))); } });
    },
    asSurface: () => {
      if (!editingFeature) return;
      void timed(() => controller.commit([asSurfaceOp({ ...editingFeature, ...draft })], 'surfaceExtrude')).then(() => { setDraft({}); setPreviewHint(null); redraw((n) => n + 1); });
    },
    chainEdges: async (eff: Record<string, unknown>) => chainRefs(eff.edges, await controller.edgesBeforeCached(String(eff.id ?? ''))),
  };
  const opsOne = (f: Record<string, unknown>, id: string, next0: Record<string, unknown>): EditOp[] => {
    const next = f.draftNew ? { ...next0, suppressed: null, draftNew: null } : next0;   // a draft loft (refused when made) becomes real with its first accepted edit
    // `regions: null` means the default shapes again (every shape but the holes): the field is dropped, which a plain `set` cannot do
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
    const mv = editingFeature.type === 'loft' && Array.isArray(next.sketches) ? loftMoveAfter(feats as never, editingId!, next.sketches as string[]) : null;   // a loft picked a later sketch: it moves down after it
    if (mv) return [...ops, mv.op];
    return thread !== undefined && editingFeature.type === 'hole' ? [...ops, ...holeThreadEditOps(editingId!, holeLinked, thread, holeWalls)] : ops;
  };
  const onDraft = (next: Record<string, unknown>, thread?: HoleThread | null) => {
    setDraft(next); draftRef.current = next;
    const ops = opsFromDraft(next, thread);
    if (!ops.length) return;
    void controller.preview(ops).then((r) => {
      onPreviewResult(r);
      // a height typed past the tip: the field takes the number the model has, and the panel says why
      if (r.tip) { setPicked({ path: 'depth', value: r.tip.maxHeight, once: true }); setDraft({ ...next, depth: r.tip.maxHeight }); setPreviewHint(t('tip.limited', { h: String(Math.round(r.tip.maxHeight * 100) / 100) })); }
    });
  };
  const onConfirm = async (next: Record<string, unknown>, thread?: HoleThread | null) => {
    viewport?.highlightSketchEntities(null, []);
    const ops = opsFromDraft(next, thread);
    const moved = ops.find((o) => o.op === 'move' && o.id === editingId) as { to: number } | undefined;
    const movedAfter = moved ? (controller.document()?.features ?? [])[moved.to] : undefined;
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
    if (movedAfter) store.notify(t('app.loft.moved', { name: featureLabel(controller.document(), movedAfter as never) }), 'info');
    if (editingId) setSelectedId(editingId);
    setLeftTab('Features');   // back to the history tree, with the feature you just edited selected
    redraw((n) => n + 1);
  };
  /** The refused edit's one-click fixes (suggested shell thickness, flip a cut that misses the body): they patch the draft, which previews again. */
  const diagFixes = () => {
    const root = previewDiag?.d.roots[0];
    if (!root || !editingFeature) return {};
    const r = editorFixes(root, editingFeature as never, draft);
    return { ...(r.message ? { message: r.message } : {}), fixes: r.fixes.map((f) => ({ key: f.key, label: f.label, run: () => setPicked({ path: f.path, value: f.value, once: true }) })) };
  };
  /** The Hole editor's one-click fix: the largest counterbore depth / countersink diameter the kernel named for this hole. */
  const holeFix = () => {
    const root = previewDiag?.d.roots[0];
    const m = root && editingFeature ? maxSizeOf(root.params) : null;
    const f = m ? editorFixes(root, editingFeature as never, draft).fixes.find((x) => x.key === 'maxSize') : undefined;
    return m && f ? { note: t('diag.advice.maxSize', { size: maxSizeText(m) }), label: f.label, path: f.path, value: f.value } : null;
  };
  const selectFailed = (id: string) => { setSelectedId(id); if (!editingId) setLeftTab('Features'); };
  const onCancel = async () => {
    viewport?.highlightSketchEntities(null, []);
    await controller.cancelPreview();
    if (editingId && (editingFeature as { draftNew?: boolean } | null)?.draftNew) await controller.deleteFeatures([editingId]);   // the refused draft loft goes away with its editor
    if (pickingPath === 'corners') { cornerSelRef.current = []; store.select([]); }   // the corners picked for a cancelled Corner must not feed the next command
    setEditingId(null); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
    setLeftTab('Features');
    redraw((n) => n + 1);
  };


  // ---- edge flange and hem editors: the two span points picked in the view, and the sketch that outlines the leg ----
  const spanPts = useRef<number[][]>([]);
  const flangeEff = (): Record<string, unknown> => {
    const eff: Record<string, unknown> = { ...(editingFeature ?? {}), ...draftRef.current };
    for (const k of Object.keys(eff)) if (eff[k] === null) delete eff[k];
    return eff;
  };
  /** The polylines of the edges the flange is picked on, as the body on screen has them (a pick names its two faces; a span of two points is its own line). */
  const flangeEdgeLines = (eff: Record<string, unknown>): number[][][] => {
    const edges = controller.bodyEdges();
    const out: number[][][] = [];
    for (const pk of Array.isArray(eff.edges) ? eff.edges as unknown[] : []) {
      const faces = (pk as { faces?: string[] } | null)?.faces;
      if (!faces) continue;
      for (const e of edges) if (e.pts && e.faces && faces.length === e.faces.length && faces.every((f) => e.faces!.includes(f))) out.push(e.pts);
    }
    return out;
  };
  flangeActions.current = editingId && editingFeature && (editingFeature.type === 'edgeFlange' || editingFeature.type === 'hem') ? {
    pickSpan: () => {
      if (pickingPath === 'span') { setPickingPath(null); spanPts.current = []; setSpanPicked(0); return; }
      spanPts.current = []; setSpanPicked(0); store.select([]); setPickingPath('span');
    },
    edgeLength: (eff) => {
      const sp = spanOf(eff, editingFeature.type === 'hem');
      if (sp.from && sp.to) return Math.hypot(sp.to[0] - sp.from[0], sp.to[1] - sp.from[1], sp.to[2] - sp.from[2]);
      const line = flangeEdgeLines(eff)[0];
      return line && line.length > 1 ? line.slice(1).reduce((n, q, i) => n + Math.hypot(q[0] - line[i][0], q[1] - line[i][1], q[2] - line[i][2]), 0) : null;
    },
    newSketch: () => void flangeSketch('new'),
    convert: () => void flangeSketch('convert'),
    editSketch: (sid) => void flangeSketch('edit', sid),
  } : null;
  useEffect(() => {   // while picking the span, a click in the view gives a point; the second one sets the span
    if (pickingPath !== 'span' || !viewport || !editingId) return;
    const hem = (editingFeature as { type?: string } | null)?.type === 'hem';
    viewport.setPickIntercept((_name, point) => {
      if (!point) return;
      const eff = flangeEff();
      let p: number[] = point;
      let best = Infinity;
      for (const line of flangeEdgeLines(eff)) {   // a click beside the picked edge lands on it
        const q = nearestOnPolyline(line, point);
        const d = q ? Math.hypot(q[0] - point[0], q[1] - point[1], q[2] - point[2]) : Infinity;
        if (q && d < best) { best = d; p = q; }
      }
      const pts = spanPts.current.length >= 2 ? [] : [...spanPts.current];
      pts.push(p);
      spanPts.current = pts;
      setSpanPicked(pts.length >= 2 ? 0 : pts.length);
      if (pts.length >= 2) {
        setHandleInject((x) => ({ seq: (x?.seq ?? 0) + 1, patch: patchSpanPoints(eff, pts[0], pts[1], hem) }));
        spanPts.current = []; setPickingPath(null);
      }
    });
    return () => { viewport?.setPickIntercept(null); setSpanPicked(0); spanPts.current = []; };
  }, [pickingPath, viewport, editingId]);
  /** Make the outline sketch of the open edge flange (`new`: the default leg as a rectangle; `convert`: the imported outline as lines and arcs) on a plane in the
   *  flange's own frame, put it before the flange, point the flange at it and open the sketcher; or (`edit`) apply the draft and open the flange's sketch. */
  const flangeSketch = async (kind: 'new' | 'convert' | 'edit', sid?: string): Promise<void> => {
    const fid = editingId, d = controller.document();
    if (!fid || !d || !editingFeature) return;
    const eff = flangeEff();
    if (kind === 'edit' && sid) {
      await onConfirm(draftRef.current);
      if (editingIdRef.current !== fid) startEditing(sid);
      return;
    }
    const at = d.features.findIndex((f) => f.id === fid);
    const prof = profileOf(eff);
    if (at < 0 || (kind === 'convert' && prof.kind !== 'inline')) return;
    const th = typeof (d.features.find((f) => f.type === 'sheetRules') as { thickness?: number } | undefined)?.thickness === 'number' ? (d.features.find((f) => f.type === 'sheetRules') as { thickness: number }).thickness : 2;
    const num = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : typeof v === 'string' && Number.isFinite(+v) && +v > 0 ? +v : null);
    // a converted outline is as high as its outline; a new sketch starts from the default leg, as high as the Height field says
    const height = kind === 'convert' && prof.kind === 'inline' ? segBounds(prof.segs).maxH : num(eff.height) ?? 10 * th;
    const sp = spanOf(eff, false);
    let frame = null as ReturnType<typeof legFrame>;
    try {
      const g = legGeometry(await controller.sheetMetal(), fid, controller.bodyFaces());
      frame = g ? legFrame(g.leg, g.normal, g.tip, height, sp.from && sp.to ? [sp.to[0] - sp.from[0], sp.to[1] - sp.from[1], sp.to[2] - sp.from[2]] : null, sp.from) : null;
    } catch { frame = null; }
    const cands = outlineCandidates({ kind: kind === 'convert' ? 'convert' : 'new', eff, frame, seq: freeFeatureNumber(d), name: t('app.sheet.flange.sketchName'), planeName: t('app.sheet.flange.planeName'), height, width: sp.length !== undefined && num(sp.length) ? num(sp.length) : flangeActions.current?.edgeLength(eff) ?? null });
    if (cands.refused !== undefined) { store.notify(t('opt.sheet.leg.noConvertV', { by: String(cands.refused) }), 'warn'); return; }
    let chosen: { ops: EditOp[]; sketchId: string } | null = null;
    let firstFail = '';
    for (const pl of cands.plans) {   // the second candidate is the mirrored one (see flangeSketch.ts): tried only when the first does not build
      const ops: EditOp[] = [
        ...pl.add.map((feature, i) => ({ op: 'add', feature, index: at + i } as EditOp)),
        ...opsFromDraft({ ...draftRef.current, ...pl.patch }),
      ];
      const trial = await controller.preview(ops, 0);
      await controller.cancelPreview();
      if (trial.ok) {
        chosen = { ops, sketchId: pl.sketchId };
        if (pl.unpinned) {   // the direction is known: a flange on the whole edge goes back to no span, so its bend follows the outline
          const bare: EditOp[] = [...ops.slice(0, pl.add.length), ...opsFromDraft({ ...draftRef.current, ...pl.unpinned })];
          const again = await controller.preview(bare, 0);
          await controller.cancelPreview();
          if (again.ok) chosen = { ops: bare, sketchId: pl.sketchId };
        }
        break;
      }
      if (!firstFail) firstFail = controller.rejection()?.summary ?? trial.hint ?? '';
    }
    if (!chosen) { setPreviewHint(firstFail || t('app.sheet.flange.sketchFailed')); return; }
    const r = await timed(() => controller.commit(chosen!.ops));
    if (!r.ok) { setPreviewHint(controller.rejection()?.summary ?? (r.hints?.map((h) => h.hint).join('; ') || (r as { schemaError?: string }).schemaError || 'edit failed')); redraw((n) => n + 1); return; }
    setEditingId(null); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
    redraw((n) => n + 1);
    startEditing(chosen.sketchId);
    store.notify(t(frame ? 'app.sheet.flange.sketchOn' : 'app.sheet.flange.sketchFallback'), frame ? 'info' : 'warn');
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
  useEffect(() => { viewport?.setHighlight([...new Set([...hlNames(), ...(threadFace ? [threadFace] : [])])]); }, [threadFace, store.selection.value]);
  useEffect(() => { viewport?.setThreadFocus(threadFace ? editingId : null); return () => viewport?.setThreadFocus(null); }, [threadFace, editingId]);
  // The move / rotate ball (F10): see triball/useTriBall.tsx and docs/triball.md. While it is on, the contextual handles step aside.
  const tri = useTriBall({
    controller, store, viewport: () => viewport, selectedFeature: selectedId,
    commit: async (ops) => { const r = await timed(() => controller.commit(ops)); redraw((n) => n + 1); return r.ok; },
    editingId, sketching: !!sketching, prefs: triPrefs, onPrefs: setTriPrefs,
  });
  triRef.current = tri;
  // The Extrude / Cut card is open: one arrow on the preview sets the depth in the card's draft (handles/depthArrow.ts).
  const depthArrow: DepthArrowCtx | null = (() => {
    if (!editingFeature || editingFeature.type !== 'extrude' || !editingId || openCard) return null;
    const eff: Record<string, unknown> = { ...editingFeature, ...draft };
    for (const k of Object.keys(eff)) if (eff[k] === null) delete eff[k];
    const sk = doc?.features.find((f) => f.id === eff.sketch) as unknown as Record<string, unknown> | undefined;
    const frame = typeof eff.sketch === 'string' ? controller.sketchFrameOf(eff.sketch) : null;
    const centre = sk ? profileCentre(sk, eff.regions) : null;
    if (!frame || !centre) return null;
    return {
      id: editingId, op: eff.op === 'cut' ? 'cut' : 'add', end: typeof eff.end === 'string' ? eff.end : 'blind',
      depth: typeof eff.depth === 'number' ? eff.depth : null, flip: eff.flip === true, frame, centre, tipLimit: controller.tipLimit(editingId),
      ops: (patch) => opsFromDraft({ ...draft, ...patch }),
    };
  })();
  // Contextual handles (arrows and dots on the selection) and the right-click menu: see useHandles.tsx and docs/contextual-handles.md
  const handles = useHandles({
    controller, store, viewport: () => viewport, commands,
    create: (ops) => createFeature(ops),
    commitInPlace: async (ops) => { const r = await timed(() => controller.commit(ops)); if (r && !r.ok) await controller.cancelPreview(); redraw((n) => n + 1); },
    editingId, selectedId, sketching: !!sketching, enabled: ws.handles && !tri.on,
    thread: threadEntry && editingId ? { id: editingId, entry: threadEntry, maxLength: threadExtent?.length ?? null, ops: (length) => opsFromDraft({ ...draft, length }) } : null,
    depthArrow,
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
  /** The camera on entering a sketch: squared up when the view is not kept, or for a NEW sketch with 'Auto look normal'; otherwise left alone, with a Look normal chip when it is angled to the plane (more than 5 degrees). */
  const enteredSketch = (isNew: boolean) => {
    const p = prefsRef.current;
    if (!p.keepView || (isNew && p.autoLookNormal)) { viewport?.orientToSketch(); setLookChip(false); return; }
    setLookChip(lookChipNeeded(viewport?.sketchLookAngle() ?? null));
  };
  const lookNormal = () => { viewport?.orientToSketch(); setLookChip(false); };
  const startEditing = (id: string) => {
    // a thread copy made by a pattern is read-only: its source thread is the one to edit, and every copy follows
    const copy = id.includes('@') ? (controller.threadsNow() as ThreadEntry[]).find((x) => x.id === id) : undefined;
    if (copy?.instanceOf && doc?.features.some((x) => x.id === copy.instanceOf)) { store.notify(t('app.thread.followed', { face: copy.face ?? id, id: copy.instanceOf }), 'info'); id = copy.instanceOf; }
    setEditingMaterial(false);
    setSelectedId(id);
    const f = doc?.features.find((x) => x.id === id) as { type?: string; name?: string } | undefined;
    const marine = marineOwner((controller.document()?.features ?? []) as unknown[], id);
    if (marine) {   // any feature a marine propeller made opens the marine wizard on its parameters
      setSelectedId(marine.hubId); setEditingId(null); setPropWiz({ params: DEFAULT_PROP, marine: marine.params, roles: marine.roles, hubId: marine.hubId });
      setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
      setLeftTab('Editor');
      return;
    }
    const imp = impellerOwner((controller.document()?.features ?? []) as unknown[], id);
    if (imp) {   // any feature an impeller made opens the impeller wizard on its parameters
      setSelectedId(imp.hubId); setEditingId(null); setImpWiz({ params: imp.params, roles: imp.roles, hubId: imp.hubId });
      setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
      setLeftTab('Editor');
      return;
    }
    const prop = propOwner((controller.document()?.features ?? []) as unknown[], id);
    if (prop) {   // any feature a propeller made opens the wizard on its parameters
      setSelectedId(prop.hubId); setEditingId(null); setPropWiz({ params: prop.params, roles: prop.roles, hubId: prop.hubId });
      setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
      setLeftTab('Editor');
      return;
    }
    if ((f as { type?: string } | undefined)?.type === 'sketch3d') { openSketch3d(id); return; }   // a 3D sketch reopens the 3D Sketch panel on its points
    if ((f as { type?: string } | undefined)?.type === 'frame') { openFrame(id); return; }   // a frame reopens the Frame panel on its parameters
    const knurl = knurlOwner((controller.document()?.features ?? []) as never, id);
    if (knurl) { openKnurlEdit({ owner: knurl }); return; }   // a knurl the wizard made (or a faceted band) reopens the Knurl wizard; unmarked ones stay on the generic editor
    const gear = gearOwner((controller.document()?.features ?? []) as unknown[], id);
    if (gear) {   // any feature a gear made opens the Gear editor on its parameters
      setSelectedId(gear.profileId); setEditingId(gear.profileId);
      setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
      setLeftTab('Editor');
      return;
    }
    if (f?.type === 'sketch') {
      setEditingId(null); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null);
      resetSketchShell();
      void (async () => {
        const view = await controller.beginSketch(id);
        if (!view) { store.notify(t('app.sketch.failed'), 'error'); return; }
        setSketching({ id, name: featureLabel(controller.document(), f as never) || id });
        enteredSketch(false);
      })();
      return;
    }
    setEditingId(id);
    // a feature with an edges list (Fillet, Chamfer...) opens with that field active, so taps add edges without a modifier key
    const now = (controller.document()?.features.find((x) => x.id === id) ?? f) as { edges?: unknown; corners?: unknown } | undefined;   // a feature just added is not in this render's doc yet
    const withEdges = Array.isArray(now?.edges);
    // a Sheet corner with no corners yet opens with its field active too (the Corner command needs nothing selected first)
    const withCorners = !withEdges && Array.isArray(now?.corners) && now.corners.length === 0;
    if (withEdges) store.select([]);
    if (withCorners) { store.select([]); cornerSelRef.current = []; store.mode.value = 'vertex'; }
    setDraft({}); setPicked(null); setPickingPath(withEdges ? 'edges' : withCorners ? 'corners' : null); setPreviewHint(null);
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
    else if (toolEntitiesRef.current.length || ['mirror', 'pattern-linear', 'pattern-circular'].includes(entry.id)) runTool({ type: 'move', at: { x: 0, y: 0 }, mods: { shift: false, ctrl: false, alt: false } });   // lets a tool that acts on a selection take it up at once
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
  const runTool = (ev: ToolEvent, dry = false): ToolOutput<unknown> | undefined => {
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
    if (dry) return out;   // only asking what the event would do
    // a click that snapped to a midpoint or an alignment makes that a real constraint, so it survives later edits
    if (ev.type === 'click' && out.draft !== draft && constrainsFromGuides(prefsRef.current, ev.mods.shift)) out.draft = applySnapConstraints(draft, out.draft, snap);
    // Shift+click on a model point attaches the new point to the model (a fixed reference point there); without Shift it only positions it
    if (ev.type === 'click' && out.draft !== draft && ev.mods.shift && snap?.model) out.draft = attachModelSnap(draft, out.draft, snap);
    if (out.draft !== draft && constructionModeRef.current && entry.group === 'draw') out.draft = markNewAsConstruction(draft, out.draft);
    toolStateRef.current = out.state;
    // the Dimension tool just resolved what it measures (two lines: their angle ...): its value field takes the focus, selected, ready to be typed over
    if (entry.id === 'dimension' && out.fields.length && !lastOutRef.current?.fields.length) setFieldSeed((s0) => ({ n: s0.n + 1, text: null }));
    lastOutRef.current = out;
    viewport?.setSketchPreview([...(out.preview as SketchPreviewShape[]), ...snapVisuals(draft, snap, out)]);
    readout.snapAt.value = snap ? snap.at : null;
    readout.snapName.value = snap && snap.kind !== 'grid' ? t('app.sketch.snap.' + (snap.model ?? (snap.kind === 'point' ? snap.role ?? 'point' : snap.kind))) : snap ? t('app.sketch.snap.grid') : null;
    readout.from.value = out.from ?? out.anchor ?? null;
    setToolOut({ fields: out.fields, ...(out.panel ? { panel: out.panel } : {}), x: lastPosRef.current.x, y: lastPosRef.current.y, pending: out.pending, snapLabel: snap ? t('app.sketch.snap.' + (snap.model ?? (snap.kind === 'point' ? snap.role ?? 'point' : snap.kind))) : undefined, snapModel: !!snap?.model });
    const toolHint = (): string => t(out.hint!, out.dropped ? { kinds: out.dropped.map((k) => t('app.sketch.constraint.' + k, undefined, k)).join(', ') } : undefined);
    if (out.hint) setSketchHint(toolHint());
    if (out.draft !== draft) {
      if (['move', 'copy', 'rotate', 'scale', 'mirror', 'pattern-linear', 'pattern-circular'].includes(entry.id)) toolEntitiesRef.current = [];   // done: the next run picks again
      const before = new Set(draft.constraints.map((c) => c.id));
      const placed = (entry.id === 'text' || entry.id === 'equation') && ev.type === 'click' ? (out.state as { placed?: string }).placed : undefined;
      void controller.applySketchDraft(out.draft).then((r) => {
        setSketchHint(r.ok || r.stale ? (out.hint ? toolHint() : null) : (r.hint ? t(r.hint) : null));
        viewTick((n) => n + 1);   // the solver's answer (degrees of freedom, constraint list) arrives after the tool's own redraw
        if (r.ok && !r.stale) settleDimensions(before, r.status);
        // a placed text or equation curve is edited in its panel: back to Select mode with the new entity picked
        if (placed && r.ok) { selectTool(null); selectEntity(placed, lastPosRef.current.x, lastPosRef.current.y); }
        // a circle dragged out by a finger: it is picked and its radius field takes the focus (the digit keypad), so an exact size can be typed
        const prior = touchPlaceRef.current;
        if (prior) {
          touchPlaceRef.current = null;
          const added = r.ok && !r.stale ? controller.sketchDraft()?.entities.find((x) => !prior.has(x.id)) : undefined;
          if (added) { selectTool(null); selectEntity(added.id, lastPosRef.current.x, lastPosRef.current.y, true); }
        }
      });
    }
    return out;
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
    if (id) setSelConstraint(null);   // one selection at a time: a picked entity replaces a picked constraint chip
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
  /** The text entity picked in Select mode (its panel is open), else null. */
  const selectedText = (): string | null => {
    const sel = selEntityRef.current; const d = controller.sketchDraft();
    return sel?.kind === 'entity' && d && d.entities.some((e) => e.id === sel.id && isText(e)) ? sel.id : null;
  };
  const textEdit = (patch: TextPatch) => {
    const id = selectedText(); const d = controller.sketchDraft();
    if (!id || !d) return;
    const next = patchText(d, id, patch);
    if (next === d) return;
    void controller.applySketchDraft(next).then((r) => { setSketchHint(r.ok || r.stale ? null : (r.hint ? t(r.hint) : null)); applyHighlight(); viewTick((n) => n + 1); });
  };
  textEditRef.current = textEdit;
  /** The equation curve picked in Select mode (its panel is open), else null. */
  const selectedEquation = (): string | null => {
    const sel = selEntityRef.current; const d = controller.sketchDraft();
    return sel?.kind === 'entity' && d && d.entities.some((e) => e.id === sel.id && isEquation(e)) ? sel.id : null;
  };
  /** Ask the kernel about the fields of curve `id` (once per id and fields); `apply` puts them in the sketch when they fit. */
  const checkEquation = (id: string, f: EquationFields, apply: boolean) => {
    const spec = equationSpec(f);
    const key = id + ' ' + JSON.stringify(spec);
    if (eqResultRef.current.key === key && !apply) return;
    eqResultRef.current = { key, r: null };
    void controller.fetchEquationCurve(spec).then((r) => {
      if (eqResultRef.current.key !== key) return;
      eqResultRef.current = { key, r };
      viewTick((n) => n + 1);
      const d = controller.sketchDraft();
      if (!apply || 'error' in r || !d || selectedEquation() !== id) return;
      void controller.applySketchDraft(patchEquation(d, id, f)).then((res) => { setSketchHint(res.ok || res.stale ? null : (res.hint ? t(res.hint) : null)); applyHighlight(); viewTick((n) => n + 1); });
    }).catch(() => {});
  };
  controller.onExtraChange = (key) => { viewport?.setBodyView(bodyViewNow()); if (key === MESH_KEY) refreshMeshes(); redraw((n) => n + 1); };
  controller.onLumps = () => { viewport?.setBodyView(bodyViewNow()); redraw((n) => n + 1); };
  controller.onTextOutlines = () => { applyHighlight(); viewTick((n) => n + 1); const id = selectedText(); const d = controller.sketchDraft(); const e = id && d ? d.entities.find((x) => x.id === id) : null; const note = e && d ? textNotes(textOutlineOf(d, e))[0] : null; if (note) setSketchHint(t(note.key, note.params ?? {})); };
  sketchSelectRef.current = (ev) => {
    if (sketchToolRef.current) return;
    const draft = controller.sketchDraft();
    if (!draft) return;
    setDimEdit(null);
    setHoverTip(null);
    if (textPickRef.current) {
      // the next click after "Pick centre" on the Text panel: a sketch point under it, else the plain position
      const pid = textPickRef.current; textPickRef.current = null;
      const hit = snapAt(draft, { x: ev.u, y: ev.v }, { tolerance: ev.tol, midpoints: false, align: false });
      const next = patchText(draft, pid, { arc: { centre: hit?.pointId ? undefined : { x: ev.u, y: ev.v }, centreId: hit?.pointId } });
      void controller.applySketchDraft(next).then(() => { applyHighlight(); viewTick((n) => n + 1); });
      return;
    }
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
    const nowId = pt?.pointId ?? (next as { entity?: string }).entity ?? null;
    if (hoverFocusTimer.current) { clearTimeout(hoverFocusTimer.current); hoverFocusTimer.current = null; }
    if (nowId) setHoverFocus(nowId);
    else hoverFocusTimer.current = setTimeout(() => { hoverFocusTimer.current = null; setHoverFocus(null); }, 350);
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
    else applyEntityEdit(setEntityDim(draft, sel.id, id === 'len' ? 'len' : id.startsWith('slot') ? (id as 'slotR' | 'slotA' | 'slotSweep' | 'slotW') : 'radius', value));
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
  /** A Sketch Report item was clicked: select what the constraint names (several highlight together); a constraint of points only is lit like a hovered row. */
  const selectConstraintTargets = (id: string) => {
    const draft = controller.sketchDraft();
    if (!draft) return;
    const tg = constraintTargets(draft, id);
    if (tg.entities.length) { hoverRef.current = { ...hoverRef.current, constraint: undefined }; setHotConstraint(null); setMultiSelection(tg.entities); }
    else hoverConstraint(id);
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
  /** Right-click menu of a dimension: radius <-> diameter, reference <-> driving, delete. */
  const runDimMenu = (action: string) => {
    const m = dimMenu;
    const draft = controller.sketchDraft();
    setDimMenu(null);
    if (!m || !draft) return;
    if (action === 'driven') { toggleDriven(m.id, m.driven); return; }
    const next = action === 'flip' ? toggleRadiusDiameter(draft, m.id) : action === 'delete' ? removeDimension(draft, m.id) : null;
    if (!next) return;
    hoverRef.current = { ...hoverRef.current, constraint: undefined };
    setHotConstraint(null);
    applyDraft(next);
  };
  /** `name = value` in a value box: define the parameter (or give an existing one the new value) as one undo step. False when it was refused. */
  const defineParam = async (name: string, expr: string): Promise<boolean> => {
    const r = defineVariable(readVars(controller.document()), name, expr);
    if (!r.ok) { setSketchHint(errorText(r.code, r.name)); return false; }
    const done = await controller.applyDocPatch({ variables: r.variables }, `parameter ${name}`);
    if (!done.ok) { setSketchHint(t('expr.error.badExpression', undefined, 'Not a valid expression')); return false; }
    setSketchHint(null);
    redraw((n) => n + 1);
    return true;
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
    if (ev.type === 'leave') {
      // the pointer may leave the canvas while a value is being typed into the fields: they stay
      if (document.activeElement?.closest?.('.sketch-fields')) return;
      viewport?.setSketchPreview([]); setToolOut(null); readout.snapAt.value = null; readout.snapName.value = null; return;
    }
    if (ev.type === 'press') { touchRef.current = { state: toolStateRef.current, out: lastOutRef.current, dragged: false }; return; }
    if (ev.type === 'cancel') {   // a second finger or a cancelled touch: what the finger began is dropped
      const t0 = touchRef.current;
      touchRef.current = null; touchPlaceRef.current = null;
      if (t0) { toolStateRef.current = t0.state; lastOutRef.current = t0.out; viewport?.setSketchPreview([]); setToolOut(null); readout.snapAt.value = null; readout.snapName.value = null; }
      return;
    }
    lastPosRef.current = { x: ev.x, y: ev.y };
    toolTolRef.current = ev.tol;
    const draft = controller.sketchDraft();
    if (!draft) return;
    const at = { x: ev.u, y: ev.v };
    let snap = ev.mods.alt || ev.mods.ctrl ? undefined : snapAt(draft, at, { tolerance: ev.tol, kinds: prefsRef.current.snapOn ? prefsRef.current.snaps : OBJECT_SNAPS_OFF, ...(prefsRef.current.snapOn ? { model: modelSnapsNow() } : {}), ...(lastOutRef.current?.from ?? lastOutRef.current?.anchor ? { from: (lastOutRef.current?.from ?? lastOutRef.current?.anchor)! } : {}), ...(prefsRef.current.gridSnap ? { grid: ev.grid, gridTol: gridCapture(ev.tol, ev.grid) } : {}) });
    // tools that pick a whole curve need the curve under the pointer, not only a midpoint snap
    if (ENTITY_PICK_TOOLS.has(sketchToolRef.current) && !snap?.entityId) {
      const entityId = pickEntity(draft, at, ev.tol);
      if (entityId) snap = snap ? { ...snap, entityId } : { kind: 'grid', at, entityId };
    }
    if (ev.type === 'dragstart') {
      // the finger left the spot it went down on: that spot is the tool's first point, unless the tool already has one (then the click would finish the shape)
      const t0 = touchRef.current;
      if (!t0) return;
      t0.dragged = true;
      const click: ToolEvent = { type: 'click', at, snap, mods: ev.mods };
      if (runTool(click, true)?.draft === draft) runTool(click);
      return;
    }
    if (ev.type === 'click') {
      const t0 = touchRef.current;
      touchRef.current = null;
      if (t0?.dragged && sketchToolRef.current === 'circle') touchPlaceRef.current = new Set(draft.entities.map((x) => x.id));
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
    if (!sketchToolRef.current && selConstraintRef.current && !sel && !multiSelRef.current.length) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const id = selConstraintRef.current; setSelConstraint(null); deleteConstraint(id); return true; }
      if (e.key === 'Escape') { e.preventDefault(); setSelConstraint(null); return true; }
      // Enter (or F2) on a selected dimension edits its value, as a double-click on it does
      if (e.key === 'Enter' || e.key === 'F2') {
        const d0 = controller.sketchDraft();
        const c = d0?.constraints.find((x) => x.id === selConstraintRef.current);
        if (c && typeof c.value === 'number') { e.preventDefault(); startDimEdit(c.id); return true; }
      }
    }
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
    // Tab with the Line tool waiting for its first point: type that point's X and Y (see the line tool)
    if (e.key === 'Tab' && !e.shiftKey && sketchToolRef.current === 'line' && !busy) { e.preventDefault(); runTool({ type: 'key', key: 'Tab' }); return true; }
    if (sketchToolRef.current && busy) {
      if (/^[0-9.\-]$/.test(e.key)) {
        // typing starts the first field. Not by focusing it here and hoping the key lands in it (the fields may be about to be re-rendered, and a second
        // fast key would select and overwrite the first): the characters typed before the field has focus are collected and put in it, replacing its text
        e.preventDefault();
        seedBufRef.current = appendSeed(seedBufRef.current, e.key);
        setFieldSeed((s0) => ({ n: s0.n + 1, text: seedBufRef.current }));
        return true;
      }
      e.preventDefault();
      runTool({ type: 'key', key: e.key });
      return true;
    }
    if (e.key === 'Escape' && sketchToolRef.current) { e.preventDefault(); selectTool(null); return true; }
    if ((e.key === 'n' || e.key === 'N') && !e.shiftKey) { e.preventDefault(); lookNormal(); return true; }   // Look normal
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
  /** Everything the shell keeps for one sketch session (tool, picked entities, chips, readout, hole mode). A session starts from this
   *  and ends in it, so nothing of the last sketch can show in the next. */
  const resetSketchShell = () => {
    selectTool(null);
    selectEntity(null, 0, 0);
    setDimEdit(null); setDimMenu(null); hoverRef.current = {}; setHotConstraint(null);
    holeSketchRef.current = false; setHoleCorner(null);
    projectSelRef.current = [];
    setSketching(null); setSketchHint(null); multiSelRef.current = []; toolEntitiesRef.current = [];
    clearReadout();
  };
  const startNewSketch = (plane: 'front' | 'top' | 'right' | { kind: 'face' | 'feature'; id: string }, after?: () => Promise<void>) => {
    setRefSel(null); setRefHover(null);   // the chosen plane's highlight must not tint the sketch
    setPlanePick(false);
    void (async () => {
      const wasHole = holeSketchRef.current;   // set by the Hole tool just before it asks for a sketch
      resetSketchShell(); holeSketchRef.current = wasHole;
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
      if (!view) { store.notify(t(controller.hasImportedBody() ? 'app.sketch.failedImported' : 'app.sketch.failedCurved'), 'error'); return; }
      projectSelRef.current = [...store.selection.value];   // kept for the Project tool
      store.select([], false);   // the picked face's highlight would cover the sketch
      setSketching({ id: view.featureId, name: t('app.sketch.newName'), plane: typeof plane === 'string' ? t('app.ref.' + plane) : plane.kind === 'feature' ? planeLabel(plane.id) : t('app.sketch.dialog.onFace') });
      enteredSketch(true);
      selectTool(holeSketchRef.current ? 'point' : 'line');
      if (holeSketchRef.current) {
        setSketchHint(t('app.hole.hint'));
        const o = typeof plane === 'object' && plane.kind === 'face' ? faceOutline(view.frame, controller.bodyEdges(), plane.id) : null;
        setHoleCorner(o ? { plate: plateFromOutline(o), rec: { ...DEFAULT_CORNER, matchFillet: !!o.radius } } : null);   // rounded corners: the holes start concentric with them
      }
      if (after) await after();
    })();
  };
  startSketchRef.current = (plane) => startNewSketch(plane);
  startOnFeatureRef.current = (id) => startNewSketch({ kind: 'feature', id });
  // Add an extrude (or cut) from the selected sketch, or the last sketch in the tree, and open it in the editor.
  // `cut` is only passed by the Cut commands (an explicit choice); `add` means "the default": nothing is remembered from the last extrude.
  const addExtrude = async (opArg: 'add' | 'cut', thin = false, sketchId?: string) => {
    const d = controller.document();
    if (!d) return;
    const target = sketchId ? { sketchId, regions: null } : nextExtrudeTarget(d.features as never, selectedId);
    if (!target) { store.notify(d.features.some((f) => f.type === 'sketch') ? t('app.allSketchesUsed') : t('app.noSketch'), 'error'); return; }
    const dflt = defaultExtrudeOp({ explicitCut: opArg === 'cut', touchesBody: controller.sketchTouchesBody(target.sketchId), supportsNew: KERNEL_SUPPORTS_NEW_BODY && controller.hasSolid() });
    // a sketch that does not meet the body makes a new, named body; the first solid of a part just adds
    const op: 'add' | 'cut' | 'newBody' = dflt === 'cut' ? 'cut' : dflt === 'new' ? 'newBody' : 'add';
    const bodyName = op === 'newBody' ? nextBodyName(usedBodyNames(d.features as unknown as Array<Record<string, unknown>>)) : null;
    // a cut of a projected outline with a loop inside it is a pocket: the inner loop, not the wall that coincides with the body
    const regions = target.regions ?? (op === 'cut' ? defaultCutRegions(d.features.find((f) => f.id === target.sketchId) as never) : null);
    const make = (flip: boolean) => ({ type: 'extrude', op, ...(bodyName ? { body: bodyName } : {}), sketch: target.sketchId, end: 'blind', depth: 10, ...(thin ? { thin: { thickness: defaultThickness(d.features.find((f) => f.id === target.sketchId) as never), side: 'inside', ends: 'flat', cornerStyle: 'mitre' } } : {}), ...(regions ? { regions } : {}), ...(flip ? { flip: true } : {}) });
    // a cut's direction is 'auto': the side the body lies on first, then the other, and the one that really touches the body is kept
    let flip = controller.extrudeFlip(target.sketchId, op === 'cut' ? 'cut' : 'add');
    if (op === 'cut') {
      const pick = await autoCutFlip(flip, async (f) => {
        const r = await controller.preview([{ op: 'add', feature: make(f) as never }], 0);
        return { ok: r.ok, codes: (r.errors ?? []).map((e) => String((e as unknown as [string, { code?: string }])[1]?.code ?? '')) };
      });
      await controller.cancelPreview();
      flip = pick.flip;
    }
    await createFeature([{ op: 'add', feature: make(flip) as never }]);
  };
  // Add the feature the ops describe as one edit, clear the selection that fed it, and open the Editor on it.
  // features whose first try is kept as a draft in their editor when the kernel refuses it (the toast alone left nothing to fix)
  const DRAFTABLE = new Set(['loft', 'shell', 'extrude', 'revolve', 'fillet', 'chamfer', 'sweep', 'edgeFlange', 'hem', 'sheetCorner']);
  const createFeature = async (ops: EditOp[]) => {
    const before = controller.document()?.features.length ?? 0;
    // the picked edges, faces or corners are consumed by the feature: clear them first so the rebuild does not report them as lost
    const picked = [...store.selection.value];
    store.select([]);
    const r = await controller.edit(ops);
    redraw((n) => n + 1);
    if (!r.ok) {
      // a Loft refused on its first try still opens its editor, on the draft, with the problem shown inline (the editor's Cancel removes the draft)
      const op0 = ops[0];
      const f0 = ops.length === 1 && op0.op === 'add' ? (op0.feature as Record<string, unknown>) : null;
      if (f0 && DRAFTABLE.has(String(f0.type))) {
        const rej = controller.rejection();
        const text = rej?.summary ?? (r.hints?.map((h) => h.hint).join('; ') || (r as { schemaError?: string }).schemaError || '');
        const made = await controller.edit([{ op: 'add', feature: { ...f0, suppressed: true, draftNew: true } as never }]);
        redraw((n) => n + 1);
        const added = (controller.document()?.features ?? []).find((x) => (x as { draftNew?: boolean }).draftNew) as unknown as Record<string, unknown> | undefined;
        if (made.ok && added) {
          startEditing(String(added.id));
          setPreviewHint(text || null);
          if (rej) setPreviewDiag({ d: rej.diagnosis, fresh: [] });   // the structured error stays in the editor (with its fixes) until the draft builds
          return;
        }
      }
      store.select(picked); return;
    }
    const now = controller.document();
    const added = now && now.features.length > before ? now.features[now.features.length - 1] : null;
    if (added && (added as { type?: string }).type === 'pipeCut') {
      const n = pipeCutNotice((r as { diff?: Parameters<typeof pipeCutNotice>[0] }).diff);
      if (n) store.notify(t(n === 'surface' ? 'app.pipeCut.surface' : 'app.pipeCut.nothing'), 'warn');
    }
    if (added) startEditing(added.id);
  };
  const fieldEvent = (id: string, value: number | null, commit: boolean) => { if (commit) seedBufRef.current = ''; runTool({ type: 'field', id, value, commit }); };
  const confirmSketch = async (): Promise<string | null> => {
    if (!sketching) return null;
    selectTool(null);
    selectEntity(null, 0, 0);
    setDimEdit(null); hoverRef.current = {}; setHotConstraint(null);
    const wasHole = holeSketchRef.current; holeSketchRef.current = false; setHoleCorner(null);
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
    return wasHole ? null : sketchId;
  };
  /** Finish the sketch (as the check does) and open the Extrude or Revolve card on it in one action. */
  const finishAnd = async (kind: 'extrude' | 'revolve') => {
    const id = await confirmSketch();
    if (!id) return;
    if (kind === 'extrude') { await addExtrude('add', false, id); return; }
    const sk = controller.document()?.features.find((f) => f.id === id);
    const ops = sk ? revolveOps(sk as never) : null;
    if (ops) await createFeature(ops); else store.notify(t('app.noAxis'), 'error');
  };
  /** `fromKey`: Escape reached the end of its steps. A sketch with geometry is never discarded by a key (the Cancel button discards it), so then it only says so. */
  const cancelSketch = async (fromKey = false) => {
    if (!sketching) return;
    if (fromKey === true && !escapeCancelsSketch(controller.sketchDraft())) { setSketchHint(t('app.sketch.escapeKeeps')); return; }
    selectTool(null);
    selectEntity(null, 0, 0);
    setDimEdit(null); hoverRef.current = {}; setHotConstraint(null); setSelConstraint(null);
    await controller.cancelSketch();
    holeSketchRef.current = false; setHoleCorner(null);
    projectSelRef.current = [];
    setSketching(null); setSketchHint(null); multiSelRef.current = []; toolEntitiesRef.current = [];
    redraw((n) => n + 1);
  };
  sketchingRef.current = !!sketching;
  const selConstraintRef = useRef<string | null>(null);
  selConstraintRef.current = sketching ? selConstraint : null;
  // The controller's session ended under the shell (the sketch's feature was deleted, or undone away, or another part opened): drop the
  // shell's half too, so no points, chips, readout or tool outlive the sketch.
  useSketchSessionGone(!!sketching, () => !!controller.sketchDraft(), () => resetSketchShell());
  useEffect(() => { viewport?.setSketchGrid({ base: sketchPrefs.gridSpacing, visible: sketchPrefs.gridSnap }); }, [viewport, sketching?.id, sketchPrefs.gridSpacing, sketchPrefs.gridSnap]);
  useEffect(() => { if (!sketching) { clearReadout(); setReportOpen(false); } }, [!!sketching]);
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
  // curves and points a conflicting constraint names turn red at once, with or without the definition colouring.
  // The conflict markers are constraint markers, so turning the relation glyphs off hides them too (B5).
  useEffect(() => {
    const d = controller.sketchDraft();
    viewport?.setSketchConflicts(d && stForKey && sketchPrefs.show.relations ? conflictingGeometry(d, stForKey) : null);
  }, [defKey, viewport, sketchPrefs.show.relations]);
  const show = sketchPrefs.show;
  const annotItems = sketchDraftNow ? (() => {
    const to = (u: number, v: number) => viewport?.sketchToScreen(u, v) ?? null;
    const all = [...annotate(sketchDraftNow, { upp: viewport?.sketchViewInfo()?.upp, squareRight: sketchPrefs.rightAngleSquare, coincident: true }), ...(show.reference ? refAnnotations(sketchDraftNow, { upp: viewport?.sketchViewInfo()?.upp, squareRight: sketchPrefs.rightAngleSquare }) : [])]
      .filter((a) => a.driven ? show.reference : a.kind === 'dimension' ? show.dimensions : show.relations);
    // where each dimension goes: no label over another, over a segment it does not measure, or over the view's controls (see dimLayout.ts)
    const host = document.getElementById('vp')?.getBoundingClientRect();
    const keepOut = host ? [...document.querySelectorAll<HTMLElement>('#vp .display-menu, #vp .viewcube, #vp button')].map((el) => el.getBoundingClientRect()).map((r) => ({ x: r.left - host.left - 4, y: r.top - host.top - 4, w: r.width + 8, h: r.height + 8 })) : [];
    const focus = new Set<string>([...store.selection.value, ...(selEntityRef.current ? [selEntityRef.current.id] : []), ...multiSelRef.current, ...(hoverRef.current.entity ? [hoverRef.current.entity] : [])]);
    // what the constraint chips follow: the above, the pointer's entity or point (a moment after it leaves) and the points of those
    const markFocus = expandFocus(sketchDraftNow, [...focus, ...(hoverFocus && !sketchToolRef.current ? [hoverFocus] : []), ...(hoverRef.current.point ? [hoverRef.current.point] : [])]);
    const axisLocks = rectangleAxisLocks(sketchDraftNow);
    const placed = new Map(layoutDimensions(sketchDraftNow, all, { to, viewport: { w: host?.width ?? 1200, h: host?.height ?? 800 }, keepOut, display: sketchPrefs.dimDisplay, squareRight: sketchPrefs.rightAngleSquare, focus, dimensionTool: sketchToolRef.current === 'dimension', measure: (txt) => labelBox(txt) }).map((p) => [p.id, p]));
    const bl = (id: string) => (stForKey?.conflicts.includes(id) ? { blame: 'conflict' as const } : stForKey?.redundant.includes(id) ? { blame: 'redundant' as const } : {});
    return separateMarks(visibleChips(all.flatMap((a): AnnotationItem[] => {
      const pd = placed.get(a.id);
      if (a.kind === 'dimension' && pd) {
        if (pd.hidden && !pd.peek) return [];
        const dim = pd.shape ? projectShape(pd.shape, to, { outside: pd.outside, text: pd.label }) : null;
        return [{ id: a.id, text: a.text, kind: a.kind, type: a.type, driven: !!a.driven, ...bl(a.id), ...(a.expr ? { fx: true } : {}), ...(dim ? { dim } : {}), x: pd.label.x, y: pd.label.y }];
      }
      const p = viewport?.sketchToScreen(a.at.x, a.at.y);
      return p ? [{ id: a.id, text: a.text, kind: a.kind, type: a.type, driven: !!a.driven, ...bl(a.id), ...(a.expr ? { fx: true } : {}), x: p.x, y: p.y + 10, refs: a.refs, ...(axisLocks.has(a.id) ? { axisLock: true } : {}) }] : [];
    }), { mode: sketchPrefs.constraintMarkers, focus: markFocus, hot: hotConstraint, selected: selConstraint }));
  })() : [];
  const stNow = sketching ? controller.sketchStatus() : null;
  const blame = (id: string) => (stNow?.conflicts.includes(id) ? 'conflict' as const : stNow?.redundant.includes(id) ? 'redundant' as const : undefined);
  const conRows = sketchDraftNow ? [
    ...sketchDraftNow.constraints.map((c) => ({ id: c.id, type: c.type, refs: c.refs ?? [], ...(typeof c.value === 'number' ? { value: shownValue(sketchDraftNow, c) ?? c.value } : {}), ...(typeof c.expr === 'string' && c.expr ? { expr: c.expr } : {}), ...(blame(c.id) ? { blame: blame(c.id)! } : {}) })),
    ...refDimsOf(sketchDraftNow).map((r) => ({ id: r.id, type: r.type, refs: r.refs, driven: true })),
  ] : [];
  const rowName = (id: string) => {
    const c = sketchDraftNow?.constraints.find((x) => x.id === id);
    return c ? `${t('app.sketch.constraint.' + c.type, undefined, c.type)}${typeof c.value === 'number' ? ' ' + Math.round((sketchDraftNow ? shownValue(sketchDraftNow, c) ?? c.value : c.value) * 100) / 100 : ''} (${id})` : id;
  };
  const sketchFeat = sketching && doc ? (doc.features.find((f) => f.id === sketching.id) as unknown as { plane?: unknown } | undefined) : undefined;
  const sketchPlaneLabel = (() => {
    const pl = sketchFeat?.plane;
    if (pl === 'front' || pl === 'top' || pl === 'right') return t('app.ref.' + pl);
    return pl && typeof pl === 'object' ? t('app.sketch.dialog.onFace') : '';
  })();
  /** Place writes the corner points into the open hole sketch (replacing earlier ones) and keeps the record on the sketch; one sketch undo step. */
  const placeCornerHolesInSketch = (rec: CornerRecord, points: HolePt[], plate: PlateInfo) => {
    const d = controller.sketchDraft();
    if (!d) return;
    const next = withCornerHoles(d, points);
    next.extras = { ...(d.extras ?? {}), cornerHoles: { ...rec, rect: plate.rect, radius: plate.radius } };
    setHoleCorner({ plate, rec });
    void controller.applySketchDraft(next).then((r) => { setSketchHint(r.ok || r.stale ? t('cornerHoles.placed', { n: points.length }) : (r.hint ? t(r.hint) : null)); viewTick((n) => n + 1); });
  };
  const sketchControls: SketchControls | null = sketching ? {
    name: sketching.name, plane: sketching.plane ?? sketchPlaneLabel,
    onOk: () => void confirmSketch(),
    ...(holeSketchRef.current ? {} : { onExtrude: () => void finishAnd('extrude'), onRevolve: () => void finishAnd('revolve') }),
    onCancel: () => void cancelSketch(),
    construction: constructionMode, onConstruction: () => setConstructionMode(!constructionMode),
    ...((entityOut && selEntityRef.current?.kind === 'entity' || multiSelRef.current.length > 1) && !sketchToolId ? { onToggleSelected: toggleSelectedConstruction } : {}),
    onLookNormal: lookNormal, lookChip, hint: sketchHint,
    status: stNow, busy: defining, prefs: sketchPrefs,
    onPrefs: updatePrefs,
    onFullyDefine: () => void fullyDefineNow(),
    onReport: () => setReportOpen((v) => !v), reportOpen,
    selected: selectedEntityIds().length > 1 ? selectedEntityIds().length : 0,
    onClearSelection: () => setMultiSelection([]),
    list: <SketchConstraintList rows={conRows} status={stNow} hot={hotConstraint} selected={selConstraint} onSelect={(id) => { selectEntity(null, 0, 0); setSelConstraint(id); }} onHover={hoverConstraint} onDelete={deleteConstraint} onEdit={startDimEdit} onToggleDriven={toggleDriven} />,
  } : null;
  const chrome = sketchChrome(ws, !!sketching);
  // the floating pill is the fallback for ribbon off; with the ribbon on the Sketch tab carries every control and nothing covers the canvas
  const sketchBar = sketchControls && chrome.bar ? <SketchBar {...sketchControls} /> : null;
  /** A folder's button: pick every face the folder's features made. */
  const selectGroupFaces = (ids: string[]) => {
    const set = new Set(ids);
    const names = controller.pickableNames('face').filter((n) => { const o = faceOwner(n); return !!o && set.has(o); });
    if (!names.length) { store.notify(t('select.group.none'), 'warn'); return; }
    store.mode.value = 'face'; viewport?.setPickMode('face');
    store.select(names);
  };
  const tree = (
    <FeatureTree rows={rows} partName={doc?.name}
      refs={doc ? [...refRows(doc as never, appearance.color), ...treeKnurlRows(doc as never), ...treeMeshRows(doc)] : []}
      selectedRef={refSel} onSelectRef={(id) => { setRefSel(id); if (id) { setSelectedId(null); store.select([]); } }} onHoverRef={setRefHover}
      onToggleRef={(id) => { if (id.startsWith('mesh:')) toggleMeshShown(id.slice(5)); }}
      onOpenRef={(id) => { if (id === 'material') openMaterial(); else if (id.startsWith('mesh:')) openMesh(id.slice(5)); else if (id.startsWith('knurl:')) openKnurlEdit({ cosmeticIndex: Number(id.slice(6)) }); else if (id === 'front' || id === 'top' || id === 'right') startNewSketch(id); }}
      status={store.featureStatus.value} warnings={store.featureWarnings.value} selectedId={selectedId} onWarning={showWarning}
      hiddenIds={hid.ids} onToggleHide={toggleHideFeature} onHoverFeature={setTreeHover} hoverId={hoverRowId}
      {...ti.treeProps}
      reveal={rev.reveal} onSelectGroup={selectGroupFaces} onSelectFaces={(id) => selectGroupFaces([id])}
      onEdit={startEditing}
      onMove={(id, to) => edit([{ op: 'move', id, to }])} />
  );
  const showAssembly = (section: AsmSection) => {
    if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true });
    revealLeft();
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
    editPart: editComponent,
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
  // The Propeller wizard: every change previews the regenerated features (plain numbers, so a new propeller needs no variables yet); Create / Apply commits the
  // variables and the features as one document patch (one undo step; a changed section count or bore removes the old features first, a second step).
  const onPropDraft = (next: PropParams) => {
    if (!doc || propErrors(next).length) return;
    void controller.preview(propOps(doc as never, next, propWiz?.roles ?? undefined)).then(onPreviewResult);
  };
  // The marine family: the same live preview and commit, with one addition. The kernel sometimes cannot fuse a blade with the hub for one section spacing and builds it
  // for another (docs/propellers.md), so a failed preview retries with 7, 6, 4 and 3 degrees (marineSpacings); the spacing that built is the one kept (and said so).
  const buildMarine = async (next: MarineParams, delay: number): Promise<{ params: MarineParams; stale: boolean; last: Awaited<ReturnType<typeof controller.preview>> | null }> => {
    let last: Awaited<ReturnType<typeof controller.preview>> | null = null;
    for (const sp of marineSpacings(next.raySpacing)) {
      const cand = { ...next, raySpacing: sp };
      if (marineErrors(cand).length) continue;
      const r = await controller.preview(marineOps(doc as never, cand, propWiz?.roles ?? undefined), delay);
      if ((r as { stale?: boolean }).stale) return { params: next, stale: true, last: null };
      if (r.ok) return { params: cand, stale: false, last: r };
      last = r;
      delay = 0;
    }
    return { params: next, stale: false, last };
  };
  const onMarineDraft = (next: MarineParams) => {
    if (!doc || marineErrors(next).length) return;
    void buildMarine(next, 150).then((b) => {
      if (b.stale) return;
      if (b.last && b.params === next) { onPreviewResult(b.last); return; }
      setPreviewHint(b.params.raySpacing !== next.raySpacing ? t('marine.respaced', { from: String(next.raySpacing), to: String(b.params.raySpacing) }) : null);
    });
  };
  const onMarineCreate = async (next: MarineParams) => {
    if (!doc) return;
    const b = await buildMarine(next, 0);
    if (!b.last?.ok) { onPreviewResult(b.last ?? { ok: false }); return; }   // no spacing built it: the preview's own diagnosis is the answer
    let plan;
    try { plan = marinePlan(doc as never, b.params, propWiz?.roles ?? undefined); } catch (e) { setPreviewHint(e instanceof MarineError ? e.message : (e as Error).message); return; }
    await controller.cancelPreview();
    if (plan.before.length) {
      const r = await timed(() => controller.commit(plan.before, 'propeller'));
      if (!r.ok) { setPreviewHint(t('prop.failed', { reason: r.hints?.map((h) => h.hint).join('; ') || (r as { schemaError?: string }).schemaError || 'edit failed' })); return; }
    }
    const r = await timed(() => controller.applyDocPatch(plan.patch as never, 'propeller'));
    if (!r.ok) { setPreviewHint(t('prop.failed', { reason: r.errors.map((e) => `${e.feature}: ${e.code}`).join('; ') })); return; }
    store.notify(t(propWiz?.roles ? 'prop.updated' : 'marine.created'));
    setPropWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  // The turbo-impeller wizard: the same live preview and commit as the marine family, with the station count as the retry knob (impellerStationsTried).
  const buildImpeller = async (next: ImpellerParams, delay: number): Promise<{ params: ImpellerParams; stale: boolean; last: Awaited<ReturnType<typeof controller.preview>> | null }> => {
    let last: Awaited<ReturnType<typeof controller.preview>> | null = null;
    for (const st of impellerStationsTried(next.stations)) {
      const cand = { ...next, stations: st };
      if (impellerErrors(cand).length) continue;
      const r = await controller.preview(impellerOps(doc as never, cand, impWiz?.roles ?? undefined), delay);
      if ((r as { stale?: boolean }).stale) return { params: next, stale: true, last: null };
      if (r.ok) return { params: cand, stale: false, last: r };
      last = r;
      delay = 0;
    }
    return { params: next, stale: false, last };
  };
  const onImpellerDraft = (next: ImpellerParams) => {
    if (!doc || impellerErrors(next).length) return;
    void buildImpeller(next, 150).then((b) => {
      if (b.stale) return;
      if (b.last && b.params === next) { onPreviewResult(b.last); return; }
      setPreviewHint(b.params.stations !== next.stations ? t('impeller.respaced', { from: String(next.stations), to: String(b.params.stations) }) : null);
    });
  };
  const onImpellerCreate = async (next: ImpellerParams) => {
    if (!doc) return;
    const b = await buildImpeller(next, 0);
    if (!b.last?.ok) { onPreviewResult(b.last ?? { ok: false }); return; }   // no station count built it: the preview's own diagnosis is the answer
    let plan;
    try { plan = impellerPlan(doc as never, b.params, impWiz?.roles ?? undefined); } catch (e) { setPreviewHint(e instanceof ImpellerError ? e.message : (e as Error).message); return; }
    await controller.cancelPreview();
    if (plan.before.length) {
      const r = await timed(() => controller.commit(plan.before, 'impeller'));
      if (!r.ok) { setPreviewHint(t('prop.failed', { reason: r.hints?.map((h) => h.hint).join('; ') || (r as { schemaError?: string }).schemaError || 'edit failed' })); return; }
    }
    const r = await timed(() => controller.applyDocPatch(plan.patch as never, 'impeller'));
    if (!r.ok) { setPreviewHint(t('prop.failed', { reason: r.errors.map((e) => `${e.feature}: ${e.code}`).join('; ') })); return; }
    store.notify(t(impWiz?.roles ? 'impeller.updated' : 'impeller.created'));
    setImpWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  const onImpellerCancel = async () => {
    await controller.cancelPreview();
    setImpWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  const onPropCancel = async () => {
    await controller.cancelPreview();
    setPropWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  const onPropCreate = async (next: PropParams) => {
    if (!doc) return;
    let plan;
    try { plan = propPlan(doc as never, next, propWiz?.roles ?? undefined); } catch (e) { setPreviewHint(e instanceof PropError ? e.message : (e as Error).message); return; }
    await controller.cancelPreview();
    if (plan.before.length) {
      const r = await timed(() => controller.commit(plan.before, 'propeller'));
      if (!r.ok) { setPreviewHint(t('prop.failed', { reason: r.hints?.map((h) => h.hint).join('; ') || (r as { schemaError?: string }).schemaError || 'edit failed' })); return; }
    }
    const r = await timed(() => controller.applyDocPatch(plan.patch as never, 'propeller'));
    if (!r.ok) { setPreviewHint(t('prop.failed', { reason: r.errors.map((e) => `${e.feature}: ${e.code}`).join('; ') })); return; }
    store.notify(t(propWiz?.roles ? 'prop.updated' : 'prop.created'));
    setPropWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  const openPropeller = () => {
    if (!doc) return;
    if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true });
    revealLeft();
    setEditingId(null); setEditingMaterial(false); setDraft({}); setPreviewHint(null); setImpWiz(null); setScrewWiz(null); setWasherWiz(null); setBearingWiz(null);
    setPropWiz({ params: { ...DEFAULT_PROP, varPrefix: freePrefix(readVars(doc)) }, roles: null });
    setLeftTab('Editor');
  };
  const openImpeller = () => {
    if (!doc) return;
    if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true });
    revealLeft();
    setEditingId(null); setEditingMaterial(false); setDraft({}); setPreviewHint(null); setPropWiz(null); setScrewWiz(null); setWasherWiz(null); setBearingWiz(null);
    setImpWiz({ params: { ...DEFAULT_IMPELLER }, roles: null });
    setLeftTab('Editor');
  };
  // The Knurl wizard: every change previews the grooves (the same cuts the Script tab's knurl() makes); Knurl commits them as ordinary features, one undo step.
  const onKnurlDraft = (next: KnurlParams) => {
    if (!doc || !next.target || knurlIssue(next)) return;
    if (next.cosmetic) {
      // instant: the shading is drawn from the record, nothing is built; a cut preview left from before is taken away
      knurlDraft = knurlCosmetic(next);
      void controller.cancelPreview().then(() => { setPreviewHint(null); viewport?.setBodyView(bodyViewNow()); });
      viewport?.setBodyView(bodyViewNow());
      return;
    }
    if (knurlDraft) { knurlDraft = null; viewport?.setBodyView(bodyViewNow()); }
    const owner = knurlWiz && knurlWiz.edit && 'owner' in knurlWiz.edit ? knurlWiz.edit.owner : null;
    void controller.preview(owner ? knurlReplaceOps(doc as never, next, owner) : knurlOps(doc as never, next), 400).then(onPreviewResult);
  };
  const onKnurlCancel = async () => {
    knurlDraft = null; knurlHidden = null;
    await controller.cancelPreview();
    viewport?.setBodyView(bodyViewNow());
    setKnurlWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  const onKnurlApply = async (next: KnurlParams) => {
    if (!doc) return;
    if (next.cosmetic) {
      // a record in the document (one undo step, no rebuild): the solid is not touched
      let rec;
      try { rec = knurlCosmetic(next); } catch (e) { setPreviewHint((e as Error).message); return; }
      const saved = readCosmeticKnurls((controller.document() as unknown as Record<string, unknown> | null)?.cosmeticKnurls);
      const at = knurlWiz?.edit && 'cosmeticIndex' in knurlWiz.edit ? knurlWiz.edit.cosmeticIndex : null;
      const list = at === null ? [...saved, rec] : replaceCosmetic(saved, at, rec);
      if (!list) { setPreviewHint(t('knurl.failed', { reason: 'the cosmetic knurl is gone' })); return; }
      knurlDraft = null; knurlHidden = null;
      await controller.cancelPreview();
      controller.setUndoableExtra('cosmeticKnurls', list);
      viewport?.setBodyView(bodyViewNow());
      store.notify(t(at === null ? 'knurl.createdCosmetic' : 'knurl.updated'));
      setKnurlWiz(null); setPreviewHint(null); setLeftTab('Features');
      redraw((n) => n + 1);
      return;
    }
    const owner = knurlWiz?.edit && 'owner' in knurlWiz.edit ? knurlWiz.edit.owner : null;
    if (owner) {   // the features it was made of may have changed since the wizard opened (an undo, another edit): look again
      const now = knurlOwner(doc.features as never, owner.ids[0]);
      const users = knurlDependents(doc.features as never, owner.ids);
      if (!now || users.length) { setPreviewHint(users.length ? t('knurl.refused', { ids: users.join(', ') }) : t('knurl.failed', { reason: 'the knurl is gone' })); return; }
    }
    let ops;
    try { ops = owner ? knurlReplaceOps(doc as never, next, owner) : knurlOps(doc as never, next); } catch (e) { setPreviewHint((e as Error).message); return; }
    await controller.cancelPreview();
    const r = await timed(() => controller.commit(ops, 'knurl'));   // one batch: the old features out, the new ones in at the same place
    if (!r.ok) { setPreviewHint(t('knurl.failed', { reason: r.hints?.map((h) => h.hint).join('; ') || (r as { schemaError?: string }).schemaError || 'edit failed' })); return; }
    store.notify(t(owner ? 'knurl.updated' : 'knurl.created'));
    setKnurlWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  const openKnurl = () => {
    if (!doc) return;
    if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true });
    revealLeft();
    setEditingId(null); setEditingMaterial(false); setDraft({}); setPreviewHint(null); setPropWiz(null); setImpWiz(null); setScrewWiz(null); setWasherWiz(null); setBearingWiz(null); setBearingWiz(null);
    const face = selectedFace();
    const found = face ? knurlTarget(face, controller.bodyEdges() as never, controller.bodyFaces()) : { reason: 'notCylinder' as const };
    const target = 'target' in found ? found.target : null;
    const count = target ? suggestCount(target.radius) : DEFAULT_KNURL.count;
    setKnurlWiz({ params: { ...DEFAULT_KNURL, target, count, depth: target ? suggestDepth(target.radius, count) : DEFAULT_KNURL.depth }, reason: face && 'reason' in found ? found.reason : null });
    if (!target) { store.mode.value = 'face'; viewport?.setPickMode('face'); }   // no cylinder yet: the wizard waits for a click on a round face
    setLeftTab('Editor');
  };
  /** Reopen an existing knurl in the wizard on its own parameters (Update replaces it in place). `owner`: cut knurls; `cosmeticIndex`: a cosmetic record. */
  const openKnurlEdit = (edit: { owner: KnurlOwner } | { cosmeticIndex: number }) => {
    if (!doc) return;
    const recs = readCosmeticKnurls((controller.document() as unknown as Record<string, unknown> | null)?.cosmeticKnurls);
    const rec = 'cosmeticIndex' in edit ? recs[edit.cosmeticIndex] : null;
    if ('cosmeticIndex' in edit && !rec) return;
    const params = 'owner' in edit ? edit.owner.params : paramsFromCosmetic(rec!);
    const users = 'owner' in edit ? knurlDependents(doc.features as never, edit.owner.ids) : [];
    if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true });
    revealLeft();
    setEditingId(null); setEditingMaterial(false); setDraft({}); setPicked(null); setPickingPath(null); setPreviewHint(null); setPropWiz(null); setImpWiz(null); setScrewWiz(null); setWasherWiz(null);
    knurlHidden = 'cosmeticIndex' in edit ? edit.cosmeticIndex : null;
    setKnurlWiz({ params, reason: null, edit, refusal: users.length ? t('knurl.refused', { ids: users.join(', ') }) : null });
    if ('owner' in edit) setSelectedId(edit.owner.ids[0]);
    setLeftTab('Editor');
  };
  // The Screw wizard: every change previews the fastener (the same features the Script tab's screw() makes); Add screw commits them, one undo step.
  const onScrewDraft = (next: ScrewParams) => {
    if (!doc || screwIssue(next)) return;
    void controller.preview(screwOps(doc as never, next), next.thread ? 1500 : 400).then(onPreviewResult);
  };
  const onScrewCancel = async () => {
    await controller.cancelPreview();
    setScrewWiz(null); setWasherWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  const onScrewApply = async (next: ScrewParams) => {
    if (!doc) return;
    let ops;
    try { ops = screwOps(doc as never, next); } catch (e) { setPreviewHint((e as Error).message); return; }
    await controller.cancelPreview();
    const r = await timed(() => controller.commit(ops, 'screw'));
    if (!r.ok) { setPreviewHint(t('screw.failed', { reason: r.hints?.map((h) => h.hint).join('; ') || (r as { schemaError?: string }).schemaError || 'edit failed' })); return; }
    store.notify(t('screw.created'));
    setScrewWiz(null); setWasherWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  const openScrew = () => {
    if (!doc) return;
    if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true });
    revealLeft();
    setEditingId(null); setEditingMaterial(false); setDraft({}); setPreviewHint(null); setPropWiz(null); setImpWiz(null); setKnurlWiz(null); setBearingWiz(null);
    setScrewWiz({ params: { ...DEFAULT_SCREW } });
    setLeftTab('Editor');
  };
  // The Washer wizard: every change previews the washer (the same features the Script tab's washer() makes); Add washer commits them as one folder, one undo step.
  const onWasherDraft = (next: WasherParams) => {
    if (!doc || washerIssue(next)) return;
    void controller.preview(washerOps(doc as never, next), 400).then(onPreviewResult);
  };
  /** Washer on a hole: a face or an edge picked while the wizard is open is read as a hole. What was already selected when it opened only counts when it is a hole. */
  const washerSel = store.selection.value;
  useEffect(() => {
    if (!washerWiz || washerSel.length !== 1 || washerSel[0] === BODY) return;
    const result = holeFromPick(washerSel[0], controller.bodyEdges() as never, controller.bodyFaces());
    if (!result.ok && washerSel.join('|') === washerPickRef.current.openSel) return;
    setWasherPick({ id: ++washerPickRef.current.n, result });
  }, [washerSel, !!washerWiz]);
  const onWasherPickHole = () => { store.mode.value = 'face'; viewport?.setPickMode('face'); };
  const onWasherCancel = async () => {
    await controller.cancelPreview();
    setWasherWiz(null); setPreviewHint(null); setLeftTab("Features");
    redraw((n) => n + 1);
  };
  const onWasherApply = async (next: WasherParams) => {
    if (!doc) return;
    let ops;
    try { ops = washerOps(doc as never, next); } catch (e) { setPreviewHint((e as Error).message); return; }
    await controller.cancelPreview();
    const r = await timed(() => controller.commit(ops, "washer"));
    if (!r.ok) { setPreviewHint(t("washer.failed", { reason: r.hints?.map((h) => h.hint).join("; ") || (r as { schemaError?: string }).schemaError || "edit failed" })); return; }
    store.notify(t("washer.created"));
    setWasherWiz(null); setPreviewHint(null); setLeftTab("Features");
    redraw((n) => n + 1);
  };
  const openWasher = () => {
    if (!doc) return;
    if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true });
    revealLeft();
    setEditingId(null); setEditingMaterial(false); setDraft({}); setPreviewHint(null); setPropWiz(null); setImpWiz(null); setKnurlWiz(null); setBearingWiz(null); setScrewWiz(null);
    setWasherWiz({ params: { ...DEFAULT_WASHER } });
    setWasherPick(null); washerPickRef.current.openSel = store.selection.value.join('|');
    setLeftTab("Editor");
  };
  // The Bearing wizard: every change previews the bearing (the same features the Script tab's bearing() makes); Add bearing commits them, one undo step.
  const onBearingDraft = (next: BearingParams) => {
    if (!doc || bearingIssue(next)) return;
    void controller.preview(bearingOps(doc as never, next), next.seal === 'open' ? 900 : 500).then(onPreviewResult);
  };
  const onBearingCancel = async () => {
    await controller.cancelPreview();
    setBearingWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  const onBearingApply = async (next: BearingParams) => {
    if (!doc) return;
    let ops;
    try { ops = bearingOps(doc as never, next); } catch (e) { setPreviewHint((e as Error).message); return; }
    await controller.cancelPreview();
    const r = await timed(() => controller.commit(ops, 'bearing'));
    if (!r.ok) { setPreviewHint(t('bearing.failed', { reason: r.hints?.map((h) => h.hint).join('; ') || (r as { schemaError?: string }).schemaError || 'edit failed' })); return; }
    store.notify(t('bearing.created'));
    setBearingWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  // A flat face selected when it opens: the bearing sits in that face (first face centre at the middle of it, extending into the body) and the pocket can be cut.
  const openBearing = () => {
    if (!doc) return;
    if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true });
    revealLeft();
    setEditingId(null); setEditingMaterial(false); setDraft({}); setPreviewHint(null); setPropWiz(null); setImpWiz(null); setKnurlWiz(null); setScrewWiz(null); setWasherWiz(null);
    const face = selectedFace();
    const placed = face ? seatOnFace(face, controller.bodyFaces()) : null;
    setBearingWiz({ params: { ...DEFAULT_BEARING, ...(placed && face ? { origin: placed.origin, axis: placed.axis, placedOn: face, placedAt: { origin: placed.origin, axis: placed.axis } } : {}) } });
    setLeftTab('Editor');
  };
  // The Frame panel: every change previews the frame; Create adds one `frame` feature (Update replaces the one being edited), one undo step.
  const frameDraftOps = (next: FrameParams): EditOp[] | null => {
    if (!doc || !frameWiz) return null;
    const feat = frameFeature(frameWiz.editId ?? freeId(doc as never), next);
    return feat ? frameOps(feat, !!frameWiz.editId) as EditOp[] : null;
  };
  const onFrameDraft = (next: FrameParams) => {
    const ops = frameDraftOps(next);
    if (!ops) return;
    const id = (ops[0] as { id?: string; feature?: { id?: string } }).id ?? (ops[0] as { feature?: { id?: string } }).feature?.id;
    void controller.preview(ops, 400).then((r) => {
      onPreviewResult(r);
      if (r.ok && r.body && !(r as { stale?: boolean }).stale) void controller.frameReportsOf(ops).then((fr) => setFrameReport(readFrames(fr).find((f) => f.id === id) ?? null));
    });
  };
  const onFrameCancel = async () => {
    await controller.cancelPreview();
    setFrameWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  const onFrameApply = async (next: FrameParams) => {
    const ops = frameDraftOps(next);
    if (!ops) return;
    const edit = !!frameWiz?.editId;
    await controller.cancelPreview();
    const r = await timed(() => controller.commit(ops, 'frame'));
    if (!r.ok) { setPreviewHint(t('frame.failed', { reason: r.hints?.map((h) => h.hint).join('; ') || (r as { schemaError?: string }).schemaError || 'edit failed' })); return; }
    store.notify(t(edit ? 'frame.updated' : 'frame.created'));
    const mat = edit ? null : partMaterialFor(next.profile, doc?.material);   // a catalogue profile brings its grade to a part that has no material of its own yet
    if (mat && controller.setMaterial(mat)) store.notify(t('frame.materialSet', { name: mat }));
    setFrameWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  const openFrame = async (editId: string | null) => {
    if (!doc) return;
    const f = editId ? (doc.features as unknown as Array<Record<string, unknown>>).find((x) => x.id === editId) : undefined;
    if (editId) await ensureForDocument([f as Record<string, unknown>]).catch(() => {});   // the frame's profile may live in a region that is not loaded yet
    const params = editId ? paramsFromFeature(f) : null;
    if (editId && !params) return;
    if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true });
    revealLeft();
    setEditingId(null); setEditingMaterial(false); setDraft({}); setPreviewHint(null); setPropWiz(null); setImpWiz(null); setKnurlWiz(null); setScrewWiz(null); setWasherWiz(null); setBearingWiz(null);
    setFrameReport(null); setFrameJoint(null); setFrameHover(null);
    setFrameWiz({ params: params ?? DEFAULT_FRAME, editId });
    setLeftTab('Editor');
  };
  // Cut list: open the Drawings workspace on a drawing of the frame (views, numbered pieces, cut list and BOM tables). A sheet the user
  // already has is kept: only its frame tables are replaced.
  // The 3D Sketch panel: Create adds one `sketch3d` feature (Update replaces the one being edited) and, for a spline path, a plane normal to its start: one undo step.
  const openSketch3d = (editId: string | null) => {
    if (!doc) return;
    const f = editId ? (doc.features as unknown as Array<Record<string, unknown>>).find((x) => x.id === editId) : undefined;
    const draft = editId ? sk3dDraftOf(f) : sk3dEmpty();
    if (!draft) return;
    if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true });
    revealLeft();
    setEditingId(null); setEditingMaterial(false); setDraft({}); setPreviewHint(null); setPropWiz(null); setImpWiz(null); setKnurlWiz(null); setScrewWiz(null); setWasherWiz(null); setBearingWiz(null); setFrameWiz(null);
    setSk3dWiz({ editId, draft });
    setLeftTab('Editor');
  };
  const onSk3dCancel = () => { setSk3dWiz(null); setPreviewHint(null); setLeftTab('Features'); };
  const onSk3dApply = async (r: Sketch3dResult) => {
    if (!doc || !sk3dWiz) return;
    const edit = !!sk3dWiz.editId;
    const id = String(r.feature.id);
    const planeId = freeId({ features: [...doc.features, { id }] } as never);
    const ops = sketch3dOps(r.feature, edit, r.normalPlane ? sk3dNormalPlane(planeId, id) : undefined) as EditOp[];
    const res = await timed(() => controller.commit(ops, 'sketch3d'));
    if (!res.ok) { setPreviewHint(t('sk3d.failed', { reason: res.hints?.map((h) => h.hint).join('; ') || (res as { schemaError?: string }).schemaError || 'edit failed' })); return; }
    store.notify(t(edit ? 'sk3d.updated' : 'sk3d.created'));
    setSk3dWiz(null); setPreviewHint(null); setLeftTab('Features');
    redraw((n) => n + 1);
  };
  // ---- reference meshes (an imported STL) ----
  const closeMeshPanel = () => {
    meshPreview = null; meshOpen = null;
    setMeshWiz(null); setLeftTab('Features');
    applyMeshes();
  };
  /** An STL file arrived (drop, Open, Import): read it, and ask for the unit with what it holds. */
  const importStlBytes = (bytes: Uint8Array, file: string) => {
    if (!controller.document()) { store.notify(t('mesh.noDoc'), 'warn'); return; }
    // reading a big file takes a moment: let the page paint the notice first
    store.notify(t('mesh.import.reading', { name: file }));
    setTimeout(() => {
      const r = probeStl(bytes);
      if (!r.ok) { store.notify(t('mesh.failed', { name: file, reason: t('mesh.err.' + r.code) }), 'error'); return; }
      setMeshDlg({ name: file, bytes, probe: r.probe, unit: guessUnit(r.probe.size) });
    }, 30);
  };
  const commitMeshImport = (unit: StlUnit, ground: boolean) => {
    const dlg = meshDlg;
    if (!dlg) return;
    setMeshDlg(null);
    setTimeout(() => {
      try {
        const have = meshesOf(controller.document());
        const { rec } = buildRecord(dlg.bytes, dlg.name, unit, have, ground ? viewport?.getUpAxis() ?? 'y' : null);
        controller.setUndoableExtra(MESH_KEY, [...have, rec]);
        refreshMeshes(true);
          redraw((n) => n + 1);
        store.notify(t('mesh.added', { name: rec.name, tris: rec.tris.toLocaleString() }));
      } catch (e) {
        store.notify(t('mesh.failed', { name: dlg.name, reason: (e as Error).message }), 'error');
      }
    }, 30);
  };
  const saveMeshes = (list: MeshRec[]) => { controller.setUndoableExtra(MESH_KEY, list.length ? list : null); refreshMeshes(); redraw((n) => n + 1); };
  const openMesh = (id: string) => {
    const rec = meshesOf(controller.document()).find((m) => m.id === id);
    if (!rec) return;
    if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true });
    revealLeft();
    setEditingId(null); setEditingMaterial(false); setDraft({}); setPreviewHint(null); setPropWiz(null); setImpWiz(null); setKnurlWiz(null); setScrewWiz(null); setWasherWiz(null); setBearingWiz(null); setFrameWiz(null); setSk3dWiz(null);
    meshPreview = null; meshOpen = id;
    setMeshWiz(id); setLeftTab('Editor');
    applyMeshes();
  };
  const toggleMeshShown = (id: string) => saveMeshes(meshesOf(controller.document()).map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)));
  const onMeshApply = (r: MeshRec) => {
    const list = meshesOf(controller.document()).map((m) => (m.id === r.id ? r : m));
    closeMeshPanel();
    saveMeshes(list);
  };
  const onMeshDelete = () => {
    const id = meshWiz;
    const rec = meshesOf(controller.document()).find((m) => m.id === id);
    closeMeshPanel();
    if (!id) return;
    saveMeshes(meshesOf(controller.document()).filter((m) => m.id !== id));
    if (rec) store.notify(t('mesh.deleted', { name: rec.name }));
  };
  const onMeshCancel = () => { closeMeshPanel(); refreshMeshes(); };
  /** Start a sketch by clicking a point on the mesh: the next click on the surface sets the point, then the plane through it is chosen. */
  const stopMeshPick = () => { viewport?.setPlacementHook(null); viewport?.setHandles(null, null); setMeshPick(null); };
  const startMeshPick = () => {
    if (!viewport || !meshesShown().some((m) => m.visible)) return;
    closeMeshPanel();
    setMeshPick({ stage: 'aim' });
    const aim = (x: number, y: number) => {
      const ray = viewport!.rayAt(x, y);
      return ray ? pickMeshes(meshesShown(), ray) : null;
    };
    viewport.setPlacementHook({
      move: (x, y) => {
        const h = aim(x, y);
        if (!h) { viewport?.setHandles(null, null); return; }
        const k = 8 * viewport!.worldPerPixel(h.pos), c = h.pos, n = h.normal;
        viewport?.setHandles([{ id: 'mesh:aim', kind: 'wire', origin: c, axis: [0, 0, 1], color: '#2fe0a0', lines: [[c[0] - k, c[1], c[2]], [c[0] + k, c[1], c[2]], [c[0], c[1] - k, c[2]], [c[0], c[1] + k, c[2]], [c[0], c[1], c[2] - k], [c[0], c[1], c[2] + k], c, [c[0] + n[0] * 4 * k, c[1] + n[1] * 4 * k, c[2] + n[2] * 4 * k]] } as never], null);
      },
      tap: (x, y) => {
        const h = aim(x, y);
        if (!h) { store.notify(t('mesh.pick.miss'), 'warn'); return; }
        viewport?.setPlacementHook(null);
        const k = 8 * viewport!.worldPerPixel(h.pos), c = h.pos, n = h.normal;
        viewport?.setHandles([{ id: 'mesh:aim', kind: 'wire', origin: c, axis: [0, 0, 1], color: '#ffd23f', lines: [[c[0] - k, c[1], c[2]], [c[0] + k, c[1], c[2]], [c[0], c[1] - k, c[2]], [c[0], c[1] + k, c[2]], [c[0], c[1], c[2] - k], [c[0], c[1], c[2] + k], c, [c[0] + n[0] * 4 * k, c[1] + n[1] * 4 * k, c[2] + n[2] * 4 * k]] } as never], null);
        setMeshPick({ stage: 'plane', pos: h.pos, normal: h.normal });
      },
      leave: () => viewport?.setHandles(null, null),
    });
  };
  const sketchOnMeshPlane = async (kind: PlaneKind) => {
    const mp = meshPick;
    if (!mp || mp.stage !== 'plane') return;
    stopMeshPick();
    const before = controller.document()?.features.length ?? 0;
    await timed(() => controller.edit([{ op: 'add', feature: { ...planeThrough(mp.pos, mp.normal, kind, t('mesh.pick.planeName')), visible: false } as never }]));
    const made = controller.document()?.features;
    const pl = made && made.length > before ? made[made.length - 1] : null;
    const bad = store.featureStatus.value.find((x) => x.id === pl?.id && !x.ok);
    if (!pl || bad) {
      if (pl) await timed(() => controller.edit([{ op: 'remove', id: pl.id }]));
      store.notify(t('mesh.sketchFailed'), 'error');
      return;
    }
    startNewSketch({ kind: 'feature', id: pl.id });
  };
  useEffect(() => {   // Esc leaves the pick
    if (!meshPick) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); stopMeshPick(); } };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [meshPick?.stage ?? null]);
  const openCutList = async () => {
    if (!doc) return;
    const frames = readFrames(await controller.frameReports());
    if (!frames.length) { store.notify(t('frame.cutlist.empty'), 'warn'); return; }
    await ensureProfiles(frames.flatMap((fr) => fr.members.map((m) => m.profile))).catch(() => {});   // masses and grades come from the regional stock
    const fresh = await frameDrawing(frames, controller.drawingQuery(), { name: doc.name });
    const cur = sanitizeDrawing((doc as unknown as { drawing?: unknown }).drawing, doc.name, '');
    controller.setDocExtra('drawing', cur.views.length ? refreshTables(cur, fresh.doc) : fresh.doc);
    setDrawingOpen(true);
  };
  // The Gear editor works on the whole parameter record: every draft regenerates the gear's features (preview), OK commits them as one edit.
  const gearRec = editingFeature?.type === 'sketch' ? readGear(editingFeature) : null;
  const gearEditOps = (next: GearParams): EditOp[] => gearCommitOps(doc as never, next, gearRec?.roles);
  const onGearDraft = (next: GearParams) => { void controller.preview(gearEditOps(next)).then(onPreviewResult); };
  const onGearConfirm = async (next: GearParams) => {
    await timed(() => controller.commit(gearEditOps(next), 'gear'));
    setEditingId(null); setDraft({}); setPreviewHint(null);
    setLeftTab('Features');
    redraw((n) => n + 1);
  };
  const switchFamily = async (marine: boolean) => {
    await controller.cancelPreview();
    setPreviewHint(null);
    setPropWiz((w) => (w ? { params: w.params, roles: null, ...(marine ? { marine: { ...DEFAULT_MARINE } } : {}) } : w));
  };
  const propEditor = propWiz && doc && propWiz.marine ? (
    <MarineWizard key={'marine-' + (propWiz.hubId ?? 'new')} params={propWiz.marine} edit={!!propWiz.roles} name={propWiz.hubId ? String((doc.features.find((f) => f.id === propWiz.hubId) as { name?: string } | undefined)?.name ?? '').replace(/ hub sketch$/, '') : undefined}
      onDraft={onMarineDraft} onCreate={onMarineCreate} onCancel={onPropCancel} onFamily={() => { void switchFamily(false); }} hint={previewHint} />
  ) : propWiz && doc ? (
    <PropellerWizard key={propWiz.hubId ?? 'new'} params={propWiz.params} edit={!!propWiz.roles} name={propWiz.hubId ? String((doc.features.find((f) => f.id === propWiz.hubId) as { name?: string } | undefined)?.name ?? '').replace(/ hub sketch$/, '') : undefined}
      onDraft={onPropDraft} onCreate={onPropCreate} onCancel={onPropCancel} onFamily={() => { void switchFamily(true); }} hint={previewHint} />
  ) : null;
  const impellerEditor = impWiz && doc ? (
    <ImpellerWizard key={'impeller-' + (impWiz.hubId ?? 'new')} params={impWiz.params} edit={!!impWiz.roles} name={impWiz.hubId ? String((doc.features.find((f) => f.id === impWiz.hubId) as { name?: string } | undefined)?.name ?? '').replace(/ hub sketch$/, '') : undefined}
      onDraft={onImpellerDraft} onCreate={onImpellerCreate} onCancel={onImpellerCancel} hint={previewHint} />
  ) : null;
  // A hole made by Corner holes reopens with the control above the Hole editor: Update moves the holes (one edit), the hole parameters stay.
  const cornerSketch = editingFeature?.type === 'hole' ? (doc?.features.find((f) => f.id === editingFeature.sketch) as unknown as { id: string; plane?: { kind?: string; id?: string }; points: Array<{ id: string }>; entities: Array<{ id: string }> } | undefined) : undefined;
  const cornerRec = cornerSketch ? readCornerHoles(cornerSketch) : null;
  const cornerHolesEdit = (() => {
    if (!cornerSketch || !cornerRec || !editingFeature) return null;
    const frame = controller.sketchFrameOf(cornerSketch.id);
    const o = frame && cornerSketch.plane?.kind === 'face' && cornerSketch.plane.id ? faceOutline(frame, controller.bodyEdges(), cornerSketch.plane.id) : null;
    // the face outline when it can be read, else the plate the holes were placed against
    const plate: PlateInfo | null = o ? plateFromOutline(o) : cornerRec.rect ? { rect: cornerRec.rect, radius: cornerRec.radius ?? null, notes: [{ code: 'noFace', params: {} }] } : null;
    if (!plate) return null;
    const update = async (rec: CornerRecord, points: HolePt[], pl: PlateInfo) => {
      const next = { ...withCornerHoles(cornerSketch, points), cornerHoles: { ...rec, rect: pl.rect, radius: pl.radius } };
      await timed(() => controller.commit([{ op: 'replace', id: cornerSketch.id, feature: next as never }], 'corner holes'));
      store.notify(t('cornerHoles.placed', { n: points.length }));
      redraw((n) => n + 1);
    };
    return <CornerHolesPanel key={editingId} update value={cornerRec} plate={plate} holeDiameter={holeDiameter({ ...editingFeature, ...draft })} onPlace={update} />;
  })();
  const knurlEditor = knurlWiz && doc ? (
    <KnurlWizard face={selectedFace()} edges={controller.bodyEdges() as never} mesh={controller.bodyFaces()} key={knurlWiz.edit ? 'knurl-edit-' + ('owner' in knurlWiz.edit ? knurlWiz.edit.owner.ids.join('+') : 'c' + knurlWiz.edit.cosmeticIndex) : 'knurl'} params={knurlWiz.params} reason={knurlWiz.reason} edit={!!knurlWiz.edit} refusal={knurlWiz.refusal} scriptNote={!!knurlWiz.edit && !!(doc as unknown as { script?: string }).script} onDraft={onKnurlDraft} onApply={onKnurlApply} onCancel={onKnurlCancel} hint={previewHint} />
  ) : null;
  const screwEditor = screwWiz && doc ? (
    <ScrewWizard key="screw" params={screwWiz.params} onDraft={onScrewDraft} onApply={onScrewApply} onCancel={onScrewCancel} hint={previewHint} />
  ) : null;
  const washerEditor = washerWiz && doc ? (
    <WasherWizard key="washer" params={washerWiz.params} picked={washerPick} onPickHole={onWasherPickHole} onDraft={onWasherDraft} onApply={onWasherApply} onCancel={onWasherCancel} hint={previewHint} />
  ) : null;
  const bearingEditor = bearingWiz && doc ? (
    <BearingWizard key="bearing" params={bearingWiz.params} onDraft={onBearingDraft} onApply={onBearingApply} onCancel={onBearingCancel} hint={previewHint} />
  ) : null;
  // Frame panel: a click or tap on a bracket, a member or a joint's hardware picks its joint; hovering lights it; the panel's list shows and scrolls to it
  const frameSel = store.selection.value, frameHov = store.hover.value;
  useEffect(() => { if (frameWiz && frameReport) { const k = jointOfFace(frameSel[0], frameReport, readout.model.value); if (k) setFrameJoint(k); } }, [frameSel]);
  useEffect(() => { if (frameWiz && frameReport) setFrameHover(jointOfFace(frameHov ?? undefined, frameReport, null)); else if (frameHover) setFrameHover(null); }, [frameHov, frameWiz]);
  useEffect(() => {
    if (!frameWiz || !viewport) return;
    const key = frameHover ?? frameJoint;
    if (key) viewport.setHighlight([...new Set([...frameSel, ...jointFaces(key, frameReport, controller.pickableNames('face'))])]);
    else viewport.setHighlight([...frameSel]);
  }, [frameJoint, frameHover, frameReport, frameWiz]);
  useEffect(() => { if (doc) adoptFrameLibraries(doc.features as unknown as Array<Record<string, unknown>>); }, [doc]);   // a frame from a shared file brings its own stock and fittings
  useEffect(() => { if (doc) void ensureForDocument(doc.features as unknown as Array<Record<string, unknown>>).then(() => redraw((n) => n + 1), () => {}); }, [doc]);   // a document that names a regional profile loads that region when it opens
  const frameEditor = frameWiz && doc ? (
    <FramePanel key={'frame-' + (frameWiz.editId ?? 'new')} params={frameWiz.params} skeletons={skeletons(doc as never)} edit={!!frameWiz.editId} onDraft={onFrameDraft} onApply={onFrameApply} onCancel={onFrameCancel} hint={previewHint} report={frameReport} focusJoint={frameJoint} onFocusJoint={setFrameJoint} onHoverJoint={setFrameHover} />
  ) : null;
  const meshRec = meshWiz && doc ? meshesOf(doc).find((m) => m.id === meshWiz) : undefined;
  const meshEditor = meshRec ? (
    <MeshPanel key={'mesh-' + meshRec.id} rec={meshRec} upAxis={viewport?.getUpAxis() ?? 'y'}
      onChange={(r) => { meshPreview = r; applyMeshes(); }}
      onApply={onMeshApply} onCancel={onMeshCancel} onDelete={onMeshDelete}
      onSketchOn={() => { meshPreview = null; startMeshPick(); }}
      onDraw={() => { const keep = meshPreview; closeMeshPanel(); if (keep) saveMeshes(meshesOf(controller.document()).map((m) => (m.id === keep.id ? keep : m))); openSketch3d(null); }} />
  ) : null;
  const sk3dEditor = sk3dWiz && doc ? (
    <Sketch3dPanel key={'sk3d-' + (sk3dWiz.editId ?? 'new')} host={sketch3dHost} initial={sk3dWiz.draft} featureId={sk3dWiz.editId ?? freeId(doc as never)} base={sk3dWiz.editId ? (doc.features as unknown as Array<Record<string, unknown>>).find((x) => x.id === sk3dWiz.editId) : undefined}
      edit={!!sk3dWiz.editId} startPlane={selectedPlaneFeature()?.id ?? null} onApply={onSk3dApply} onCancel={onSk3dCancel} hint={previewHint} />
  ) : null;
  const featureEditor = propEditor ? propEditor : impellerEditor ? impellerEditor : knurlEditor ? knurlEditor : screwEditor ? screwEditor : washerEditor ? washerEditor : bearingEditor ? bearingEditor : frameEditor ? frameEditor : sk3dEditor ? sk3dEditor : meshEditor ? meshEditor : gearRec ? (
    <GearEditor key={editingId} params={gearRec.params} name={String(editingFeature?.name ?? '').replace(/ profile$/, '')} onDraft={onGearDraft} onConfirm={onGearConfirm} onCancel={onCancel} hint={previewHint} />
  ) : editingFeature?.type === 'thread' ? (
    <ThreadEditor key={editingId} feature={editingFeature} extent={threadExtent} entryModeled={(controller.threadsNow() as Array<{ id?: string; modeled?: boolean }>).find((x) => x.id === editingId)?.modeled} modeledMs={loadThreadPrefs().modeledMs ?? null} inject={handleInject} onDraft={onDraft} onConfirm={onConfirm} onCancel={onCancel} hint={previewHint}
      loadStandards={() => controller.threadStandards()} loadSizes={(std) => controller.threadSizes(std)}
      group={groupFaces ?? undefined} warnings={store.featureWarnings.value}
      faceDiameter={threadCyl ? threadCyl.radius * 2 : null} internal={threadInternal} warning={editingId ? store.featureWarnings.value[editingId] ?? null : null} />
  ) : editingFeature?.type === 'hole' ? (
    <>
    {cornerHolesEdit}
    <HoleEditor key={editingId} feature={editingFeature} onDraft={onDraft} onConfirm={onConfirm} onCancel={onCancel} hint={previewHint} fix={holeFix()} linked={holeLinked}
      threads={{
        loadStandards: () => controller.threadStandards(), loadSizes: (std) => controller.threadSizes(std), wallLength: holeWallLength,
        entryModeled: holeEntry?.modeled, modeledMs: loadThreadPrefs().modeledMs ?? null, warning: holeEntry?.id ? store.featureWarnings.value[holeEntry.id] ?? null : null,
      }} />
    </>
  ) : (
    <FeatureEditor
      feature={(editingFeature as { draftNew?: boolean } | null)?.draftNew ? (({ suppressed: _s, ...rest }) => rest)(editingFeature as unknown as Record<string, unknown>) as never : editingFeature}
      onDraft={onDraft}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onPickRequest={(path) => {
        if (LIST_PATHS.has(path)) {   // edge and face lists: add the selection now, then each pick adds or takes out until Done
          if (pickingPath === path) { setPickingPath(null); return; }
          const id = editingId, sel = store.selection.value, shown = controller.shownEdges();
          setPickingPath(path);
          pickQueueRef.current = pickQueueRef.current.then(async () => {
            const r = await controller.pickIntoList(id, path, () => fieldNow(id, path), () => [], sel, tangentChainOn(), true, shown).catch(() => null);
            if (r && editingIdRef.current === id) { draftRef.current = { ...draftRef.current, [path]: r.value }; setPicked({ path, value: r.value }); }
          });
          return;
        }
        if (path === 'span') { flangeActions.current?.pickSpan(); return; }   // the two points that bound a partial edge flange
        if (path === 'corners') {   // corners are vertices: switch the view to vertex picking and let each click add one
          if (pickingPath === path) { setPickingPath(null); return; }
          cornerSelRef.current = []; store.select([]); store.mode.value = 'vertex'; setPickingPath(path);
          return;
        }
        setPickingPath(path); store.select([]);
      }}
      pickingPath={pickingPath}
      picked={picked}
      inject={handleInject}
      key={`${editingId}:${String(editingFeature?.type)}`}
      options={(a) => optionsFor(a, doc, thinActions)}
      hint={openCard ? null : previewHint}
      diag={previewDiag ? <DiagnosticsCard diagnosis={previewDiag.d} variant="editor" onSelect={selectFailed} onCancel={onCancel} {...diagFixes()} /> : null}
      okBlocked={previewDiag?.fresh.length ? t('diag.okBlocked', { id: previewDiag.fresh[0].id }) : null}
      shapes={editShapes}
      extra={editingFeature?.type === 'insertPart' && (editingFeature as { part?: unknown }).part && !(editingFeature as { draftNew?: boolean }).draftNew ? (
        <div class="fedit-extra">
          <button type="button" class="btn primary" data-action="edit-part-features" onClick={() => { const id = String(editingId); onCancel(); editComponent(id); }}>{t('asm.part.editPartBtn')}</button>
          <small>{t('asm.part.editPartHint', { name: String((editingFeature as { name?: string }).name ?? '') })}</small>
        </div>
      ) : null}
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
  const editingNow = (editingId && !editorGone && editingFeature) || editingMaterial || propWiz || knurlWiz || screwWiz || washerWiz || bearingWiz || frameWiz || sk3dWiz || (meshWiz && meshRec);
  const leftBody = !doc ? <div class="empty">{t('app.left.empty')}</div>
    : editingNow ? editor : tree;
  const catalog = useCatalog({
    controller, viewport: () => viewport, notify: (text, level) => store.notify(text, level),
    placed: () => redraw((n) => n + 1),
    upAxis: () => navPrefs.upAxis,
    library: libraryRegistry(),
    hide: (ids) => { const h = lookStore.hidden.value; lookStore.hidden.value = { ...h, ids: [...new Set([...h.ids, ...ids])] }; },
  });
  // External parts libraries: Insert is one document patch (one undo step); the provenance goes in the document's `sources` field
  const thumbRenderer = useMemo(() => makeThumbRenderer(controller), []);
  const libraryActions: LibraryActions = {
    insert: async (data, lib) => {
      const r = await insertPart(controller, lib, data);
      if (!r.ok) { store.notify(t('library.insert.failed', { title: data.part.title, reason: r.errors.map((e) => `${e.feature}: ${e.code}`).join('; ') }), 'error'); return false; }
      if (r.meshes) refreshMeshes();   // the part's reference meshes came along
      redraw((n) => n + 1);
      store.notify(t('library.inserted', { title: data.part.title, licence: data.licence ?? t('library.licence.unknown') }));
      return true;
    },
    openNew: (data, lib) => guarded(async () => { await load(openText(lib, data), { file: null }); }),
    download: (data) => { void platform.saveFile(downloadName(data), new TextDecoder().decode(data.bytes), 'application/json'); },
    sources: () => liveSources(doc),
  };
  const catalogPanel = <CatalogPanel hasDoc={!!doc} hasSolid={controller.hasSolid()} onItemDown={catalog.onItemDown} onItemKey={catalog.onItemKey} upAxis={navPrefs.upAxis} onPropeller={openPropeller} onKnurl={openKnurl} onScrew={openScrew} onWasher={openWasher} onBearing={openBearing} library={{ registry: libraryRegistry(), actions: libraryActions, notify: (text, level) => store.notify(text, level), renderThumb: thumbRenderer }} />;
  // what the script host needs from the app: build into the open document, or scratch builds when the kernel can
  const scriptHostFor = (loadDoc: (d: Record<string, unknown>) => Promise<unknown>) => ({
    load: loadDoc as never,
    edit: async (ops: never, why?: string) => (await controller.edit(ops, why)) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    ...(controller.canScratchBuild() ? {
      build: (d: unknown, view?: unknown) => controller.scratchBuild(d as never, view as never) as never,
      release: () => controller.scratchRelease(),
      facts: (need: never) => controller.scratchFacts(need),
    } : {}),
  });
  /** A short fingerprint of the feature list, kept with the script so a later variable edit can tell the model is still exactly what the script built. */
  const featureSig = (features: unknown): string => { const j = JSON.stringify(features ?? []); let h = 5381; for (let i = 0; i < j.length; i++) h = ((h * 33) ^ j.charCodeAt(i)) >>> 0; return h.toString(36) + ':' + j.length; };
  /** After a Variables-tab edit: a document made by a script is rebuilt from that script with the edited values, if nothing was changed by hand since. */
  const rerunScriptForVariables = async (): Promise<void> => {
    const d = controller.document() as unknown as { script?: string; scriptSig?: string; name?: string; features?: unknown[]; variables?: Array<{ name: string; expr: string }> } | null;
    const code = d?.script;
    if (!d || typeof code !== 'string' || !code) return;
    const declared = new Set(evaluateScript(code).state.varDefs.map((v) => v.name));
    if (!declared.size) return;   // this script has no variables to follow
    if (d.scriptSig !== featureSig(d.features)) { store.notify(t('script.varsStale'), 'warn'); return; }
    if (readCosmeticKnurls((d as unknown as Record<string, unknown>).cosmeticKnurls).length) { store.notify(t('script.varsKnurl'), 'warn'); return; }   // a display record is not a feature: the signature does not see it, and the rebuilt document has none
    const all = d.variables ?? [];
    const vars = Object.fromEntries(all.filter((v) => declared.has(v.name)).map((v) => [v.name, v.expr]));
    const extras = all.filter((v) => !declared.has(v.name));   // variables added by hand are kept
    store.busy.value = true; scriptRunning = true;
    try {
      // The runner opens the empty part and then adds the whole list in one edit; here the finished part is opened in ONE load instead,
      // so the screen never shows the empty part while the big rebuild runs.
      let shell: Record<string, unknown> | null = null;
      let opened = false;
      const openWhole = async (features: unknown[]): Promise<void> => {
        opened = true;
        const top = features.reduce<number>((m, f) => Math.max(m, Number(/^F(\d+)$/.exec(String((f as { id?: string }).id))?.[1] ?? 0)), 0);
        await load(JSON.stringify({ ...emptyPart(d.name ?? 'Part'), ...shell, name: d.name, features, seq: top + 1 }));
      };
      const host = { ...scriptHostFor(async (dd) => { shell = dd; }), edit: async (ops: Array<{ feature: unknown }>) => { await openWhole(ops.map((o) => o.feature)); return { ok: true } as never; } };
      const r = await runScript(code, host as never, extras.length ? { variables: extras } : {}, { vars });
      if (r.errors.length) { store.notify(r.errors[0].message, 'error'); return; }
      if (!opened && shell) await openWhole([]);
      controller.setDocExtra('script', code);
      controller.setDocExtra('scriptSig', featureSig(controller.document()?.features));
      store.notify(t('script.rebuilt'));
      setLeftTab('Variables');   // the load put the panel back on the feature tree: stay where the edit was made
    } finally { store.busy.value = false; scriptRunning = false; }
  };
  const variablesPanel = <VariablesPanel doc={doc} onApply={async (patch, reason) => { const r = await controller.applyDocPatch(patch, reason); if (r.ok && patch.variables) await rerunScriptForVariables(); redraw((n) => n + 1); return r; }} />;
  // Bodies: view state kept in the document (no feature, no undo step); the viewport is told at once
  const setBodyField = (key: 'appearance' | 'bodyNames' | 'view', value: unknown | null): void => {
    controller.setDocExtra(key, value && typeof value === 'object' && Object.keys(value).length ? value : null);
    viewport?.setBodyView(bodyViewNow());
    redraw((n) => n + 1);
  };
  /** A body as an edit names it: by the name the document gives it, or by one of its faces. */
  const targetOf = (r: BodyRow): BodyTarget => ({ ...(r.docName ? { docName: r.docName } : {}), face: [...r.faces].sort()[0] });
  const editBodies = (ops: EditOp[]): void => {
    void timed(() => controller.commit(ops, 'bodies')).then((r) => {
      if (!r.ok) { const e = (r.errors?.[0] ?? null) as unknown; const code = Array.isArray(e) ? (e[1] as { code?: string } | undefined)?.code : (e as { code?: string } | null)?.code; const reason = code ? t('diag.reason.' + code) : ''; store.notify(t('bodies.failed', { why: reason && reason !== 'diag.reason.' + code ? reason : code ?? '' }), 'error'); }
      store.select([]);
      redraw((n) => n + 1);
    });
  };
  const setHiddenBodies = (keys: string[]): void => setBodyField('view', keys.length ? { hiddenBodies: keys } : null);
  const bodyRows = leftTab === 'Bodies' ? bodyRowsFor(true) : [];
  const bodyFields = readBodyFields(doc);
  const bodiesPanel = <BodiesPanel rows={bodyRows}
    madeBy={(o) => { const f = (controller.document()?.features ?? []).find((x) => x.id === o.split('@')[0]) as { name?: string; type?: string } | undefined; return f ? f.name || f.type || o : null; }}
    selected={[...new Set(store.selection.value.map((n) => rowOfName(bodyRows, n)?.key).filter((k): k is string => !!k))]}
    onSelect={(key, add) => store.select([key], add)}
    onToggleHidden={(key) => setHiddenBodies(setHidden(bodyFields, key, !bodyRows.find((r) => r.key === key)?.hidden, bodyRows))}
    onSolo={(key) => setHiddenBodies(solo(bodyRows, key))}
    onShowAll={() => setHiddenBodies(showAll())}
    onHideOthers={() => setHiddenBodies(hideOthers(bodyRows, store.selection.value.map((n) => rowOfName(bodyRows, n)?.key).filter((k): k is string => !!k)))}
    onRename={(key, name) => {
      const row = bodyRows.find((r) => r.key === key);
      if (!row?.docName) { setBodyField('bodyNames', withName(bodyFields, key, name)); return; }
      // a body the document names is renamed in the document, in every feature that refers to it
      const ops = renameBodyOps((controller.document()?.features ?? []) as unknown as Array<Record<string, unknown>>, row.docName, name);
      if (!ops) { if (name.trim() && name.trim() !== row.docName) store.notify(t('bodies.nameTaken', { name: name.trim() }), 'error'); return; }
      if (bodyFields.bodyNames?.[key]) setBodyField('bodyNames', withName(bodyFields, key, ''));
      editBodies(ops);
    }}
    onCopy={(key) => { const r = bodyRows.find((x) => x.key === key); if (!r) return; const used = usedBodyNames((controller.document()?.features ?? []) as unknown as Array<Record<string, unknown>>, controller.lumps.flatMap((l) => (l.name ? [l.name] : []))); editBodies(copyBodyOps(targetOf(r), freeBodyName(used, r.named ? r.name : r.name))); }}
    onRemove={(keys) => { const ts = keys.flatMap((k) => { const r = bodyRows.find((x) => x.key === k); return r ? [targetOf(r)] : []; }); if (ts.length) editBodies(removeBodyOps(ts)); }}
    onCombine={(op, keys) => { const ts = keys.flatMap((k) => { const r = bodyRows.find((x) => x.key === k); return r ? [targetOf(r)] : []; }); if (ts.length >= 2) editBodies(combineBodyOps(op as CombineOp, ts[0], ts.slice(1))); }}
    onLook={(key, patch) => {
      // a change to a selected body goes to every selected body; to an unselected one, to it alone
      const sel = new Set(store.selection.value.map((n) => rowOfName(bodyRows, n)?.key).filter((k): k is string => !!k));
      const rows = bodyRows.filter((r) => (sel.has(key) ? sel.has(r.key) : r.key === key));
      if (rows.length) setBodyField('appearance', withLooks(bodyFields, rows, patch as Partial<Record<keyof BodyLookSpec, never>>));
    }} />;
  const showVariables = () => { if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true }); revealLeft(); setLeftTab('Variables'); };
  const showScript = () => { if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true }); revealLeft(); setLeftTab('Script'); };
  /** The tab the last Run of the Script panel built into: Run again updates that part instead of opening another tab. */
  const scriptTab = useRef<number | null>(null);
  const scriptReport = useRef<{ errors: import('@kit/script').ScriptError[]; checks: import('@kit/script').ScriptCheck[]; ran: number | null } | undefined>(undefined);
  const scriptPanel = <ScriptPanel initial={scriptReport.current} onReport={(r) => { scriptReport.current = r; }} saved={String((doc as unknown as { script?: string } | null)?.script ?? '')} name={doc?.name} onRun={(code, run) => new Promise((resolve) => {
    const build = async (inPlace: boolean) => {
      // while it runs: busy (the autosave waits), and the part that is open stays as it is until the finished list is opened in one step
      store.busy.value = true; scriptRunning = true;
      try {
        const loadOpts = inPlace ? { keep: true, keepView: true } : {};
        const r = await runScript(code, scriptHostFor((d) => load(JSON.stringify({ ...emptyPart(files.names.next()), ...d }), loadOpts)), {}, { ...run, ...(new URLSearchParams(location.search).has('legacyScript') ? { batched: false } : {}) });
        if (r.cancelled) { store.notify(t('script.cancelled')); resolve({ errors: [] }); return; }
        scriptTab.current = tabSet.activeId;
        scriptReport.current = { errors: r.errors, checks: r.checks ?? [], ran: r.errors.length ? null : r.ops.length };
        controller.setDocExtra('script', code);
        controller.setDocExtra('scriptSig', featureSig(controller.document()?.features));
        redraw((n) => n + 1);
        setLeftTab('Script');
        if (!r.errors.length) store.notify(t('script.done', { count: r.ops.length }));
        for (const w of r.warnings ?? []) store.notify(`${w.line ? `Line ${w.line}: ` : ''}${w.message}`, 'warn');
        resolve({ errors: r.errors, checks: r.checks ?? [], features: r.ops.length });
      } finally { store.busy.value = false; scriptRunning = false; }
    };
    void (async () => {
      const d = controller.document() as unknown as { script?: string; name?: string } | null;
      const last = scriptTab.current !== null && tabSet.get(scriptTab.current) ? scriptTab.current : null;
      let scriptPartName: string | null = null;
      if (d?.script && last !== tabSet.activeId) { try { scriptPartName = evaluateScript(code).state.parts.at(-1)?.name ?? null; } catch { /* the run reports the error */ } }
      if (d && runsInPlace({ activeTabId: tabSet.activeId, lastRunTabId: last, docScript: d.script, docName: d.name, scriptPartName })) {
        if (!(await settleSketch())) { resolve({ errors: [] }); return; }
        await build(true);
      } else guarded(() => build(false));   // another part: a NEW untitled part; the current one stays open in its tab
    })();
  })} />;
  const showCatalog = () => { if (!store.workspace.value.leftTabs) store.setWorkspace({ leftTabs: true }); revealLeft(); setLeftTab('Catalog'); };
  // after a catalog drop the new shape is the selection: its tree row and its size box
  useEffect(() => setShapeSelector((id) => { selectShapeFeature(id); }), []);
  const left = ws.leftPanel === 'hidden' && !phone ? null : (
    <div class={'tree-wrap ' + (phone ? 'sheeted' : ws.leftPanel) + (ws.leftTabs ? ' tabbed' : '')}>
      {ws.leftTabs ? (
        <>
          <div class="ptabs">
            {(['Outliner', 'Features', 'Editor', 'Catalog', 'Variables', 'Script', 'Bodies'] as const).filter((id) => !(phone && id === 'Editor')).map((id) => {   // on a phone the editor is the properties sheet
              const label = t('app.leftTab.' + id);
              const icon = { Outliner: 'feature-part', Features: 'add-extrude', Catalog: 'open-catalog', Editor: 'edit', Variables: 'open-variables', Script: 'open-script', Bodies: 'sel-body' }[id];
              return <button key={id} class="pt" data-testid={'left-tab-' + id} aria-selected={leftTab === id} aria-label={label} title={label} onClick={() => setLeftTab(id)}><Icon name={icon} size={18} />{leftTab === id ? <span class="pt-label">{label}</span> : null}</button>;
            })}
          </div>
          <div class="ptab-body">
          {leftTab === 'Outliner' ? outliner : leftTab === 'Features' ? (phone ? (doc ? tree : leftBody) : leftBody)
            : leftTab === 'Catalog' ? catalogPanel
            : leftTab === 'Variables' ? variablesPanel
            : leftTab === 'Script' ? scriptPanel
            : leftTab === 'Bodies' ? bodiesPanel
            : editor}
          </div>
        </>
      ) : leftBody}
    </div>
  );
  // the properties panel only exists while there is a feature to show: no empty column, nothing to close
  const rightMode = feature ? ws.rightPanel : 'off';
  const inspector = (
      <Inspector feature={feature} warnings={selectedId ? (store.featureWarnings.value[selectedId]?.all ?? (store.featureWarnings.value[selectedId] ? [store.featureWarnings.value[selectedId]] : [])) : []} onSet={(path, value) => {
        clearTimeout(pending);
        pending = setTimeout(() => edit([{ op: 'set', id: selectedId!, path, value }]), 150);
      }} />
  );
  const right = rightMode === 'off' ? null : <div class={'insp-wrap ' + rightMode}>{inspector}</div>;
  // phone: the editor while a feature (or material, or wizard) is being edited, else the properties of the selected feature
  const emptySheet = (key: string) => <div class="sheet-empty">{t(key)}</div>;
  const propsBody = !doc ? emptySheet('app.left.empty') : editingNow ? editor : feature ? <div class="insp-wrap">{inspector}</div> : emptySheet('app.sheet.props.empty');
  const wasEditing = useRef(false);
  useEffect(() => {   // an editor that starts opens the properties sheet; when it ends, so does the sheet it filled
    if (!phone) return;
    if (editingNow) {
      setSheet('props');
      // the first number (Depth ...) is what is usually edited: bring it into the sheet's small window
      setTimeout(() => document.querySelector('.sheet .fedit-fld .expr-field input')?.scrollIntoView?.({ block: 'nearest' }), 300);
    } else if (wasEditing.current) setSheet((cur) => (cur === 'props' ? null : cur));
    wasEditing.current = !!editingNow;
  }, [phone, !!editingNow]);

  // reference planes: all three for an empty part, otherwise the one chosen or hovered in the tree
  const planeIds = ['front', 'top', 'right'] as const;
  // the Start here card: only on an open document with nothing in the viewport (startContent.ts lists every source); the X dismisses it for this tab
  const startSources = {
    doc, meshes: doc ? meshesOf(doc).length : 0, hasSolid: controller.hasSolid(), hasImportedBody: controller.hasImportedBody(), sketching: !!sketching,
    panelOpen: !!(editingId || propWiz || impWiz || knurlWiz || screwWiz || washerWiz || bearingWiz || frameWiz || sk3dWiz || meshWiz || meshDlg || meshPick || kindDlg),
    drawingOpen,
  };
  const startDismissedNow = isStartDismissed(tabSet.activeId);
  const emptyPart1 = showStartCard(startSources, startDismissedNow);   // also lights the three planes as pick targets
  const refPlane = (id: string | null) => (id === 'front' || id === 'top' || id === 'right' ? id : null);
  const catPlane = catalogPlane.value, catActive = catalogActive.value;   // a catalog drag shows the planes as drop targets and lights the one under the pointer
  useEffect(() => {
    viewport?.setRefPlanes(
      emptyPart1 || catActive || planePick ? [...planeIds] : [],
      sketching ? null : catPlane ?? refPlane(refHover) ?? refPlane(refSel),
      { front: t('app.ref.front') + ' (XY)', top: t('app.ref.top') + ' (XZ)', right: t('app.ref.right') + ' (ZY)' },
    );
  }, [emptyPart1, sketching, refHover, refSel, !!doc, catPlane, catActive, planePick]);
  useEffect(() => { viewport?.setRefPlanePick(planePick); return () => viewport?.setRefPlanePick(false); }, [planePick]);
  useEffect(() => {   // Escape gives up picking a plane
    if (!planePick) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPlanePick(false); } };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [planePick]);
  const pickedFace = planePick ? selectedFace() : null;
  useEffect(() => { if (pickedFace) startNewSketch({ kind: 'face', id: pickedFace }); }, [pickedFace]);   // a flat face clicked while picking starts the sketch on it
  useEffect(() => { if (!controller.document()) void (async () => { viewport?.requestFit(); await controller.load(emptyPart(files.names.next())); markClean(); redraw((n) => n + 1); })(); }, []);
  useEffect(() => installDismissGuard(), []);   // the click that closes a menu must not also start a sketch point
  // autosave: a changed part is written 400 ms after the last change, and at once when the page is hidden
  const autoPayload = () => {
    // every changed part (a tab opened from an assembly is not one: it is written back or dropped), as one stored session
    const omitted: string[] = [];
    let used = 0;
    const parts = tabSet.tabs.filter((tb) => !tb.parent && tabDirty(tb)).flatMap((tb) => {
      const d = tb.controller.document();
      if (!d) return [];
      const name = (tb.id === tabSet.activeId ? files.partName : tb.file.partName) ?? d.name;
      // imported meshes and STEP text go in packed (files/assets.ts); meshes past the browser storage budget are left out and said once
      const packed = packDocCached(d, Math.max(0, AUTOSAVE_ASSET_BUDGET - used));
      omitted.push(...packed.omitted);
      const sz = assetSize(packed.doc); used += sz.meshes + sz.blobs;
      return [{ name, doc: name !== d.name ? { ...packed.doc, name } : packed.doc, active: tb.id === tabSet.activeId, whole: d }];
    });
    if (!parts.length) return null;
    for (const x of parts) void snapshots.note(packDocCached(x.whole).doc as PartDoc, x.name, 'auto');
    const stored = parts.map(({ whole: _w, ...rest }) => rest);
    if (stored.length === 1) {
      const only = stored[0];
      // the stored copy is about to be replaced by a part with far fewer features: keep the stored one first
      const prev = readAutosave(browserKV());
      if (prev && !isTabs(prev.doc) && featureCount(prev.doc) >= 4 && (only.doc as PartDoc).features.length < featureCount(prev.doc) / 2) void snapshots.note(prev.doc, prev.name, 'drop');
      return { name: only.name, doc: only.doc, omitted };
    }
    return { name: stored.map((x) => x.name).join(', '), doc: { format: 'cad-tabs', tabs: stored } satisfies AutosaveTabs, omitted };
  };
  useEffect(() => { if (anyDirty()) autosaver.schedule(autoPayload, (controller.document()?.features.length ?? 0) > 200 ? 5000 : undefined); });
  useEffect(() => {
    const hide = () => { if (anyDirty()) autosaver.flush(autoPayload); };
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
    const w = watchForUpdate({ current: runningBundle(), fetchHtml: async () => (await fetch(location.origin + location.pathname, { cache: 'no-store' })).text(), onStale: () => setStale(true) });
    return w.stop;
  }, []);
  useEffect(() => {
    if (runsInstalled()) return;
    return watchInstall({ onAvailable: (ev) => setInstallEv(ev), onInstalled: () => setInstallEv(null) });
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (shouldWarnOnUnload(anyDirty(), location.search)) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, []);

  // the contextual ribbon: a sketch replaces the tabs by the Sketch tab; an open feature editor greys the model commands; an assembly opens on its tab
  const fileIds = new Set(commands.filter((c) => isFileCommand(c.id)).map((c) => c.id));
  const ribbonCommands = editingId ? commands.map((c) => (idleDuringEdit(c.id) ? { ...c, enabled: () => false } : c)) : commands;
  const ribbonLayout = sketching
    ? { ...RIBBON_LAYOUT, [SKETCH_TAB]: sketchRibbonGroups({ active: sketchToolId, onPick: selectTool, labels: phone || ws.toolLabels !== 'icons', ...(sketchControls ? { controls: sketchControls } : {}) }).filter((g) => !(phone && g.id === 'Finish')) }   // a phone names its tools, and its action bar carries OK and Cancel
    : RIBBON_LAYOUT;
  const kindRef = useRef<DocKind | null>(null);
  const kindNow = docKindOf(doc as never);
  useEffect(() => {
    const next = tabForKindChange(kindRef.current, kindNow, tab);
    kindRef.current = kindNow;
    if (next !== tab) setTab(next);
  }, [kindNow]);
  // a part that gets its first sheet metal plate opens on the Sheet tab; one that loses it leaves that tab
  const sheetRef = useRef<boolean | null>(null);
  useEffect(() => {
    const next = tabForSheetChange(sheetRef.current, sheetUi.isSheet, tab);
    sheetRef.current = sheetUi.isSheet;
    if (next !== tab && kindNow === 'part') setTab(next);
  }, [sheetUi.isSheet]);
  // Every action of the sketch bar and every sketch tool is also a command in the F search while a sketch is open (not on the ribbon: the bar and the Sketch tab carry them there)
  const sketchSetShow = (k: 'dimensions' | 'relations') => { const next = { ...sketchPrefs, show: { ...sketchPrefs.show, [k]: !sketchPrefs.show[k] } }; setSketchPrefs(next); saveSketchPrefs(next); };
  const sketchCommands: Command[] = sketching ? [
    { id: 'sketch-ok', label: t('app.sketch.confirm'), tab: 'Sketch', group: 'Finish', run: () => void confirmSketch() },
    { id: 'sketch-cancel', label: t('app.sketch.cancel'), tab: 'Sketch', group: 'Finish', run: () => void cancelSketch() },
    { id: 'sketch-fully-define', label: t('app.sketch.fullyDefine'), tip: t('app.sketch.fullyDefine.tip'), tab: 'Sketch', group: 'Sketch', run: () => void fullyDefineNow() },
    { id: 'sketch-construction', label: t('app.sketch.constructionMode'), tip: t('app.sketch.constructionMode.tip'), tab: 'Sketch', group: 'Sketch', pressed: () => constructionMode, run: () => setConstructionMode(!constructionMode) },
    { id: 'sketch-report', label: t('app.sketch.report'), tip: t('app.sketch.report.tip'), tab: 'Sketch', group: 'Sketch', pressed: () => reportOpen, run: () => setReportOpen((v) => !v) },
    { id: 'sketch-look-normal', label: t('app.sketch.lookNormal'), tab: 'Sketch', group: 'Sketch', keys: 'N', run: () => lookNormal() },
    { id: 'sketch-show-dimensions', label: t('app.sketch.show.dimensions'), tab: 'Sketch', group: 'Sketch', pressed: () => sketchPrefs.show.dimensions, run: () => sketchSetShow('dimensions') },
    { id: 'sketch-show-relations', label: t('app.sketch.show.relations'), tab: 'Sketch', group: 'Sketch', pressed: () => sketchPrefs.show.relations, run: () => sketchSetShow('relations') },
    { id: 'sketch-select', label: t('app.sketch.select'), tab: 'Sketch', group: 'Sketch', run: () => selectTool(null) },
    ...sketchTools().map((x) => ({ id: 'sketch-tool-' + x.id, label: t('app.sketch.tool.' + x.id), ...(x.key ? { keys: x.key.toUpperCase() } : {}), tab: 'Sketch', group: t('app.sketch.group.' + x.group), run: () => selectTool(x.id) })),
  ] : [];
  const drawerEl = () => (   // a function: the tabs are built only when the drawer or its sheet is open
    <Drawer active={drawerTab} onTab={setDrawerTab} onClose={toggleDrawer}
      tabs={[
        { id: 'history', label: t('app.drawer.history'), badge: entries.length, content: <HistoryLog entries={entries} here={records.length} filter={histFilter} onFilter={setHistFilter} onGoto={gotoStep} /> },
        { id: 'diagnostics', label: t('app.drawer.diagnostics'), badge: failures.length || (controller.rejection() ? 1 : 0) || warnList.length, bad: failures.length > 0 || !!controller.rejection(), content: <>{(() => {
          const dg = controller.diagnosis(); const rej = controller.rejection();
          if (dg.roots.length) return <DiagnosticsCard diagnosis={dg} onSelect={selectFailed} onUndo={records.length ? () => { void controller.undo().then(() => redraw((n) => n + 1)); } : undefined} />;
          if (rej) return <DiagnosticsCard diagnosis={rej.diagnosis} onSelect={selectFailed} note={t('diag.rejected')} />;
          return failures.length ? (
            <div>{failures.map((f) => <div key={f.id} class="issue"><b>{f.code ?? t('app.diagnostics.error')}</b> {t('app.diagnostics.on')} {f.id}<div class="why">{f.hint}</div><button class="btn" onClick={() => selectFailed(f.id)}>{t('app.diagnostics.show')}</button></div>)}</div>
          ) : warnList.length ? null : <div class="empty">{t('app.diagnostics.none')}</div>;
        })()}{warnList.length ? <h4 class="warn-head">{t('app.diagnostics.warnings', { n: warnList.length })}</h4> : null}{warnList.map(([id, w]) => {
          // an import with parts that are not solids: "needs repair", the import report and Repair
          const parts = w.code === 'importStepParts' ? parseParts(w.params?.parts) : [];
          const repair = parts.length && needsRepair(parts) ? () => void repairImport(id) : null;
          return <div key={'w' + id} class="issue warn" data-warning={w.code}><b>{w.code}</b> {t('app.diagnostics.on')} {id}<div class="why">{parts.length ? t('import.needsRepair', { n: parts.filter((x) => x.outcome === 'surface').length }) + ' ' + importSummary(parts, t) : w.hint}</div><button class="btn" onClick={() => selectFailed(id)}>{t('app.diagnostics.show')}</button>{parts.length ? <button class="btn" onClick={() => setImportReport({ name: id, parts, viewOnly: false, repair: () => { setImportReport(null); repair?.(); } })}>{t('import.report.open')}</button> : null}{repair ? <button class="btn" title={t('import.report.repair.tip')} onClick={repair}>{t('import.report.repair')}</button> : null}</div>;
        })}</> },
        { id: 'inspect', label: t('app.drawer.inspect'), content: <InspectPanel {...inspect.props} /> },
        { id: 'check', label: t('app.drawer.check'), badge: check.badge, bad: check.badge > 0, content: <CheckPanel {...check.props} /> },
        { id: 'console', label: t('app.drawer.console'), content: (
          <pre class="log">{store.notices.value.map((n) => `${n.level.padEnd(5)} ${n.text}`).join('\n') || t('app.console.none')}</pre>
        ) },
      ]} />
  );
  const lay = layoutHandles(store, ws);
  const cmd = (id: string) => commands.find((c) => c.id === id);
  const fileItems = ['new-part', 'open', 'save', 'save-as', 'samples', ...EXPORT_KINDS.map((k) => `export-${k}`), 'import-step', 'embed-geometry', 'recover-versions'].flatMap((id) => { const c = cmd(id); return c ? [commandToItem(c)] : []; });
  const docTabs = tabSet.tabs.map((tb): TabInfo => ({ id: tb.id, name: (tb.id === tabSet.activeId ? files.partName : tb.file.partName) ?? tb.controller.document()?.name ?? (tb.id === tabSet.activeId && (store.busy.value || importing.value) ? t('app.opening') : t('app.noPart')), dirty: tabDirty(tb), active: tb.id === tabSet.activeId }));
  const moreItems = [
    { id: 'search', icon: 'search', label: t('app.search'), keys: 'F', run: () => setPalette(true) },
    { id: 'mode-part', icon: 'feature-part', label: t('drawing.tab.part'), pressed: () => !drawingOpen, run: () => setDrawingOpen(false) },
    { id: 'mode-drawing', icon: 'export-dxf-views', label: t('drawing.tab.drawing'), enabled: () => !!doc, pressed: () => drawingOpen, run: () => setDrawingOpen(true) },
    { id: 'rename', icon: 'rename', label: t('cmd.rename'), enabled: () => !!doc, run: () => { if (doc) ti.topRename.begin(); } },
    ...(installEv ? [{ id: 'install', icon: 'save', label: t('app.install.action'), run: () => { const ev = installEv; setInstallEv(null); void ev.prompt().then(() => ev.userChoice).catch(() => { /* closed without choosing */ }); } }] : []),
    { id: 'settings', icon: 'settings', label: t('app.settings.title'), run: () => setSettings(true) },
    // the published site's floating Licences and Documentation links are hidden on a phone (they printed over the bottom bar); they are here instead
    ...(document.getElementById('licences-link') ? [{ id: 'licences', icon: 'feature-generic', label: t('app.more.licences'), run: () => { window.open((document.getElementById('licences-link') as HTMLAnchorElement).href, '_blank', 'noopener'); } }] : []),
    ...(document.getElementById('docs-link') ? [{ id: 'docs', icon: 'feature-generic', label: t('app.more.docs'), run: () => { window.open((document.getElementById('docs-link') as HTMLAnchorElement).href, '_blank', 'noopener'); } }] : []),
  ];
  const phoneBar = (
    <div class="topbar phone-bar">
      <Slot id="phone-file" variant="icon" side="bottom" menu icon="menu" title={t('app.phone.menu')} items={fileItems} />
      {ti.topRename.active && doc
        ? <InlineName class="doc-name" value={doc.name} onCommit={ti.topRename.commit} onCancel={ti.topRename.end} />
        : <DocSwitcher tabs={docTabs} title={files.partName ?? doc?.name ?? t('app.noPart')} dirty={isDirty()} open={docList} onOpen={setDocList}
            onSwitch={(id) => void switchTab(id)} onClose={(id) => void closeTab(id)}
            onNew={() => void (async () => { if (await addTab()) await load(JSON.stringify(emptyPart(files.names.next())), { file: null }); })()} />}
      <Tip label={t('cmd.undo')} side="bottom"><button class="rb-btn tb-icon" aria-label={t('cmd.undo')} disabled={!doc} onClick={() => cmd('undo')!.run()}><Icon name="undo" size={22} /></button></Tip>
      <Tip label={t('cmd.redo')} side="bottom"><button class="rb-btn tb-icon" aria-label={t('cmd.redo')} disabled={!doc} onClick={() => cmd('redo')!.run()}><Icon name="redo" size={22} /></button></Tip>
      <Slot id="phone-more" variant="icon" side="bottom" menu icon="more" title={t('app.phone.more')} items={moreItems} />
      {stale ? (
        <span class="update-note" role="status">
          <span>{t('app.update.text')}</span>
          <button class="rb-btn" onClick={() => guardedAll(() => location.reload())}>{t('app.update.refresh')}</button>
          <button class="rb-btn" onClick={() => setStale(false)}>{t('app.update.later')}</button>
        </span>
      ) : null}
    </div>
  );
  return (
    <VarsContext.Provider value={scopeOf(doc)}>
    <div id="app" style={layoutStyle(ws)} data-layout={layout.value} data-sketching={sketching ? '1' : undefined} data-tray={phone && tray ? '1' : undefined} data-ribbon={ws.ribbon} data-left={ws.leftPanel} data-right={rightMode} data-drawer={ws.drawerOpen} data-rail={ws.toolRail} data-lcol={ws.leftCollapsed}>
      {phone ? phoneBar : <div class="topbar">
        <Tip label={t('cmd.new-part')} keys="Ctrl+N" side="bottom"><button class="rb-btn tb-icon tb-new" aria-label={t('cmd.new-part')} onClick={() => commands.find((c) => c.id === 'new-part')!.run()}><Icon name="new-part" size={18} /></button></Tip>
        <Tip label={t('cmd.open')} side="bottom"><button class="rb-btn tb-icon" aria-label={t('cmd.open')} onClick={() => commands.find((c) => c.id === 'open')!.run()}><Icon name="open" size={18} /></button></Tip>
        <Tip label={t('cmd.save')} side="bottom"><button class="rb-btn tb-icon" aria-label={t('cmd.save')} disabled={!doc} onClick={() => commands.find((c) => c.id === 'save')!.run()}><Icon name="save" size={18} /></button></Tip>
        <ExportMenu items={EXPORT_KINDS.map((k) => commands.find((c) => c.id === `export-${k}`)!)} open={exportOpen && !!doc} onOpenChange={setExportOpen} keys="Ctrl+E" disabled={!doc} visibleOnly={{ on: exportVisible, onChange: setExportVisible }} meshQuality={{ quality: exportQuality, chord: exportChord, onQuality: setExportQuality, onChord: setExportChord }} />
        <Slot id="file-more" variant="icon" side="bottom" menu icon="more" title={t('app.fileMore')} items={['save-as', 'embed-geometry', 'recover-versions', 'import-step', 'import-skp-hidden', 'rotate-skp'].flatMap((id) => { const c = commands.find((x) => x.id === id); return c ? [commandToItem(c)] : []; })} />
        <Tip label={t('cmd.samples')} side="bottom"><button class="rb-btn tb-icon" aria-label={t('cmd.samples')} onClick={() => commands.find((c) => c.id === 'samples')!.run()}><Icon name="samples" size={18} /></button></Tip>
        {ti.topRename.active && doc
          ? <InlineName class="doc-name" value={doc.name} onCommit={ti.topRename.commit} onCancel={ti.topRename.end} />
          : null}
        <b class="doc-name" hidden={ti.topRename.active && !!doc} onDblClick={() => { if (doc) ti.topRename.begin(); }}>{files.partName ?? doc?.name ?? t('app.noPart')}{isDirty() ? <span class="doc-dirty" title={t('app.discard.modified')}> •</span> : null}</b>
        {stale ? (
          <span class="update-note" role="status">
            <span>{t('app.update.text')}</span>
            <button class="rb-btn" onClick={() => guardedAll(() => location.reload())}>{t('app.update.refresh')}</button>
            <button class="rb-btn" onClick={() => setStale(false)}>{t('app.update.later')}</button>
          </span>
        ) : null}
        <div class="mode-tabs" role="tablist" aria-label={t('drawing.title')}>
          <button role="tab" aria-selected={!drawingOpen} class="rb-btn" onClick={() => setDrawingOpen(false)}>{t('drawing.tab.part')}</button>
          <button role="tab" aria-selected={drawingOpen} class="rb-btn" disabled={!doc} onClick={() => setDrawingOpen(true)}>{t('drawing.tab.drawing')}</button>
        </div>
        {installEv ? <button class="rb-btn install-btn" title={t('app.install.text')} onClick={() => { const ev = installEv; setInstallEv(null); void ev.prompt().then(() => ev.userChoice).catch(() => { /* closed without choosing */ }); }}>{t('app.install.action')}</button> : null}
        <button class="search-btn" onClick={() => setPalette(true)}>{t('app.search')} <kbd>F</kbd></button>
        <Tip label={t('app.settings.title')} side="bottom"><button class="rb-btn tb-icon" aria-label={t('app.settings.title')} onClick={() => setSettings(true)}><Icon name="settings" size={18} /></button></Tip>
      </div>}
      {phone ? null : <TabStrip
        tabs={tabSet.tabs.map((tb): TabInfo => ({ id: tb.id, name: (tb.id === tabSet.activeId ? files.partName : tb.file.partName) ?? tb.controller.document()?.name ?? (tb.id === tabSet.activeId && (store.busy.value || importing.value) ? t('app.opening') : t('app.noPart')), dirty: tabDirty(tb), active: tb.id === tabSet.activeId }))}
        onSwitch={(id) => void switchTab(id)}
        onClose={(id) => void closeTab(id)}
        onMove={(id, to) => { tabSet.move(id, to); redraw((n) => n + 1); }}
        onNew={() => void (async () => { if (await addTab()) await load(JSON.stringify(emptyPart(files.names.next())), { file: null }); })()}
      />}
      {ws.ribbon !== 'off' && !phone ? <div class={'ribbon-wrap ' + ws.ribbon}><Ribbon commands={ribbonCommands} activeTab={activeRibbonTab(tab, !!sketching)} onTab={setTab} labels={ws.toolLabels} layout={ribbonLayout} hidden={fileIds} onlyTab={sketching ? SKETCH_TAB : undefined} tabLabel={(x) => (x === SKETCH_TAB && sketching ? t('app.sketch.editing', { name: sketching.name }) : undefined)} caption={(c) => t('rb.' + c.id, undefined, c.label)} /></div> : null}
      {ws.leftPanel === 'docked' ? left : null}
      {lay.docked}
      <div id="vp" ref={host}>
        {handles.menuEl}{ti.menu ? <ContextMenu x={ti.menu.x} y={ti.menu.y} items={ti.menu.items} onRun={ti.runMenu} onClose={ti.closeMenu} /> : null}{handles.fieldsEl}{handles.askEl}{handles.hintEl}<div class="vp-notes">{handles.aboutEl}<QuickMeasure lines={quickText} /></div>{tri.menuEl}{tri.dialogEl}{tri.statusEl}
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
            <Tip label={t('cmd.sel-auto-tip')}>
              <button aria-pressed={autoPick} onClick={() => chooseAutoPick(!autoPick)}>{t('cmd.sel-auto')}</button>
            </Tip>
            {([['face', 'cmd.sel-face', 'Q'], ['edge', 'cmd.sel-edge', 'E'], ['vertex', 'cmd.sel-vertex', 'V'], ['body', 'cmd.sel-body', 'B']] as const).map(([m, l, k]) => (
              <Tip key={m} label={t(l)} keys={k}>
                <button aria-pressed={!autoPick && store.mode.value === m} disabled={!store.filters.value[MODE_FILTER[m]]} aria-label={ws.toolLabels === 'icons' ? t(l) : undefined} onClick={() => setMode(m)}>
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
          onRemove={(n) => store.select(store.selection.value.filter((x) => x !== n))} onHover={(n) => viewport?.setHover(n, true)}
          onBodyName={bodyNameOf} onReveal={(n) => rev.show(n)} canReveal={(n) => rev.canShow(n)} /> : null}
        {!sketching && !selectedFace() && selectedPlaneFeature() ? <button class="face-sketch-chip" data-act="sketch-on-plane" onClick={() => { const p = selectedPlaneFeature(); if (p) startNewSketch({ kind: 'feature', id: p.id }); }}>{t('app.sketch.onPlane')}</button> : null}
        {!sketching && selectedFace() ? <button class="face-sketch-chip" onClick={() => { const f = selectedFace(); if (f) startNewSketch({ kind: 'face', id: f }); }}>{t('app.sketch.onFace')}</button> : null}
        <AnalysisLegend legend={analysisStore.legend.value} />
        <DisplayMenu display={store.display.value} onToggle={(l, on) => store.setDisplay(l, on)} {...(sketching ? { sketch: { show: sketchPrefs.show, onToggle: (k, on) => updatePrefs({ show: { ...sketchPrefs.show, [k]: on } }), dimDisplay: sketchPrefs.dimDisplay, onDimDisplay: (v) => updatePrefs({ dimDisplay: v }), typedAngleDims: sketchPrefs.typedAngleDims, rightAngleSquare: sketchPrefs.rightAngleSquare, onFlag: (k, on) => updatePrefs({ [k]: on }) } } : {})} analysis={{ opts: an, onChange: (patch) => analysisStore.set(patch) }} look={{
          style: lk.style, ghostOpacity: lk.ghostOpacity, light: lk.light, background: lk.background, intensity: lk.intensity, reflections: lk.reflections, edgeWidth: lk.edgeWidth, silhouette: lk.silhouette, appearance: selComp ? (compAppearances.get(selComp.id) ?? appearance) : appearance,
          onLook: (patch) => lookStore.set(patch), onAppearance: (patch) => lookStore.setAppearance(selComp ? componentKey(partName, selComp.id) : partName || 'part', patch),
          library: { enabled: online.value.enabled, onEnable: () => setOnlineEnabled(true), list: () => onlineLibrary.list('wood') },
          componentName: selComp?.name,
          anyHidden: anyHidden(hid), onShowAll: () => lookStore.showAll(),
        }} />
        {sketchBar}
        {sketching && holeSketchRef.current && holeCorner ? <CornerHolesPanel floating value={holeCorner.rec} plate={holeCorner.plate} holeDiameter={holeDiameter(newHole(sketching.id, false, loadHolePrefs()))} onPlace={placeCornerHolesInSketch} /> : null}
        {boxRect ? <div class={'sketch-box' + (boxRect.crossing ? ' crossing' : '')} style={{ left: Math.min(boxRect.x0, boxRect.x1) + 'px', top: Math.min(boxRect.y0, boxRect.y1) + 'px', width: Math.abs(boxRect.x1 - boxRect.x0) + 'px', height: Math.abs(boxRect.y1 - boxRect.y0) + 'px' }} title={boxRect.crossing ? t('app.sketch.box.crossing') : t('app.sketch.box.window')} /> : null}
        {sketching && !sketchToolId && !entityOut && hoverTip ? <div class="sketch-tip" style={{ left: hoverTip.x + 'px', top: hoverTip.y + 'px' }}>{hoverTip.text}</div> : null}
        {sketching ? <SketchAnnotations items={annotItems} hot={hotConstraint} touch={layout.value !== 'desktop'} selected={selConstraint} inert={!!sketchToolId} onSelect={(id) => { setSelConstraint(id); selectEntity(null, 0, 0); }} onEdit={startDimEdit} onHover={hoverConstraint} onToggleDriven={toggleDriven} onMenu={(a, x, y) => setDimMenu({ id: a.id, type: a.type ?? '', driven: !!a.driven, x, y })} /> : null}
        {sketching && dimMenu ? <ContextMenu x={dimMenu.x} y={dimMenu.y} items={dimensionMenu(dimMenu.type, dimMenu.driven)} onRun={runDimMenu} onClose={() => setDimMenu(null)} /> : null}
        {sketching && dimEdit ? <SketchFields cls="dimedit" fields={[{ id: 'value', label: 'app.sketch.field.value', value: dimEdit.value, locked: true, unit: 'length', ...(dimEdit.expr ? { expr: dimEdit.expr } : {}) }]} x={dimEdit.x} y={dimEdit.y} onField={dimEditEvent} onDefine={defineParam} /> : null}
        {chrome.rightPalette ? <SketchToolStrip layout="palette" active={sketchToolId} onPick={selectTool} labels={ws.toolLabels} /> : null}
        {emptyPart1 ? <StartCard active={refPlane(refSel)} onHover={setRefHover} onSketch={startNewSketch} onClose={() => dismissStart(tabSet.activeId)} /> : null}
        <ViewNav phone={phone} onTurn={(d, step) => viewport?.turnView(d, step)} onRoll={(d, step) => viewport?.rollView(d, step)} onHome={() => viewport?.homeView()} {...(sketching ? { onLookNormal: lookNormal } : {})} />
        <div class="cube-tools">
          <Tip label={t('cmd.fit')} keys="Z" side="bottom"><button aria-label={t('cmd.fit')} onClick={() => viewport?.fit()}><Icon name="fit" size={18} /></button></Tip>
          <Tip label={ortho ? t('app.view.parallel') : t('app.view.perspective')} side="bottom"><button aria-label={t('cmd.toggle-projection')} aria-pressed={ortho} class={ortho ? 'on' : ''} onClick={toggleProjection}><Icon name={ortho ? 'projection-ortho' : 'toggle-projection'} size={18} /></button></Tip>
        </div>
        {sketching && reportOpen && !phoneOrTablet && sketchDraftNow ? <SketchReportWindow report={sketchReport(sketchDraftNow, stNow)} onSelect={selectConstraintTargets} onClose={() => setReportOpen(false)} /> : null}
        {sketching && !sketchToolId && entityOut && entityOut.fields.length ? <SketchFields fields={entityOut.fields} x={entityOut.x} y={entityOut.y} onField={entityFieldEvent} onDefine={defineParam} /> : null}
        {sketching && !sketchToolId && selectedText() ? (() => {
          const d = controller.sketchDraft()!; const id = selectedText()!; const f = textFields(d, id); const e = d.entities.find((x) => x.id === id)!;
          return f ? <TextPanel fields={f} notes={textNotes(textOutlineOf(d, e))} picking={textPickRef.current === id} fonts={fontsApi}
            onPatch={textEdit} onDone={() => selectEntity(null, 0, 0)}
            onDelete={() => { void controller.applySketchDraft(deleteEntity(d, id)).then(() => selectEntity(null, 0, 0)); }}
            onPickCentre={() => { textPickRef.current = textPickRef.current === id ? null : id; viewTick((n) => n + 1); }} /> : null;
        })() : null}
        {sketching && !sketchToolId && selectedEquation() ? (() => {
          const d = controller.sketchDraft()!; const id = selectedEquation()!; const f = equationFields(d, id);
          if (!f) return null;
          checkEquation(id, f, false);
          const k = eqResultRef.current;
          return <EquationPanel fields={f} result={k.key.startsWith(id + ' ') ? k.r : null} onChange={(next) => checkEquation(id, next, true)}
            onDone={() => selectEntity(null, 0, 0)}
            onDelete={() => { void controller.applySketchDraft(deleteEntity(d, id)).then(() => selectEntity(null, 0, 0)); }} />;
        })() : null}
        {sketching && toolOut?.panel ? <PatternPanel panel={toolOut.panel} onField={fieldEvent} onKey={(key) => runTool({ type: 'key', key })} onCancel={() => selectTool(null)} /> : null}
        {sketching && toolOut ? <SketchFields fields={toolOut.fields} x={toolOut.x} y={toolOut.y} onField={fieldEvent} onDefine={defineParam} seed={fieldSeed} /> : null}
        {sketching && toolOut && (toolOut.pending?.length || toolOut.snapLabel) ? <div class={'sketch-pending' + (toolOut.snapModel ? ' model' : '')} style={{ left: toolOut.x + 16 + 'px', top: toolOut.y - 8 + 'px' }}>{[...(toolOut.pending ?? []), toolOut.snapLabel].filter(Boolean).join(' · ')}</div> : null}
        <div id="vp-layer">
          {planePick ? (
            <div class="busy-overlay plane-pick-bar" role="status" data-testid="plane-pick-bar">
              <span>{t('app.sketch.pickPlane')}</span>
              <button class="busy-cancel" onClick={() => setPlanePick(false)}>{t('app.sketch.pickPlane.cancel')}</button>
            </div>
          ) : null}
          {sketching ? <CursorLabel enabled={sketchPrefs.cursorLabel} /> : null}
          <BusyOverlay busy={store.busy.value} label={busyNote.value ?? undefined} showElapsed={busyNote.value !== null} onCancel={async () => { await controller.cancel(); redraw((n) => n + 1); }} />
          <BusyOverlay busy={!!importing.value} delayMs={0} showElapsed cancelable={importing.value?.phase !== 'building'} label={importing.value ? (importing.value.phase === 'building' ? t('files.solidcraft.building', { name: importing.value.name }) : importing.value.total ? t('files.solidcraft.reading', { name: importing.value.name, done: importing.value.done, total: importing.value.total }) : t('files.solidcraft.starting', { name: importing.value.name })) : undefined} onCancel={() => importing.value?.abort()} />
          <Toast notices={store.notices.value} />
          {tabSet.active?.parent ? (
            <div class="busy-overlay" role="status" data-testid="edit-part-bar">
              <span>{t('asm.editpart.banner', { part: tabSet.active.parent.part, asm: tabSet.active.parent.asm })}</span>
              <button class="busy-cancel" onClick={() => void finishEditingPart(true)}>{t('asm.editpart.done')}</button>
              <button class="busy-cancel" onClick={() => void finishEditingPart(false)}>{t('asm.editpart.cancel')}</button>
            </div>
          ) : null}
        </div>
      </div>
      {rightMode === 'docked' ? right : null}
      {ws.drawerOpen ? drawerEl() : null}
      {drawingOpen && doc ? (() => {
        const h = makeDrawingHost(controller, { save: (n, d, m) => platform.saveFile(n, d, m), notify: (x, l) => store.notify(x, l ?? 'info'), changed: () => redraw((n) => n + 1), close: () => setDrawingOpen(false) });
        return h ? <DrawingWorkspace host={h} /> : null;
      })() : null}
      <div class="status-wrap">
        <StatusBar notices={store.notices.value} hover={hoverLabel(store.hover.value)} busy={store.busy.value}
          sketch={sketching ? <><SketchReadout snapOn={sketchPrefs.snapOn} gridOn={sketchPrefs.gridSnap} gridBase={sketchPrefs.gridSpacing}
            onSnap={(on) => updatePrefs({ snapOn: on })} onGrid={(on) => updatePrefs({ gridSnap: on })} onSpacing={(mm) => updatePrefs({ gridSpacing: mm })} onZoom={(pct) => viewport?.setSketchZoom(uppForPercent(pct))} />
            {sketchControls && !chrome.bar ? <SketchNotes hint={sketchControls.hint} selected={sketchControls.selected} onClearSelection={sketchControls.onClearSelection} status={sketchControls.status} list={sketchControls.list} /> : null}</> : <ModelReadout />}
          items={[
            ...(selText ? [{ label: t('app.status.selection'), value: selText }] : []),
            ...(warnList.length ? [{ label: t('app.status.warnings'), value: String(warnList.length), tone: 'warn' as const, title: t('app.status.warnings.tip'), onClick: () => { setDrawerTab('diagnostics'); openDrawer(); } }] : []),
            { label: t('app.status.features'), value: String(rows.length) },
            { label: t('app.status.faces'), value: String(facts.faces) },
            { label: t('app.status.triangles'), value: String(facts.triangles) },
            ...(cachedChip(store.cached.value) ? [cachedChip(store.cached.value)!] : []),
            ...(agentLink.state.value.state === 'connected' ? [{ label: t('agent.chip'), value: t(agentLink.allowEdit.value ? 'agent.chip.edit' : 'agent.chip.view'), tone: agentLink.allowEdit.value ? 'warn' as const : 'ok' as const, title: t('agent.chip.tip'), onClick: () => setSettings(true) }] : []),
            ...(check.chip ? [check.chip] : []),
            ...(kernelRouter.prefs.value.mode === 'local' ? [{ label: t('app.status.kernel'), ...chipOf(kernelRouter.status.value), title: t('app.status.kernel.tip'),
              onClick: () => { try { localStorage.setItem('cad.settingsTab', 'kernel'); } catch { /* private window */ } setSettings(true); } }] : []),
            ...(facts.rebuildMs !== null ? [{ label: t('app.status.lastRebuild'), value: t('app.status.secondsUnit', { value: (facts.rebuildMs / 1000).toFixed(1) }) }] : []),
            { label: t('app.status.errors'), value: String(failures.filter((f) => !f.blockedBy).length) + (failures.some((f) => f.blockedBy) ? ' ' + t('app.status.blocked', { n: failures.filter((f) => f.blockedBy).length }) : ''), tone: failures.length ? ('err' as const) : ('ok' as const) },
          ]}
          drawerOpen={phone ? sheet === 'diag' : ws.drawerOpen} onToggleDrawer={toggleDrawer} />
      </div>
      {phone && sketching ? (
        <div class="sketch-actions" role="toolbar" aria-label={t('app.sketch.act.label')}>
          <button class="sa-btn sa-done" data-act="done" onClick={() => void confirmSketch()}><Icon name="check" size={22} /><span>{t('app.sketch.act.done')}</span></button>
          <button class="sa-btn" data-act="cancel-shape" onClick={() => sketchKeyRef.current?.({ key: 'Escape', preventDefault() { /* a button, not a key */ } } as KeyboardEvent)}><Icon name="close" size={22} /><span>{t('app.sketch.act.cancelShape')}</span></button>
          <button class="sa-btn" data-act="undo" onClick={() => sketchUndoRef.current?.()}><Icon name="undo" size={22} /><span>{t('app.sketch.act.undo')}</span></button>
          <button class="sa-btn" data-act="delete" disabled={!entityOut && !multiSelRef.current.length} onClick={() => sketchKeyRef.current?.({ key: 'Delete', preventDefault() { /* a button, not a key */ } } as KeyboardEvent)}><Icon name="trash" size={22} /><span>{t('app.sketch.act.delete')}</span></button>
        </div>
      ) : null}
      {phone ? (
        <div class="nav-wrap">
        {tray ? <ToolTray commands={ribbonCommands} activeTab={activeRibbonTab(tab, !!sketching)} onTab={setTab} layout={ribbonLayout} hidden={fileIds} onlyTab={sketching ? SKETCH_TAB : undefined}
          tabLabel={(x) => (x === SKETCH_TAB && sketching ? t('app.sketch.editing', { name: sketching.name }) : undefined)} caption={(c) => t('rb.' + c.id, undefined, c.label)} onDone={() => setTray(false)} /> : null}
        <BottomNav items={[
          { id: 'tools', label: t('app.nav.tools'), icon: <Icon name="tools" size={22} />, pressed: tray },
          { id: 'tree', label: t('app.nav.tree'), icon: <Icon name="folder" size={22} />, pressed: sheet === 'tree' },
          { id: 'props', label: t('app.nav.props'), icon: <Icon name="edit" size={22} />, pressed: sheet === 'props' },
          { id: 'diag', label: t('app.nav.diag'), icon: <Icon name="drawer" size={22} />, pressed: sheet === 'diag', badge: failures.length || (controller.rejection() ? 1 : 0) || warnList.length, bad: failures.length > 0 || !!controller.rejection() },
        ]} onPick={(id) => { if (id === 'tools') { setSheet(null); setTray((v) => !v); } else toggleSheet(id as 'tree' | 'props' | 'diag'); }} />
        </div>
      ) : null}
      {phone ? (
        <Sheet open={sheet !== null} onClose={() => setSheet(null)} snap={sheetSnap} onSnap={setSheetSnap} docked fractions={sheet === 'props' ? SPLIT_FRACTION : BROWSE_FRACTION} modal={sheetSnap === 'full' && sheet !== 'props'} bottom={navH}
          title={sheet === 'props' ? t('app.nav.props') : sheet === 'diag' ? t('app.nav.diag') : t('app.nav.tree')}>
          {sheet === 'tree' ? left : sheet === 'props' ? propsBody : sheet === 'diag' ? drawerEl() : null}
        </Sheet>
      ) : null}
      {sketching && reportOpen && phoneOrTablet && sketchDraftNow ? <SketchReportSheet report={sketchReport(sketchDraftNow, stNow)} onSelect={selectConstraintTargets} onClose={() => setReportOpen(false)} snap={reportSnap} onSnap={setReportSnap} bottom={phone ? navH : 0} /> : null}
      {palette ? <CommandPalette commands={sketchCommands.length ? [...commands, ...sketchCommands] : commands} pinned={['view-iso', 'fit', 'undo', 'redo', 'samples', 'settings']} onClose={() => setPalette(false)} /> : null}
      {samples ? <LibraryDialog samples={samples} thumbBase={base} registry={libraryRegistry()} onOpenPart={(data, lib) => { setSamples(null); libraryActions.openNew(data, lib); }} canInsert={!!doc} onInsertPart={(e) => { setSamples(null); catalog.onItemKey(partItem(e)); }} onWizard={(id) => { setSamples(null); if (id === 'screw') openScrew(); else openBearing(); }} onClose={() => setSamples(null)} recent={files.recent()} recentThumbs={files.recentThumbs()} onPickRecent={openRecent}
        onPick={(s) => { setSamples(null); guarded(async () => { const r = await fetch(s.url); await load(await r.text(), { file: null }); files.noteSample(s.id, s.title, s.url); }); }} /> : null}
      {kindDlg ? <ImportKindDialog kind={kindDlg.kind} name={kindDlg.name} initial={readChoice(kindDlg.kind)} hidden={kindDlg.hidden} onCancel={() => setKindDlg(null)} onImport={(choice, hidden) => { const d = kindDlg; setKindDlg(null); if (d.kind === 'skp') { if (choice === 'saved') void importSkpMesh(d.bytes!, d.name, hidden); else importSkpBytes(d.bytes!, d.name, hidden); } else if (choice === 'saved') importStepFeature(d.text!, d.name); else importStepText(d.text!, d.name); }} /> : null}
      {meshDlg ? <MeshImportDialog name={meshDlg.name} probe={meshDlg.probe} unit={meshDlg.unit} onImport={commitMeshImport} onCancel={() => setMeshDlg(null)} /> : null}
      {meshPick ? (
        <div class="mesh-pick-chip" data-testid="mesh-pick" role="group" aria-label={t('mesh.pick.hint')}>
          <span class="mesh-pick-text">{meshPick.stage === 'aim' ? t('mesh.pick.hint') : t('mesh.pick.plane')}</span>
          {meshPick.stage === 'plane' ? (['normal', 'front', 'top', 'right'] as PlaneKind[]).map((k) => (
            <button key={k} type="button" class={'rb-btn' + (k === 'normal' ? ' ok' : '')} data-plane={k} onClick={() => void sketchOnMeshPlane(k)}>{t('mesh.pick.' + k)}</button>
          )) : null}
          <button type="button" class="rb-btn" data-act="mesh-pick-cancel" onClick={stopMeshPick}>{t('mesh.pick.cancel')}</button>
        </div>
      ) : null}
      {importReport ? <ImportReportDialog name={importReport.name} parts={importReport.parts} viewOnly={importReport.viewOnly} onRepair={importReport.repair} onClose={() => setImportReport(null)} /> : null}
      {recoverOpen ? <RecoverDialog load={() => snapshots.list()} onClose={() => setRecoverOpen(false)} onRestore={(sn) => { setRecoverOpen(false); void load(JSON.stringify(sn.doc), { restored: true }); }} /> : null}
      {restore ? <RestoreDialog name={restore.name} savedAt={restore.savedAt}
        onVersions={() => { setRestore(null); setRecoverOpen(true); }}
        onNew={() => { clearAutosave(browserKV()); setRestore(null); }}
        onRestore={() => { const a = restore; setRestore(null); void restoreSession(a); }} /> : null}
      {saveAsOpen ? <SaveAsDialog initial={files.partName ?? doc?.name ?? 'Part1'} geometry={embedPref || openedWithView.current} onCancel={() => setSaveAsOpen(false)}
        onSave={async (fileName, o) => { setSaveAsOpen(false); chooseEmbed(o.geometry); const d = controller.document(), v = controller.viewData(); if (d) finishSave(await files.save(d, { saveAs: true, fileName, thumbnail: await saveThumbs.forSave(d), ...embedOpt(o.geometry, v) }), d); }} /> : null}
      {dragging ? <DropOverlay /> : null}
      <CatalogGhost hasSolid={controller.hasSolid()} />
      {guard ? <DiscardDialog name={doc?.name ?? ''} onCancel={() => { setGuard(null); setGuardSave(null); }}
        onDiscard={() => { const go = guard; setGuard(null); setGuardSave(null); void go(); }}
        onSave={async () => { const go = guard, sv = guardSave; setGuard(null); setGuardSave(null); if (sv) { await sv(); return; } await commands.find((c) => c.id === 'save')!.run(); if (!isDirty()) void go(); }} /> : null}
      {sheetUi.nodes}
      {knurlAsk ? <KnurlExportAsk count={knurlAsk.count} onAnswer={answerKnurl} /> : null}
      {knurlFail ? <KnurlExportFailed reason={knurlFail.reason} message={knurlFail.message} onChoose={chooseKnurl} /> : null}
      {settings ? <SettingsDialog workspace={stored} layoutPref={layoutPref.value} onLayoutPref={(v) => { layoutPref.value = v; write(LAYOUT_KEY, v); }} onChange={(p: Partial<Workspace>) => store.setWorkspace(p)} onPreset={(n) => store.applyPreset(n)} onResetLayout={() => resetLayout(store)} onClose={() => setSettings(false)}
        locale={localeSignal.value} locales={[...availableLocales(), ...(import.meta.env.DEV ? [PSEUDO] : [])]} pseudo={PSEUDO}
        onLocale={(c) => { setLocale(c); write('cad.locale', c); }}
        navPrefs={navPrefs} onNavPrefs={changeNav}
        massPrefs={massPrefs} onMassPrefs={changeMass}
        online={{ enabled: online.value.enabled, cacheBytes: cacheSize.value, onEnabled: setOnlineEnabled, onClear: () => { void clearOnlineCache(); } }}
        exportPrefs={exportPrefs} onExportPrefs={changeExport}
        agent={{ state: agentLink.state.value, allowEdit: agentLink.allowEdit.value, onConnect: agentLink.connect, onDisconnect: agentLink.disconnect, onAllowEdit: agentLink.setAllowEdit }}
        kernel={{ prefs: kernelRouter.prefs.value, status: kernelRouter.status.value, onChange: (patch) => kernelRouter.setPrefs(patch), onTest: (v) => kernelRouter.test(v), onRetry: () => kernelRouter.retry() }}
        triPrefs={triPrefs} onTriPrefs={(patch) => { const next = { ...triPrefs, ...patch }; setTriPrefs(next); saveTriPrefs(next); }}
        sketchPrefs={sketchPrefs} onSketchPrefs={(patch) => { const next = { ...sketchPrefs, ...patch }; setSketchPrefs(next); saveSketchPrefs(next); }}
        iconSet={iconSet} onIconSet={(v) => { setIconSetState(v); chooseIconSet(v); }}
        theme={theme} onTheme={(v) => { setTheme(v); applyTheme(v); write('cad.theme', v); viewport?.refreshTheme(); }} /> : null}
    </div>
    </VarsContext.Provider>
  );
}

render(<App />, document.getElementById('root')!);
registerServiceWorker(layout.value !== 'desktop');   // a phone or tablet leaves the kernel wasm out of the install
