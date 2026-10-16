import { type Session, type EditRecord, type EditOp, type EditResult, type PreviewResult, type ViewFrame } from '@ck/session';
import { emptyPart, type PartDoc, type SketchFeature, type SketchSolverStatus } from '@ck/part-model';
import { vertexName, BODY, type Store } from '@kit/store';
import { SelModel } from './select/model';
import { blockedIssues, blockMessage, type Issue, type ProfileList, type ProfileReport } from './designCheck';
import type { CheckPolicy } from './checkSettings';
import { importStepView, importSldprtView, type StepImportResult } from './files/stepImport';
import { applyOpsLocal, saveThreadPrefs, warningsById, type ThreadRow, type ThreadStd } from './threadData';
import { queryInterference, queryMass, queryMeasure, type Interference } from './inspect/kernel';
import { drawingQuery } from './drawing/kernel';
import type { DrawingQuery } from './drawing/layout';
import type { KernelMeasure } from './inspect/measure';
import type { MassRaw } from './inspect/mass';
import { t } from './i18n';
import { refLabel, syncNameOps } from './featureCreators';
import { deleteOps, repairAnchor, rollbackCount as countOf, withRollbackInsert } from './treeActions';
import { fetchSurfaces, hasSurfaceFeatures, mergedView, surfaceNames, toViewSurfaces, withSurfaces } from './surfaceView';
import type { ViewSurface } from '@kit/viewport';
import { diagnose, type DiagFeature, type Diagnosis } from './errorSummary';
import { adviceOf, summaryLine } from './diagnosticsText';
import { setDocFields, type DocPatch } from './docFields';
import { watchComponents, partMassProps, type AsmComponent, type AsmExtra } from './assembly/kernel';
import { defaultFlip, ensureTextOutlines, foldSolution, fromFeature, toFeature, type SketchDraft, type TextOutlineData } from '@kit/sketch';

/** The solved sketch a viewport draws while a sketch feature is open for editing. */
export interface SketchEditView {
  featureId: string;
  frame: ViewFrame;
  sketch: SketchFeature;
  status?: SketchSolverStatus;
}

/** Result of a speculative sketch drag: `stale` when a newer drag superseded it. */
export interface SketchPreview {
  ok: boolean;
  stale?: boolean;
  view?: SketchEditView;
  hint?: string;
  status?: SketchSolverStatus;
}

/** One edge as the kernel reports it: `key` is the persistent name the viewport selects by. */
export interface ViewEdge { key?: string; faces?: string[]; mid?: number[]; /** world-space polyline of the edge */ pts?: number[][] }

export interface ViewSink {
  setBody(b: unknown | null): void;
  setHighlight(n: string[]): void;
  setSketchEdit(v: SketchEditView | null): void;
  setThreads?(items: unknown[]): void;
  /** Light up the length range of the thread being edited (null clears it). */
  setThreadFocus?(id: string | null): void;
}

/** What the viewer is handed: the solid's view body plus the surface bodies. */
export type ShownBody = NonNullable<Awaited<ReturnType<Session['bodyForView']>>> & { surfaces?: ViewSurface[] };

export interface KernelFactory {
  open(doc: PartDoc): Promise<Session>;
  cancel?(): void;
}

/** One undoable change of the part's material. */
interface MaterialStep { at: number; before: string | null; after: string }

export class Controller {
  private readonly store: Store;
  private readonly view: ViewSink;
  private readonly kernel: KernelFactory;
  private session: Session | null = null;
  private lastGood: PartDoc | null = null;
  private pendingCancel: (() => void) | null = null;
  private redoStack: Array<EditOp[] | MaterialStep | { patch: DocPatch; reason: string }> = [];
  /** The patch of each variables / configurations step by its record id, so redo can apply it again. */
  private docSteps = new Map<string, { patch: DocPatch; reason: string }>();
  /** The material set in the app (the session has no document-level op for it, like the part name); applied to `document()`. */
  private material: string | null = null;
  /** Material changes in order, each with how many session records existed when it was made, so undo and redo keep them in line with the session's. */
  private materialSteps: MaterialStep[] = [];
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewSeq = 0;
  private previewWake: (() => void) | null = null;
  /** Rollback marker: id of the last feature that is on (`''` none, null = all). View only: the session has no op that sets the document's `rollback`. */
  private rollbackAnchor: string | null = null;
  private lastIds: string[] = [];
  /** A part name set in the app (the session cannot rename the document); applied to what `document()` returns. */
  private docName: string | null = null;
  /** Viewer-state fields kept in the document file that the session has no op for (the exploded view). Applied to `document()`; not a history step. */
  private docExtra: Record<string, unknown> = {};
  /** The kernel's `components[]` of the last regen of the document (id, dof, place), for the assembly panel. */
  private asmComponents: AsmComponent[] = [];
  /** The degrees-of-freedom report and rejected-mate details of the last regen (asked with `opts.dofReport`). */
  private asmExtra: AsmExtra = { report: null, errors: new Map() };

  /** The session hands out a deep copy of the document on every `document` read (1.4 MB of JSON for a 500-feature part, ~0.3 s each).
   *  One copy is kept until the session changes; callers get the same object and must not mutate it. */
  private snap: PartDoc | null = null;
  private sdoc(): PartDoc {
    return (this.snap ??= this.session!.document);
  }

  constructor(deps: { store: Store; view: ViewSink; kernel: KernelFactory }) {
    this.store = deps.store;
    this.view = deps.view;
    this.kernel = deps.kernel;
  }

  async load(doc: PartDoc): Promise<void> {
    this.store.busy.value = true;
    try {
      this.session = await this.kernel.open(doc);
      this.snap = null;
      this.asmComponents = []; this.asmExtra = { report: null, errors: new Map() };
      watchComponents(this.session, (c, x) => { this.asmComponents = c; this.asmExtra = x; });
      this.session.forgetReplies?.();   // the warm-up regen of open() predates the watch: ask again so its components are seen
      // viewer-state fields kept in the file: the exploded view and the drawing sheet
      this.docExtra = {}; this.extraRev++;
      for (const k of ['explode', 'drawing', 'script', 'appearance', 'faceAppearance', 'bodyNames', 'view']) { const v = (doc as unknown as Record<string, unknown>)[k]; if (v) this.docExtra[k] = structuredClone(v); }
      this.rollbackAnchor = null; this.rejected = null; this.lastIds = []; this.docName = null; this.material = null; this.materialSteps = []; this.redoStack = []; this.docSteps.clear();
      await this.refresh();
    } finally {
      this.store.busy.value = false;
    }
  }

  /** The kernel transport the open session talks to (null for a session that has none, e.g. a test double). */
  private transport(): { request(m: Record<string, unknown>): Promise<{ ok?: boolean; trap?: string; error?: unknown; result?: unknown }> } | null {
    const k = (this.session as unknown as { kernel?: { request?: unknown } } | null)?.kernel;
    return k && typeof k.request === 'function' ? (k as never) : null;
  }
  /** Whether `scratchBuild` can run (a script run uses it for the batched path). */
  canScratchBuild(): boolean { return this.transport() !== null; }
  private scratchTag = `script-${Math.random().toString(36).slice(2, 8)}`;
  /**
   * Build `doc` on a scratch kernel state of its own: the open document, its history, the view and the store are untouched.
   * Without `view` the kernel skips tessellation, edge extraction and the mesh reply (`noView`), so only the errors come back;
   * with `view` the body comes too, for a script's selectors. The kernel's regen cache is keyed by the document, so a later
   * `load` of the same list finds it built. The document is completed with the defaults a loaded part has (the kernel's cache key
   * covers the material and the variables), or the later load would not find what was built here.
   */
  async scratchBuild(doc: PartDoc, view: boolean): Promise<{ errors: Array<[string, { code?: string; message?: string }]>; geometry?: { mesh: ReturnType<Controller['bodyFaces']>; edges: ViewEdge[]; box: { min: number[]; max: number[] } | null } }> {
    const k = this.transport();
    if (!k) throw new Error('no kernel');
    const r = await k.request({ type: 'regen', tag: this.scratchTag, part: { ...emptyPart('script'), ...doc }, ...(view ? {} : { opts: { noView: true } }) });
    if (r.trap || !r.ok || !r.result) throw new Error(r.trap ?? (typeof r.error === 'string' ? r.error : 'regen failed'));
    const res = r.result as { errors?: Array<[string, { code?: string; message?: string }]>; body?: Record<string, unknown> | null };
    const errors = res.errors ?? [];
    if (!view) return { errors };
    const body = res.body ?? null;
    if (!body) return { errors, geometry: { mesh: null, edges: [], box: null } };
    const { meshFromBody } = await import('@ck/mesh');
    const mesh = meshFromBody(body as Parameters<typeof meshFromBody>[0]) as unknown as ReturnType<Controller['bodyFaces']>;
    return { errors, geometry: { mesh: mesh && mesh.positions.length > 0 ? mesh : null, edges: (body.edges as ViewEdge[] | undefined) ?? [], box: (body.box as { min: number[]; max: number[] } | undefined) ?? null } };
  }
  /** Kernel answers about the document `scratchBuild` built last (a script's read-back: volume, area, centre of mass, validity). */
  async scratchFacts(need: { mass?: boolean; validate?: boolean; describe?: string[]; text?: { string: string; font?: string; height: number; spacing?: number } }): Promise<{ text?: never;  volume?: number | null; area?: number | null; com?: number[] | null; valid?: boolean | null; issues?: Array<{ code: string; entity: string; detail: string }>; faces?: Array<{ name: string; surface?: string; area?: number; radius?: number }> }> {
    const k = this.transport();
    if (!k) throw new Error('no kernel');
    const out: Awaited<ReturnType<Controller['scratchFacts']>> = {};
    if (need.text) {
      const r = await k.request({ type: 'textMetrics', ...need.text }) as { ok: boolean; result?: unknown; error?: { message?: string } | string };
      if (!r.ok) throw new Error(`text(): ${typeof r.error === 'string' ? r.error : r.error?.message ?? 'the kernel could not measure the text'}`);
      out.text = r.result as never;
    }
    if (need.mass) {
      const r = await k.request({ type: 'massProps', tag: this.scratchTag });
      const m = (r.ok ? r.result : null) as { volume?: number; area?: number; com?: number[] } | null;
      out.volume = m?.volume ?? null; out.area = m?.area ?? null; out.com = m?.com ?? null;
    }
    if (need.validate) {
      const r = await k.request({ type: 'validate', tag: this.scratchTag });
      const v = (r.ok ? r.result : null) as { ok?: boolean; issues?: Array<{ code: string; entity: string; detail: string }> } | null;
      out.valid = v ? v.ok === true : null; out.issues = v?.issues ?? [];
    }
    if (need.describe?.length) {
      const r = await k.request({ type: 'describe', tag: this.scratchTag, names: need.describe });
      const d = (r.ok ? r.result : null) as { items?: Array<{ name: string; surface?: string; area?: number; radius?: number }> } | null;
      out.faces = (d?.items ?? []).map((i) => ({ name: i.name, surface: i.surface, area: i.area, radius: i.radius }));
    }
    return out;
  }
  /** Drop the scratch state of `scratchBuild` (the kernel keeps a body per tag): the tag goes back to an empty part. */
  async scratchRelease(): Promise<void> {
    const k = this.transport();
    if (!k) return;
    await k.request({ type: 'regen', tag: this.scratchTag, part: { format: 'ck-part', version: 1, name: 'scratch', features: [], seq: 1, rollback: null }, opts: { noView: true } }).catch(() => null);
  }

  /** Changes to the document (edit, undo, redo, document patches) run one after the other: an undo pressed while an edit is
   *  still building waits for it instead of racing it in the session. `cancel` is deliberately not queued. */
  private chain: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** The session's edit records, oldest first (empty with no document). */
  history(): EditRecord[] { return this.session?.history() ?? []; }

  edit(ops: EditOp[], reason?: string): Promise<EditResult> { return this.serial(() => this.editNow(ops, reason)); }

  private async editNow(ops: EditOp[], reason?: string): Promise<EditResult> {
    const s = this.session;
    if (!s) throw new Error('no document loaded');
    const guarded = !this.unguarded;
    this.unguarded = false;
    const policy = guarded ? this.policy?.() ?? null : null;
    const blocking = policy && policy.blocking.length > 0 ? policy : null;
    // while rolled back, new features go in right after the marker
    const at = this.rollbackCount();
    const adds = ops.filter((o) => o.op === 'add' && o.index === undefined).length;
    ops = withRollbackInsert(ops, at);
    ops = syncNameOps(this.sdoc().features as unknown as Array<Record<string, unknown>>, ops, applyOpsLocal as never);
    this.store.busy.value = true;
    try {
      let result: EditResult;
      // Block rules compare against the part as it is now: the last check of this state, or one made first.
      const before = blocking ? await this.baselineFor(blocking) : null;
      try {
        result = await Promise.race([
          s.edit(ops, reason, { lean: true }),
          new Promise<never>((_, reject) => {
            this.pendingCancel = () => reject(new Error('cancelled'));
          }),
        ]);
      } catch (e) {
        if ((e as Error).message === 'cancelled') {
          return { ok: false, record: null, hints: [{ feature: '', code: 'cancelled', hint: 'regen cancelled' }] };
        }
        throw e;
      } finally {
        this.pendingCancel = null;
        this.snap = null;
      }
      if (!result.ok) {
        // the cause and its consequences, not every error joined into one wall of text
        let text = result.hints?.map((h) => h.hint).join('; ') || result.schemaError || 'edit failed';
        this.rejected = null;
        if (result.errors?.length) {
          const cand = applyOpsLocal(this.sdoc().features as unknown as Array<Record<string, unknown>>, ops) ?? this.sdoc().features;
          const diagnosis = this.diagnoseErrors(result.errors, result.hints ?? [], cand);
          const summary = summaryLine(diagnosis);
          if (summary) { text = summary; this.rejected = { diagnosis, summary, at: Date.now() }; }
        }
        this.store.notify(text, 'error');
        return result;
      }
      this.rejected = null;
      this.redoStack = [];
      // the marker moves past what was just inserted
      if (at !== null && adds) this.rollbackAnchor = this.sdoc().features[at + adds - 1]?.id ?? this.rollbackAnchor;
      await this.refresh();
      if (blocking && before) {
        const blocked = await this.blockCheck(blocking, before);
        if (blocked) {
          // Same path as a failed edit: the part goes back, the history has no record, the shell logs a rejection.
          await s.undo();
          this.snap = null;
          await this.refresh();
          this.store.notify(blocked, 'error');
          return { ok: false, record: null, hints: [{ feature: '', code: 'designCheckBlocked', hint: blocked }] };
        }
      } else if (policy?.afterEdit) this.scheduleAfterEdit();
      const warn = (ws: Array<{ code: string; feature?: string; reason?: string }>): void => {
        for (const w of ws) this.store.notify(`refDiff ${w.code}${w.feature ? ` on ${w.feature}` : ''}${w.reason ? `: ${w.reason}` : ''}`, 'warn');
      };
      warn(result.refWarnings ?? []);
      // the reference check regenerates both documents: it reports when it is done, the edit is already on screen
      void result.refWarningsLater?.then(warn).catch(() => {});
      return result;
    } finally {
      this.store.busy.value = false;
    }
  }

  /** Speculative edit: shows the candidate body, leaves document and history untouched.
   *  Debounced ~150 ms; a newer preview supersedes an older one (stale:true, body dropped). */
  async preview(ops: EditOp[], delayMs = 150): Promise<PreviewResult & { hint?: string; diagnosis?: Diagnosis | null }> {
    const seq = ++this.previewSeq;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewWake?.();
    await new Promise<void>((resolve) => {
      this.previewWake = resolve;
      this.previewTimer = setTimeout(() => { this.previewTimer = null; resolve(); }, delayMs);
    });
    this.previewWake = null;
    if (seq !== this.previewSeq) {
      return { ok: true, errors: [], hints: [], body: null, stale: true };
    }
    this.previewTimer = null;
    const s = this.session;
    if (!s) return { ok: false, errors: [], hints: [], body: null, schemaError: 'no document loaded' };
    const upTo = this.rollbackCount();
    const r = await s.preview(ops, upTo === null ? undefined : { upTo });
    if (seq !== this.previewSeq) {
      return { ok: true, errors: [], hints: [], body: null, stale: true };
    }
    if (r.stale) return r;
    if (r.ok && r.body) {
      // the candidate's features, worked out here (an op it cannot apply, like a move, falls back to the committed ones)
      const cand = applyOpsLocal(this.sdoc().features as unknown as Array<Record<string, unknown>>, ops) ?? this.sdoc().features;
      // the preview's own reply carries the surface bodies and thread markers: no second regen of the candidate
      const surfaces = r.surfaces !== undefined ? (hasSurfaceFeatures(cand as never) ? toViewSurfaces(r.surfaces) : []) : await this.surfacesFor(s, { ...this.sdoc(), features: cand } as unknown as PartDoc, upTo, '-psurf');
      if (seq !== this.previewSeq) return { ok: true, errors: [], hints: [], body: null, stale: true };
      this.view.setBody(withSurfaces(r.body, surfaces));
      await this.previewExtras(s, ops, seq, r.threads || r.warnings ? { threads: r.threads ?? [], warnings: r.warnings ?? [] } : undefined);
      return r;
    }
    const cand = applyOpsLocal(this.sdoc().features as unknown as Array<Record<string, unknown>>, ops) ?? this.sdoc().features;
    const diagnosis = r.errors?.length ? this.diagnoseErrors(r.errors, r.hints ?? [], cand) : null;
    // one short sentence about the cause instead of every error joined (the full list is in `diagnosis`)
    const hint = (diagnosis ? summaryLine(diagnosis) : '') || r.schemaError || 'preview failed';
    return { ...r, hint, diagnosis };
  }

  /**
   * Warnings and cosmetic threads of a regen. The Session reports only `errors` today (verify() and preview() drop the
   * rest of the regen reply), so when the document has a thread feature this asks the kernel for the reply itself; with a
   * Session that passes `threads` / `warnings` through, `report.regen` already has them and no request is made.
   */
  private async regenExtras(s: Session, doc: PartDoc, tag: string, from?: { threads?: unknown[]; warnings?: unknown[] }): Promise<{ threads: unknown[]; warnings: unknown[] }> {
    if (from && (from.threads || from.warnings)) return { threads: from.threads ?? [], warnings: from.warnings ?? [] };
    if (!doc.features.some((f) => (f as { type?: string }).type === 'thread')) return { threads: [], warnings: [] };
    try {
      const k = (s as unknown as { kernel?: { request(m: unknown): Promise<{ ok?: boolean; result?: unknown }> } }).kernel;
      const modeled = doc.features.some((f) => (f as { type?: string; modeled?: unknown }).type === 'thread' && (f as { modeled?: unknown }).modeled === true);
      const t0 = Date.now();
      const r = await k?.request({ type: 'regen', tag, part: doc });
      if (modeled && r?.ok) saveThreadPrefs({ modeledMs: Date.now() - t0 });   // remembered: the editor's "about N s to rebuild" note
      const res = (r?.ok ? r.result : null) as { threads?: unknown[]; warnings?: unknown[] } | null;
      return { threads: res?.threads ?? [], warnings: res?.warnings ?? [] };
    } catch { return { threads: [], warnings: [] }; }
  }
  private rejected: { diagnosis: Diagnosis; summary: string; at: number } | null = null;
  /** The last edit the kernel refused because it broke the model (the model itself is unchanged); null after the next successful edit or load. */
  rejection(): { diagnosis: Diagnosis; summary: string; at: number } | null { return this.rejected; }
  private committedDiag: Diagnosis = diagnose([], []);
  /** The roots and consequences of the committed model's last regen (empty when it built cleanly). */
  diagnosis(): Diagnosis { return this.committedDiag; }
  private diagnoseErrors(errors: Array<[string, { code: string; params?: Record<string, unknown> }]>, hints: Array<{ feature: string; code: string; hint: string }>, features: unknown): Diagnosis {
    return diagnose(errors.map(([id, e]) => ({ id, code: e.code, params: e.params, hint: hints.find((h) => h.feature === id && h.code === e.code)?.hint })), features as DiagFeature[]);
  }
  private committedExtras: { threads: unknown[]; warnings: unknown[] } = { threads: [], warnings: [] };
  private shownThreads: unknown[] = [];
  private applyExtras(x: { threads: unknown[]; warnings: unknown[] }): void {
    this.shownThreads = x.threads;
    this.view.setThreads?.(x.threads);
    this.store.featureWarnings.value = warningsById(x.warnings);
  }
  /** After a preview of an edit that touches a thread: the warnings and markers of the candidate (restored by cancelPreview / the next refresh). */
  private async previewExtras(s: Session, ops: EditOp[], seq: number, reply?: { threads: unknown[]; warnings: unknown[] }): Promise<void> {
    const feats = applyOpsLocal(this.sdoc().features as unknown as Array<Record<string, unknown>>, ops);
    const hasThread = (feats ?? []).some((f) => f.type === 'thread');
    if (feats && !hasThread && this.committedExtras.threads.length) { this.applyExtras({ threads: [], warnings: [] }); return; }   // the candidate removes the last thread
    if (!feats || !hasThread) { if (this.store.featureWarnings.value && Object.keys(this.store.featureWarnings.value).length) this.applyExtras(this.committedExtras); return; }
    const x = reply ?? (await this.regenExtras(s, { ...this.sdoc(), features: feats } as unknown as PartDoc, `${this.previewTagOf(s)}-x`));
    if (seq !== this.previewSeq) return;
    this.applyExtras(x);
  }
  private previewTagOf(s: Session): string { return (s as unknown as { tag?: string }).tag ?? 'main'; }

  private threadCache: { standards?: ThreadStd[]; sizes: Map<string, ThreadRow[]> } = { sizes: new Map() };
  /** The thread standards (cached: the tables never change within a kernel). Empty when there is no document. */
  async threadStandards(): Promise<ThreadStd[]> {
    if (this.threadCache.standards) return this.threadCache.standards;
    const s = this.session;
    if (!s) return [];
    const r = await s.threadData();
    this.threadCache.standards = (r.standards ?? []) as ThreadStd[];
    return this.threadCache.standards;
  }
  /** The sizes of one standard with all numbers (cached per standard). */
  async threadSizes(standard: string): Promise<ThreadRow[]> {
    const hit = this.threadCache.sizes.get(standard);
    if (hit) return hit;
    const s = this.session;
    if (!s) return [];
    const r = await s.threadData(standard);
    const rows = (r.sizes ?? []) as ThreadRow[];
    this.threadCache.sizes.set(standard, rows);
    return rows;
  }
  /** One size row, or null when the standard / size is unknown. */
  async threadRow(standard: string, size: string): Promise<ThreadRow | null> {
    return (await this.threadSizes(standard).catch(() => [])).find((r) => r.size === size) ?? null;
  }
  /** The markers and warnings of the last committed state, as the last refresh saw them. */
  threadsNow(): unknown[] { return this.committedExtras.threads; }
  /** The markers of what is on screen now: the committed ones, or the candidate of a preview in progress. */
  threadsShown(): unknown[] { return this.shownThreads; }

  /** Drop a pending/committed preview: restore the last good body, no edit record. */
  async cancelPreview(): Promise<void> {
    this.applyExtras(this.committedExtras);
    this.previewSeq++;
    if (this.previewTimer) { clearTimeout(this.previewTimer); this.previewTimer = null; }
    this.previewWake?.();
    this.previewWake = null;
    const s = this.session;
    if (!s) return;
    const body = await this.bodyNow(s).catch(() => null);
    this.view.setBody(body);
  }

  /** Commit the editor draft as exactly one edit record (one batch). */
  async commit(ops: EditOp[], reason?: string): Promise<EditResult> {
    this.previewSeq++;
    if (this.previewTimer) { clearTimeout(this.previewTimer); this.previewTimer = null; }
    this.previewWake?.();
    this.previewWake = null;
    return this.edit(ops, reason);
  }

  undo(): Promise<void> { return this.serial(() => this.undoNow()); }

  /** The session's undo stack (its private `before` documents), when it has one: the guard below and `cancel` read it. */
  private stackOf(s: Session | null): Array<{ record: EditRecord; before: PartDoc }> | null {
    const st = (s as unknown as { stack?: unknown } | null)?.stack;
    return Array.isArray(st) ? (st as Array<{ record: EditRecord; before: PartDoc }>) : null;
  }

  /** Diagnostics of the last refused undo (history lengths, feature counts), for the diagnostics card. */
  lastUndoProblem: string | null = null;
  /** Called with the document just before every undo takes effect (the app keeps a snapshot of it: the safety net). */
  beforeUndo: ((doc: PartDoc) => void) | null = null;

  private async undoNow(): Promise<void> {
    const s = this.session;
    if (!s) return;
    // a sketch is open: Undo takes back its last tool step, it never changes the part under the open sketch
    if (this.sketchOpen) { await this.undoSketch(); return; }
    const last = this.materialSteps[this.materialSteps.length - 1];
    if (last && last.at === s.history().length) {   // the newest change is a material change: it is the one step undone
      this.materialSteps.pop(); this.material = last.before; this.redoStack.push(last);
      return;
    }
    // An undo takes back exactly one step. If the step it would restore has far fewer features than the part has now (more
    // than that step's own adds), the history and the part disagree: leave the part alone and say so.
    const st = this.stackOf(s);
    const top = st?.[st.length - 1];
    if (top) {
      const now = this.sdoc().features.length, then = top.before.features.length;
      if (then < now - Math.max(top.record.ops.length, 1)) {
        this.lastUndoProblem = `undo refused: part has ${now} features, the step before ${top.record.id} has ${then}; ${top.record.ops.length} ops; history ${st!.length}; redo ${this.redoStack.length}; material steps ${this.materialSteps.length}`;
        this.store.notify(t('app.notice.undoFailed'), 'error');
        return;
      }
    }
    try { this.beforeUndo?.(this.sdoc()); } catch { /* a failing snapshot never blocks the undo */ }
    this.store.busy.value = true;
    try {
      const { records } = await s.undo();
      this.snap = null;
      // Session has no forward stack: replay these ops to redo.
      for (const rec of records) this.redoStack.push(this.docSteps.get(rec.id) ?? rec.ops);
      await this.refresh();
    } finally {
      this.store.busy.value = false;
    }
  }

  redo(): Promise<void> { return this.serial(() => this.redoNow()); }

  private async redoNow(): Promise<void> {
    const ops = this.redoStack.pop();
    if (!ops || !this.session) return;
    if (!Array.isArray(ops) && 'patch' in ops) { const rest = this.redoStack; try { await this.applyDocPatchNow(ops.patch, ops.reason); } finally { this.redoStack = rest; } return; }
    if (!Array.isArray(ops)) { this.materialSteps.push({ ...ops, at: this.session.history().length }); this.material = ops.after; return; }
    // edit() clears the redo stack on success; keep the remaining entries.
    const rest = this.redoStack;
    try {
      await this.editNow(ops, 'redo');
    } finally {
      this.redoStack = rest;
    }
  }

  // ---- sketch session (S1): open a sketch, drag with the solver, confirm/cancel ----

  private sketchOpen: { featureId: string; upTo: number; draft: SketchDraft; baselineDof: number | null; isNew: boolean; undo: SketchDraft[]; status: SketchSolverStatus | null } | null = null;
  private sketchTimer: ReturnType<typeof setTimeout> | null = null;
  private sketchWake: (() => void) | null = null;
  private sketchSeq = 0;
  /** The preview now running in the kernel worker. The worker runs every request it is sent, so a newer
   *  drag must wait for this one instead of queueing behind it: only the latest waiting drag ever runs. */
  private sketchInflight: Promise<unknown> | null = null;

  /** Open a sketch feature for editing: solve it as of its place in the tree (the
   *  features after it are cut off with `upTo`) and hand the viewport the solved
   *  sketch and its plane frame. Returns null when the feature is missing or not a
   *  sketch. The document, the edit stack and the displayed body are untouched. */
  async beginSketch(featureId: string): Promise<SketchEditView | null> {
    const s = this.session;
    if (!s) return null;
    const features = this.sdoc().features;
    const index = features.findIndex((f) => f.id === featureId);
    if (index < 0) return null;
    const feature = features[index] as unknown as Record<string, unknown>;
    if (feature.type !== 'sketch') return null;
    const draft = fromFeature(feature);
    this.sketchOpen = { featureId, upTo: index + 1, draft, baselineDof: null, isNew: false, undo: [], status: null };
    this.sketchSeq++;
    const res = await this.previewSketch(draft, index + 1, false);
    if (!res.ok || !res.view) { this.sketchOpen = null; return null; }
    this.sketchOpen.baselineDof = res.status?.dof ?? null;
    this.sketchOpen.status = res.status ?? null;
    this.showSketch(res.view);
    return res.view;
  }

  /** Start a new, empty sketch on a standard plane at the end of the tree. Nothing is written until
   *  commitSketch: cancelling leaves the document exactly as it was. */
  async beginNewSketch(plane: 'front' | 'top' | 'right' | { kind: 'face' | 'feature'; id: string } = 'front'): Promise<SketchEditView | null> {
    const s = this.session;
    if (!s) return null;
    const id = `F${this.sdoc().seq}`;
    const draft = fromFeature({
      type: 'sketch', id, name: typeof plane === 'string' || plane.kind === 'feature' ? t('app.sketch.defaultName', { plane: refLabel(this.sdoc(), typeof plane === 'string' ? { kind: 'std', id: plane } : plane) }) : 'Sketch', plane: typeof plane === 'string' ? { kind: 'std', id: plane } : plane,
      points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [],
    });
    const upTo = (this.rollbackCount() ?? this.sdoc().features.length) + 1;
    this.sketchOpen = { featureId: id, upTo, draft, baselineDof: null, isNew: true, undo: [], status: null };
    this.sketchSeq++;
    const res = await this.previewSketch(draft, upTo, true);
    if (!res.ok || !res.view) { this.sketchOpen = null; return null; }
    this.sketchOpen.baselineDof = res.status?.dof ?? null;
    this.sketchOpen.status = res.status ?? null;
    this.showSketch(res.view);
    return res.view;
  }

  /** A sketch tool produced a new draft: it becomes the draft at once (so the next tool step builds on it),
   *  the previous one goes on the sketch's own undo stack, and the kernel solves and previews it. */
  async applySketchDraft(draft: SketchDraft): Promise<SketchPreview> {
    const open = this.sketchOpen;
    if (!open) return { ok: false, hint: 'no sketch open' };
    open.undo.push(open.draft);
    open.draft = draft;
    return this.updateSketch(draft, 0);
  }

  /** Undo the last tool edit in the open sketch. False when there is nothing to undo. */
  async undoSketch(): Promise<boolean> {
    const open = this.sketchOpen;
    const prev = open?.undo.pop();
    if (!open || !prev) return false;
    open.draft = prev;
    await this.updateSketch(prev, 0);
    return true;
  }

  /** Drag a point: preview the pinned draft on the sketch's own partial regen.
   *  Debounced ~100 ms; a newer drag supersedes an older one (stale:true, no view).
   *  On failure the previous good sketch stays on screen and `hint` says why. */
  async updateSketch(draft: SketchDraft, delayMs = 100): Promise<SketchPreview> {
    const seq = ++this.sketchSeq;
    if (this.sketchTimer) clearTimeout(this.sketchTimer);
    this.sketchWake?.();
    let wake: () => void = () => {};
    await new Promise<void>((resolve) => {
      wake = resolve;
      this.sketchWake = resolve;
      this.sketchTimer = setTimeout(() => { this.sketchTimer = null; resolve(); }, delayMs);
    });
    if (this.sketchWake === wake) this.sketchWake = null;
    if (seq !== this.sketchSeq) return { ok: true, stale: true };
    this.sketchTimer = null;
    const open = this.sketchOpen;
    if (!open) return { ok: false, hint: 'no sketch open' };
    while (this.sketchInflight) {
      await this.sketchInflight.catch(() => {});
      if (seq !== this.sketchSeq) return { ok: true, stale: true };
    }
    const running = this.previewSketch(draft, open.upTo, open.isNew);
    this.sketchInflight = running;
    let res: Awaited<typeof running>;
    try { res = await running; } finally { if (this.sketchInflight === running) this.sketchInflight = null; }
    if (seq !== this.sketchSeq) return { ok: true, stale: true };
    // A drag the solver could not absorb comes back as a successful regen that
    // echoes the sketch unsolved (status.solved false): refuse it, keep the
    // last good solved sketch on screen (the point snaps back).
    if (draft.temp.length && res.status && res.status.solved === false) {
      const hint = open.baselineDof === 0 ? 'app.sketch.fullyDefined' : 'app.sketch.conflict';
      open.status = res.status ?? open.status;
      return { ok: false, hint, status: res.status };
    }
    if (res.ok && res.view) {
      open.status = res.status ?? null;
      // Fold the solver's result into the draft: regen only re-solves on expr
      // changes, so the committed sketch must carry the solved coordinates.
      open.draft = foldSolution(draft, res.view.sketch);
      this.showSketch(res.view);
      return { ok: true, view: res.view, status: res.status };
    }
    return { ok: false, hint: res.hint, status: res.status };
  }

  /** Commit the open sketch as exactly one replace edit (the temporary drag fix is
   *  dropped) and close the sketch overlay. Null when no sketch is open. */
  async commitSketch(): Promise<EditResult | null> {
    const open = this.sketchOpen;
    if (!open) return null;
    this.sketchOpen = null;
    this.closeSketchPreview();
    this.view.setSketchEdit(null);
    const feature = toFeature(open.draft);
    this.skipGuardOnce();
    return this.edit([open.isNew ? { op: 'add', feature } : { op: 'replace', id: open.featureId, feature }], open.isNew ? 'new sketch' : 'sketch');
  }

  private sketchFrameNow: ViewFrame | null = null;
  private showSketch(v: SketchEditView): void {
    this.sketchFrameNow = v.frame;
    this.view.setSketchEdit(v);
    // lettering: the outlines come from the kernel; draw the sketch again when they have arrived
    void ensureTextOutlines(v.sketch as never, (spec) => this.fetchTextOutline(spec), () => { if (this.sketchOpen && this.sketchFrameNow === v.frame) this.view.setSketchEdit(v); this.onTextOutlines?.(); }).catch(() => {});
  }

  /** Called when new text outlines arrived (the app redraws its panel and highlight). */
  onTextOutlines: (() => void) | null = null;
  /** The kernel's polylines for a text entity (docs/text.md, textOutline). Throws the kernel's message. */
  async fetchTextOutline(spec: Record<string, unknown>): Promise<TextOutlineData> {
    const k = this.transport();
    if (!k) throw new Error('no kernel');
    const r = await k.request({ type: 'textOutline', ...spec }) as { ok: boolean; result?: unknown; error?: { message?: string } | string };
    if (!r.ok) throw new Error(typeof r.error === 'string' ? r.error : r.error?.message ?? 'textOutline failed');
    return r.result as TextOutlineData;
  }
  /** The plane frame of the open sketch (null when none is open). */
  sketchFrame(): ViewFrame | null {
    return this.sketchOpen ? this.sketchFrameNow : null;
  }

  /** The solver's verdict on the open sketch (degrees of freedom, conflicts), from the last preview. */
  sketchStatus(): SketchSolverStatus | null {
    return this.sketchOpen?.status ?? null;
  }

  /** Ask the solver about a draft without touching the session: nothing is shown, nothing goes on the undo stack. Used to
   *  suggest constraints (Fully Define) and to find out how defined each entity is. Null when no sketch is open or the
   *  regen gave no verdict. */
  async probeSketch(draft: SketchDraft): Promise<SketchSolverStatus | null> {
    const open = this.sketchOpen;
    if (!open) return null;
    const r = await this.previewSketch(draft, open.upTo, open.isNew);
    return r.status ?? null;
  }

  /** The draft being edited in the open sketch session (null when none). The
   *  shell drags on top of this so folds from earlier drags are kept. */
  sketchDraft(): SketchDraft | null {
    return this.sketchOpen?.draft ?? null;
  }

  /** Close the sketch overlay without writing anything. */
  async cancelSketch(): Promise<void> {
    this.sketchOpen = null;
    this.closeSketchPreview();
    this.view.setSketchEdit(null);
  }

  private closeSketchPreview(): void {
    this.sketchSeq++;
    if (this.sketchTimer) { clearTimeout(this.sketchTimer); this.sketchTimer = null; }
    this.sketchWake?.();
    this.sketchWake = null;
  }

  /** Speculative regen of the sketch on its partial upTo tag; no document write. */
  private async previewSketch(draft: SketchDraft, upTo: number, isNew = false): Promise<{ ok: boolean; view?: SketchEditView; hint?: string; status?: SketchSolverStatus }> {
    const s = this.session;
    if (!s) return { ok: false, hint: 'no document loaded' };
    const feature = toFeature(draft, { includeTemp: true });
    const r = await s.preview([isNew ? { op: 'add', feature, index: upTo - 1 } : { op: 'replace', id: draft.id, feature }], { upTo, solveSketches: true });
    // a prefix with no solid yet (a first sketch) has no body but still carries its sketches
    const sketches = r.body?.sketches ?? r.sketches;
    if (r.ok && sketches) {
      const entry = sketches.find((x) => x.id === draft.id);
      if (entry) return { ok: true, view: { featureId: draft.id, frame: entry.frame, sketch: entry.sketch, status: entry.status }, status: entry.status };
      return { ok: false, hint: 'sketch missing from the regen reply' };
    }
    const hint = r.hints?.map((h) => h.hint).join('; ') || r.schemaError || 'sketch did not solve';
    return { ok: false, hint };
  }

  /** Change the variables, the configurations or both (with the features a rename rewrites) as one undo step. The kernel rebuilds the
   *  candidate first; on failure nothing changes and the features that failed are returned. */
  applyDocPatch(patch: DocPatch, reason: string): Promise<{ ok: true } | { ok: false; errors: Array<{ feature: string; code: string }> }> { return this.serial(() => this.applyDocPatchNow(patch, reason)); }
  private async applyDocPatchNow(patch: DocPatch, reason: string): Promise<{ ok: true } | { ok: false; errors: Array<{ feature: string; code: string }> }> {
    const s = this.session;
    if (!s) return { ok: false, errors: [] };
    this.store.busy.value = true;
    try {
      const r = await setDocFields(s, patch, reason);
      if (!r.ok) { this.store.notify(r.errors.map((e) => `${e.feature}: ${e.code}`).join('; ') || 'rebuild failed', 'error'); return r; }
      this.docSteps.set(r.record.id, { patch, reason });
      this.redoStack = [];
      await this.refresh();
      return { ok: true };
    } finally {
      this.store.busy.value = false;
    }
  }

  document(): PartDoc | null {
    const d = this.session ? this.sdoc() : null;
    if (!d) return d;
    const extra = Object.keys(this.docExtra).length ? this.docExtra : null;
    if (this.docName === null && this.material === null && !extra) return d;
    const m = this.merged;
    if (m && m.base === d && m.name === this.docName && m.material === this.material && m.extraRev === this.extraRev) return m.out;
    const out = { ...d, ...(this.docName !== null ? { name: this.docName } : {}), ...(this.material !== null ? { material: this.material } : {}), ...(extra ? structuredClone(extra) : {}) } as PartDoc;
    this.merged = { base: d, name: this.docName, material: this.material, extraRev: this.extraRev, out };
    return out;
  }
  /** The document with the app-level name, material and viewer fields applied, kept while none of them (nor the session's document) changed. */
  private merged: { base: PartDoc; name: string | null; material: string | null; extraRev: number; out: PartDoc } | null = null;
  private extraRev = 0;

  /** Keep a viewer-state field (the exploded view) in the document; `null` removes it. Not a history step and no rebuild. */
  setDocExtra(key: string, value: unknown | null): void {
    this.extraRev++;
    this.extraRev++;
    if (value === null) delete this.docExtra[key]; else this.docExtra[key] = structuredClone(value);
  }

  /** The kernel's `drawing` request for the current state, for the Drawings workspace (null with no document). */
  drawingQuery(): DrawingQuery | null { return this.session ? drawingQuery(this.session) : null; }

  /** Components of the assembly as the kernel reported them at the last rebuild: id, remaining degrees of freedom (0 = fixed or fully mated), placement. */
  components(): AsmComponent[] { return this.asmComponents; }

  /** The `assembly` report of the last regen (total and per-component freedom, redundant and conflicting mates) and the detail of rejected features. */
  assemblyExtra(): AsmExtra { return this.asmExtra; }

  /** Volume (mm3, unit density) and solid count of a part document, asked of the kernel under a tag of its own so the open document is untouched. */
  async partMass(part: unknown): Promise<{ volume: number | null; error?: string }> {
    const s = this.session;
    return s ? partMassProps(s, part) : { volume: null, error: 'no document loaded' };
  }

  /** Set the part's material (its name, e.g. "Mild steel"). One undo step, in order with the session's edits; the session has no
   *  document-level op, so the name lives here and is applied to `document()` (so Save, autosave and Inspect see it).
   *  Returns false when the name is empty or already the material. */
  setMaterial(name: string): boolean {
    const s = this.session;
    const n = name.trim();
    if (!s || !n) return false;
    const before = this.document()?.material ?? null;
    if (before === n) return false;
    this.materialSteps.push({ at: s.history().length, before: this.material, after: n });
    this.material = n;
    this.redoStack = [];
    return true;
  }

  /** Rename the part. The session has no document-level op, so the name lives here and is applied to `document()`
   *  (so Save and the top bar see it); it is not an undo step. */
  setPartName(name: string): void {
    const n = name.trim();
    if (this.session && n) this.docName = n;
  }

  /** How many features the rollback marker lets through (null = the whole model). */
  rollbackCount(): number | null {
    return countOf(this.rollbackAnchor, (this.session ? this.sdoc().features : []).map((f) => f.id));
  }

  /** Move the rollback marker: show the model as it was after the first `count` features (null = roll forward to the end).
   *  The document and history are untouched; features after the marker are not built. */
  async setRollback(count: number | null): Promise<void> {
    const s = this.session;
    if (!s) return;
    const ids = this.sdoc().features.map((f) => f.id);
    this.rollbackAnchor = count === null || count >= ids.length ? null : count <= 0 ? '' : ids[count - 1];
    this.store.busy.value = true;
    try { await this.refresh(); } finally { this.store.busy.value = false; }
  }

  /** Delete these features (those that depend on one of them go too only when they are selected as well; otherwise the
   *  session refuses and says what still uses it). */
  async deleteFeatures(ids: string[]): Promise<EditResult | null> {
    const s = this.session;
    if (!s || !ids.length) return null;
    const ops = deleteOps(this.sdoc().features as unknown as Array<{ id: string }>, ids);
    return ops.length ? this.edit(ops, `delete ${ids.join(', ')}`) : null;
  }

  /** Build everything again from the document. (The kernel keeps no regen cache, so every build is already a full one.) */
  async rebuild(): Promise<void> {
    if (!this.session) return;
    this.store.busy.value = true;
    try { await this.refresh(); } finally { this.store.busy.value = false; }
  }

  /** Names of every face, edge or corner on screen, for Select all. */
  pickableNames(mode: 'face' | 'edge' | 'vertex' | 'body'): string[] {
    const v = this.lastView;
    if (!v) return [];
    if (mode === 'body') return this.selModel()?.bodies().map((x) => x.name) ?? [];
    if (mode === 'face') return [...new Set<string>((v as unknown as { mesh?: { faceIds?: string[] } }).mesh?.faceIds ?? [])];
    const edges = v.edges ?? [];
    if (mode === 'edge') return edges.flatMap((e) => (e.key ? [e.key] : []));
    const out = new Set<string>();
    for (const e of edges) for (const p of [e.pts?.[0], e.pts?.[e.pts.length - 1]]) if (p) out.add(vertexName(p));
    return [...out];
  }

  /** Show the solid of a STEP file in the viewport (view only: it is not a feature of the part and the next edit replaces it). */
  async importStep(text: string, name: string): Promise<StepImportResult> {
    if (!this.session) return { ok: false, code: 'noSession', message: 'no document loaded' };
    this.store.busy.value = true;
    try {
      const r = await importStepView(this.session, text, name);
      if (r.ok) { this.view.setBody(r.view); this.importedOnScreen = true; }
      return r;
    } finally { this.store.busy.value = false; }
  }

  /** Show the solid of a SolidWorks .SLDPRT file in the viewport (view only, like STEP). */
  async importSldprt(bytes: Uint8Array, name: string): Promise<StepImportResult> {
    if (!this.session) return { ok: false, code: 'noSession', message: 'no document loaded' };
    this.store.busy.value = true;
    try {
      const r = await importSldprtView(this.session, bytes, name);
      if (r.ok) { this.view.setBody(r.view); this.importedOnScreen = true; }
      return r;
    } finally { this.store.busy.value = false; }
  }

  features(): Array<{ id: string; type: string; name?: string }> {
    return this.session
      ? this.sdoc().features.map((f) => ({ id: f.id, type: f.type, name: f.name }))
      : [];
  }

  /** The design-check policy now in force (rule modes, limits), or null for none. The app sets it. */
  policy: (() => CheckPolicy | null) | null = null;
  /** Called with every finished policy check (after an edit), for the panel and the status chip. */
  onCheck: ((r: { report: ProfileReport; revision: number; policy: CheckPolicy }) => void) | null = null;
  private unguarded = false;
  private baseline: { revision: number; key: string; issues: Issue[] } | null = null;
  private afterTimer: ReturnType<typeof setTimeout> | null = null;
  private afterRunning = false;
  private afterAgain = false;

  /** The next edit is not subject to Block rules (sketch confirmations). */
  private skipGuardOnce(): void { this.unguarded = true; }

  private async rawCheck(profile: string | Record<string, unknown>, opts?: { samples?: number; maxIssues?: number }): Promise<ProfileReport | null> {
    const s = this.session;
    if (!s) return null;
    try { return await s.checkProfile(profile, opts); } catch (e) { this.store.notify((e as Error).message, 'error'); return null; }
  }

  private async baselineFor(p: CheckPolicy): Promise<Issue[] | null> {
    const key = JSON.stringify(p.profile);
    if (this.baseline && this.baseline.revision === this.revision && this.baseline.key === key) return this.baseline.issues;
    const report = await this.rawCheck(p.profile);
    if (!report) return null;
    this.baseline = { revision: this.revision, key, issues: report.issues };
    return report.issues;
  }

  /** After an edit: the message to reject it with when a Block rule has new violations, else null (and the result is the new baseline). */
  private async blockCheck(p: CheckPolicy, before: Issue[]): Promise<string | null> {
    const report = await this.rawCheck(p.profile);
    if (!report) return null;
    const fresh = blockedIssues(before, report.issues, p.blocking);
    if (fresh.length) return blockMessage(fresh, p.titles);
    this.baseline = { revision: this.revision, key: JSON.stringify(p.profile), issues: report.issues };
    this.onCheck?.({ report, revision: this.revision, policy: p });
    return null;
  }

  /** Run the active profile shortly after the last edit; never two at once (a second request waits and reruns once). */
  private scheduleAfterEdit(delayMs = 400): void {
    if (this.afterTimer) clearTimeout(this.afterTimer);
    this.afterTimer = setTimeout(() => { this.afterTimer = null; void this.runAfterEdit(); }, delayMs);
  }
  private async runAfterEdit(): Promise<void> {
    if (this.afterRunning) { this.afterAgain = true; return; }
    const p = this.policy?.();
    if (!p || !p.afterEdit) return;
    this.afterRunning = true;
    try {
      const r = await this.checkProfile(p.profile);
      if (r) {
        this.baseline = { revision: r.revision, key: JSON.stringify(p.profile), issues: r.report.issues };
        this.onCheck?.({ report: r.report, revision: r.revision, policy: p });
      }
    } finally {
      this.afterRunning = false;
      if (this.afterAgain) { this.afterAgain = false; this.scheduleAfterEdit(0); }
    }
  }

  /** Counts the documents shown so far; a design-check result carries the number it was made for and is stale once it moves. */
  revision = 0;
  private profileList: ProfileList | null = null;

  /** The built-in design-rule profiles and their rule parameters (asked once, then kept). Null without a document or on a kernel error. */
  async profiles(): Promise<ProfileList | null> {
    if (this.profileList) return this.profileList;
    const s = this.session;
    if (!s) return null;
    try { this.profileList = await s.profiles(); } catch (e) { this.store.notify((e as Error).message, 'error'); return null; }
    return this.profileList;
  }

  /** Run a design-rule profile (built-in id or inline rules) on the part. Only when asked: never part of a rebuild.
   *  Shows the busy state and can be cancelled like a rebuild. `null` when cancelled, without a document or on a kernel error. */
  async checkProfile(profile: string | Record<string, unknown>, opts?: { samples?: number; maxIssues?: number }): Promise<{ report: ProfileReport; revision: number } | null> {
    const s = this.session;
    if (!s) return null;
    const revision = this.revision;
    this.store.busy.value = true;
    try {
      const report = await Promise.race([
        s.checkProfile(profile, opts),
        new Promise<never>((_, reject) => { this.pendingCancel = () => reject(new Error('cancelled')); }),
      ]);
      return { report, revision };
    } catch (e) {
      if ((e as Error).message !== 'cancelled') this.store.notify((e as Error).message, 'error');
      return null;
    } finally {
      this.pendingCancel = null;
      this.store.busy.value = false;
    }
  }

  async cancel(): Promise<void> {
    this.pendingCancel?.();
    this.pendingCancel = null;
    this.kernel.cancel?.();
    if (!this.session) return;
    this.store.busy.value = true;
    try {
      // The new session starts with no history: carry the old one's undo stack over, cut back to the state that is shown
      // (a cancelled undo has already taken its step off the old stack, so then the old session's own document is the one).
      const old = this.session;
      const oldStack = this.stackOf(old);
      const keep = this.lastGoodHistory;
      const stale = oldStack !== null && oldStack.length < keep;
      const doc = stale ? old.document : this.lastGood ?? this.sdoc();
      const fresh = await this.kernel.open(doc);
      const freshStack = this.stackOf(fresh);
      if (oldStack && freshStack) {
        freshStack.push(...oldStack.slice(0, stale ? oldStack.length : keep));
        const seq = (old as unknown as { editSeq?: number }).editSeq;
        if (typeof seq === 'number') (fresh as unknown as { editSeq: number }).editSeq = seq;
      }
      this.session = fresh;
      this.snap = null;
      await this.refresh();
    } finally {
      this.store.busy.value = false;
    }
  }

  /** The last body handed to the viewer, with its surface bodies kept apart (`lastView` has them merged in). */
  private shown: ShownBody | null = null;
  /** The last body handed to the viewer (its box and sketch frames), for choosing sensible defaults. */
  private lastView: { box: { min: number[]; max: number[] }; sketches: Array<{ id: string; frame: { o: number[]; x?: number[]; y?: number[]; z: number[] } }>; edges?: ViewEdge[]; mesh?: { positions: ArrayLike<number>; normals?: ArrayLike<number>; triFace?: ArrayLike<number>; faceIds?: string[] } } | null = null;

  /** The plane frame (origin and three unit axes) of a sketch of the body on screen: where the size box puts a shape's profile. */
  sketchFrameOf(sketchId: string): { o: [number, number, number]; x: [number, number, number]; y: [number, number, number]; z: [number, number, number] } | null {
    const f = this.lastView?.sketches.find((x) => x.id === sketchId)?.frame;
    if (!f || !f.x || !f.y) return null;
    const v3 = (a: number[]): [number, number, number] => [a[0], a[1], a[2]];
    return { o: v3(f.o), x: v3(f.x), y: v3(f.y), z: v3(f.z) };
  }

  /** The selection model of what is on screen (faces, edges, bodies and the questions the Select commands ask); null when nothing is shown. */
  selModel(): SelModel | null {
    const view = this.lastView;
    if (!view) return null;
    if (this.selCache?.view === view) return this.selCache.model;
    const m = this.bodyFaces();
    if (!m && !view.edges?.length) return null;
    const model = new SelModel({ mesh: m, edges: view.edges ?? [], surfaceOf: (n) => this.surfaceOf(n) });
    this.selCache = { view, model };
    return model;
  }
  private selCache: { view: object; model: SelModel } | null = null;

  /** The bounding box of the body on screen (null when there is none). */
  bodyBox(): { min: number[]; max: number[] } | null {
    return this.lastView?.box ?? null;
  }

  /** The triangles of the body on screen (three vertices per triangle, xyz, millimetres); null when there is none. */
  bodyMesh(): { positions: ArrayLike<number> } | null {
    const m = this.lastView?.mesh;
    return m && m.positions.length > 0 ? m : null;
  }

  /** The mesh arrays of the body on screen with normals and face ids (what the handles measure faces from), or null. */
  bodyFaces(): { positions: ArrayLike<number>; normals: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] } | null {
    const m = this.lastView?.mesh;
    return m && m.normals && m.triFace && m.faceIds && m.positions.length > 0 ? { positions: m.positions, normals: m.normals, triFace: m.triFace, faceIds: m.faceIds } : null;
  }


  // ---- Inspect tools: read-only kernel queries on the current state. They never edit the document; null on a kernel error or no document. ----
  private async inspect<T>(go: (s: Session) => Promise<T | null>): Promise<T | null> {
    const s = this.session;
    if (!s) return null;
    try { return await go(s); } catch (e) { this.store.notify((e as Error).message, 'error'); return null; }
  }
  /** Volume, area, centre of mass and principal moments (unit density) of the body. */
  massProps(): Promise<MassRaw | null> { return this.inspect((s) => queryMass(s)); }
  /** The kernel's measurement of one or two faces / edges. */
  measure(refs: Array<Record<string, unknown>>): Promise<KernelMeasure | null> { return this.inspect((s) => queryMeasure(s, refs)); }
  /** Pairs of solid bodies that share volume. */
  interference(): Promise<Interference | null> { return this.inspect((s) => queryInterference(s)); }

  /** STEP text of the current document, from the kernel (null when nothing is loaded). */
  async exportStep(): Promise<string | null> {
    return this.session ? this.session.step() : null;
  }

  /** The edges of the body on screen: persistent key, the two faces they separate, and a point on each. */
  bodyEdges(): ViewEdge[] {
    return this.lastView?.edges ?? [];
  }

  /** Whether a new extrude of this sketch should be flipped so a cut goes into the material. */
  extrudeFlip(sketchId: string, op: 'add' | 'cut'): boolean {
    const v = this.lastView;
    const frame = v?.sketches.find((x) => x.id === sketchId)?.frame ?? null;
    return defaultFlip(op, frame, v?.box ?? null);
  }

  /** The body to show: the whole model, or the first `rollbackCount()` features while rolled back. */
  private async bodyNow(s: Session): Promise<ShownBody | null> {
    const n = this.rollbackCount();
    let body: Awaited<ReturnType<Session['bodyForView']>>;
    let surfaces: ViewSurface[] | null = null;
    if (n === null) {
      body = await s.bodyForView();
      // the surface bodies come from the same regen (the session keeps its reply): no second request
      if (typeof s.regenReport === 'function') surfaces = hasSurfaceFeatures(this.sdoc().features as never) ? toViewSurfaces((await s.regenReport()).surfaces) : [];
    } else {
      const r = await s.preview([], { upTo: n });
      if (!r.ok) this.store.notify(r.hints?.map((h) => h.hint).join('; ') || r.schemaError || 'rolled-back model did not build', 'error');
      body = r.body;
      if (r.surfaces !== undefined) surfaces = hasSurfaceFeatures(this.sdoc().features as never) ? toViewSurfaces(r.surfaces) : [];
    }
    return withSurfaces(body, surfaces ?? (await this.surfacesFor(s, this.sdoc(), n)));
  }

  /**
   * The surface bodies (sheets) of a document. `Session.bodyForView` returns only the solid, so with a feature that makes a
   * sheet this asks the kernel for the regen reply itself (a second regen on its own tag); documents without one pay nothing.
   */
  private async surfacesFor(s: Session, doc: PartDoc, upTo: number | null, suffix = '-surf'): Promise<ViewSurface[]> {
    if (!hasSurfaceFeatures(doc.features as never)) return [];
    const k = (s as unknown as { kernel?: { request(m: unknown): Promise<{ ok?: boolean; result?: unknown }> } }).kernel;
    return fetchSurfaces(k, doc, `${this.previewTagOf(s)}${suffix}`, upTo);
  }

  /** The surface bodies on screen: feature id and the face names it owns. */
  surfaceBodies(): Array<{ id: string; faces: string[] }> {
    return (this.shown?.surfaces ?? []).map((x) => ({ id: x.id, faces: x.mesh.faceIds }));
  }
  /** The id of the surface body that owns this face or edge name (null for the solid, or a corner). */
  surfaceOf(name: string): string | null {
    return surfaceNames(this.shown).get(name) ?? null;
  }
  /** True while the viewport shows an imported STEP body (view only) that no edit has replaced yet. */
  private importedOnScreen = false;
  hasImportedBody(): boolean { return this.importedOnScreen; }
  /** Whether the part has a solid on screen (a part of surfaces only has none: no volume, no mass). */
  hasSolid(): boolean {
    return (this.shown?.mesh.triFace.length ?? 0) > 0;
  }

  private async refresh(): Promise<void> {
    const s = this.session;
    if (!s) return;
    this.snap = null;
    this.importedOnScreen = false;
    const ids = this.sdoc().features.map((f) => f.id);
    this.rollbackAnchor = repairAnchor(this.rollbackAnchor, this.lastIds, ids);
    this.lastIds = ids;
    const body = await this.bodyNow(s);
    this.revision++;
    this.shown = body;
    this.lastView = body ? mergedView(body) : null;   // solid and sheets as one mesh: what picking lists, measure and section read
    this.view.setBody(body);
    // everything that can be selected now: faces, edges and the corners at the ends of edges
    const existing = new Set<string>(this.lastView?.mesh?.faceIds ?? []);
    if (body) existing.add(BODY);
    for (const e of (this.lastView?.edges ?? []) as Array<{ key?: string; pts: number[][] }>) {
      if (e.key) existing.add(e.key);
      for (const p of [e.pts[0], e.pts[e.pts.length - 1]]) if (p) existing.add(vertexName(p));
    }
    this.store.dropMissing(existing);
    // errors, repair hints, markers and warnings of the regen the session already holds (no validate / check: the design
    // check runs on its own schedule)
    const rr = typeof s.regenReport === 'function' ? await s.regenReport() : null;
    const report = rr ? { regen: { errors: rr.errors, threads: rr.threads, warnings: rr.warnings }, hints: rr.hints } : await s.verify();
    this.committedExtras = await this.regenExtras(s, this.sdoc(), this.previewTagOf(s), report.regen as unknown as { threads?: unknown[]; warnings?: unknown[] });
    this.applyExtras(this.committedExtras);
    const errors = new Map(report.regen.errors);
    this.committedDiag = this.diagnoseErrors(report.regen.errors, report.hints, this.sdoc().features);
    this.store.featureStatus.value = this.sdoc().features.map((f) => {
      const err = errors.get(f.id);
      if (!err) return { id: f.id, ok: true };
      const hint = report.hints.find((h) => h.feature === f.id && h.code === err.code);
      const root = this.committedDiag.roots.find((r) => r.id === f.id);
      // an error code with no repair text gets the plain advice instead of the raw "error code {params}" line
      const text = root && (!hint?.hint || hint.hint.includes('see the features field table')) ? adviceOf(root) : hint?.hint;
      return { id: f.id, ok: false, code: err.code, hint: text, params: err.params, blockedBy: this.committedDiag.blockedBy[f.id] };
    });
    this.lastGood = this.sdoc();
    this.lastGoodHistory = typeof s.history === 'function' ? s.history().length : 0;
  }
  private lastGoodHistory = 0;
}
